import { mergeProgress, parseProgress, serializeProgress, type ProgressFile } from '../srs/events.ts';
import type { RemoteConfig } from './config.ts';

export type GitHubErrorKind = 'auth' | 'access' | 'notfound' | 'conflict' | 'network' | 'toolarge' | 'other';

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status?: number;
  constructor(kind: GitHubErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
    this.status = status;
  }
}

type Fetch = typeof fetch;

const API = 'https://api.github.com';

export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

const contentsUrl = (cfg: RemoteConfig) =>
  `${API}/repos/${cfg.repo}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;

function headers(cfg: RemoteConfig, json = false): Record<string, string> {
  return {
    Authorization: `Bearer ${cfg.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

function errorFor(status: number, cfg: RemoteConfig): GitHubError {
  switch (status) {
    case 401:
      return new GitHubError('auth', 'GitHub token invalid or expired.', status);
    case 403:
      return new GitHubError(
        'access',
        'GitHub refused the request: the token lacks access to the repo (needs Contents: read and write), or the API rate limit was hit.',
        status,
      );
    case 404:
      return new GitHubError(
        'notfound',
        `Not found: check that ${cfg.repo} exists, that ${cfg.path} is on branch ${cfg.branch}, and that the token has access to the repo.`,
        status,
      );
    case 409:
    case 422:
      return new GitHubError('conflict', 'progress.json changed on GitHub in the meantime.', status);
    default:
      return new GitHubError('other', `GitHub returned HTTP ${status}.`, status);
  }
}

async function request(f: Fetch, url: string, init: RequestInit, cfg: RemoteConfig): Promise<Response> {
  let res: Response;
  try {
    res = await f(url, { ...init, cache: 'no-store' });
  } catch {
    throw new GitHubError('network', 'Could not reach GitHub (offline?).');
  }
  if (!res.ok) throw errorFor(res.status, cfg);
  return res;
}

export interface Pulled {
  file: ProgressFile;
  sha: string;
}

/** GET progress.json, bypassing the HTTP cache. */
export async function pull(cfg: RemoteConfig, f: Fetch = fetch): Promise<Pulled> {
  const res = await request(f, `${contentsUrl(cfg)}?ref=${encodeURIComponent(cfg.branch)}`, { headers: headers(cfg) }, cfg);
  const body = (await res.json()) as { content?: string; encoding?: string; sha?: string; size?: number };
  if (typeof body.sha !== 'string') throw new GitHubError('other', 'Unexpected response from GitHub.');
  if (body.encoding === 'none' || (body.content === '' && (body.size ?? 0) > 0)) {
    throw new GitHubError('toolarge', 'progress.json is too large for the GitHub contents API (over 1 MB).');
  }
  const text = decodeBase64Utf8(body.content ?? '');
  let parsed: unknown = {};
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new GitHubError('other', 'progress.json on GitHub is not valid JSON; refusing to overwrite it.');
    }
  }
  return { file: parseProgress(parsed), sha: body.sha };
}

export interface PushOptions {
  device: string;
  fetch?: Fetch;
  maxAttempts?: number;
}

/**
 * PUT `file` on top of `sha`. If GitHub rejects it because the file changed (409/422),
 * pull, merge, and retry (up to 3 attempts). Returns what was actually written and the new sha.
 */
export async function push(
  cfg: RemoteConfig,
  file: ProgressFile,
  sha: string | null,
  opts: PushOptions,
): Promise<Pulled> {
  const f = opts.fetch ?? fetch;
  const attempts = opts.maxAttempts ?? 3;
  let current = file;
  let baseSha = sha;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await request(
        f,
        contentsUrl(cfg),
        {
          method: 'PUT',
          headers: headers(cfg, true),
          body: JSON.stringify({
            message: `Sync progress (${opts.device})`,
            content: encodeBase64Utf8(serializeProgress(current)),
            ...(baseSha ? { sha: baseSha } : {}),
            branch: cfg.branch,
          }),
        },
        cfg,
      );
      const body = (await res.json()) as { content?: { sha?: string } };
      const newSha = body.content?.sha;
      if (typeof newSha !== 'string') throw new GitHubError('other', 'Unexpected response from GitHub.');
      return { file: current, sha: newSha };
    } catch (e) {
      if (!(e instanceof GitHubError) || e.kind !== 'conflict' || attempt >= attempts) {
        if (e instanceof GitHubError && e.kind === 'conflict') {
          throw new GitHubError('conflict', 'Could not sync: progress.json keeps changing on GitHub. Try again.', e.status);
        }
        throw e;
      }
      const remote = await pull(cfg, f);
      current = mergeProgress(current, remote.file);
      baseSha = remote.sha;
    }
  }
}
