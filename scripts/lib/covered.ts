import type { Section } from '../../src/bank/types.ts';
import { chapterSlug } from './slugs.ts';

/**
 * Sets coveredHash = hash (in place) for every section of the given chapter slugs ("all" = every chapter),
 * or only for the given section ids. Returns how many sections were marked.
 */
export function markCovered(sections: Section[], chapterSlugs: string[], sectionIds?: string[]): number {
  let n = 0;
  for (const s of sections) {
    const inChapter = chapterSlugs.includes('all') || chapterSlugs.includes(chapterSlug(s.chapter));
    if (!inChapter || (sectionIds && !sectionIds.includes(s.id))) continue;
    s.coveredHash = s.hash;
    n++;
  }
  return n;
}
