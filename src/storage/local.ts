import { del, get, set } from 'idb-keyval';
import { emptyProgress, parseProgress, type ProgressFile } from '../srs/events.ts';

/** What is kept on this device between visits. */
export interface LocalData {
  file: ProgressFile;
  /** Number of local changes (answers, flags, settings) not yet pushed. */
  pending: number;
  /** Blob sha of progress.json when it was last seen on GitHub. */
  sha: string | null;
  lastSyncedAt?: number;
}

export interface LocalStore {
  load(): Promise<LocalData>;
  save(data: LocalData): Promise<void>;
  clear(): Promise<void>;
}

export const emptyLocal = (): LocalData => ({ file: emptyProgress(), pending: 0, sha: null });

function normalize(raw: unknown): LocalData {
  if (!raw || typeof raw !== 'object') return emptyLocal();
  const o = raw as Record<string, unknown>;
  return {
    file: parseProgress(o.file),
    pending: typeof o.pending === 'number' && o.pending > 0 ? Math.floor(o.pending) : 0,
    sha: typeof o.sha === 'string' ? o.sha : null,
    lastSyncedAt: typeof o.lastSyncedAt === 'number' ? o.lastSyncedAt : undefined,
  };
}

export function createMemoryStore(initial?: LocalData): LocalStore {
  let data: LocalData | undefined = initial;
  return {
    async load() {
      return data ? structuredClone(data) : emptyLocal();
    },
    async save(d) {
      data = structuredClone(d);
    },
    async clear() {
      data = undefined;
    },
  };
}

const KEY = 'llmq.progress.v1';

/** IndexedDB-backed store. If IndexedDB is unavailable, falls back to memory (progress then lasts only for the tab). */
export function createIdbStore(): LocalStore {
  const fallback = createMemoryStore();
  let broken = false;
  return {
    async load() {
      if (broken) return fallback.load();
      try {
        return normalize(await get(KEY));
      } catch {
        broken = true;
        return fallback.load();
      }
    },
    async save(d) {
      if (!broken) {
        try {
          await set(KEY, d);
          return;
        } catch {
          broken = true;
        }
      }
      await fallback.save(d);
    },
    async clear() {
      try {
        await del(KEY);
      } catch {
        /* ignore */
      }
      await fallback.clear();
    },
  };
}
