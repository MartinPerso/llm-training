import { describe, expect, it } from 'vitest';
import { concept, section } from '../test/helpers.ts';
import { BOOK_TITLE } from './types.ts';
import { bankFromGlobs, buildBank, normalizeSections } from './load.ts';

describe('bank loading', () => {
  it('tolerates empty globs', () => {
    const b = bankFromGlobs({}, {});
    expect(b.concepts).toEqual([]);
    expect(b.chapters).toEqual([]);
  });

  it('ignores _files and retired concepts, orders chapters by section order', () => {
    const sections = [section('s1', 'Second', 20), section('s0', 'First', 5)];
    const b = bankFromGlobs(
      { '../../content/sections.json': sections },
      {
        '../../content/questions/b.json': { chapter: 'Second', concepts: [concept('x', 's1'), { ...concept('gone', 's1'), retired: true }] },
        '../../content/questions/a.json': { chapter: 'First', concepts: [concept('y', 's0')] },
        '../../content/questions/_template.json': { chapter: 'First', concepts: [concept('tmpl', 's0')] },
      },
    );
    expect(b.chapters).toEqual(['First', 'Second']);
    expect(b.concepts.map((c) => c.id)).toEqual(['y', 'x']);
    expect(b.chapterOf.get('x')).toBe('Second');
  });

  it('orders concepts by section order inside a chapter, and drops duplicate ids', () => {
    const sections = [section('s1', 'C', 1), section('s2', 'C', 2)];
    const b = buildBank(sections, [{ chapter: 'C', concepts: [concept('late', 's2'), concept('early', 's1'), concept('late', 's2')] }]);
    expect(b.concepts.map((c) => c.id)).toEqual(['early', 'late']);
  });

  it('groups chapters by source, the book first, and maps each chapter to its source', () => {
    const ext = (id: string, chapter: string, order: number, source: string) => ({ ...section(id, chapter, order), source, url: `https://x.org/#${id}` });
    const sections = [section('b1', 'Book', 1), ext('e1', 'Part A', 5, 'Notes'), ext('e2', 'Part B', 6, 'Notes'), ext('o1', 'Other', 7, 'Elsewhere')];
    const b = buildBank(sections, [
      { chapter: 'Part B', concepts: [concept('p.b', 'e2')] },
      { chapter: 'Other', concepts: [concept('o.a', 'o1')] },
      { chapter: 'Part A', concepts: [concept('p.a', 'e1')] },
      { chapter: 'Book', concepts: [concept('k.a', 'b1')] },
    ]);
    expect(b.chapterGroups).toEqual([
      { source: BOOK_TITLE, chapters: ['Book'] },
      { source: 'Notes', chapters: ['Part A', 'Part B'] },
      { source: 'Elsewhere', chapters: ['Other'] },
    ]);
    expect(b.sourceOf.get('Part B')).toBe('Notes');
    expect(b.sourceOf.get('Book')).toBe(BOOK_TITLE);
  });

  it('accepts sections wrapped in an object', () => {
    expect(normalizeSections({ sections: [section('s', 'C', 1)] })).toHaveLength(1);
    expect(normalizeSections(null)).toEqual([]);
  });
});
