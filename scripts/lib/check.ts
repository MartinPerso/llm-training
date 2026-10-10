// Validation of the question bank (content/questions/*.json). Pure: takes parsed data, returns issues.

import katex from 'katex';
import type { z } from 'zod';
import type { Section } from '../../src/bank/types.ts';
import { extractMath } from './math.ts';
import { CONCEPT_ID_RE, ChapterHeaderSchema, ConceptSchema } from './schema.ts';
import { chapterSlug } from './slugs.ts';

export interface Issue {
  file: string;
  concept?: string;
  message: string;
}

export interface BankFile {
  name: string; // e.g. "inference.json"
  data: unknown; // parsed JSON
}

export interface BankStats {
  chapters: Record<string, { concepts: number; variants: number }>;
  kinds: Record<string, number>;
  totalConcepts: number;
  totalVariants: number;
  retired: number;
}

export interface CheckResult {
  errors: Issue[];
  warnings: Issue[];
  stats: BankStats;
}

const RECALL_MAX = 400;
const PROMPT_MAX = 180;
const CHOICE_MAX = 90;
const VERBATIM_MIN = 5;

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function formatZodIssue(i: z.core.$ZodIssue): string {
  const path = i.path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '');
  let msg = i.message;
  if (i.code === 'invalid_union') msg = 'does not match any question kind';
  if (i.code === 'unrecognized_keys') msg = `unknown key(s): ${(i as { keys: string[] }).keys.join(', ')}`;
  return path ? `${path}: ${msg}` : msg;
}

/** Math problems in one text field. */
export function checkMathInText(text: string): string[] {
  const out: string[] = [];
  const { spans, errors } = extractMath(text);
  out.push(...errors);
  for (const { tex, display } of spans) {
    try {
      katex.renderToString(tex, { throwOnError: true, displayMode: display, strict: 'ignore' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push(`KaTeX cannot render ${display ? '$$' : '$'}${tex}${display ? '$$' : '$'}: ${msg}`);
    }
  }
  return out;
}

interface TextField {
  label: string;
  value: string;
}

function textFields(q: Record<string, unknown>): TextField[] {
  const out: TextField[] = [];
  for (const key of ['prompt', 'answer', 'explanation', 'unit']) {
    if (typeof q[key] === 'string') out.push({ label: key, value: q[key] as string });
  }
  if (Array.isArray(q.choices)) {
    q.choices.forEach((c, i) => typeof c === 'string' && out.push({ label: `choices[${i}]`, value: c }));
  }
  return out;
}

export function checkBank(files: BankFile[], sections: Section[]): CheckResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const stats: BankStats = { chapters: {}, kinds: {}, totalConcepts: 0, totalVariants: 0, retired: 0 };
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const knownChapters = new Set(sections.map((s) => s.chapter));
  const seenIds = new Map<string, string>(); // concept id -> file
  const seenChapters = new Map<string, string>(); // chapter -> file

  for (const file of files) {
    const err = (message: string, concept?: string) => errors.push({ file: file.name, concept, message });
    const warn = (message: string, concept?: string) => warnings.push({ file: file.name, concept, message });

    const head = ChapterHeaderSchema.safeParse(file.data);
    if (!head.success) {
      err(`not a valid chapter file (expected { chapter, concepts[] }): ${head.error.issues.map(formatZodIssue).join('; ')}`);
      continue;
    }
    const { chapter, concepts } = head.data;
    const extraKeys = Object.keys(file.data as object).filter((k) => k !== 'chapter' && k !== 'concepts');
    if (extraKeys.length) err(`unknown top-level key(s): ${extraKeys.join(', ')}`);
    if (sections.length && !knownChapters.has(chapter)) err(`chapter "${chapter}" does not exist in sections.json`);
    const prevFile = seenChapters.get(chapter);
    if (prevFile) err(`chapter "${chapter}" is already defined in ${prevFile}`);
    else seenChapters.set(chapter, file.name);
    const expectedSlug = chapterSlug(chapter);
    if (file.name !== `${expectedSlug}.json`) warn(`file name should be ${expectedSlug}.json for chapter "${chapter}"`);

    const chapterStats = (stats.chapters[chapter] ??= { concepts: 0, variants: 0 });
    let firstSegment: string | undefined;

    for (const raw of concepts) {
      const r = (raw ?? {}) as { id?: unknown; section?: unknown; variants?: unknown; retired?: unknown };
      const id = typeof r.id === 'string' ? r.id : undefined;
      const label = id ?? '(no id)';
      const parsed = ConceptSchema.safeParse(raw);
      if (!parsed.success) for (const i of parsed.error.issues) err(formatZodIssue(i), label);

      // Ids (checked even when the rest of the concept is invalid, to report everything at once)
      if (id) {
        const other = seenIds.get(id);
        if (other) err(`duplicate concept id (also in ${other})`, id);
        else seenIds.set(id, file.name);
        if (CONCEPT_ID_RE.test(id)) {
          const seg = id.split('.')[0];
          firstSegment ??= seg;
          if (seg !== firstSegment) err(`id starts with "${seg}" but other ids in this file start with "${firstSegment}"`, id);
          else if (seg !== expectedSlug) warn(`id prefix "${seg}" differs from the chapter slug "${expectedSlug}"`, id);
        }
      }

      // Section
      if (typeof r.section === 'string' && r.section) {
        const section = sectionById.get(r.section);
        if (!section) err(`section ${r.section} does not exist in sections.json`, label);
        else if (section.chapter !== chapter) {
          err(`section "${section.title}" belongs to chapter "${section.chapter}", not "${chapter}"`, label);
        }
      }

      // Variants: math + soft checks (on raw data so one bad field does not hide the others)
      const variants = Array.isArray(r.variants) ? r.variants : [];
      variants.forEach((v, vi) => {
        if (!v || typeof v !== 'object') return;
        const q = v as Record<string, unknown>;
        const where = (field: string) => `variants[${vi}].${field}`;
        for (const f of textFields(q)) {
          for (const m of checkMathInText(f.value)) err(`${where(f.label)}: ${m}`, label);
        }
        // Calibrated style (GUIDE §2.1): short, plain prompts; the difficulty is in knowing.
        if (r.retired !== true && typeof q.prompt === 'string' && q.prompt.length > PROMPT_MAX) {
          warn(`${where('prompt')}: prompt is ${q.prompt.length} characters (> ${PROMPT_MAX}); make it shorter and plainer`, label);
        }
        if (r.retired !== true && q.kind === 'mcq' && Array.isArray(q.choices)) {
          q.choices.forEach((c, ci) => {
            if (typeof c === 'string' && c.length > CHOICE_MAX) warn(`${where(`choices[${ci}]`)}: choice is ${c.length} characters (> ${CHOICE_MAX})`, label);
          });
        }
        if (q.kind === 'recall' && typeof q.answer === 'string' && typeof q.prompt === 'string') {
          if (q.answer.length > RECALL_MAX) warn(`${where('answer')}: recall answer is ${q.answer.length} characters (> ${RECALL_MAX})`, label);
          const a = norm(q.answer);
          if (a.length >= VERBATIM_MIN && norm(q.prompt).includes(a)) warn(`${where('prompt')}: prompt contains the answer verbatim`, label);
        }
        if (q.kind === 'mcq' && Array.isArray(q.choices) && typeof q.correct === 'number' && typeof q.prompt === 'string') {
          const c = q.choices[q.correct];
          const a = typeof c === 'string' ? norm(c) : '';
          if (a.length >= VERBATIM_MIN && norm(q.prompt).includes(a)) warn(`${where('prompt')}: prompt contains the correct choice verbatim`, label);
        }
      });

      // Stats (valid concepts only)
      if (parsed.success) {
        const concept = parsed.data;
        stats.totalConcepts++;
        chapterStats.concepts++;
        if (concept.retired) stats.retired++;
        stats.totalVariants += concept.variants.length;
        chapterStats.variants += concept.variants.length;
        for (const q of concept.variants) stats.kinds[q.kind] = (stats.kinds[q.kind] ?? 0) + 1;
      }
    }
  }
  return { errors, warnings, stats };
}

export function formatIssue(i: Issue): string {
  return `${i.file}: ${i.concept ?? '(file)'}: ${i.message}`;
}
