import { describe, expect, it } from 'vitest';
import { concept, section } from '../test/helpers.ts';
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

  it('accepts sections wrapped in an object', () => {
    expect(normalizeSections({ sections: [section('s', 'C', 1)] })).toHaveLength(1);
    expect(normalizeSections(null)).toEqual([]);
  });
});
