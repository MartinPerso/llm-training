import type { Bank } from '../bank/load.ts';
import { isReview, type ProgressEvent } from './events.ts';
import type { CardState } from './scheduler.ts';

export const RECENT_DAYS = 3;

export interface ChapterStats {
  chapter: string;
  seen: number;
  total: number;
  /** Fraction of reviews in the last 3 days with rating > 1, or null if there are none. */
  recall: number | null;
  recentReviews: number;
}

export function chapterStats(
  now: number,
  events: readonly ProgressEvent[],
  states: Map<string, CardState>,
  bank: Bank,
): ChapterStats[] {
  const since = now - RECENT_DAYS * 86_400_000;
  return bank.chapters.map((chapter) => {
    const ids = bank.idsByChapter.get(chapter) ?? [];
    const set = new Set(ids);
    let recent = 0;
    let right = 0;
    for (const e of events) {
      if (isReview(e) && e.t >= since && e.t <= now && set.has(e.c)) {
        recent++;
        if (e.r > 1) right++;
      }
    }
    return {
      chapter,
      seen: ids.filter((id) => states.has(id)).length,
      total: ids.length,
      recall: recent ? right / recent : null,
      recentReviews: recent,
    };
  });
}

export interface MissedConcept {
  id: string;
  misses: number;
  reviews: number;
}

/** Concepts with the most "Again" answers (at least one), most missed first. */
export function mostMissed(states: Map<string, CardState>, limit = 10): MissedConcept[] {
  return [...states.entries()]
    .filter(([, s]) => s.lapses > 0)
    .map(([id, s]) => ({ id, misses: s.lapses, reviews: s.reviews }))
    .sort((a, b) => b.misses - a.misses || b.misses / b.reviews - a.misses / a.reviews || (a.id < b.id ? -1 : 1))
    .slice(0, limit);
}
