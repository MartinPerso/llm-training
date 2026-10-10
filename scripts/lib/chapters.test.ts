import { describe, expect, it } from 'vitest';
import type { Section } from '../../src/bank/types.ts';
import type { BankFile } from './check.ts';
import {
  type BookCacheEntry,
  buildChapters,
  chapterStatus,
  findChapter,
  findSection,
  formatMix,
  sectionBody,
  sectionTarget,
  totals,
} from './chapters.ts';
import { formatStatusTable } from './status-table.ts';

const sec = (id: string, chapter: string, title: string, level: 1 | 2 | 3, order: number, hash = 'h', coveredHash?: string): Section => ({
  id, chapter, title, level, order, hash, ...(coveredHash ? { coveredHash } : {}),
});

const sections: Section[] = [
  sec('p0', 'Parallelism', 'Parallelism', 1, 0, 'h0', 'h0'),
  sec('p1', 'Parallelism', 'Data parallelism', 2, 1, 'h1', 'h1'),
  sec('i0', 'Inference', 'Inference', 1, 2, 'h2'),
  sec('i1', 'Inference', 'KV cache', 2, 3, 'h3', 'h3'),
  sec('i2', 'Inference', 'Reducing KV cache size', 3, 4, 'new', 'old'),
  sec('g0', 'GPUs', 'GPUs', 1, 5, 'h5'),
];

const cache = new Map<string, BookCacheEntry>([
  ['p0', { file: '00-p.md', bodyChars: 10 }], // heading only
  ['p1', { file: '01-dp.md', bodyChars: 700 }],
  ['i0', { file: '02-i.md', bodyChars: 0 }],
  ['i1', { file: '03-kv.md', bodyChars: 1500 }],
  ['i2', { file: '04-red.md', bodyChars: 100 }],
  ['g0', { file: '05-g.md', bodyChars: 226 }],
]);

const q = (kind: string) =>
  kind === 'mcq'
    ? { kind, prompt: 'p', choices: ['a', 'b', 'c', 'd'], correct: 0, explanation: 'e' }
    : { kind, prompt: 'p', answer: 'a' };

const parallelism: BankFile = {
  name: 'parallelism.json',
  data: {
    chapter: 'Parallelism',
    concepts: [
      { id: 'parallelism.data-parallelism.a', section: 'p1', variants: [q('recall'), q('mcq')] },
      { id: 'parallelism.data-parallelism.b', section: 'p1', variants: [q('recall')] },
      { id: 'parallelism.data-parallelism.old', section: 'p1', retired: true, variants: [q('mcq'), q('mcq')] },
    ],
  },
};
const inference: BankFile = {
  name: 'inference.json',
  data: { chapter: 'Inference', concepts: [{ id: 'inference.kv-cache.x', section: 'i1', variants: [q('truefalse')] }] },
};

describe('chapterStatus', () => {
  it('todo without a file, whatever the hashes say', () => {
    expect(chapterStatus(false, ['covered', 'covered'])).toBe('todo');
    expect(chapterStatus(false, ['new'])).toBe('todo');
  });
  it('in progress, done and outdated', () => {
    expect(chapterStatus(true, ['covered', 'new'])).toBe('in progress');
    expect(chapterStatus(true, ['new', 'new'])).toBe('in progress');
    expect(chapterStatus(true, ['covered', 'covered'])).toBe('done');
    expect(chapterStatus(true, ['covered', 'changed'])).toBe('outdated');
    expect(chapterStatus(true, ['new', 'changed'])).toBe('outdated');
  });
});

describe('sizes and targets', () => {
  it('strips the marker comment and the heading', () => {
    expect(sectionBody('<!-- section: x | chapter: C | H2 -->\n## Title\n\n- a\n')).toBe('- a');
    expect(sectionBody('<!-- section: x | chapter: C | H1 -->\n# Title\n')).toBe('');
  });
  it('targets about one concept per 350 chars, at least one for non-trivial sections, none for heading-only', () => {
    expect(sectionTarget(0)).toBe(0);
    expect(sectionTarget(39)).toBe(0);
    expect(sectionTarget(40)).toBe(1);
    expect(sectionTarget(700)).toBe(2);
    expect(sectionTarget(4726)).toBe(14);
  });
});

describe('buildChapters', () => {
  const chapters = buildChapters(sections, [parallelism, inference], cache);
  const by = (slug: string) => chapters.find((c) => c.slug === slug)!;

  it('lists chapters in book order with slugs', () => {
    expect(chapters.map((c) => c.slug)).toEqual(['parallelism', 'inference', 'gpus']);
  });
  it('computes sizes, targets and concept counts (retired excluded)', () => {
    const p = by('parallelism');
    expect(p.nonTrivialSections).toBe(1);
    expect(p.chars).toBe(710);
    expect(p.target).toBe(2);
    expect(p.concepts).toBe(2);
    expect(p.retired).toBe(1);
    expect(p.variants).toBe(3);
    expect(p.kinds).toEqual({ recall: 2, numeric: 0, mcq: 1, truefalse: 0 });
    expect(p.conceptIds).toHaveLength(3);
    expect(p.retiredIds).toEqual(['parallelism.data-parallelism.old']);
    expect(formatMix(p.kinds)).toBe('67/0/33/0');
  });
  it('derives statuses', () => {
    expect(by('parallelism').status).toBe('done');
    expect(by('inference').status).toBe('outdated');
    expect(by('inference').changedSections.map((s) => s.id)).toEqual(['i2']);
    expect(by('gpus').status).toBe('todo');
  });
  it('flags heading-only sections and reuses existing id segments', () => {
    const p = by('parallelism');
    expect(p.sections[0].trivial).toBe(true);
    expect(p.sections[0].target).toBe(0);
    expect(p.sections[1].suggestedSlug).toBe('data-parallelism');
    expect(by('inference').sections[0].suggestedSlug).toBe('inference');
    expect(by('inference').sections[2].suggestedSlug).toBe('reducing-kv-cache');
  });
  it('works without the book cache (sizes unknown)', () => {
    const c = buildChapters(sections, [], undefined);
    expect(c[0].chars).toBeUndefined();
    expect(c[0].target).toBeUndefined();
    expect(c[0].status).toBe('todo');
    expect(formatStatusTable(c, totals(c))).toContain('?');
  });
  it('totals', () => {
    const t = totals(chapters);
    expect(t.byStatus).toEqual({ todo: 1, 'in progress': 0, done: 1, outdated: 1 });
    expect(t.concepts).toBe(3);
    expect(t.variants).toBe(4);
    expect(t.sections).toBe(6);
  });
  it('renders a table with a totals row', () => {
    const text = formatStatusTable(chapters, totals(chapters));
    expect(text).toContain('parallelism');
    expect(text).toMatch(/TOTAL\s+3 chapters/);
    expect(text).toContain('outdated');
  });
});

describe('lookup', () => {
  const chapters = buildChapters(sections, [], cache);
  it('finds chapters by slug or title', () => {
    expect(findChapter(chapters, 'inference')?.title).toBe('Inference');
    expect(findChapter(chapters, 'gpus')?.slug).toBe('gpus');
    expect(findChapter(chapters, 'nope')).toBeUndefined();
  });
  it('finds sections by id, id without dashes, title or title slug', () => {
    const inf = findChapter(chapters, 'inference')!;
    expect(findSection(inf, 'i1')?.title).toBe('KV cache');
    expect(findSection(inf, 'kv-cache')?.id).toBe('i1');
    expect(findSection(inf, 'KV cache')?.id).toBe('i1');
    expect(findSection(inf, 'reducing-kv-cache-size')?.id).toBe('i2');
    expect(findSection(inf, 'zzz')).toBeUndefined();
  });
  it('accepts a unique id prefix', () => {
    const c = buildChapters([sec('2f47eb87-3605-80c1-a4a4-d8dc201f202c', 'Inference', 'KV cache', 2, 0)], [], cache);
    expect(findSection(c[0], '2f47eb87-3605-80c1')?.title).toBe('KV cache');
    expect(findSection(c[0], '2f47')).toBeUndefined();
  });
});
