import { isReview, type ProgressEvent } from './events.ts';
import type { CardState } from './scheduler.ts';

export const WINDOW_DAYS = 10;
/** Everything should be introduced by this day. */
export const INTRO_DAYS = 6;

export const startOfLocalDay = (t: number): number => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** Time of the first review, or null before the first answer. */
export function firstReviewTime(events: readonly ProgressEvent[]): number | null {
  let min: number | null = null;
  for (const e of events) if (isReview(e) && (min === null || e.t < min)) min = e.t;
  return min;
}

/** Local calendar day number: 1 on the day of the first answer. */
export function dayNumber(now: number, first: number): number {
  const a = new Date(startOfLocalDay(first));
  const b = new Date(startOfLocalDay(now));
  // Count calendar days (robust to DST: compare via UTC of the Y/M/D parts).
  const days = Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000,
  );
  return days + 1;
}

/** New concepts to introduce today so everything is introduced by day 6 (all remaining after that). */
export function paceHint(day: number, remainingNew: number): number {
  if (remainingNew <= 0) return 0;
  return Math.ceil(remainingNew / Math.max(1, INTRO_DAYS - (day - 1)));
}

export type WindowPhase = 'not-started' | 'running' | 'finished';

export interface WindowInfo {
  phase: WindowPhase;
  /** 1..10 while running, 0 before the start, WINDOW_DAYS + 1 or more once finished. */
  day: number;
  remainingNew: number;
  introducedToday: number;
  /** Total concepts to introduce today (including the ones already introduced today). */
  targetToday: number;
  /** Still to introduce today to follow the pace. */
  leftToday: number;
  /** After day 6 the hint is "introduce all remaining". */
  introduceAll: boolean;
  onTrack: boolean;
}

export function windowInfo(args: {
  now: number;
  firstReview: number | null;
  states: Map<string, CardState>;
  /** Active concepts in scope. */
  total: number;
  remainingNew: number;
}): WindowInfo {
  const { now, firstReview, states, total, remainingNew } = args;
  const phase: WindowPhase =
    firstReview === null ? 'not-started' : dayNumber(now, firstReview) > WINDOW_DAYS ? 'finished' : 'running';
  const day = firstReview === null ? 0 : dayNumber(now, firstReview);
  const paceDay = Math.max(1, day);

  const dayStart = startOfLocalDay(now);
  let introducedToday = 0;
  for (const s of states.values()) if (s.firstSeen >= dayStart) introducedToday++;
  const introducedBefore = Math.max(0, total - remainingNew - introducedToday);

  const targetToday = paceHint(paceDay, remainingNew + introducedToday);
  const leftToday = Math.max(0, targetToday - introducedToday);

  // By the start of day d, (d-1)/6 of the bank should already be introduced.
  const expectedBefore = Math.floor((total * Math.min(INTRO_DAYS, paceDay - 1)) / INTRO_DAYS);
  const onTrack = phase === 'not-started' || introducedBefore >= expectedBefore;

  return {
    phase,
    day,
    remainingNew,
    introducedToday,
    targetToday,
    leftToday,
    introduceAll: paceDay >= INTRO_DAYS,
    onTrack,
  };
}
