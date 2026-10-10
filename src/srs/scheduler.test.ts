import { State } from 'ts-fsrs';
import { describe, expect, it } from 'vitest';
import { DAY, MIN, review } from '../test/helpers.ts';
import { dueTime, isLearning, replay, retrievability } from './scheduler.ts';
import type { ProgressEvent } from './events.ts';

const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const ids = ['a', 'b', 'c'];

const events: ProgressEvent[] = [
  review('a', T0, 3),
  review('a', T0 + 10 * MIN, 3, 1),
  review('a', T0 + 2 * DAY, 3),
  review('b', T0 + MIN, 1),
  review('b', T0 + 2 * MIN, 3),
  review('c', T0 + 3 * MIN, 4),
  { c: 'c', t: T0 + 4 * MIN, flag: 'ambiguous' },
];

describe('replay', () => {
  it('is deterministic', () => {
    expect(replay(events, ids)).toEqual(replay(events, ids));
    expect(replay(events, ids)).toEqual(replay(structuredClone(events), ids));
  });

  it('depends on review order only through t', () => {
    const shuffled = [events[4]!, events[0]!, events[6]!, events[2]!, events[5]!, events[1]!, events[3]!];
    expect(replay(shuffled, ids)).toEqual(replay(events, ids));
    expect(replay([...events].reverse(), ids)).toEqual(replay(events, ids));
  });

  it('ignores duplicates, flags, and unknown concepts', () => {
    const noisy = [...events, ...events, review('ghost', T0, 3)];
    expect(replay(noisy, ids)).toEqual(replay(events, ids));
    expect(replay(events, ids).has('ghost')).toBe(false);
  });

  it('tracks counters and the last variant', () => {
    const s = replay(events, ids);
    const a = s.get('a')!;
    expect(a.reviews).toBe(3);
    expect(a.firstSeen).toBe(T0);
    expect(a.lastReview).toBe(T0 + 2 * DAY);
    expect(a.lastVariant).toBe(0);
    expect(s.get('b')!.lapses).toBe(1);
    expect(s.get('b')!.lastVariant).toBe(0);
    expect(replay([review('a', T0, 3, 2)], ids).get('a')!.lastVariant).toBe(2);
    expect(s.has('zzz')).toBe(false);
  });

  it('uses learning steps: Again goes back to a short step, then graduates', () => {
    const again = replay([review('a', T0, 1)], ids).get('a')!;
    expect(isLearning(again)).toBe(true);
    expect(dueTime(again) - T0).toBe(MIN);

    const good = replay([review('a', T0, 3)], ids).get('a')!;
    expect(good.card.state).toBe(State.Learning);
    expect(dueTime(good) - T0).toBe(10 * MIN);

    const graduated = replay([review('a', T0, 3), review('a', T0 + 10 * MIN, 3)], ids).get('a')!;
    expect(graduated.card.state).toBe(State.Review);
    expect(dueTime(graduated) - (T0 + 10 * MIN)).toBeGreaterThanOrEqual(DAY);
  });

  it('a lapse sends a review card to relearning', () => {
    const s = replay([review('a', T0, 4), review('a', T0 + 5 * DAY, 1)], ids).get('a')!;
    expect(s.card.state).toBe(State.Relearning);
    expect(s.lapses).toBe(1);
  });

  it('higher target recall schedules sooner', () => {
    const evs = [review('a', T0, 4), review('a', T0 + 5 * DAY, 3)];
    const low = replay(evs, ids, { targetRecall: 0.85 }).get('a')!;
    const high = replay(evs, ids, { targetRecall: 0.95 }).get('a')!;
    expect(dueTime(high)).toBeLessThan(dueTime(low));
  });

  it('retrievability drops over time and is ~target at the due time', () => {
    const s = replay([review('a', T0, 4), review('a', T0 + DAY, 3)], ids).get('a')!;
    const atReview = retrievability(s, s.lastReview);
    const atDue = retrievability(s, dueTime(s));
    const later = retrievability(s, dueTime(s) + 10 * DAY);
    expect(atReview).toBeGreaterThan(atDue);
    expect(atDue).toBeGreaterThan(later);
    expect(atDue).toBeCloseTo(0.9, 1);
  });
});
