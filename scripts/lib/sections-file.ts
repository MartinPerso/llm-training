import { existsSync, readFileSync } from 'node:fs';
import type { Section } from '../../src/bank/types.ts';
import { SECTIONS_FILE } from './paths.ts';

export function readSections(file = SECTIONS_FILE): Section[] {
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8')) as Section[];
}

/** A section from an external source (a web page with its own `url`) rather than the Notion book. */
export const isExternal = (s: Pick<Section, 'url'>) => typeof s.url === 'string';

/** Section as stored in sections.json (stable key order, no text). */
export function toStoredSection(s: Section, coveredHash: string | undefined): Section {
  const out: Section = { id: s.id, chapter: s.chapter, title: s.title, level: s.level, order: s.order, hash: s.hash };
  if (s.url !== undefined) out.url = s.url;
  if (coveredHash) out.coveredHash = coveredHash;
  return out;
}

/**
 * sections.json after a book fetch: the fetched book sections (keeping coveredHash by id), then the external sections
 * of `previous` unchanged except for `order`, renumbered after the book. `gone` = book sections no longer in the book.
 */
export function mergeFetchedSections(fetched: Section[], previous: Section[]): { stored: Section[]; gone: Section[] } {
  const prevById = new Map(previous.map((s) => [s.id, s]));
  const book = fetched.map((s) => toStoredSection(s, prevById.get(s.id)?.coveredHash));
  const firstOrder = book.reduce((n, s) => Math.max(n, s.order + 1), 0);
  const external = previous
    .filter(isExternal)
    .sort((a, b) => a.order - b.order)
    .map((s, i) => toStoredSection({ ...s, order: firstOrder + i }, s.coveredHash));
  const fetchedIds = new Set(fetched.map((s) => s.id));
  const gone = previous.filter((p) => !isExternal(p) && !fetchedIds.has(p.id));
  return { stored: [...book, ...external], gone };
}
