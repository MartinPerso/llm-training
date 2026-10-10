import { DEFAULT_SETTINGS, clampRecall, type Settings } from './settings.ts';

export type ReviewEvent = {
  c: string; // concept id
  v: number; // variant index
  t: number; // epoch ms
  r: 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
  ms: number; // time to answer
  a?: string; // what you typed / picked
};
export type FlagEvent = { c: string; t: number; flag: string };
export type ProgressEvent = ReviewEvent | FlagEvent;

export type StoredSettings = Settings & { updatedAt: number };

export interface ProgressFile {
  schema: 1;
  settings: StoredSettings;
  events: ProgressEvent[];
}

export const isFlag = (e: ProgressEvent): e is FlagEvent => 'flag' in e;
export const isReview = (e: ProgressEvent): e is ReviewEvent => !('flag' in e);

/** Stable identity of an event: concept + timestamp + kind. */
export const eventKey = (e: ProgressEvent): string => `${e.c}|${e.t}|${isFlag(e) ? 'f' : 'r'}`;

export function emptyProgress(): ProgressFile {
  return { schema: 1, settings: { ...DEFAULT_SETTINGS, updatedAt: 0 }, events: [] };
}

/** Total order: time, then key. Used for sorting and for deterministic replay. */
export function compareEvents(a: ProgressEvent, b: ProgressEvent): number {
  if (a.t !== b.t) return a.t - b.t;
  const ka = eventKey(a);
  const kb = eventKey(b);
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

const canon = (e: unknown): string => JSON.stringify(e);

/** Union of events (deduplicated by key, sorted by time) and the newer settings. Pure. */
export function mergeProgress(a: ProgressFile, b: ProgressFile): ProgressFile {
  const byKey = new Map<string, ProgressEvent>();
  for (const e of [...a.events, ...b.events]) {
    const k = eventKey(e);
    const prev = byKey.get(k);
    // Same key but different payload (should not happen): keep the smaller JSON so the result
    // does not depend on argument order.
    if (!prev || canon(e) < canon(prev)) byKey.set(k, e);
  }
  const events = [...byKey.values()].sort(compareEvents);

  let settings: StoredSettings;
  if (a.settings.updatedAt !== b.settings.updatedAt) {
    settings = a.settings.updatedAt > b.settings.updatedAt ? a.settings : b.settings;
  } else {
    settings = canon(a.settings) <= canon(b.settings) ? a.settings : b.settings;
  }
  return { schema: 1, settings: { ...settings }, events };
}

export function appendEvents(file: ProgressFile, events: ProgressEvent[]): ProgressFile {
  return mergeProgress(file, { schema: 1, settings: file.settings, events });
}

export function withSettings(file: ProgressFile, patch: Partial<Settings>, now: number): ProgressFile {
  const next = { ...file.settings, ...patch };
  next.targetRecall = clampRecall(next.targetRecall);
  return { ...file, settings: { ...next, updatedAt: now } };
}

function parseEvent(x: unknown): ProgressEvent | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (typeof o.c !== 'string' || typeof o.t !== 'number' || !Number.isFinite(o.t)) return null;
  if (typeof o.flag === 'string') return { c: o.c, t: o.t, flag: o.flag };
  const r = o.r;
  if (r !== 1 && r !== 2 && r !== 3 && r !== 4) return null;
  const v = typeof o.v === 'number' && Number.isInteger(o.v) && o.v >= 0 ? o.v : 0;
  const ms = typeof o.ms === 'number' && Number.isFinite(o.ms) ? o.ms : 0;
  const ev: ReviewEvent = { c: o.c, v, t: o.t, r, ms };
  if (typeof o.a === 'string') ev.a = o.a;
  return ev;
}

/** Tolerant parser for files read from disk or GitHub (an empty/`{}` file becomes an empty progress). */
export function parseProgress(raw: unknown): ProgressFile {
  const out = emptyProgress();
  if (!raw || typeof raw !== 'object') return out;
  const o = raw as Record<string, unknown>;
  const s = o.settings as Record<string, unknown> | undefined;
  if (s && typeof s === 'object') {
    out.settings = {
      targetRecall: typeof s.targetRecall === 'number' ? clampRecall(s.targetRecall) : DEFAULT_SETTINGS.targetRecall,
      updatedAt: typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt) ? s.updatedAt : 0,
    };
  }
  if (Array.isArray(o.events)) {
    const events = o.events.map(parseEvent).filter((e): e is ProgressEvent => e !== null);
    return mergeProgress(out, { schema: 1, settings: out.settings, events });
  }
  return out;
}

/** One event per line so the git history of the progress repo stays readable. */
export function serializeProgress(file: ProgressFile): string {
  const events = file.events.map((e) => '    ' + JSON.stringify(e)).join(',\n');
  return (
    '{\n  "schema": 1,\n  "settings": ' +
    JSON.stringify(file.settings) +
    ',\n  "events": [' +
    (events ? '\n' + events + '\n  ' : '') +
    ']\n}\n'
  );
}
