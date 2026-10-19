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
  id, chapter: 'Agentic RL', source: 'RL notes', title, level: 2, order, hash: '2026-06', url: `${POST}#${id}`, ...over,
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
  it('stores the source after the chapter and the url between hash and coveredHash', () => {
    expect(Object.keys(toStoredSection(external[0], 'c'))).toEqual(['id', 'chapter', 'source', 'title', 'level', 'order', 'hash', 'url', 'coveredHash']);
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

  it('requires a source with a url, forbids it without, and one source per chapter', () => {
    const bad = [
      ext('a', 'A', 9, { source: undefined }),
      ext('b', 'B', 10, { source: ' ' }),
      { ...book[1], id: 'i9', source: 'Oops' },
      ext('c', 'C', 11, { source: 'Other' }),
    ];
    const msgs = checkSections([...sections, ...bad]).map((i) => i.message);
    expect(msgs).toContain('section a: an external-source section (with a url) needs a non-empty source');
    expect(msgs).toContain('section b: an external-source section (with a url) needs a non-empty source');
    expect(msgs).toContain('section i9: a book section (no url) must not have a source');
    expect(msgs).toContain('chapter "Agentic RL" has sections with different sources ("RL notes", " ", "Other")');
  });
});

describe('bank:check', () => {
  it('accepts concepts attached to external section keys', () => {
    const r = checkBank([{ name: 'rlagentic.json', data: agentic([concept('agenticrl.ppo-trust-regions.clip-ratio'), concept('agenticrl.async-rl.staleness', 'async-rl')]) }], sections);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.stats.chapters['Agentic RL']).toEqual({ concepts: 2, variants: 2 });
  });

  describe('chapters split from one source', () => {
    const split: Section[] = [
      ...book,
      ext('s1', 'S1', 2, { chapter: 'Part one' }),
      ext('s2', 'S2', 3, { chapter: 'Part two' }),
      ext('s3', 'S3', 4, { chapter: 'Part three', source: 'Other source' }),
    ];
    const file = (name: string, chapter: string, id: string, section: string) => ({ name, data: { chapter, concepts: [concept(id, section)] } });
    // chapterSlug of unknown titles: "partone", "parttwo", "partthree"

    it('accepts a prefix shared by the chapters of a source, different from their slugs', () => {
      const r = checkBank([file('partone.json', 'Part one', 'rl.s1.a', 's1'), file('parttwo.json', 'Part two', 'rl.s2.b', 's2')], split);
      expect(r.errors).toEqual([]);
      expect(r.warnings).toEqual([]);
    });

    it('warns when another chapter of the same source uses a different prefix', () => {
      const r = checkBank([file('partone.json', 'Part one', 'rl.s1.a', 's1'), file('parttwo.json', 'Part two', 'other.s2.b', 's2')], split);
      expect(r.errors).toEqual([]);
      expect(r.warnings.map((w) => w.message)).toEqual(['id prefix "other" differs from "rl", the prefix of the other chapters of source "RL notes"']);
    });

    it('does not compare prefixes across sources, and keeps the book rule', () => {
      const bank = [file('partone.json', 'Part one', 'rl.s1.a', 's1'), file('partthree.json', 'Part three', 'zz.s3.c', 's3')];
      expect(checkBank(bank, split).warnings).toEqual([]);
      const bookFile = { name: 'inference.json', data: { chapter: 'Inference', concepts: [concept('rl.kv.x', 'i1')] } };
      expect(checkBank([bookFile], split).warnings.map((w) => w.message)).toContain('id prefix "rl" differs from the chapter slug "inference"');
    });
  });

  it('still rejects unknown keys and keys of another chapter', () => {
    const r = checkBank([{ name: 'rlagentic.json', data: agentic([concept('agenticrl.x.a', 'nope'), concept('agenticrl.x.b', 'i1')]) }], sections);
    expect(r.errors.map((e) => e.message)).toEqual([
      'section nope does not exist in sections.json',
      'section "KV cache" belongs to chapter "Inference", not "Agentic RL"',
    ]);
  });
});

describe('bank:status', () => {
  const files = [{ name: 'rlagentic.json', data: agentic([concept('agenticrl.ppo-trust-regions.clip-ratio')]) }];
  const chapters = buildChapters(sections, files, cache);
  const rl = findChapter(chapters, 'rlagentic')!;

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
    const row = formatStatusTable(chapters, t).split('\n').find((l) => l.startsWith('rlagentic'))!;
    expect(row).toMatch(/rlagentic\s+Agentic RL\s+2\s+-\s+-\s+1\s+1/);
  });

  it('finds sections by key or title, and marks them covered', () => {
    expect(findSection(rl, 'async-rl')?.title).toBe('Async RL');
    expect(findSection(rl, 'The PPO family and trust regions')?.id).toBe('ppo-trust-regions');
    const copy = sections.map((s) => ({ ...s }));
    expect(markCovered(copy, ['rlagentic'], ['async-rl'])).toBe(1);
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
      expect(p.chapter.slug).toBe('rlagentic');
      expect(p.merged.chapter).toBe('Agentic RL');
      expect(p.merge.added).toEqual(['agenticrl.ppo-trust-regions.clip-ratio']);
      expect(p.warnings).toEqual([]);
    }
  });

  it('resolves one of several chapters sharing an id prefix, by title or by the sections of the concepts', () => {
    const split: Section[] = [...book, ext('s1', 'S1', 2, { chapter: 'Part one' }), ext('s2', 'S2', 3, { chapter: 'Part two' })];
    const body = (chapter: string | undefined, id: string, sec: string) =>
      '```json\n' + JSON.stringify({ ...(chapter ? { chapter } : {}), concepts: [concept(id, sec)] }) + '\n```';
    const byTitle = planImport(body('Part two', 'rl.s2.a', 's2'), split, () => ({}));
    expect(byTitle.ok && byTitle.chapter.title).toBe('Part two');
    const bySection = planImport(body(undefined, 'rl.s2.a', 's2'), split, () => ({}));
    expect(bySection.ok && bySection.chapter.title).toBe('Part two');
  });

  it('fails on a section key that is not registered', () => {
    const p = planImport(reply([concept('agenticrl.grpo.a', 'grpo-variants')]), sections, () => ({}));
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.join('\n')).toContain('section grpo-variants does not exist in sections.json');
  });
});
