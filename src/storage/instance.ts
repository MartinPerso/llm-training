import { getDevice, getRemoteConfig } from './config.ts';
import { createIdbStore } from './local.ts';
import { SyncManager } from './sync.ts';

export const sync = new SyncManager({
  store: createIdbStore(),
  getConfig: getRemoteConfig,
  getDevice,
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
});

let started = false;

/** Load local data, kick off the first pull, and wire the browser events. Safe to call twice. */
export function startSync(): void {
  if (started) return;
  started = true;
  void sync.init();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void sync.flush();
  });
  window.addEventListener('online', () => {
    if (getRemoteConfig()) void sync.syncNow();
  });
}
