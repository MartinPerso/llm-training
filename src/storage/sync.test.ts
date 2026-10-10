import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyProgress, type ProgressFile } from '../srs/events.ts';
import { review } from '../test/helpers.ts';
import type { RemoteConfig } from './config.ts';
import { FakeGitHub } from './fakeGitHub.ts';
import { createMemoryStore, emptyLocal } from './local.ts';
import { DEBOUNCE_MS, MAX_WAIT_MS, SyncManager } from './sync.ts';

const cfg: RemoteConfig = { token: 'test-token', repo: 'me/progress', branch: 'main', path: 'progress.json' };
const file = (events: ProgressFile['events']): ProgressFile => ({ ...emptyProgress(), events });

function setup(opts: { gh?: FakeGitHub; config?: RemoteConfig | null; device?: string; online?: () => boolean } = {}) {
  const gh = opts.gh ?? new FakeGitHub();
  const store = createMemoryStore();
  const config = opts.config === undefined ? cfg : opts.config;
  const mgr = new SyncManager({
    store,
    getConfig: () => config,
    getDevice: () => opts.device ?? 'test',
    fetch: gh.fetch,
    isOnline: opts.online,
  });
  return { gh, store, mgr };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-01T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('SyncManager', () => {
  it('is local-only without a token and never calls GitHub', async () => {
    const { gh, mgr } = setup({ config: null });
    await mgr.init();
    await mgr.addEvent(review('a', 1));
    await vi.advanceTimersByTimeAsync(5 * MAX_WAIT_MS);
    expect(gh.requests).toHaveLength(0);
    expect(mgr.getSnapshot().status).toMatchObject({ state: 'local-only', pendingCount: 1 });
    expect(mgr.getSnapshot().file.events).toHaveLength(1);
  });

  it('happy path: pull on start, answer, debounced push, status transitions', async () => {
    const gh = new FakeGitHub(file([review('remote', 100)]));
    const { mgr, store } = setup({ gh });
    const states: string[] = [];
    mgr.subscribe(() => states.push(mgr.getSnapshot().status.state));

    await mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(mgr.getSnapshot().file.events.map((e) => e.c)).toEqual(['remote']);
    expect(mgr.getSnapshot().status.state).toBe('synced');
    expect(gh.puts).toBe(0); // nothing to push

    await mgr.addEvent(review('mine', 200));
    expect(mgr.getSnapshot().status).toMatchObject({ state: 'pending', pendingCount: 1 });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(gh.puts).toBe(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(gh.puts).toBe(1);
    expect(gh.current().events.map((e) => e.c)).toEqual(['remote', 'mine']);
    expect(mgr.getSnapshot().status).toMatchObject({ state: 'synced', pendingCount: 0 });
    expect(mgr.getSnapshot().status.lastSyncedAt).toBeTypeOf('number');
    expect(states).toContain('syncing');

    // persisted locally, including the new sha
    const saved = await store.load();
    expect(saved.sha).toBe(gh.sha);
    expect(saved.pending).toBe(0);
    expect(saved.file.events).toHaveLength(2);
  });

  it('debounce: answers keep postponing the push until the max wait', async () => {
    const { gh, mgr } = setup();
    await mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    let answered = 0;
    // an answer every 10 s: the 15 s debounce never elapses, the 60 s max wait does
    for (let i = 0; i < 5; i++) {
      await mgr.addEvent(review(`c${answered++}`, Date.now()));
      await vi.advanceTimersByTimeAsync(10_000);
    }
    expect(gh.puts).toBe(0);
    await mgr.addEvent(review(`c${answered++}`, Date.now()));
    await vi.advanceTimersByTimeAsync(10_000 + 1000);
    expect(gh.puts).toBe(1);
    expect(gh.current().events).toHaveLength(6);
  });

  it('at most one push per minute while answering', async () => {
    const { gh, mgr } = setup();
    await mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    await mgr.addEvent(review('a', Date.now()));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(gh.puts).toBe(1);
    await mgr.addEvent(review('b', Date.now()));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10); // would be due, but the last push was < 60 s ago
    expect(gh.puts).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(gh.puts).toBe(2);
  });

  it('flush() pushes immediately (tab hidden)', async () => {
    const { gh, mgr } = setup();
    await mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    await mgr.addEvent(review('a', Date.now()));
    await mgr.flush();
    expect(gh.puts).toBe(1);
    expect(mgr.getSnapshot().status.state).toBe('synced');
  });

  it('conflict then retry: the other device\'s events are merged, not overwritten', async () => {
    const gh = new FakeGitHub(file([review('a', 1)]));
    const { mgr } = setup({ gh });
    await mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    await mgr.addEvent(review('phone', 50));
    // The other device pushes right after our pull, before our PUT.
    let done = false;
    gh.onRequest = (req) => {
      if (req.method === 'GET' && !done) {
        done = true;
        queueMicrotask(() => gh.externalWrite(file([review('a', 1), review('computer', 40)])));
      }
    };
    await mgr.syncNow();
    expect(gh.puts).toBe(2);
    expect(gh.current().events.map((e) => e.c)).toEqual(['a', 'computer', 'phone']);
    expect(mgr.getSnapshot().file.events.map((e) => e.c)).toEqual(['a', 'computer', 'phone']);
    expect(mgr.getSnapshot().status).toMatchObject({ state: 'synced', pendingCount: 0 });
  });

  it('two devices converge on the union of their events', async () => {
    const gh = new FakeGitHub();
    const phone = setup({ gh, device: 'phone' });
    const pc = setup({ gh, device: 'computer' });
    await phone.mgr.init();
    await pc.mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    await phone.mgr.addEvent(review('p1', 10));
    await pc.mgr.addEvent(review('c1', 20));
    await phone.mgr.syncNow();
    await pc.mgr.syncNow();
    await phone.mgr.syncNow();
    const ids = (m: SyncManager) => m.getSnapshot().file.events.map((e) => e.c);
    expect(ids(phone.mgr)).toEqual(['p1', 'c1']);
    expect(ids(pc.mgr)).toEqual(['p1', 'c1']);
    expect(gh.current().events.map((e) => e.c)).toEqual(['p1', 'c1']);
    expect(gh.requests.filter((r) => r.method === 'PUT').length).toBeLessThanOrEqual(2);
  });

  it('keeps events added while a sync is in flight', async () => {
    const gh = new FakeGitHub();
    const { mgr } = setup({ gh });
    await mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    await mgr.addEvent(review('first', 1));
    let injected = false;
    gh.onRequest = (req) => {
      if (req.method === 'PUT' && !injected) {
        injected = true;
        void mgr.addEvent(review('during', 2));
      }
    };
    await mgr.syncNow();
    expect(mgr.getSnapshot().file.events.map((e) => e.c)).toEqual(['first', 'during']);
    expect(mgr.getSnapshot().status.pendingCount).toBe(1);
    await vi.advanceTimersByTimeAsync(2 * MAX_WAIT_MS);
    expect(gh.current().events.map((e) => e.c)).toEqual(['first', 'during']);
    expect(mgr.getSnapshot().status).toMatchObject({ state: 'synced', pendingCount: 0 });
  });

  it('UTF-8 survives the full round trip (é, θ, emoji)', async () => {
    const gh = new FakeGitHub();
    const a = setup({ gh });
    await a.mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    const typed = 'café θ_t 🧠 日本';
    await a.mgr.addEvent({ ...review('x', 5), a: typed });
    await a.mgr.addEvent({ c: 'x', t: 6, flag: 'ambiguë: θ 🧠' });
    await a.mgr.syncNow();
    const b = setup({ gh });
    await b.mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    const events = b.mgr.getSnapshot().file.events;
    expect(events[0]).toMatchObject({ a: typed });
    expect(events[1]).toMatchObject({ flag: 'ambiguë: θ 🧠' });
  });

  it('offline: reports it, keeps pending, retries and recovers', async () => {
    const gh = new FakeGitHub();
    gh.offline = true;
    const { mgr } = setup({ gh });
    await mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(mgr.getSnapshot().status.state).toBe('offline');
    await mgr.addEvent(review('a', 1));
    await mgr.syncNow();
    expect(mgr.getSnapshot().status).toMatchObject({ state: 'offline', pendingCount: 1 });
    gh.offline = false;
    await vi.advanceTimersByTimeAsync(61_000);
    expect(mgr.getSnapshot().status).toMatchObject({ state: 'synced', pendingCount: 0 });
    expect(gh.current().events).toHaveLength(1);
  });

  it('navigator offline short-circuits without requests', async () => {
    const { gh, mgr } = setup({ online: () => false });
    await mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(gh.requests).toHaveLength(0);
    expect(mgr.getSnapshot().status.state).toBe('offline');
  });

  it('auth errors surface as "error" and are not retried automatically', async () => {
    const gh = new FakeGitHub();
    gh.failNext(401);
    const { mgr } = setup({ gh });
    await mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(mgr.getSnapshot().status.state).toBe('error');
    expect(mgr.getSnapshot().status.error).toMatch(/invalid or expired/);
    const before = gh.requests.length;
    await vi.advanceTimersByTimeAsync(10 * MAX_WAIT_MS);
    expect(gh.requests.length).toBe(before);
  });

  it('restores local state (pending, sha) on the next start and pushes leftovers', async () => {
    const gh = new FakeGitHub();
    const store = createMemoryStore({ ...emptyLocal(), file: file([review('left-over', 7)]), pending: 1 });
    const mgr = new SyncManager({ store, getConfig: () => cfg, getDevice: () => 'd', fetch: gh.fetch });
    await mgr.init();
    expect(mgr.getSnapshot().ready).toBe(true);
    expect(mgr.getSnapshot().file.events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(gh.current().events.map((e) => e.c)).toEqual(['left-over']);
    expect(mgr.getSnapshot().status.pendingCount).toBe(0);
  });

  it('settings changes sync, and the newer settings win', async () => {
    const gh = new FakeGitHub();
    const a = setup({ gh });
    const b = setup({ gh });
    await a.mgr.init();
    await b.mgr.init();
    await vi.advanceTimersByTimeAsync(0);
    await a.mgr.updateSettings({ targetRecall: 0.95 });
    await a.mgr.syncNow();
    await b.mgr.syncNow();
    expect(b.mgr.getSnapshot().file.settings.targetRecall).toBe(0.95);
    expect(gh.current().settings.targetRecall).toBe(0.95);
  });

  it('importFile merges and marks pending; resetLocal clears everything', async () => {
    const { mgr, store } = setup({ config: null });
    await mgr.init();
    await mgr.addEvent(review('a', 1));
    await mgr.importFile(file([review('a', 1), review('b', 2)]));
    expect(mgr.getSnapshot().file.events).toHaveLength(2);
    await mgr.resetLocal();
    expect(mgr.getSnapshot().file.events).toHaveLength(0);
    expect(mgr.getSnapshot().status.pendingCount).toBe(0);
    expect((await store.load()).file.events).toHaveLength(0);
  });
});
