import { describe, expect, it } from 'vitest';
import { buildBank } from '../bank/load.ts';
import { concept, makeBank, DAY, HOUR, MIN, review } from '../test/helpers.ts';
import { buildQueue, queueCounts } from './queue.ts';
import { replay } from './scheduler.ts';
import type { ProgressEvent } from './events.ts';

const bank = makeBank();
const ids = [...bank.byId.keys()];
const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);
const states = (events: ProgressEvent[]) => replay(events, ids);
const next = (events: ProgressEvent[], now: number, opts = {}) =>
  buildQueue(now, states(events), bank, { targetRecall: 0.9 }, opts);

describe('buildQueue tiers', () => {
  it('book order: chapters are A then B, concepts in file order', () => {
    expect(bank.concepts.map((c) => c.id)).toEqual(['a1', 'a2', 'a3', 'b1', 'b2']);
  });

  it('tier 3: new concepts round-robin across chapters, book order within a chapter', () => {
    const order: string[] = [];
    const events: ProgressEvent[] = [];
    let t = T0;
    for (let i = 0; i < 5; i++) {
      const item = next(events, t, { justAnswered: order.at(-1) ?? null });
      expect(item?.tier).toBe('new');
      order.push(item!.concept.id);
      events.push(review(item!.concept.id, t, 4));
      t += MIN;
    }
    expect(order).toEqual(['a1', 'b1', 'a2', 'b2', 'a3']);
  });

  it('tier 1: learning cards whose due time passed, earliest due first, beating everything', () => {
    const events = [review('a1', T0, 1), review('b1', T0 + 30_000, 1)]; // due T0+1m and T0+1m30
    expect(next(events, T0 + 2 * MIN)?.concept.id).toBe('a1');
    expect(next(events, T0 + 2 * MIN)?.tier).toBe('learning');
    expect(next(events, T0 + 30_000 + 10_000)?.tier).toBe('new'); // not yet due
    expect(next(events, T0 + 2 * MIN, { justAnswered: 'a1' })?.concept.id).toBe('b1');
  });

  it('tier 2: due reviews, lowest retrievability first, after learning cards', () => {
    const events = [
      review('a1', T0, 3),
      review('a1', T0 + 10 * MIN, 3),
      review('b1', T0, 4),
      review('b1', T0 + 10 * MIN, 4),
    ];
    const now = T0 + 60 * DAY;
    const st = states(events);
    expect(st.get('a1')!.card.due.getTime()).toBeLessThan(now);
    const item = next(events, now);
    expect(item?.tier).toBe('due');
    expect(item?.concept.id).toBe('a1'); // 'Good' twice is less stable than 'Easy' twice
    const withLearning = [...events, review('a2', now - 5 * MIN, 1)];
    expect(next(withLearning, now)?.tier).toBe('learning');
  });

  it('due reviews come before new concepts; new concepts come before extra practice', () => {
    const graduated = [review('a1', T0, 3), review('a1', T0 + 10 * MIN, 3)];
    expect(next(graduated, T0 + 60 * DAY)?.tier).toBe('due');
    expect(next(graduated, T0 + 11 * MIN)?.tier).toBe('new');
  });

  it('tier 4: extra practice picks the lowest retrievability and skips the last 10 minutes', () => {
    const events: ProgressEvent[] = [];
    const last = ['a1', 'a2', 'a3', 'b1', 'b2'].map((id, i) => {
      const at = T0 + i * HOUR;
      events.push(review(id, at, 4), review(id, at + 10 * MIN, 4));
      return at + 10 * MIN;
    });
    const now = last[4]! + 2 * MIN; // nothing is due yet
    const item = next(events, now);
    expect(item?.tier).toBe('extra');
    expect(item?.concept.id).toBe('a1'); // oldest review => lowest retrievability
    // a1 answered a minute ago: excluded from extra practice for 10 minutes
    const justA1 = [...events, review('a1', now - MIN, 3)];
    const again = next(justA1, now);
    expect(again?.tier).toBe('extra');
    expect(again?.concept.id).toBe('a2');
  });

  it('extra practice still returns something when everything was answered in the last 10 minutes', () => {
    const one = buildBank([], [{ chapter: 'A', concepts: [concept('a1', 'x')] }]);
    const events = [review('a1', T0, 4), review('a1', T0 + MIN, 4)];
    const item = buildQueue(T0 + 2 * MIN, replay(events, ['a1']), one, { targetRecall: 0.9 }, { justAnswered: 'a1' });
    expect(item?.concept.id).toBe('a1');
  });

  it('never returns the concept just answered if anything else is available', () => {
    const events = [review('a1', T0, 1)];
    const item = next(events, T0 + 5 * MIN, { justAnswered: 'a1' });
    expect(item?.concept.id).not.toBe('a1');
  });

  it('chapter focus restricts every tier', () => {
    expect(next([], T0, { chapter: 'B' })?.concept.id).toBe('b1');
    const events = [review('a1', T0, 1)];
    expect(next(events, T0 + 5 * MIN, { chapter: 'B' })?.concept.id).toBe('b1');
    expect(next(events, T0 + 5 * MIN, { chapter: 'A' })?.concept.id).toBe('a1');
  });

  it('returns null for an empty scope', () => {
    expect(next([], T0, { chapter: 'nope' })).toBeNull();
  });
});

describe('variant choice', () => {
  it('uses variant 0 for new concepts and avoids the last variant afterwards (a1 has 2 variants)', () => {
    expect(next([], T0)?.variantIndex).toBe(0);
    const item = next([review('a1', T0, 1, 0)], T0 + 2 * MIN);
    expect(item?.concept.id).toBe('a1');
    expect(item?.variantIndex).toBe(1);
    expect(next([review('a1', T0, 1, 1)], T0 + 2 * MIN)?.variantIndex).toBe(0);
  });

  it('single-variant concepts always return variant 0', () => {
    const item = next([review('a2', T0, 1, 0)], T0 + 2 * MIN);
    expect(item?.concept.id).toBe('a2');
    expect(item?.variantIndex).toBe(0);
  });
});

describe('queueCounts', () => {
  it('counts learning, due, new', () => {
    const events = [
      review('a1', T0, 3),
      review('a1', T0 + 10 * MIN, 3),
      review('b1', T0 + 40 * DAY, 1),
      review('a2', T0 + 40 * DAY, 3),
    ];
    const now = T0 + 40 * DAY + 20 * MIN;
    const c = queueCounts(now, states(events), bank);
    expect(c).toMatchObject({ total: 5, seen: 3, newRemaining: 2, learning: 2, learningDue: 2, reviewDue: 1 });
    expect(queueCounts(now, states(events), bank, 'B')).toMatchObject({ total: 2, seen: 1, newRemaining: 1 });
  });
});
