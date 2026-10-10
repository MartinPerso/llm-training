import type { Section } from '../../src/bank/types.ts';

export interface SectionDiff {
  section: Section;
  status: 'new' | 'changed' | 'covered';
  concepts: number; // non-retired concepts pointing at this section
}

export function diffSections(sections: Section[], conceptCounts: Map<string, number>): SectionDiff[] {
  return sections.map((section) => ({
    section,
    status: section.coveredHash === undefined ? 'new' : section.coveredHash !== section.hash ? 'changed' : 'covered',
    concepts: conceptCounts.get(section.id) ?? 0,
  }));
}

/** Sections that need attention: new or changed text, or no concepts yet. */
export const needsWork = (d: SectionDiff) => d.status !== 'covered' || d.concepts === 0;
