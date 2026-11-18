import { describe, expect, it } from 'vitest';
import { buildBank } from '../bank/load.ts';
import { BOOK_TITLE } from '../bank/types.ts';
import { concept, makeBank, section, DAY, HOUR, MIN, review } from '../test/helpers.ts';
import { buildQueue, queueCounts, scopeIds, type PracticeScope } from './queue.ts';
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
    expect(queueCounts(now, states(events), bank, { chapter: 'B' })).toMatchObject({ total: 2, seen: 1, newRemaining: 1 });
  });
});

describe('source focus', () => {
  const quant = 'Quant research';
  const rl = 'RL & agentic RL interview notes';
  const mixed = buildBank([
    section('book', 'Book chapter', 1),
    { ...section('rl', 'RL chapter', 2), source: rl },
    { ...section('probability', 'Probability', 3), source: quant },
    { ...section('validation', 'Validation', 4), source: quant },
  ], [
    { chapter: 'Book chapter', concepts: [concept('l1', 'book')] },
    { chapter: 'RL chapter', concepts: [concept('r1', 'rl')] },
    { chapter: 'Probability', concepts: [concept('q1', 'probability', 2), concept('q2', 'probability'), { ...concept('retired', 'probability'), retired: true }] },
    { chapter: 'Validation', concepts: [concept('q3', 'validation')] },
  ]);
  const mixedStates = (events: ProgressEvent[]) => replay(events, mixed.byId.keys());
  const pick = (events: ProgressEvent[], now: number, scope: PracticeScope = { source: quant }) =>
    buildQueue(now, mixedStates(events), mixed, { targetRecall: 0.9 }, scope);

  it.each([
    [BOOK_TITLE, ['l1']],
    [rl, ['r1']],
    [quant, ['q1', 'q2', 'q3']],
  ])('includes every active concept across the chapters of %s', (source, expected) => {
    expect(scopeIds(mixed, { source })).toEqual(expected);
  });

  it('introduces new concepts from every chapter in the selected source', () => {
    const events: ProgressEvent[] = [];
    const order: string[] = [];
    for (let i = 0; i < 3; i++) {
      const item = pick(events, T0 + i * MIN)!;
      expect(item.tier).toBe('new');
      order.push(item.concept.id);
      events.push(review(item.concept.id, T0 + i * MIN, 4));
    }
    expect(order).toEqual(['q1', 'q3', 'q2']);
  });

  it('excludes other sources when selecting due learning cards', () => {
    const events = [review('l1', T0, 1), review('r1', T0, 1), review('q2', T0 + MIN, 1)];
    expect(pick(events, T0 + 5 * MIN)).toMatchObject({ concept: { id: 'q2' }, tier: 'learning' });
  });

  it('excludes other sources when selecting due reviews', () => {
    const events = ['l1', 'r1', 'q3'].flatMap((id) => [review(id, T0, 3), review(id, T0 + 10 * MIN, 3)]);
    expect(pick(events, T0 + 60 * DAY)).toMatchObject({ concept: { id: 'q3' }, tier: 'due' });
  });

  it('keeps extra practice and variant rotation within the selected source', () => {
    const events = [review('l1', T0 - DAY, 1), review('r1', T0 - DAY, 1),
      ...['q1', 'q2', 'q3'].map((id, i) => review(id, T0 + i * HOUR, 4))];
    expect(pick(events, T0 + 2 * HOUR + MIN)).toMatchObject({ concept: { id: 'q1' }, tier: 'extra', variantIndex: 1 });
  });

  it('can narrow a source to one chapter without leaking incompatible chapters', () => {
    expect(scopeIds(mixed, { source: quant, chapter: 'Validation' })).toEqual(['q3']);
    expect(pick([], T0, { source: quant, chapter: 'Validation' })?.concept.id).toBe('q3');
    expect(pick([], T0, { source: quant, chapter: 'Book chapter' })).toBeNull();
    expect(pick([], T0, { source: 'Missing source' })).toBeNull();
    expect(queueCounts(T0, new Map(), mixed, { source: 'Missing source' }).total).toBe(0);
  });

  it('counts progress across the selected source and restores all sources when unfiltered', () => {
    const states = mixedStates([review('l1', T0, 1), review('r1', T0, 1), review('q2', T0, 1)]);
    expect(queueCounts(T0 + 5 * MIN, states, mixed, { source: quant })).toEqual({
      total: 3, seen: 1, newRemaining: 2, learning: 1, learningDue: 1, reviewDue: 0,
    });
    expect(queueCounts(T0 + 5 * MIN, states, mixed)).toMatchObject({ total: 5, seen: 3, newRemaining: 2, learningDue: 3 });
  });
});
