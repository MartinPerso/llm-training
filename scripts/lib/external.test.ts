// Chapters whose source is an external web page (sections with a `url`) instead of the Notion book.

import { describe, expect, it } from 'vitest';
import type { Section } from '../../src/bank/types.ts';
import { type BookCacheEntry, buildChapters, findChapter, findSection, totals } from './chapters.ts';
import { checkBank, checkSections, formatIssue } from './check.ts';
import { markCovered } from './covered.ts';
import { diffSections, needsWork } from './diff.ts';
import { planImport } from './import.ts';
import { isExternal, mergeFetchedSections, toStoredSection } from './sections-file.ts';
import { formatStatusTable } from './status-table.ts';

const POST = 'https://example.org/blog/rl/';
const book: Section[] = [
  { id: 'i0', chapter: 'Inference', title: 'Inference', level: 1, order: 0, hash: 'h0', coveredHash: 'h0' },
  { id: 'i1', chapter: 'Inference', title: 'KV cache', level: 2, order: 1, hash: 'h1', coveredHash: 'h1' },
];
const ext = (id: string, title: string, order: number, over: Partial<Section> = {}): Section => ({
  id, chapter: 'Agentic RL', title, level: 2, order, hash: '2026-06', url: `${POST}#${id}`, ...over,
});
const external: Section[] = [ext('ppo-trust-regions', 'The PPO family and trust regions', 2), ext('async-rl', 'Async RL', 3)];
const sections = [...book, ...external];
const cache = new Map<string, BookCacheEntry>([
  ['i0', { file: '00-i.md', bodyChars: 10 }],
  ['i1', { file: '01-kv.md', bodyChars: 700 }],
]);

const EXPL = 'Clipping the ratio bounds how far one update can move the policy away from the one that sampled the data, which keeps the surrogate objective trustworthy.';
const concept = (id: string, section = 'ppo-trust-regions') => ({
  id,
  section,
  variants: [{ kind: 'truefalse', prompt: 'PPO clips the advantage itself.', answer: false, explanation: EXPL }],
});
const agentic = (concepts: unknown[]) => ({ chapter: 'Agentic RL', concepts });

describe('sections.json', () => {
  it('stores the url between hash and coveredHash', () => {
    expect(Object.keys(toStoredSection(external[0], 'c'))).toEqual(['id', 'chapter', 'title', 'level', 'order', 'hash', 'url', 'coveredHash']);
    expect(isExternal(external[0])).toBe(true);
    expect(isExternal(book[0])).toBe(false);
  });

  it('a book fetch keeps external sections, renumbered after the book, and does not report them as gone', () => {
    const previous = [...book, { ...external[1], order: 7, coveredHash: '2026-06' }, { ...external[0], order: 5 }];
    const fetched = [book[0], { ...book[1], hash: 'h1b' }, { id: 'i2', chapter: 'Inference', title: 'New', level: 2 as const, order: 2, hash: 'h2' }];
    const { stored, gone } = mergeFetchedSections(fetched, previous);
    expect(stored.map((s) => [s.id, s.order])).toEqual([['i0', 0], ['i1', 1], ['i2', 2], ['ppo-trust-regions', 3], ['async-rl', 4]]);
    expect(stored[1]).toMatchObject({ hash: 'h1b', coveredHash: 'h1' });
    expect(stored[4]).toEqual({ ...external[1], order: 4, coveredHash: '2026-06' });
    expect(gone).toEqual([]);
    expect(mergeFetchedSections([book[0]], previous).gone.map((s) => s.id)).toEqual(['i1']);
  });

  it('checks urls, duplicate ids and chapters that mix both kinds', () => {
    expect(checkSections(sections)).toEqual([]);
    const bad = [...sections, ext('x', 'X', 9, { url: 'example.org/x' }), ext('async-rl', 'Again', 10), { ...book[1], id: 'i9', chapter: 'Agentic RL' }];
    expect(checkSections(bad).map(formatIssue)).toEqual([
      'sections.json: (file): section x: url must be an http(s) link, got "example.org/x"',
      'sections.json: (file): duplicate section id async-rl',
      'sections.json: (file): chapter "Agentic RL" mixes book sections and external-source sections (with a url)',
    ]);
  });
});

describe('bank:check', () => {
  it('accepts concepts attached to external section keys', () => {
    const r = checkBank([{ name: 'agenticrl.json', data: agentic([concept('agenticrl.ppo-trust-regions.clip-ratio'), concept('agenticrl.async-rl.staleness', 'async-rl')]) }], sections);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.stats.chapters['Agentic RL']).toEqual({ concepts: 2, variants: 2 });
  });

  it('still rejects unknown keys and keys of another chapter', () => {
    const r = checkBank([{ name: 'agenticrl.json', data: agentic([concept('agenticrl.x.a', 'nope'), concept('agenticrl.x.b', 'i1')]) }], sections);
    expect(r.errors.map((e) => e.message)).toEqual([
      'section nope does not exist in sections.json',
      'section "KV cache" belongs to chapter "Inference", not "Agentic RL"',
    ]);
  });
});

describe('bank:status', () => {
  const files = [{ name: 'agenticrl.json', data: agentic([concept('agenticrl.ppo-trust-regions.clip-ratio')]) }];
  const chapters = buildChapters(sections, files, cache);
  const rl = findChapter(chapters, 'agenticrl')!;

  it('lists the chapter with its source page and every section as non-trivial', () => {
    expect(rl.title).toBe('Agentic RL');
    expect(rl.sourceUrl).toBe(POST);
    expect(rl.nonTrivialSections).toBe(2);
    expect(rl.chars).toBeUndefined();
    expect(rl.status).toBe('in progress');
    expect(rl.sections.map((s) => [s.suggestedSlug, s.url, s.trivial, s.concepts])).toEqual([
      ['ppo-trust-regions', `${POST}#ppo-trust-regions`, false, 1],
      ['async-rl', `${POST}#async-rl`, false, 0],
    ]);
    expect(findChapter(chapters, 'inference')!.sourceUrl).toBeUndefined();
  });

  it('keeps the book totals known and shows "-" for the external sizes', () => {
    const t = totals(chapters);
    expect(t.chars).toBe(710);
    expect(t.target).toBe(2);
    expect(t.nonTrivialSections).toBe(3);
    const row = formatStatusTable(chapters, t).split('\n').find((l) => l.startsWith('agenticrl'))!;
    expect(row).toMatch(/agenticrl\s+Agentic RL\s+2\s+-\s+-\s+1\s+1/);
  });

  it('finds sections by key or title, and marks them covered', () => {
    expect(findSection(rl, 'async-rl')?.title).toBe('Async RL');
    expect(findSection(rl, 'The PPO family and trust regions')?.id).toBe('ppo-trust-regions');
    const copy = sections.map((s) => ({ ...s }));
    expect(markCovered(copy, ['agenticrl'], ['async-rl'])).toBe(1);
    expect(copy.find((s) => s.id === 'async-rl')!.coveredHash).toBe('2026-06');
  });
});

describe('book:diff', () => {
  it('reports external sections as new until covered, and changed only when their revision label changes', () => {
    const covered = external.map((s) => ({ ...s, coveredHash: s.hash }));
    expect(diffSections(external, new Map()).map((d) => d.status)).toEqual(['new', 'new']);
    expect(diffSections(covered, new Map([['ppo-trust-regions', 1], ['async-rl', 1]])).filter(needsWork)).toEqual([]);
    expect(diffSections([{ ...covered[0], hash: '2026-09' }], new Map()).map((d) => d.status)).toEqual(['changed']);
  });
});

describe('bank:import', () => {
  const reply = (concepts: unknown[]) => '```json\n' + JSON.stringify(agentic(concepts), null, 2) + '\n```';

  it('resolves the external chapter by title and merges', () => {
    const p = planImport(reply([concept('agenticrl.ppo-trust-regions.clip-ratio')]), sections, () => ({}));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.chapter.slug).toBe('agenticrl');
      expect(p.merged.chapter).toBe('Agentic RL');
      expect(p.merge.added).toEqual(['agenticrl.ppo-trust-regions.clip-ratio']);
      expect(p.warnings).toEqual([]);
    }
  });

  it('fails on a section key that is not registered', () => {
    const p = planImport(reply([concept('agenticrl.grpo.a', 'grpo-variants')]), sections, () => ({}));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.join('\n')).toContain('section grpo-variants does not exist in sections.json');
  });
});
