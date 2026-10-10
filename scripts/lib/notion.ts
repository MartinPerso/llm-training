// Minimal client for Notion's unofficial public-page API (no auth needed for public pages).

export interface NotionBlock {
  id: string;
  type: string;
  content?: string[];
  parent_id?: string;
  properties?: Record<string, unknown>;
  format?: Record<string, unknown>;
  [key: string]: unknown;
}

export type BlockMap = Record<string, NotionBlock>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ClientOptions {
  host: string;
  delayMs?: number;
  retries?: number;
  log?: (msg: string) => void;
}

/** Unwraps `{value: {value: block}}` / `{value: block}` / `{role, value}` shapes. */
export function unwrapBlock(entry: unknown): NotionBlock | undefined {
  let v = (entry as { value?: unknown } | undefined)?.value;
  for (let i = 0; i < 3 && v && typeof v === 'object' && 'value' in (v as object) && !('type' in (v as object)); i++) {
    v = (v as { value: unknown }).value;
  }
  if (v && typeof v === 'object' && 'id' in v && 'type' in v) return v as NotionBlock;
  return undefined;
}

export function mergeRecordMap(into: BlockMap, recordMap: { block?: Record<string, unknown> } | undefined): number {
  let added = 0;
  for (const entry of Object.values(recordMap?.block ?? {})) {
    const block = unwrapBlock(entry);
    if (block && !into[block.id]) {
      into[block.id] = block;
      added++;
    }
  }
  return added;
}

/** Child ids referenced by a block's `content` that are not in the map yet. */
export function missingChildIds(blocks: BlockMap, rootId: string): string[] {
  const missing = new Set<string>();
  const seen = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const b = blocks[id];
    if (!b) {
      if (id !== rootId) missing.add(id);
      continue;
    }
    for (const c of b.content ?? []) stack.push(c);
  }
  return [...missing];
}

export class NotionClient {
  private opts: Required<Omit<ClientOptions, 'log'>> & { log: (m: string) => void };
  constructor(opts: ClientOptions) {
    this.opts = { delayMs: 250, retries: 5, log: () => {}, ...opts };
  }

  private async post(path: string, body: unknown): Promise<any> {
    const url = `https://${this.opts.host}${path}`;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
      await sleep(this.opts.delayMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) return await res.json();
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status} from ${path}`);
        } else {
          throw new Error(`HTTP ${res.status} from ${path}: ${(await res.text()).slice(0, 200)}`);
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('HTTP 4') && !e.message.startsWith('HTTP 429')) throw e;
        lastErr = e;
      }
      const wait = Math.min(30_000, 1000 * 2 ** attempt);
      this.opts.log(`  retry ${attempt + 1} for ${path} in ${wait}ms (${String(lastErr)})`);
      await sleep(wait);
    }
    throw lastErr;
  }

  /** Loads the whole page tree: paginated page chunks, then any children missing from the chunks. */
  async loadPage(pageId: string): Promise<BlockMap> {
    const blocks: BlockMap = {};
    let cursor: unknown = { stack: [] };
    for (let chunk = 0; chunk < 500; chunk++) {
      const res = await this.post('/api/v3/loadPageChunk', {
        pageId,
        limit: 100,
        cursor,
        chunkNumber: chunk,
        verticalColumns: false,
      });
      const added = mergeRecordMap(blocks, res.recordMap);
      this.opts.log(`  chunk ${chunk}: +${added} blocks (total ${Object.keys(blocks).length})`);
      cursor = res.cursor;
      if (!res.cursor?.stack?.length) break;
    }
    for (let round = 0; round < 50; round++) {
      const missing = missingChildIds(blocks, pageId);
      if (!missing.length) break;
      this.opts.log(`  fetching ${missing.length} missing blocks`);
      let progress = 0;
      for (let i = 0; i < missing.length; i += 100) {
        const batch = missing.slice(i, i + 100);
        const res = await this.post('/api/v3/syncRecordValuesMain', {
          requests: batch.map((id) => ({ pointer: { table: 'block', id }, version: -1 })),
        });
        progress += mergeRecordMap(blocks, res.recordMap);
      }
      if (!progress) {
        this.opts.log(`  ${missing.length} blocks could not be fetched; giving up on them`);
        break;
      }
    }
    return blocks;
  }
}
