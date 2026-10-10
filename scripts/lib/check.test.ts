import { describe, expect, it } from 'vitest';
import type { ChapterFile, Section } from '../../src/bank/types.ts';
import { checkBank, formatIssue } from './check.ts';
import { diffSections, needsWork } from './diff.ts';

const sections: Section[] = [
  { id: 'sec-1', chapter: 'Inference', title: 'Inference', level: 1, order: 0, hash: 'h1' },
  { id: 'sec-2', chapter: 'Inference', title: 'KV cache', level: 2, order: 1, hash: 'h2', coveredHash: 'h2' },
  { id: 'sec-3', chapter: 'Precision', title: 'Precision', level: 1, order: 2, hash: 'h3', coveredHash: 'old' },
];

const valid: ChapterFile = {
  chapter: 'Inference',
  concepts: [
    {
      id: 'inference.kv-cache.bytes-per-token',
      section: 'sec-2',
      variants: [
        { kind: 'numeric', prompt: 'How many bytes per token for $L=2$ layers?', answer: 8, tolerance: 0, unit: 'bytes', explanation: 'Because $2L \\cdot 2$.' },
        { kind: 'recall', prompt: 'Why does the cache help?', answer: 'It avoids recomputing keys and values.' },
      ],
    },
    {
      id: 'inference.kv-cache.growth',
      section: 'sec-2',
      variants: [
        { kind: 'mcq', prompt: 'Which grows with $S$?', choices: ['A', 'B', 'C', 'D'], correct: 2, explanation: 'C does.' },
        { kind: 'truefalse', prompt: 'The cache is free.', answer: false, explanation: 'It costs memory: \\$ matters.' },
      ],
    },
  ],
};

const run = (data: unknown, name = 'inference.json') => checkBank([{ name, data }], sections);
const messages = (r: ReturnType<typeof run>) => r.errors.map(formatIssue);

describe('checkBank', () => {
  it('passes a valid file and computes stats', () => {
    const r = run(valid);
    expect(messages(r)).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.stats.totalConcepts).toBe(2);
    expect(r.stats.totalVariants).toBe(4);
    expect(r.stats.kinds).toEqual({ numeric: 1, recall: 1, mcq: 1, truefalse: 1 });
  });

  it('passes with no files', () => {
    expect(checkBank([], sections).errors).toEqual([]);
  });

  it('reports schema, mcq, id, section and math problems in an invalid file', () => {
    const bad = {
      chapter: 'Inference',
      concepts: [
        {
          id: 'inference.kv-cache.a',
          section: 'sec-3', // wrong chapter
          variants: [
            { kind: 'mcq', prompt: 'p', choices: ['A', 'A', 'C', 'D'], correct: 1, explanation: 'e' },
            { kind: 'numeric', prompt: 'p', answer: 1, tolerance: 2, explanation: 'e' },
            { kind: 'recall', prompt: 'bad math $\\frac{1}{$', answer: '' },
            { kind: 'truefalse', prompt: 'price $5', answer: true, explanation: 'e' },
          ],
        },
        { id: 'Bad_ID', section: 'sec-2', variants: [] },
        { id: 'inference.kv-cache.a', section: 'nope', variants: [{ kind: 'truefalse', prompt: 'p', answer: true, explanation: 'e' }] },
        { id: 'other.x.y', section: 'sec-2', variants: [{ kind: 'truefalse', prompt: 'p', answer: true, explanation: 'e' }] },
      ],
    };
    const out = messages(run(bad)).join('\n');
    expect(out).toContain('choices must all be distinct');
    expect(out).toContain('tolerance');
    expect(out).toContain('answer: must not be empty');
    expect(out).toMatch(/KaTeX cannot render \$\\frac\{1\}\{\$/);
    expect(out).toContain('unbalanced "$"');
    expect(out).toContain('belongs to chapter "Precision"');
    expect(out).toContain('Bad_ID');
    expect(out).toContain('at least 1 variant');
    expect(out).toContain('duplicate concept id');
    expect(out).toContain('section nope does not exist');
    expect(out).toContain('other.x.y: id starts with "other"');
  });

  it('rejects mcq with the wrong number of choices, unknown keys and more than 3 variants', () => {
    const q = { kind: 'truefalse', prompt: 'p', answer: true, explanation: 'e' };
    const data = {
      chapter: 'Inference',
      concepts: [
        { id: 'inference.a.b', section: 'sec-2', variants: [{ kind: 'mcq', prompt: 'p', choices: ['A', 'B', 'C'], correct: 0, explanation: 'e' }] },
        { id: 'inference.a.c', section: 'sec-2', variants: [{ ...q, explanaton: 'typo' }] },
        { id: 'inference.a.d', section: 'sec-2', variants: [q, q, q, q] },
      ],
    };
    const out = messages(run(data)).join('\n');
    expect(out).toContain('exactly 4 choices');
    expect(out).toContain('unknown key');
    expect(out).toContain('at most 3 variants');
  });

  it('warns on long recall answers and prompts that contain their answer', () => {
    const data = {
      chapter: 'Inference',
      concepts: [
        {
          id: 'inference.a.b',
          section: 'sec-2',
          variants: [
            { kind: 'recall', prompt: 'x', answer: 'y'.repeat(401) },
            { kind: 'recall', prompt: 'Is it the key-value cache?', answer: 'key-value cache' },
          ],
        },
      ],
    };
    const r = run(data);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.message).join('\n')).toMatch(/401 characters[\s\S]*verbatim/);
  });

  it('reports a chapter that does not exist in sections.json and non-object files', () => {
    expect(messages(run({ chapter: 'Nope', concepts: [] })).join()).toContain('does not exist in sections.json');
    expect(messages(run([])).join()).toContain('not a valid chapter file');
  });
});

describe('diffSections', () => {
  it('flags new, changed and concept-less sections', () => {
    const d = diffSections(sections, new Map([['sec-2', 2]]));
    expect(d.map((x) => x.status)).toEqual(['new', 'covered', 'changed']);
    expect(d.filter(needsWork).map((x) => x.section.id)).toEqual(['sec-1', 'sec-3']);
  });
});
