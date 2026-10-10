// In-memory stand-in for the GitHub contents API, for tests only.
import { emptyProgress, parseProgress, serializeProgress, type ProgressFile } from '../srs/events.ts';
import { decodeBase64Utf8, encodeBase64Utf8 } from './github.ts';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  cache?: RequestCache;
  body: Record<string, unknown>;
}

export class FakeGitHub {
  text: string;
  private version = 1;
  requests: RecordedRequest[] = [];
  puts = 0;
  offline = false;
  alwaysConflict: 409 | 422 | null = null;
  private failures: Array<{ status: number; method?: string }> = [];
  /** Optional hook run before each request is answered. */
  onRequest?: (req: RecordedRequest) => void;

  constructor(initial: ProgressFile = emptyProgress()) {
    this.text = serializeProgress(initial);
  }

  get sha(): string {
    return `sha-${this.version}`;
  }

  current(): ProgressFile {
    return parseProgress(JSON.parse(this.text));
  }

  setRaw(text: string): void {
    this.text = text;
    this.version++;
  }

  /** Another device writes directly (bumps the sha). */
  externalWrite(file: ProgressFile): void {
    this.setRaw(serializeProgress(file));
  }

  failNext(status: number, method?: string): void {
    this.failures.push({ status, method });
  }

  fetch: typeof fetch = async (input, init) => {
    const req: RecordedRequest = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: { ...((init?.headers as Record<string, string>) ?? {}) },
      cache: init?.cache,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
    };
    this.requests.push(req);
    this.onRequest?.(req);
    if (this.offline) throw new TypeError('Failed to fetch');
    const idx = this.failures.findIndex((f) => !f.method || f.method === req.method);
    if (idx !== -1) {
      const [f] = this.failures.splice(idx, 1);
      if (req.method === 'PUT') this.puts++;
      return new Response(JSON.stringify({ message: 'nope' }), { status: f!.status });
    }
    if (req.method === 'GET') {
      return json({
        type: 'file',
        encoding: 'base64',
        sha: this.sha,
        size: this.text.length,
        // GitHub wraps base64 at 60 characters
        content: encodeBase64Utf8(this.text).replace(/(.{60})/g, '$1\n'),
      });
    }
    this.puts++;
    if (this.alwaysConflict) return json({ message: 'conflict' }, this.alwaysConflict);
    if (req.body.sha !== this.sha) return json({ message: `is at ${this.sha} but expected ${String(req.body.sha)}` }, 409);
    this.text = decodeBase64Utf8(req.body.content as string);
    this.version++;
    return json({ content: { sha: this.sha }, commit: { sha: 'c' } }, 200);
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
