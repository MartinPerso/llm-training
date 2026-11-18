import type { Bank } from '../bank/load.ts';
import type { Concept } from '../bank/types.ts';
import { dueTime, isLearning, retrievability, type CardState } from './scheduler.ts';
import { DEFAULT_SETTINGS, type Settings } from './settings.ts';

export type Tier = 'learning' | 'due' | 'new' | 'extra';

export interface QueueItem {
  concept: Concept;
  variantIndex: number;
  tier: Tier;
}

export interface PracticeScope {
  /** Include all chapters belonging to this source. */
  source?: string | null;
  /** Restrict the session to one chapter. */
  chapter?: string | null;
}

export interface QueueOptions extends PracticeScope {
  /** The concept that was just answered: not returned again unless nothing else exists. */
  justAnswered?: string | null;
  /** Extra practice skips concepts answered within this window (default 10 minutes). */
  recentWindowMs?: number;
}

export const RECENT_WINDOW_MS = 10 * 60 * 1000;

const byIdOrder = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Next variant to show: the one after the last variant shown (so it differs when there are 2+). */
export function pickVariant(concept: Concept, state: CardState | undefined): number {
  const n = concept.variants.length;
  if (!state) return 0;
  return (state.lastVariant + 1) % n;
}

function scopeChapters(bank: Bank, { source, chapter }: PracticeScope): string[] {
  return bank.chapters.filter((c) => (!source || bank.sourceOf.get(c) === source) && (!chapter || c === chapter));
}

/** Active concept ids of the source/chapter in scope, in book order. */
export function scopeIds(bank: Bank, scope: PracticeScope = {}): string[] {
  return scopeChapters(bank, scope).flatMap((chapter) => bank.idsByChapter.get(chapter) ?? []);
}

/**
 * Next unseen concept: round-robin across chapters (the chapter with the fewest introduced
 * concepts goes next, ties in book order), in book order within a chapter.
 */
function pickNew(
  bank: Bank,
  states: Map<string, CardState>,
  scope: PracticeScope,
  excluded: Set<string>,
): string | null {
  let best: { id: string; seen: number; rank: number } | null = null;
  const chapters = scopeChapters(bank, scope);
  chapters.forEach((ch, rank) => {
    const ids = bank.idsByChapter.get(ch) ?? [];
    let seen = 0;
    let firstNew: string | null = null;
    for (const id of ids) {
      if (states.has(id)) seen++;
      else if (firstNew === null && !excluded.has(id)) firstNew = id;
    }
    if (firstNew === null) return;
    if (!best || seen < best.seen || (seen === best.seen && rank < best.rank)) {
      best = { id: firstNew, seen, rank };
    }
  });
  return (best as { id: string } | null)?.id ?? null;
}

function select(
  now: number,
  states: Map<string, CardState>,
  bank: Bank,
  settings: Settings,
  scope: PracticeScope,
  excluded: Set<string>,
  recentWindowMs: number,
): { id: string; tier: Tier } | null {
  const candidates: Array<[string, CardState]> = [];
  for (const id of scopeIds(bank, scope)) {
    const state = states.get(id);
    if (state && !excluded.has(id)) candidates.push([id, state]);
  }

  // 1. Learning / relearning cards that are due, earliest first.
  const learning = candidates
    .filter(([, s]) => isLearning(s) && dueTime(s) <= now)
    .sort(([ia, a], [ib, b]) => dueTime(a) - dueTime(b) || byIdOrder(ia, ib));
  if (learning[0]) return { id: learning[0][0], tier: 'learning' };

  // 2. Review cards that are due, lowest current retrievability first.
  const due = candidates
    .filter(([, s]) => !isLearning(s) && dueTime(s) <= now)
    .map(([id, s]) => ({ id, r: retrievability(s, now, settings) }))
    .sort((a, b) => a.r - b.r || byIdOrder(a.id, b.id));
  if (due[0]) return { id: due[0].id, tier: 'due' };

  // 3. New concepts.
  const fresh = pickNew(bank, states, scope, excluded);
  if (fresh) return { id: fresh, tier: 'new' };

  // 4. Extra practice: the seen concept most likely to be forgotten, skipping recent answers.
  const extra = candidates
    .filter(([, s]) => recentWindowMs <= 0 || now - s.lastReview >= recentWindowMs)
    .map(([id, s]) => ({ id, r: retrievability(s, now, settings) }))
    .sort((a, b) => a.r - b.r || byIdOrder(a.id, b.id));
  if (extra[0]) return { id: extra[0].id, tier: 'extra' };
  return null;
}

/**
 * The next item to practice, following the plan's order (learning due, reviews due, new, extra).
 * Returns null only when the (scoped) bank is empty.
 */
export function buildQueue(
  now: number,
  states: Map<string, CardState>,
  bank: Bank,
  settings: Settings = DEFAULT_SETTINGS,
  opts: QueueOptions = {},
): QueueItem | null {
  const { source = null, chapter = null, justAnswered = null, recentWindowMs = RECENT_WINDOW_MS } = opts;
  const attempts: Array<[Set<string>, number]> = [
    [new Set(justAnswered ? [justAnswered] : []), recentWindowMs],
    [new Set(justAnswered ? [justAnswered] : []), 0],
    [new Set(), 0],
  ];
  for (const [excluded, window] of attempts) {
    const pick = select(now, states, bank, settings, { source, chapter }, excluded, window);
    if (pick) {
      const concept = bank.byId.get(pick.id) as Concept;
      return { concept, variantIndex: pickVariant(concept, states.get(pick.id)), tier: pick.tier };
    }
  }
  return null;
}

export interface QueueCounts {
  /** Learning/relearning cards due now. */
  learningDue: number;
  /** Review cards due now. */
  reviewDue: number;
  /** Learning/relearning cards, due or not. */
  learning: number;
  /** Concepts never answered. */
  newRemaining: number;
  seen: number;
  total: number;
}

export function queueCounts(
  now: number,
  states: Map<string, CardState>,
  bank: Bank,
  scope: PracticeScope = {},
): QueueCounts {
  const ids = scopeIds(bank, scope);
  const c: QueueCounts = { learningDue: 0, reviewDue: 0, learning: 0, newRemaining: 0, seen: 0, total: ids.length };
  for (const id of ids) {
    const s = states.get(id);
    if (!s) {
      c.newRemaining++;
      continue;
    }
    c.seen++;
    const due = dueTime(s) <= now;
    if (isLearning(s)) {
      c.learning++;
      if (due) c.learningDue++;
    } else if (due) c.reviewDue++;
  }
  return c;
}
