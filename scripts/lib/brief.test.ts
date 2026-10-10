import { describe, expect, it } from 'vitest';
import type { Section } from '../../src/bank/types.ts';
import type { BankFile } from './check.ts';
import { renderReviewBrief, renderTaskBrief } from './brief.ts';
import { type BookCacheEntry, buildChapters, findSection } from './chapters.ts';

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
const file: BankFile = {
  name: 'parallelism.json',
  data: {
    chapter: 'Parallelism',
    concepts: [
      { id: 'parallelism.data-parallelism.a', section: 'p1', variants: [{ kind: 'recall', prompt: 'p', answer: 'a' }] },
      { id: 'parallelism.data-parallelism.b', section: 'p1', retired: true, variants: [{ kind: 'recall', prompt: 'p', answer: 'a' }] },
    ],
  },
};

const ctxFor = (files: BankFile[], withCache = true, secs = sections) => {
  const chapters = buildChapters(secs, files, withCache ? cache : undefined);
  const chapter = chapters.find((c) => c.slug === 'parallelism')!;
  const notation = chapters.find((c) => c.slug === 'transformer')?.sections[0];
  return { chapter, notation, cacheAvailable: withCache };
};

describe('renderTaskBrief', () => {
  const brief = renderTaskBrief(ctxFor([]));
  it('names the output file, chapter string and setup', () => {
    expect(brief).toContain('`content/questions/parallelism.json`');
    expect(brief).toContain('`{ "chapter": "Parallelism", "concepts": [ ... ] }`');
    expect(brief).toContain('.nvmrc');
    expect(brief).toContain('npm ci');
    expect(brief).toContain('npm run book:fetch');
  });
  it('lists sections with ids, files, targets and marks heading-only ones', () => {
    expect(brief).toContain('`.cache/book/51-data-parallelism.md`');
    expect(brief).toContain('`p1`');
    expect(brief).toMatch(/Data parallelism \| `p1` \| `\.cache\/book\/51-data-parallelism\.md` \| 1900 \| 5 \|/);
    expect(brief).toMatch(/Empty \| `p2` .* \| no concepts needed \|/);
  });
  it('points at the notation section, the guide, the gate, covering and commit', () => {
    expect(brief).toContain('`.cache/book/14-architecture.md`');
    expect(brief).toContain('content/GUIDE.md');
    expect(brief).toContain('npm run bank:check -- --stats');
    expect(brief).toContain('npm run book:covered -- parallelism');
    expect(brief).toContain('git add content/questions/parallelism.json content/sections.json');
    expect(brief).toContain('git commit -m "Add questions: Parallelism"');
    expect(brief).toContain('Never commit `.cache/`');
    expect(brief).toContain('## Report back to the user');
  });
  it('lists existing ids (retired flagged) and the changed sections for an outdated chapter', () => {
    const secs = sections.map((s) => (s.id === 'p1' ? { ...s, coveredHash: 'old' } : s));
    const b = renderTaskBrief(ctxFor([file], true, secs));
    expect(b).toContain('Chapter status: **outdated**');
    expect(b).toContain('`parallelism.data-parallelism.a`');
    expect(b).toContain('`parallelism.data-parallelism.b` (retired)');
    expect(b).toContain('Sections whose text changed');
    expect(b).toContain('Data parallelism (`p1`)');
  });
  it('scopes to one section', () => {
    const ctx = ctxFor([file]);
    const b = renderTaskBrief({ ...ctx, section: findSection(ctx.chapter, 'data-parallelism') });
    expect(b).toContain('(only the section "Data parallelism")');
    expect(b).toContain('npm run book:covered -- parallelism --section p1');
    expect(b).toContain('Add questions: Parallelism (Data parallelism)');
    expect(b).not.toContain('51-data-parallelism.md` | 1900 | 5 | 0 |\n| ');
    expect(b).not.toContain('`.cache/book/49-parallelism.md`');
  });
  it('degrades without the cache', () => {
    const b = renderTaskBrief(ctxFor([], false));
    expect(b).toContain('`.cache/book/` is missing right now');
    expect(b).toContain('npm run book:fetch');
  });
});

describe('renderReviewBrief', () => {
  it('describes the audit, the fix rules and the overlap report', () => {
    const b = renderReviewBrief({
      ...ctxFor([file]),
      overlaps: [{ concept: 'parallelism.data-parallelism.a', variant: 0, field: 'answer', phrase: 'a copied run of seven words here' }],
    });
    expect(b).toContain('# Review: audit the quiz questions for "Parallelism"');
    for (const w of ['Non-obviousness', 'Faithfulness', 'Answer leaks', 'Distractor quality', 'Copied phrasing']) expect(b).toContain(w);
    expect(b).toContain('"retired": true');
    expect(b).toContain('a copied run of seven words here');
    expect(b).toContain('git commit -m "Review questions: Parallelism"');
    expect(b).toContain('GUIDE sections 2, 3, 4, 5, 6 and 12');
    expect(b).not.toContain('Nothing to review yet');
  });
  it('says so when the file does not exist', () => {
    expect(renderReviewBrief({ ...ctxFor([]), overlaps: [] })).toContain('Nothing to review yet');
  });
});
