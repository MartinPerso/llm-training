import { describe, expect, it } from 'vitest';
import type { Section } from '../../src/bank/types.ts';
import { markCovered } from './covered.ts';

const make = (): Section[] => [
  { id: 'a', chapter: 'Parallelism', title: 'Parallelism', level: 1, order: 0, hash: 'h1' },
  { id: 'b', chapter: 'Parallelism', title: 'Data parallelism', level: 2, order: 1, hash: 'h2', coveredHash: 'old' },
  { id: 'c', chapter: 'Inference', title: 'Inference', level: 1, order: 2, hash: 'h3' },
];

describe('markCovered', () => {
  it('covers every section of the chapter and nothing else', () => {
    const s = make();
    expect(markCovered(s, ['parallelism'])).toBe(2);
    expect(s.map((x) => x.coveredHash)).toEqual(['h1', 'h2', undefined]);
  });
  it('covers only the named sections when given ids', () => {
    const s = make();
    expect(markCovered(s, ['parallelism'], ['b'])).toBe(1);
    expect(s.map((x) => x.coveredHash)).toEqual([undefined, 'h2', undefined]);
  });
  it('"all" covers everything', () => {
    const s = make();
    expect(markCovered(s, ['all'])).toBe(3);
  });
});
