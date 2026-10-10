import { describe, expect, it } from 'vitest';
import { copiedRuns, findOverlaps, shingles, words } from './overlap.ts';

const source = [
  '- the KV cache stores the keys and values of every previous token so that decoding never recomputes them\n- $2 \\cdot L \\cdot K \\cdot H$ values per token',
];

describe('words', () => {
  it('lowercases, drops punctuation and math', () => {
    expect(words('Hello, **World** $x^2$ it\'s 3.5')).toEqual(['hello', 'world', "it's", '3', '5']);
  });
});

describe('copiedRuns', () => {
  const set = shingles(source);
  it('finds a verbatim run of 7+ words, even with other markdown', () => {
    const runs = copiedRuns('Note that the **keys and values** of every previous token are kept.', set);
    expect(runs).toEqual(['the keys and values of every previous token']);
  });
  it('ignores short coincidences and rewordings', () => {
    expect(copiedRuns('Keys and values of earlier tokens are kept, so no recomputation is needed.', set)).toEqual([]);
  });
  it('merges overlapping windows into one maximal run', () => {
    const runs = copiedRuns('the kv cache stores the keys and values of every previous token so that decoding never recomputes them', set);
    expect(runs).toHaveLength(1);
    expect(runs[0].split(' ')).toHaveLength(18);
  });
});

describe('findOverlaps', () => {
  const data = {
    chapter: 'Inference',
    concepts: [
      {
        id: 'inference.kv-cache.a',
        section: 's',
        variants: [
          { kind: 'recall', prompt: 'What is stored?', answer: 'It stores the keys and values of every previous token' },
          { kind: 'mcq', prompt: 'p', choices: ['x', 'y', 'z', 'previous token so that decoding never recomputes them'], correct: 0, explanation: 'fine' },
        ],
      },
      { id: 'inference.kv-cache.retired', section: 's', retired: true, variants: [{ kind: 'recall', prompt: 'p', answer: 'the keys and values of every previous token' }] },
    ],
  };
  it('reports concept, variant, field and phrase; skips retired concepts', () => {
    const o = findOverlaps(data, source);
    expect(o.map((x) => [x.concept, x.variant, x.field])).toEqual([
      ['inference.kv-cache.a', 0, 'answer'],
      ['inference.kv-cache.a', 1, 'choices[3]'],
    ]);
    expect(o[0].phrase).toBe('stores the keys and values of every previous token');
  });
  it('tolerates malformed data', () => {
    expect(findOverlaps(undefined, source)).toEqual([]);
    expect(findOverlaps({ concepts: [null, { id: 3 }] }, source)).toEqual([]);
  });
});
