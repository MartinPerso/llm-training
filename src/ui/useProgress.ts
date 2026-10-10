import { useMemo, useSyncExternalStore } from 'react';
import { bank } from '../bank/index.ts';
import { replay, type CardState } from '../srs/scheduler.ts';
import type { ProgressFile } from '../srs/events.ts';
import { sync } from '../storage/instance.ts';
import type { Snapshot } from '../storage/sync.ts';

const cache = new WeakMap<ProgressFile, Map<string, CardState>>();

/** Card states for a progress file, memoized by file identity (the manager creates a new file object on every change). */
export function statesFor(file: ProgressFile): Map<string, CardState> {
  let s = cache.get(file);
  if (!s) {
    s = replay(file.events, bank.byId.keys(), file.settings);
    cache.set(file, s);
  }
  return s;
}

export function useSnapshot(): Snapshot {
  return useSyncExternalStore(sync.subscribe, sync.getSnapshot);
}

export function useProgress() {
  const snap = useSnapshot();
  const states = useMemo(() => statesFor(snap.file), [snap.file]);
  return { file: snap.file, status: snap.status, ready: snap.ready, states };
}
