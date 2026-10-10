import { describe, expect, it } from 'vitest';
import { makeBank, review, DAY } from '../test/helpers.ts';
import { autoRating } from './rating.ts';
import { replay } from './scheduler.ts';
import { seededOrder } from './shuffle.ts';
import { chapterStats, mostMissed } from './stats.ts';

describe('autoRating', () => {
  it('wrong is Again; right is Guessed=2, Knew it=3, Easy=4', () => {
    expect(autoRating(false)).toBe(1);
    expect(autoRating(false, 'easy')).toBe(1);
    expect(autoRating(true, 'guessed')).toBe(2);
    expect(autoRating(true, 'knew')).toBe(3);
    expect(autoRating(true, 'easy')).toBe(4);
  });
});

describe('seededOrder', () => {
  it('is a deterministic permutation', () => {
    const a = seededOrder(4, 'concept:0');
    expect(seededOrder(4, 'concept:0')).toEqual(a);
    expect([...a].sort()).toEqual([0, 1, 2, 3]);
    const seen = new Set(Array.from({ length: 30 }, (_, i) => seededOrder(4, `concept:${i}`).join()));
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('stats', () => {
  const bank = makeBank();
  const T = Date.UTC(2026, 0, 10, 12);
  const events = [
    review('a1', T - 5 * DAY, 1), // old: outside the 3-day window
    review('a1', T - 2 * DAY, 3),
    review('a2', T - DAY, 1),
    review('a2', T - DAY + 1, 2),
    review('b1', T - 1000, 1),
    review('b1', T - 500, 1),
  ];
  const states = replay(events, bank.byId.keys());

  it('per-chapter seen/total and 3-day recall', () => {
    const [a, b] = chapterStats(T, events, states, bank);
    expect(a).toMatchObject({ chapter: 'A', seen: 2, total: 3, recentReviews: 3 });
    expect(a!.recall).toBeCloseTo(2 / 3);
    expect(b).toMatchObject({ chapter: 'B', seen: 1, total: 2, recentReviews: 2, recall: 0 });
  });

  it('most missed concepts', () => {
    const m = mostMissed(states, 10);
    expect(m.map((x) => x.id)).toEqual(['b1', 'a1', 'a2']);
    expect(m[0]).toEqual({ id: 'b1', misses: 2, reviews: 2 });
    expect(mostMissed(states, 1)).toHaveLength(1);
  });
});
