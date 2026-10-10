// Per-chapter / per-section view of the book and the bank: sizes, concept targets and writing status.
// Pure functions over already-loaded data (sections.json, bank files, .cache/book), so they are testable.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Section } from '../../src/bank/types.ts';
import type { BankFile } from './check.ts';
import { BOOK_DIR } from './paths.ts';
import { chapterSlug, slugify } from './slugs.ts';

/** A section whose body (without its heading) is shorter than this has nothing to ask about. */
export const TRIVIAL_BODY_CHARS = 40;
/** About one concept per this many characters of dense notes (GUIDE section 9). */
export const CHARS_PER_CONCEPT = 350;

export const KINDS = ['recall', 'numeric', 'mcq', 'truefalse'] as const;
export type Kind = (typeof KINDS)[number];

export type ChapterStatus = 'todo' | 'in progress' | 'done' | 'outdated';

// ---------------------------------------------------------------------------------------------
// .cache/book

export interface BookCacheEntry {
  file: string; // file name inside .cache/book, e.g. "49-parallelism.md"
  bodyChars: number; // characters of the section's text, excluding the marker comment and the heading line
}

const SECTION_MARKER_RE = /^<!--\s*section:\s*(\S+)\s*\|/;

/** Body of a section file: everything after the marker comment and the heading line, trimmed. */
export function sectionBody(fileText: string): string {
  const lines = fileText.split('\n');
  let i = 0;
  if (SECTION_MARKER_RE.test(lines[0] ?? '')) i = 1;
  if (/^#{1,6}\s/.test(lines[i] ?? '')) i++;
  return lines.slice(i).join('\n').trim();
}

/** Section id -> file and size, read from .cache/book. Undefined when the cache is missing or empty. */
export function readBookCache(dir = BOOK_DIR): Map<string, BookCacheEntry> | undefined {
  if (!existsSync(dir)) return undefined;
  const out = new Map<string, BookCacheEntry>();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.md') || file === 'book.md' || file === 'index.md') continue;
    const text = readFileSync(join(dir, file), 'utf8');
    const m = SECTION_MARKER_RE.exec(text.split('\n', 1)[0] ?? '');
    if (m) out.set(m[1], { file, bodyChars: sectionBody(text).length });
  }
  return out.size ? out : undefined;
}

// ---------------------------------------------------------------------------------------------
// Targets

export const isTrivial = (bodyChars: number) => bodyChars < TRIVIAL_BODY_CHARS;

/** Concepts to aim for in one section: 0 for heading-only sections, otherwise chars / 350 (at least 1). */
export function sectionTarget(bodyChars: number): number {
  return isTrivial(bodyChars) ? 0 : Math.max(1, Math.round(bodyChars / CHARS_PER_CONCEPT));
}

// ---------------------------------------------------------------------------------------------
// Model

export type SectionState = 'new' | 'changed' | 'covered';

export interface SectionInfo {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  order: number;
  hash: string;
  coveredHash?: string;
  state: SectionState;
  file?: string; // undefined when .cache/book is missing
  chars?: number; // body chars; undefined when .cache/book is missing
  trivial?: boolean; // heading-only; undefined when unknown
  target?: number; // undefined when unknown
  concepts: number; // non-retired concepts attached to this section
  conceptIds: string[]; // all concept ids (retired ones included) attached to this section
  suggestedSlug: string; // slug to use as the middle segment of concept ids
}

export interface ChapterInfo {
  slug: string;
  title: string;
  /** `content/questions/<slug>.json` */
  file: string;
  fileExists: boolean;
  parseError?: string;
  sections: SectionInfo[];
  nonTrivialSections?: number;
  chars?: number; // sum of body chars
  target?: number; // sum of per-section targets
  concepts: number; // non-retired
  retired: number;
  variants: number; // of non-retired concepts
  kinds: Record<Kind, number>; // variants of non-retired concepts
  conceptIds: string[]; // every id in the file (retired ones included)
  retiredIds: string[];
  changedSections: SectionInfo[];
  uncoveredSections: SectionInfo[];
  status: ChapterStatus;
}

export function sectionState(s: Pick<Section, 'hash' | 'coveredHash'>): SectionState {
  return s.coveredHash === undefined ? 'new' : s.coveredHash !== s.hash ? 'changed' : 'covered';
}

/**
 * todo: no bank file. outdated: some covered section changed since. done: every section covered at its current hash.
 * in progress: the file exists but some sections were never covered.
 */
export function chapterStatus(fileExists: boolean, states: SectionState[]): ChapterStatus {
  if (!fileExists) return 'todo';
  if (states.includes('changed')) return 'outdated';
  if (states.every((s) => s === 'covered')) return 'done';
  return 'in progress';
}

interface RawConcept {
  id?: unknown;
  section?: unknown;
  retired?: unknown;
  variants?: unknown;
}

export function suggestSectionSlug(s: Pick<Section, 'title'>): string {
  return slugify(s.title).split('-').filter(Boolean).slice(0, 3).join('-') || 'section';
}

export function buildChapters(
  sections: Section[],
  bankFiles: BankFile[],
  cache: Map<string, BookCacheEntry> | undefined,
  parseErrors: { file: string; message: string }[] = [],
): ChapterInfo[] {
  const order: string[] = [];
  const byChapter = new Map<string, Section[]>();
  for (const s of [...sections].sort((a, b) => a.order - b.order)) {
    if (!byChapter.has(s.chapter)) {
      byChapter.set(s.chapter, []);
      order.push(s.chapter);
    }
    byChapter.get(s.chapter)!.push(s);
  }

  return order.map((title) => {
    const slug = chapterSlug(title);
    const file = `content/questions/${slug}.json`;
    const bankFile = bankFiles.find((f) => f.name === `${slug}.json`);
    const parseError = parseErrors.find((p) => p.file === `${slug}.json`)?.message;
    const raw = (bankFile?.data as { concepts?: unknown } | undefined)?.concepts;
    const concepts = (Array.isArray(raw) ? raw : []).filter((c): c is RawConcept => !!c && typeof c === 'object');

    const kinds: Record<Kind, number> = { recall: 0, numeric: 0, mcq: 0, truefalse: 0 };
    let variants = 0;
    let retired = 0;
    let live = 0;
    const conceptIds: string[] = [];
    const retiredIds: string[] = [];
    const idsBySection = new Map<string, string[]>();
    const liveBySection = new Map<string, number>();
    for (const c of concepts) {
      const id = typeof c.id === 'string' ? c.id : undefined;
      if (id) conceptIds.push(id);
      const sec = typeof c.section === 'string' ? c.section : undefined;
      if (sec && id) idsBySection.set(sec, [...(idsBySection.get(sec) ?? []), id]);
      if (c.retired) {
        retired++;
        if (id) retiredIds.push(id);
        continue;
      }
      live++;
      if (sec) liveBySection.set(sec, (liveBySection.get(sec) ?? 0) + 1);
      for (const v of Array.isArray(c.variants) ? c.variants : []) {
        variants++;
        const k = (v as { kind?: unknown } | null)?.kind;
        if (typeof k === 'string' && (KINDS as readonly string[]).includes(k)) kinds[k as Kind]++;
      }
    }

    const infos: SectionInfo[] = (byChapter.get(title) ?? []).map((s) => {
      const entry = cache?.get(s.id);
      const ids = idsBySection.get(s.id) ?? [];
      const existingSlug = ids.map((id) => id.split('.')[1]).find(Boolean);
      return {
        id: s.id,
        title: s.title,
        level: s.level,
        order: s.order,
        hash: s.hash,
        coveredHash: s.coveredHash,
        state: sectionState(s),
        file: entry?.file,
        chars: entry?.bodyChars,
        trivial: entry ? isTrivial(entry.bodyChars) : undefined,
        target: entry ? sectionTarget(entry.bodyChars) : undefined,
        concepts: liveBySection.get(s.id) ?? 0,
        conceptIds: ids,
        suggestedSlug: existingSlug ?? suggestSectionSlug(s),
      };
    });

    const known = infos.every((s) => s.chars !== undefined);
    const fileExists = bankFile !== undefined || parseError !== undefined;
    return {
      slug,
      title,
      file,
      fileExists,
      parseError,
      sections: infos,
      nonTrivialSections: known ? infos.filter((s) => !s.trivial).length : undefined,
      chars: known ? infos.reduce((n, s) => n + s.chars!, 0) : undefined,
      target: known ? infos.reduce((n, s) => n + s.target!, 0) : undefined,
      concepts: live,
      retired,
      variants,
      kinds,
      conceptIds,
      retiredIds,
      changedSections: infos.filter((s) => s.state === 'changed'),
      uncoveredSections: infos.filter((s) => s.state === 'new'),
      status: chapterStatus(fileExists, infos.map((s) => s.state)),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Lookup

export function findChapter(chapters: ChapterInfo[], query: string): ChapterInfo | undefined {
  const q = query.trim().toLowerCase();
  return chapters.find((c) => c.slug === q) ?? chapters.find((c) => c.title.toLowerCase() === q);
}

/** Finds a section of a chapter by id (with or without dashes, or a unique prefix of it), by title or by title slug. */
export function findSection(chapter: ChapterInfo, query: string): SectionInfo | undefined {
  const q = query.trim().toLowerCase();
  const bare = q.replaceAll('-', '');
  const exact = chapter.sections.find(
    (s) => s.id.toLowerCase() === q || s.id.replaceAll('-', '').toLowerCase() === bare || s.title.toLowerCase() === q || slugify(s.title) === q,
  );
  if (exact) return exact;
  const prefixed = chapter.sections.filter((s) => bare.length >= 6 && s.id.replaceAll('-', '').toLowerCase().startsWith(bare));
  return prefixed.length === 1 ? prefixed[0] : undefined;
}

// ---------------------------------------------------------------------------------------------
// Totals and formatting

export interface Totals {
  chapters: number;
  byStatus: Record<ChapterStatus, number>;
  sections: number;
  nonTrivialSections?: number;
  chars?: number;
  target?: number;
  concepts: number;
  retired: number;
  variants: number;
  kinds: Record<Kind, number>;
}

export function totals(chapters: ChapterInfo[]): Totals {
  const known = chapters.every((c) => c.chars !== undefined);
  const t: Totals = {
    chapters: chapters.length,
    byStatus: { todo: 0, 'in progress': 0, done: 0, outdated: 0 },
    sections: 0,
    nonTrivialSections: known ? 0 : undefined,
    chars: known ? 0 : undefined,
    target: known ? 0 : undefined,
    concepts: 0,
    retired: 0,
    variants: 0,
    kinds: { recall: 0, numeric: 0, mcq: 0, truefalse: 0 },
  };
  for (const c of chapters) {
    t.byStatus[c.status]++;
    t.sections += c.sections.length;
    if (known) {
      t.nonTrivialSections! += c.nonTrivialSections!;
      t.chars! += c.chars!;
      t.target! += c.target!;
    }
    t.concepts += c.concepts;
    t.retired += c.retired;
    t.variants += c.variants;
    for (const k of KINDS) t.kinds[k] += c.kinds[k];
  }
  return t;
}

/** "30/25/25/20" = percentage of recall/numeric/mcq/truefalse variants, or "-" when there are none. */
export function formatMix(kinds: Record<Kind, number>): string {
  const n = KINDS.reduce((s, k) => s + kinds[k], 0);
  if (!n) return '-';
  return KINDS.map((k) => Math.round((100 * kinds[k]) / n)).join('/');
}

/** Same mix with names, for briefs and reports: "recall 12, numeric 9, mcq 9, truefalse 7". */
export function formatKindCounts(kinds: Record<Kind, number>): string {
  return KINDS.map((k) => `${k} ${kinds[k]}`).join(', ');
}
