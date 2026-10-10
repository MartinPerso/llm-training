import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Section } from '../../src/bank/types.ts';
import type { BankFile } from './check.ts';
import { type BookCacheEntry, buildChapters, findSection } from './chapters.ts';
import { ROOT } from './paths.ts';
import { EXAMPLE_IDS, demoteHeadings, estimateTokens, extractTypesBlock, packFileName, pickExamples, renderPack } from './pack.ts';

const sections: Section[] = [
  { id: 'p0', chapter: 'Parallelism', title: 'Parallelism', level: 1, order: 0, hash: 'h0' },
  { id: 'p1', chapter: 'Parallelism', title: 'Data parallelism', level: 2, order: 1, hash: 'h1' },
  { id: 'p2', chapter: 'Parallelism', title: 'Empty', level: 2, order: 2, hash: 'h2' },
  { id: 't0', chapter: 'The modern transformer LM', title: 'Architecture', level: 2, order: 3, hash: 'h3' },
];
const cache = new Map<string, BookCacheEntry>([
  ['p0', { file: '49-parallelism.md', bodyChars: 700 }],
  ['p1', { file: '51-data-parallelism.md', bodyChars: 1900 }],
  ['p2', { file: '52-empty.md', bodyChars: 3 }],
  ['t0', { file: '14-architecture.md', bodyChars: 5000 }],
]);
const bank: BankFile = {
  name: 'parallelism.json',
  data: {
    chapter: 'Parallelism',
    concepts: [
      { id: 'parallelism.data-parallelism.a', section: 'p1', variants: [{ kind: 'recall', prompt: 'p', answer: 'a' }] },
      { id: 'parallelism.data-parallelism.b', section: 'p1', retired: true, variants: [{ kind: 'recall', prompt: 'p', answer: 'a' }] },
    ],
  },
};

const typesSource = `// header
export interface Section { id: string }
export type Question =
  | { kind: "recall"; prompt: string; answer: string }
export interface ChapterFile { chapter: string }
export const DEFAULT_TOLERANCE = 0.05;

export const BOOK_URL = "https://example.com";
`;
const guide = '# Question-writing guide\n\n## 1. Goal\n\ntext\n\n```md\n# not a heading\n```\n\n### 2.1 Calibrated style\n';
const example = {
  concepts: [
    { id: 'inference.a.x', section: 's', variants: [{ kind: 'numeric', prompt: 'n', answer: 1, explanation: 'e' }] },
    { id: 'inference.a.old', section: 's', retired: true, variants: [{ kind: 'recall', prompt: 'r', answer: 'a' }] },
    { id: 'inference.a.y', section: 's', variants: [{ kind: 'mcq', prompt: 'm', choices: ['a', 'b', 'c', 'd'], correct: 0, explanation: 'e' }] },
  ],
};

const input = (files: BankFile[] = [], over: Record<string, unknown> = {}) => {
  const chapters = buildChapters(sections, files, cache);
  const chapter = chapters.find((c) => c.slug === 'parallelism')!;
  const notation = chapters.find((c) => c.slug === 'transformer')!.sections[0];
  const sourceTexts = new Map([
    ['p0', 'INTRO NOTES'],
    ['p1', 'DATA PARALLELISM NOTES'],
    ['p2', ''],
  ]);
  return { chapter, notation, notationText: 'NOTATION TABLE', sourceTexts, guide, typesSource, exampleSource: example, ...over };
};

describe('renderPack', () => {
  const pack = renderPack(input());
  it('has the five parts in order', () => {
    const at = ['# PART 1:', '# PART 2:', '# PART 3:', '# PART 4:', '# PART 5:'].map((h) => pack.indexOf(h));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });
  it('states the output contract, title, id scheme and section table', () => {
    expect(pack).toContain('{ "chapter": "Parallelism", "concepts": [ ... ] }');
    expect(pack).toContain('**Nothing after the code block.**');
    expect(pack).toContain('`parallelism.<section-slug>.<idea-slug>`');
    expect(pack).toMatch(/Data parallelism \| `p1` \| 5 \| `data-parallelism` \|/);
    expect(pack).toMatch(/Empty \| `p2` \| no concepts needed \|/);
  });
  it('has no shell commands or repo paths in the instructions', () => {
    const part1 = pack.slice(pack.indexOf('# PART 1:'), pack.indexOf('# PART 2:'));
    for (const w of ['npm ', 'git ', '.cache', 'content/', 'scripts/', 'src/']) expect(part1).not.toContain(w);
  });
  it('spells out the calibrated rules, escaping, self-check and multi-message answers', () => {
    for (const w of ['under **150 characters**', 'under 90 characters', '2 to 4 sentences', 'chain of equalities', 'every backslash is doubled', 'Self-check before you answer', 'say "continue"'.replace('say ', 'will say '), 'only the new concepts']) {
      expect(pack).toContain(w);
    }
    expect(pack).toContain('35% recall, 15% numeric, 25% mcq, 25% truefalse');
  });
  it('embeds the guide with demoted headings, the types and the active examples only', () => {
    expect(pack).toContain('## Question-writing guide');
    expect(pack).toContain('### 2.1 Calibrated style'.replace('###', '####'));
    expect(pack).toContain('# not a heading'); // inside a code fence: untouched
    expect(pack).toContain('export type Question =');
    expect(pack).not.toContain('export interface Section');
    expect(pack).not.toContain('BOOK_URL');
    expect(pack).toContain('inference.a.x');
    expect(pack).toContain('inference.a.y');
    expect(pack).not.toContain('inference.a.old');
  });
  it('puts every section under a header with title and id, then the notation', () => {
    expect(pack).toContain('## Source section: Data parallelism (section id: `p1`)');
    expect(pack).toContain('DATA PARALLELISM NOTES');
    expect(pack).toContain('(heading only: no notes, no concepts needed)');
    expect(pack).toContain("## Notation reference (don't write questions on it)");
    expect(pack.indexOf('NOTATION TABLE')).toBeGreaterThan(pack.indexOf('DATA PARALLELISM NOTES'));
  });
  it('skips the notation block when the chapter contains it', () => {
    const chapters = buildChapters(sections.map((s) => (s.id === 't0' ? { ...s, chapter: 'Parallelism' } : s)), [], cache);
    const chapter = chapters.find((c) => c.slug === 'parallelism')!;
    const t0 = chapter.sections.find((s) => s.id === 't0')!;
    const p = renderPack(input([], { chapter, notation: t0, sourceTexts: new Map([['t0', 'ARCH']]) }));
    expect(p).not.toContain("Notation reference (don't write");
    expect(p).toContain('## Source section: Architecture');
  });
  it('lists existing ids (retired flagged) and says to extend, never rename', () => {
    const p = renderPack(input([bank]));
    expect(p).toContain('## Concepts that already exist');
    expect(p).toContain('`parallelism.data-parallelism.a`');
    expect(p).toContain('`parallelism.data-parallelism.b` (retired)');
    expect(p).toContain('Never rename or reuse');
    expect(pack).not.toContain('## Concepts that already exist');
  });
  it('scopes to one section', () => {
    const i = input([bank]);
    const p = renderPack({ ...i, section: findSection(i.chapter, 'data-parallelism') });
    expect(p).toContain('write concepts for **this section only**: "Data parallelism"');
    expect(p).toContain('## Source section: Data parallelism');
    expect(p).not.toContain('## Source section: Parallelism (');
    expect(p).not.toContain('INTRO NOTES');
    expect(p).toContain('(section "Data parallelism")');
  });
});

describe('helpers', () => {
  it('demoteHeadings skips code fences', () => {
    expect(demoteHeadings('# a\n```\n# b\n```\n## c')).toBe('## a\n```\n# b\n```\n### c');
  });
  it('extractTypesBlock keeps Question to DEFAULT_TOLERANCE', () => {
    const t = extractTypesBlock(typesSource);
    expect(t.startsWith('export type Question')).toBe(true);
    expect(t.endsWith('DEFAULT_TOLERANCE = 0.05;')).toBe(true);
  });
  it('pickExamples prefers the given ids, skips retired, fills up to n', () => {
    expect(pickExamples(example, ['inference.a.y', 'inference.a.old', 'nope'], 5).map((c) => (c as { id: string }).id)).toEqual(['inference.a.y', 'inference.a.x']);
    expect(pickExamples(undefined)).toEqual([]);
  });
  it('names files and estimates tokens', () => {
    expect(packFileName('parallelism')).toBe('parallelism.md');
    expect(packFileName('parallelism', { suggestedSlug: 'tensor-parallelism' })).toBe('parallelism--tensor-parallelism.md');
    expect(estimateTokens(4000)).toBe(1000);
  });
  const real = join(ROOT, 'content', 'questions', 'inference.json');
  it.skipIf(!existsSync(real))('the default examples from the real inference bank cover all four kinds, with derivations', () => {
    const picked = pickExamples(JSON.parse(readFileSync(real, 'utf8'))) as { id: string; variants: { kind: string; explanation?: string }[] }[];
    expect(picked.map((c) => c.id)).toEqual(EXAMPLE_IDS);
    const kinds = new Set(picked.flatMap((c) => c.variants.map((v) => v.kind)));
    expect([...kinds].sort()).toEqual(['mcq', 'numeric', 'recall', 'truefalse']);
    expect(picked.filter((c) => c.variants.some((v) => /\$\$/.test(v.explanation ?? ''))).length).toBeGreaterThanOrEqual(3);
  });
});
