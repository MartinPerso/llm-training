import { existsSync, readFileSync } from 'node:fs';
import type { Section } from '../../src/bank/types.ts';
import { SECTIONS_FILE } from './paths.ts';

export function readSections(file = SECTIONS_FILE): Section[] {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')) as Section[];
}

/** Section as stored in sections.json (stable key order, no text). */
export function toStoredSection(s: Section, coveredHash: string | undefined): Section {
  const out: Section = { id: s.id, chapter: s.chapter, title: s.title, level: s.level, order: s.order, hash: s.hash };
  if (coveredHash) out.coveredHash = coveredHash;
  return out;
}
