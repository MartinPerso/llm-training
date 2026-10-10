import { buildBank, type Bank } from '../bank/load.ts';
import type { ChapterFile, Concept, Section } from '../bank/types.ts';
import type { ReviewEvent } from '../srs/events.ts';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const concept = (id: string, section: string, variants = 1): Concept => ({
  id,
  section,
  variants: Array.from({ length: variants }, (_, i) => ({
    kind: 'truefalse' as const,
    prompt: `${id} v${i}`,
    answer: true,
    explanation: 'because',
  })),
});

export const section = (id: string, chapter: string, order: number): Section => ({
  id,
  chapter,
  title: id,
  level: 2,
  order,
  hash: 'h',
});

/** Two chapters (A: a1 a2 a3, B: b1 b2) in book order A then B. */
export function makeBank(): Bank {
  const sections = [section('sa', 'A', 1), section('sb', 'B', 2)];
  const files: ChapterFile[] = [
    { chapter: 'A', concepts: [concept('a1', 'sa', 2), concept('a2', 'sa'), concept('a3', 'sa')] },
    { chapter: 'B', concepts: [concept('b1', 'sb'), concept('b2', 'sb')] },
  ];
  return buildBank(sections, files);
}

export const review = (c: string, t: number, r: 1 | 2 | 3 | 4 = 3, v = 0): ReviewEvent => ({ c, v, t, r, ms: 1000 });
