import type { ChapterFile, Concept, Section } from './types.ts';

/** Everything the app needs to know about the question bank, in book order. */
export interface Bank {
  /** Active (non-retired) concepts, in book order: chapter order, then section order, then file order. */
  concepts: Concept[];
  byId: Map<string, Concept>;
  /** Chapter titles in book order (only chapters that have at least one concept). */
  chapters: string[];
  chapterOf: Map<string, string>;
  sections: Map<string, Section>;
  /** Concept ids per chapter, in book order. */
  idsByChapter: Map<string, string[]>;
}

/** Accepts an array of sections or `{ sections: [...] }`. */
export function normalizeSections(raw: unknown): Section[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { sections?: unknown }).sections)
      ? (raw as { sections: unknown[] }).sections
      : [];
  return list.filter(
    (s): s is Section =>
      !!s && typeof s === 'object' && typeof (s as Section).id === 'string' && typeof (s as Section).order === 'number',
  );
}

export function buildBank(sectionList: Section[], files: ChapterFile[]): Bank {
  const sections = new Map(sectionList.map((s) => [s.id, s]));
  const chapterFirstOrder = new Map<string, number>();
  for (const s of sectionList) {
    const cur = chapterFirstOrder.get(s.chapter);
    if (cur === undefined || s.order < cur) chapterFirstOrder.set(s.chapter, s.order);
  }

  type Entry = { concept: Concept; chapter: string; seq: number };
  const entries: Entry[] = [];
  let seq = 0;
  const seen = new Set<string>();
  for (const file of files) {
    for (const concept of file.concepts ?? []) {
      if (concept.retired || seen.has(concept.id) || !concept.variants?.length) continue;
      seen.add(concept.id);
      entries.push({ concept, chapter: file.chapter, seq: seq++ });
    }
  }

  const chapterRank = (c: string) => chapterFirstOrder.get(c) ?? Number.MAX_SAFE_INTEGER;
  const sectionRank = (e: Entry) => sections.get(e.concept.section)?.order ?? Number.MAX_SAFE_INTEGER;
  entries.sort(
    (a, b) =>
      chapterRank(a.chapter) - chapterRank(b.chapter) ||
      (a.chapter < b.chapter ? -1 : a.chapter > b.chapter ? 1 : 0) ||
      sectionRank(a) - sectionRank(b) ||
      a.seq - b.seq,
  );

  const concepts = entries.map((e) => e.concept);
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const chapterOf = new Map(entries.map((e) => [e.concept.id, e.chapter]));
  const idsByChapter = new Map<string, string[]>();
  for (const e of entries) {
    const list = idsByChapter.get(e.chapter) ?? [];
    list.push(e.concept.id);
    idsByChapter.set(e.chapter, list);
  }
  return { concepts, byId, chapters: [...idsByChapter.keys()], chapterOf, sections, idsByChapter };
}

/** Turn the result of `import.meta.glob(..., { eager: true, import: 'default' })` into a bank. */
export function bankFromGlobs(
  sectionGlob: Record<string, unknown>,
  questionGlob: Record<string, unknown>,
): Bank {
  const sections = Object.values(sectionGlob).flatMap(normalizeSections);
  const files = Object.entries(questionGlob)
    .filter(([path]) => !(path.split('/').pop() ?? '').startsWith('_'))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, file]) => file as ChapterFile)
    .filter((f) => f && typeof f === 'object' && Array.isArray(f.concepts));
  return buildBank(sections, files);
}
