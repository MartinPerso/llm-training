// Token, repo and device name live in localStorage (never in the progress file).
// Every access is wrapped: storage can throw (private mode, blocked site data).

export const DEFAULT_REPO = 'MartinPerso/llm-training-progress';
export const DEFAULT_BRANCH = 'main';
export const PROGRESS_PATH = 'progress.json';

const K_TOKEN = 'llmq.token';
const K_REPO = 'llmq.repo';
const K_DEVICE = 'llmq.device';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null): void {
  try {
    if (value === null || value === '') localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export interface RemoteConfig {
  token: string;
  repo: string;
  branch: string;
  path: string;
}

export const getToken = (): string => read(K_TOKEN) ?? '';
export const setToken = (t: string): void => write(K_TOKEN, t.trim());
export const getRepo = (): string => read(K_REPO) || DEFAULT_REPO;
export const setRepo = (r: string): void => write(K_REPO, r.trim() === DEFAULT_REPO ? null : r.trim());

export function defaultDeviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? 'phone' : 'computer';
}
export const getDevice = (): string => read(K_DEVICE) || defaultDeviceName();
export const setDevice = (d: string): void => write(K_DEVICE, d.trim());

/** Null when no token is set: the app then works fully locally. */
export function getRemoteConfig(): RemoteConfig | null {
  const token = getToken();
  if (!token) return null;
  return { token, repo: getRepo(), branch: DEFAULT_BRANCH, path: PROGRESS_PATH };
}
