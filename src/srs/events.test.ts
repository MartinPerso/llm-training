import { describe, expect, it } from 'vitest';
import { review } from '../test/helpers.ts';
import {
  emptyProgress,
  mergeProgress,
  parseProgress,
  serializeProgress,
  type FlagEvent,
  type ProgressFile,
} from './events.ts';

const file = (events: ProgressFile['events'], updatedAt = 0, targetRecall = 0.9): ProgressFile => ({
  schema: 1,
  settings: { targetRecall, updatedAt },
  events,
});

const flag = (c: string, t: number, note = 'unclear'): FlagEvent => ({ c, t, flag: note });

const A = file([review('x', 1000), review('y', 3000, 1), flag('x', 5000)], 10, 0.9);
const B = file([review('x', 1000), review('x', 2000, 4), review('z', 4000)], 20, 0.95);
const C = file([review('y', 3000, 1), review('y', 6000, 2), flag('z', 7000)], 15, 0.85);

describe('mergeProgress', () => {
  it('unions events, dedupes by concept+t+kind, and sorts by t', () => {
    const m = mergeProgress(A, B);
    expect(m.events.map((e) => [e.c, e.t])).toEqual([
      ['x', 1000],
      ['x', 2000],
      ['y', 3000],
      ['z', 4000],
      ['x', 5000],
    ]);
  });

  it('keeps a flag and a review with the same concept and time', () => {
    const m = mergeProgress(file([review('x', 1)]), file([flag('x', 1)]));
    expect(m.events).toHaveLength(2);
  });

  it('the newer settings win', () => {
    expect(mergeProgress(A, B).settings).toEqual({ targetRecall: 0.95, updatedAt: 20 });
    expect(mergeProgress(B, A).settings).toEqual({ targetRecall: 0.95, updatedAt: 20 });
  });

  it('is commutative', () => {
    expect(mergeProgress(A, B)).toEqual(mergeProgress(B, A));
    expect(mergeProgress(B, C)).toEqual(mergeProgress(C, B));
  });

  it('is associative', () => {
    expect(mergeProgress(mergeProgress(A, B), C)).toEqual(mergeProgress(A, mergeProgress(B, C)));
    expect(mergeProgress(mergeProgress(C, A), B)).toEqual(mergeProgress(C, mergeProgress(B, A)));
  });

  it('is idempotent', () => {
    const m = mergeProgress(A, B);
    expect(mergeProgress(m, m)).toEqual(m);
    expect(mergeProgress(m, B)).toEqual(m);
    expect(mergeProgress(m, A)).toEqual(m);
  });

  it('is deterministic even if two events share a key but differ', () => {
    const x = file([{ ...review('x', 1), a: 'one' }]);
    const y = file([{ ...review('x', 1), a: 'two' }]);
    expect(mergeProgress(x, y)).toEqual(mergeProgress(y, x));
    expect(mergeProgress(x, y).events).toHaveLength(1);
  });

  it('breaks settings ties deterministically', () => {
    const x = file([], 5, 0.9);
    const y = file([], 5, 0.85);
    expect(mergeProgress(x, y)).toEqual(mergeProgress(y, x));
  });
});

describe('parseProgress / serializeProgress', () => {
  it('round-trips', () => {
    const m = mergeProgress(A, B);
    expect(parseProgress(JSON.parse(serializeProgress(m)))).toEqual(m);
  });

  it('is tolerant of empty or odd files and drops malformed events', () => {
    expect(parseProgress({})).toEqual(emptyProgress());
    expect(parseProgress(null)).toEqual(emptyProgress());
    const p = parseProgress({ events: [{ c: 'x', t: 1, r: 3, v: 0, ms: 5 }, { c: 'x', t: 2, r: 9 }, 'junk', { t: 3 }] });
    expect(p.events).toHaveLength(1);
  });

  it('writes one event per line', () => {
    const lines = serializeProgress(A).split('\n');
    expect(lines.filter((l) => l.includes('"c":')).length).toBe(3);
  });
});
