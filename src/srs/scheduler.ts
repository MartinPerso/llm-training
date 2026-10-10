import { createEmptyCard, fsrs, State, type Card, type FSRS, type Grade } from 'ts-fsrs';
import { compareEvents, eventKey, isReview, type ProgressEvent } from './events.ts';
import { DEFAULT_SETTINGS, type Settings } from './settings.ts';

const fsrsByRetention = new Map<number, FSRS>();

/**
 * FSRS configured for this app: fuzz off (replay must be deterministic), classic learning steps
 * (ts-fsrs v5 applies them when `enable_short_term` is true).
 */
export function getFsrs(retention: number): FSRS {
  let f = fsrsByRetention.get(retention);
  if (!f) {
    f = fsrs({
      request_retention: retention,
      enable_fuzz: false,
      enable_short_term: true,
      learning_steps: ['1m', '10m'],
      relearning_steps: ['10m'],
    });
    fsrsByRetention.set(retention, f);
  }
  return f;
}

export interface CardState {
  card: Card;
  /** Variant shown at the last review. */
  lastVariant: number;
  /** Number of "Again" answers so far (the card's own `lapses` only counts Review-state misses). */
  lapses: number;
  /** Number of reviews so far. */
  reviews: number;
  /** Time of the first review (epoch ms). */
  firstSeen: number;
  /** Time of the last review (epoch ms). */
  lastReview: number;
}

/**
 * Replay review events through FSRS, per concept, in time order. Pure and deterministic: input
 * order and duplicates do not matter. Only concepts with at least one review (and listed in
 * `conceptIds`) appear in the result; a missing concept is a new one.
 */
export function replay(
  events: readonly ProgressEvent[],
  conceptIds: Iterable<string>,
  settings: Settings = DEFAULT_SETTINGS,
): Map<string, CardState> {
  const known = new Set(conceptIds);
  const f = getFsrs(settings.targetRecall);
  const reviews = events.filter(isReview).filter((e) => known.has(e.c)).sort(compareEvents);

  const states = new Map<string, CardState>();
  let lastKey = '';
  for (const e of reviews) {
    const key = eventKey(e);
    if (key === lastKey) continue; // duplicate event
    lastKey = key;
    const prev = states.get(e.c);
    const now = new Date(e.t);
    const card = prev ? prev.card : createEmptyCard(now);
    const next = f.next(card, now, e.r as Grade).card;
    states.set(e.c, {
      card: next,
      lastVariant: e.v,
      lapses: (prev?.lapses ?? 0) + (e.r === 1 ? 1 : 0),
      reviews: (prev?.reviews ?? 0) + 1,
      firstSeen: prev?.firstSeen ?? e.t,
      lastReview: e.t,
    });
  }
  return states;
}

export const dueTime = (s: CardState): number => s.card.due.getTime();

export const isLearning = (s: CardState): boolean =>
  s.card.state === State.Learning || s.card.state === State.Relearning;

/** Predicted probability of recalling the concept right now (0..1). */
export function retrievability(s: CardState, now: number, settings: Settings = DEFAULT_SETTINGS): number {
  return getFsrs(settings.targetRecall).get_retrievability(s.card, new Date(now), false);
}
