import {
  appendEvents,
  mergeProgress,
  serializeProgress,
  withSettings,
  type ProgressEvent,
  type ProgressFile,
} from '../srs/events.ts';
import type { Settings } from '../srs/settings.ts';
import type { RemoteConfig } from './config.ts';
import { GitHubError, pull, push } from './github.ts';
import type { LocalStore } from './local.ts';

export type SyncState = 'local-only' | 'synced' | 'pending' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  lastSyncedAt?: number;
  pendingCount: number;
  error?: string;
}

export interface Snapshot {
  file: ProgressFile;
  status: SyncStatus;
  /** False until the local copy has been loaded. */
  ready: boolean;
}

export const DEBOUNCE_MS = 15_000;
export const MAX_WAIT_MS = 60_000;
export const MIN_PUSH_INTERVAL_MS = 60_000;
export const RETRY_MS = 60_000;

export interface SyncDeps {
  store: LocalStore;
  getConfig: () => RemoteConfig | null;
  getDevice: () => string;
  fetch?: typeof fetch;
  now?: () => number;
  isOnline?: () => boolean;
}

type Listener = () => void;

/**
 * Local-first progress holder + GitHub sync.
 * - `init()` loads the local copy (UI can render), then pulls and merges if a token is set.
 * - `addEvent()` saves locally, marks pending and schedules a debounced push
 *   (15 s debounce, 60 s max wait, at most one push per minute).
 * - Every sync is pull, merge, PUT with the sha (retrying on conflicts), store the new sha.
 */
export class SyncManager {
  private readonly deps: SyncDeps;
  private file: ProgressFile;
  private pending = 0;
  private sha: string | null = null;
  private lastSyncedAt: number | undefined;
  private syncing = false;
  private lastError: { kind: GitHubError['kind']; message: string } | null = null;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstPendingAt: number | null = null;
  private lastPushAt = Number.NEGATIVE_INFINITY;
  private running: Promise<void> | null = null;
  private rerun = false;
  private saveChain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<Listener>();
  private snapshot: Snapshot;

  constructor(deps: SyncDeps) {
    this.deps = deps;
    this.file = { schema: 1, settings: { targetRecall: 0.9, updatedAt: 0 }, events: [] };
    this.snapshot = this.makeSnapshot(false);
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  // ---- React-friendly store API ----
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): Snapshot => this.snapshot;

  private makeSnapshot(ready: boolean): Snapshot {
    return { file: this.file, status: this.computeStatus(), ready };
  }

  private publish(ready = this.snapshot.ready): void {
    this.snapshot = this.makeSnapshot(ready);
    this.listeners.forEach((l) => l());
  }

  private computeStatus(): SyncStatus {
    const base = { lastSyncedAt: this.lastSyncedAt, pendingCount: this.pending };
    if (!this.deps.getConfig()) return { state: 'local-only', ...base };
    if (this.syncing) return { state: 'syncing', ...base };
    if (this.lastError) {
      return {
        state: this.lastError.kind === 'network' ? 'offline' : 'error',
        error: this.lastError.message,
        ...base,
      };
    }
    if (this.pending > 0 || this.lastSyncedAt === undefined) return { state: 'pending', ...base };
    return { state: 'synced', ...base };
  }

  // ---- lifecycle ----
  async init(): Promise<void> {
    const local = await this.deps.store.load();
    this.file = local.file;
    this.pending = local.pending;
    this.sha = local.sha;
    this.lastSyncedAt = local.lastSyncedAt;
    this.publish(true);
    if (this.deps.getConfig()) void this.requestSync();
  }

  /** Call after the token/repo changed in settings. */
  configChanged(): void {
    this.lastError = null;
    this.publish();
    if (this.deps.getConfig()) void this.requestSync();
  }

  private persist(): Promise<void> {
    const data = { file: this.file, pending: this.pending, sha: this.sha, lastSyncedAt: this.lastSyncedAt };
    this.saveChain = this.saveChain.then(() => this.deps.store.save(data)).catch(() => undefined);
    return this.saveChain;
  }

  // ---- local changes ----
  private changed(count = 1): Promise<void> {
    this.pending += count;
    this.publish();
    const saved = this.persist();
    this.schedulePush();
    return saved;
  }

  addEvent(event: ProgressEvent): Promise<void> {
    this.file = appendEvents(this.file, [event]);
    return this.changed();
  }

  updateSettings(patch: Partial<Settings>): Promise<void> {
    this.file = withSettings(this.file, patch, this.now());
    return this.changed();
  }

  /** Merge an imported/other-device file into the local copy. */
  importFile(other: ProgressFile): Promise<void> {
    this.file = mergeProgress(this.file, other);
    return this.changed();
  }

  async resetLocal(): Promise<void> {
    this.clearTimer();
    this.file = { schema: 1, settings: { targetRecall: 0.9, updatedAt: 0 }, events: [] };
    this.pending = 0;
    this.sha = null;
    this.lastSyncedAt = undefined;
    this.lastError = null;
    this.firstPendingAt = null;
    this.publish();
    await this.saveChain;
    await this.deps.store.clear();
  }

  // ---- scheduling ----
  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedulePush(): void {
    if (!this.deps.getConfig() || this.pending === 0) return;
    const now = this.now();
    if (this.firstPendingAt === null) this.firstPendingAt = now;
    const maxWaitLeft = this.firstPendingAt + MAX_WAIT_MS - now;
    let delay = Math.min(DEBOUNCE_MS, Math.max(0, maxWaitLeft));
    delay = Math.max(delay, this.lastPushAt + MIN_PUSH_INTERVAL_MS - now);
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.requestSync();
    }, delay);
  }

  /** Best effort, e.g. when the tab is hidden: skip the debounce. */
  flush(): Promise<void> {
    if (!this.deps.getConfig() || this.pending === 0) return Promise.resolve();
    this.clearTimer();
    return this.requestSync();
  }

  /** Manual "Sync now". Resolves when the sync (and any queued re-run) is finished. */
  syncNow(): Promise<void> {
    this.clearTimer();
    return this.requestSync();
  }

  private requestSync(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.syncOnce();
        } while (this.rerun);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  // ---- the sync itself ----
  private async syncOnce(): Promise<void> {
    const cfg = this.deps.getConfig();
    if (!cfg) {
      this.publish();
      return;
    }
    if (this.deps.isOnline && !this.deps.isOnline()) {
      this.lastError = { kind: 'network', message: 'Offline.' };
      this.publish();
      return;
    }
    this.syncing = true;
    this.lastError = null;
    this.publish();
    const f = this.deps.fetch;
    const startPending = this.pending;
    try {
      const remote = await pull(cfg, f);
      let merged = mergeProgress(this.file, remote.file);
      let sha = remote.sha;
      if (serializeProgress(merged) !== serializeProgress(remote.file)) {
        this.lastPushAt = this.now();
        const res = await push(cfg, merged, sha, { device: this.deps.getDevice(), fetch: f });
        merged = res.file;
        sha = res.sha;
      }
      // Keep anything added while the requests were in flight.
      this.file = mergeProgress(this.file, merged);
      this.sha = sha;
      this.pending = Math.max(0, this.pending - startPending);
      this.lastSyncedAt = this.now();
      this.firstPendingAt = this.pending > 0 ? this.now() : null;
      this.syncing = false;
      this.publish();
      await this.persist();
      if (this.pending > 0) this.schedulePush();
    } catch (e) {
      this.syncing = false;
      const err =
        e instanceof GitHubError
          ? { kind: e.kind, message: e.message }
          : { kind: 'other' as const, message: e instanceof Error ? e.message : 'Sync failed.' };
      this.lastError = err;
      this.publish();
      await this.persist();
      // Transient problems are retried later; auth/access problems need the user.
      if (err.kind === 'network' || err.kind === 'conflict' || err.kind === 'other') {
        this.clearTimer();
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.requestSync();
        }, RETRY_MS);
      }
    }
  }
}
