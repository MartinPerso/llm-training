// Turns what the user saved from a chat assistant (.json, .md or .txt) into a merged question file.
// Pure: text in, plan out. IO and printing live in scripts/bank-import.ts.
//
// Steps: extract the JSON (whole file, or every ```json fence; with a repair of unescaped LaTeX backslashes),
// resolve the chapter (title + id prefixes), merge into the existing file by concept id, validate with the bank checker.

import type { ChapterFile, Section } from '../../src/bank/types.ts';
import { type ChapterInfo, buildChapters, findChapter } from './chapters.ts';
import { type Issue, checkBank, formatIssue } from './check.ts';

// ---------------------------------------------------------------------------------------------
// JSON repair

// LaTeX commands that start with "n": `\neq` is a valid JSON escape (`\n`) followed by "eq", so it parses to the wrong text.
const LATEX_N_RE = /^n(?:eq|abla|ot|notin|mid|geq|leq|subset|subseteq|rightarrow|olimits|ewcommand|u|e|i)(?![A-Za-z])/;

/**
 * Doubles the lone backslashes inside JSON string literals: `"$\frac{1}{2}$"` becomes `"$\\frac{1}{2}$"`.
 * Valid escapes (`\\`, `\"`, `\/`, `\uXXXX`, `\n`) are kept. `\b \f \r \t` followed by a letter are kept as LaTeX
 * (`\beta`, `\frac`, `\right`, `\times`) because a real backspace, form feed, return or tab is never wanted in these texts;
 * `\n` followed by a LaTeX command name (`\neq`, `\nabla`) likewise. Raw line breaks inside a string become `\n`.
 * `count` is the number of fixes: 0 means the text is returned unchanged.
 */
export function repairBackslashes(text: string): { text: string; count: number } {
  let out = '';
  let inString = false;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!inString) {
      out += c;
      if (c === '"') inString = true;
      continue;
    }
    if (c === '"') {
      inString = false;
      out += c;
      continue;
    }
    if (c === '\n' || c === '\r' || c === '\t') {
      out += c === '\n' ? '\\n' : c === '\r' ? '\\r' : '\\t';
      count++;
      continue;
    }
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = text[i + 1];
    if (n === undefined) {
      out += c;
    } else if (n === '\\' || n === '"' || n === '/') {
      out += c + n;
      i++;
    } else if (n === 'u') {
      if (/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
        out += text.slice(i, i + 6);
        i += 5;
      } else {
        out += '\\\\';
        count++;
      }
    } else if (n === 'n') {
      if (LATEX_N_RE.test(text.slice(i + 1, i + 14))) {
        out += '\\\\';
        count++;
      } else {
        out += c + n;
        i++;
      }
    } else if (n === 'b' || n === 'f' || n === 'r' || n === 't') {
      if (/[A-Za-z]/.test(text[i + 2] ?? '')) {
        out += '\\\\';
        count++;
      } else {
        out += c + n;
        i++;
      }
    } else {
      out += '\\\\'; // invalid escape such as `\p`, `\(`, `\{`, `\%`: the backslash was meant literally
      count++;
    }
  }
  return { text: out, count };
}

// ---------------------------------------------------------------------------------------------
// Parsing with a useful error

export interface ParseFailure {
  message: string;
  position?: number;
  line?: number;
  column?: number;
  /** The offending line with a caret under the position. */
  snippet?: string;
}

export type ParseResult = { ok: true; value: unknown; repaired: number } | { ok: false; failure: ParseFailure };

/** Position and message of the first syntax error of `text` as JSON (a small strict scanner; undefined when it is valid). */
export function findJsonError(text: string): { position: number; message: string } | undefined {
  let i = 0;
  const fail = (message: string, position = i): never => {
    throw Object.assign(new Error(message), { position });
  };
  const ws = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i])) i++;
  };
  const describe = () => (i >= text.length ? 'unexpected end of text' : `unexpected character '${text[i]}'`);
  const str = () => {
    i++; // opening quote
    while (i < text.length) {
      const c = text[i];
      if (c === '"') return void i++;
      if (c < ' ') fail('line break or control character inside a string (use \\n)');
      if (c === '\\') {
        const n = text[i + 1];
        if (n === 'u' && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) i += 6;
        else if (n !== undefined && '"\\/bfnrt'.includes(n)) i += 2;
        else fail(`bad escape '\\${n ?? ''}' (a backslash must be doubled)`);
      } else i++;
    }
    fail('unterminated string');
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      if (text[i] === '}') return void i++;
      for (;;) {
        ws();
        if (text[i] !== '"') fail(`expected a double-quoted property name, found ${describe().replace('unexpected ', '')}`);
        str();
        ws();
        if (text[i] !== ':') fail(`expected ':', found ${describe().replace('unexpected ', '')}`);
        i++;
        value();
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === '}') return void i++;
        else fail(`expected ',' or '}', found ${describe().replace('unexpected ', '')}`);
      }
    } else if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') return void i++;
      for (;;) {
        value();
        ws();
        if (text[i] === ',') i++;
        else if (text[i] === ']') return void i++;
        else fail(`expected ',' or ']', found ${describe().replace('unexpected ', '')}`);
      }
    } else if (c === '"') str();
    else {
      const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
      if (!m) fail(describe());
      else i += m[0].length;
    }
  };
  try {
    value();
    ws();
    if (i < text.length) fail('unexpected text after the JSON value');
  } catch (e) {
    const position = (e as { position?: number }).position;
    return position === undefined ? undefined : { position, message: (e as Error).message };
  }
  return undefined;
}

export function describeParseError(text: string, e: unknown): ParseFailure {
  const own = findJsonError(text);
  const raw = e instanceof Error ? e.message : String(e);
  const m = /position (\d+)/.exec(raw);
  const position = own?.position ?? (m ? Math.min(Number(m[1]), text.length) : undefined);
  const message = own?.message ?? raw.replace(/\s*\(line \d+ column \d+\)/, '');
  if (position === undefined) return { message };
  const before = text.slice(0, position);
  const line = before.split('\n').length;
  const column = position - (before.lastIndexOf('\n') + 1) + 1;
  const lineText = text.split('\n')[line - 1] ?? '';
  // Keep the snippet short: a window of the line around the column.
  const from = Math.max(0, column - 1 - 40);
  const snippet = `${lineText.slice(from, from + 80)}\n${' '.repeat(column - 1 - from)}^`;
  return { message, position, line, column, snippet };
}

/**
 * JSON.parse, preceded by a repair of lone backslashes (see repairBackslashes). `repaired` counts the fixes applied.
 * When the text parses as is and needs no repair it is used untouched.
 */
export function parseJson(text: string): ParseResult {
  const fixed = repairBackslashes(text);
  let original: { value: unknown } | undefined;
  let originalError: unknown;
  try {
    original = { value: JSON.parse(text) };
  } catch (e) {
    originalError = e;
  }
  if (fixed.count > 0) {
    try {
      return { ok: true, value: JSON.parse(fixed.text), repaired: fixed.count };
    } catch {
      // fall through: report the original error
    }
  }
  if (original) return { ok: true, value: original.value, repaired: 0 };
  return { ok: false, failure: describeParseError(text, originalError) };
}

// ---------------------------------------------------------------------------------------------
// Finding the JSON in a file

export interface Fence {
  lang: string; // "" for a bare fence
  body: string;
  /** 1-based line of the opening fence. */
  line: number;
  terminated: boolean;
}

/** Fenced code blocks (``` or ~~~, any length of 3+), line based so that a fence inside a string cannot confuse it. */
export function extractFences(text: string): Fence[] {
  const out: Fence[] = [];
  const lines = text.split(/\r?\n/);
  let open: { marker: string; len: number; lang: string; line: number; body: string[] } | undefined;
  lines.forEach((raw, idx) => {
    const l = raw.trimEnd();
    if (!open) {
      const m = /^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/.exec(l);
      if (m) open = { marker: m[1][0], len: m[1].length, lang: m[2].toLowerCase(), line: idx + 1, body: [] };
      return;
    }
    const close = new RegExp(`^\\s*${open.marker === '`' ? '`' : '~'}{${open.len},}\\s*$`);
    if (close.test(l)) {
      out.push({ lang: open.lang, body: open.body.join('\n'), line: open.line, terminated: true });
      open = undefined;
    } else {
      open.body.push(raw);
    }
  });
  if (open) out.push({ lang: open.lang, body: open.body.join('\n'), line: open.line, terminated: false });
  return out;
}

export interface RawChapterFile {
  chapter?: unknown;
  concepts: unknown[];
  [key: string]: unknown;
}

export interface Extracted {
  files: { origin: string; file: RawChapterFile }[];
  errors: string[];
  notes: string[];
}

const isChapterFileShape = (v: unknown): v is RawChapterFile =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { concepts?: unknown }).concepts);

const BACKSLASH_HINT =
  'Most common cause: backslashes in LaTeX must be doubled in JSON ("$\\\\frac{1}{2}$", not "$\\frac{1}{2}$"). Paste this back to the chat: "Resend the JSON block with every backslash doubled, and nothing after it."';

/** `lineOffset`: lines before the text in the saved file (the line of the opening fence), so that the line number matches the file. */
function failureText(origin: string, f: ParseFailure, lineOffset = 0): string {
  const where = f.line !== undefined ? ` at line ${f.line + lineOffset}, column ${f.column} (position ${f.position})` : '';
  return [`${origin}: invalid JSON${where}: ${f.message}`, f.snippet ? f.snippet.replace(/^/gm, '    ') : '', BACKSLASH_HINT].filter(Boolean).join('\n');
}

/**
 * The ChapterFile(s) in what the chat produced: the whole file when it parses (an object, or an array of objects),
 * otherwise every ```json (or bare ```) fenced block, otherwise the outermost `{ ... }` of the text.
 */
export function extractChapterFiles(text: string): Extracted {
  const res: Extracted = { files: [], errors: [], notes: [] };
  const addValue = (origin: string, value: unknown, repaired: number) => {
    if (repaired) {
      res.notes.push(
        `${origin}: fixed ${repaired} unescaped backslash(es)/line break(s) inside strings (LaTeX such as \\frac must be written \\\\frac in JSON). Ask the chat to double its backslashes next time.`,
      );
    }
    const items = Array.isArray(value) ? value : [value];
    let found = 0;
    for (const item of items) {
      if (isChapterFileShape(item)) {
        res.files.push({ origin, file: item });
        found++;
      }
    }
    if (!found) res.notes.push(`${origin}: JSON without a "concepts" array, ignored.`);
    return found;
  };

  const trimmed = text.replace(/^﻿/, '').trim();
  if (!trimmed) {
    res.errors.push('The file is empty.');
    return res;
  }

  const whole = parseJson(trimmed);
  if (whole.ok) {
    addValue('file', whole.value, whole.repaired);
    if (!res.files.length) res.errors.push('The file is JSON but not a ChapterFile: expected { "chapter": "...", "concepts": [ ... ] }.');
    return res;
  }

  const fences = extractFences(trimmed);
  const usable = fences.filter((f) => f.lang === 'json' || f.lang === '');
  if (!usable.length) {
    if (/^[{[]/.test(trimmed)) {
      res.errors.push(failureText('file', whole.failure));
      return res;
    }
    // No fence: try the outermost braces of the text.
    const a = trimmed.indexOf('{');
    const b = trimmed.lastIndexOf('}');
    if (a >= 0 && b > a) {
      const r = parseJson(trimmed.slice(a, b + 1));
      if (r.ok) {
        res.notes.push('No ```json code block found: used the JSON object found in the text.');
        addValue('text', r.value, r.repaired);
        if (!res.files.length) res.errors.push('Found JSON but it is not a ChapterFile: expected { "chapter": "...", "concepts": [ ... ] }.');
        return res;
      }
      res.errors.push(failureText('text', r.failure));
      return res;
    }
    res.errors.push('No JSON found. Save the chat\'s JSON reply (the ```json code block) to a file, or the whole reply as .md/.txt.');
    return res;
  }

  usable.forEach((f, i) => {
    const origin = usable.length === 1 ? `code block (line ${f.line})` : `code block ${i + 1} of ${usable.length} (line ${f.line})`;
    if (!f.terminated) {
      res.errors.push(`${origin}: the code block is never closed. The reply was probably cut off: ask the chat to "continue" with the remaining concepts as a complete JSON block, and save that too.`);
      return;
    }
    const r = parseJson(f.body);
    if (!r.ok) {
      if (f.lang === '' && !/^\s*[{[]/.test(f.body)) return; // a bare fence that is not JSON (a note, a command): not ours
      res.errors.push(failureText(origin, r.failure, f.line));
      return;
    }
    addValue(origin, r.value, r.repaired);
  });
  if (!res.files.length && !res.errors.length) res.errors.push('No ChapterFile found in the code blocks: expected { "chapter": "...", "concepts": [ ... ] }.');
  return res;
}

// ---------------------------------------------------------------------------------------------
// Chapter resolution

const idPrefix = (id: unknown) => (typeof id === 'string' ? id.split('.')[0] : undefined);

export type Resolution = { ok: true; chapter: ChapterInfo; concepts: unknown[]; notes: string[] } | { ok: false; errors: string[] };

/** Finds the chapter by the `chapter` title and checks it against the id prefixes (the chapter slug). All files must agree. */
export function resolveChapter(files: RawChapterFile[], chapters: ChapterInfo[]): Resolution {
  const errors: string[] = [];
  const notes: string[] = [];
  const found: ChapterInfo[] = [];
  const valid = `valid chapters: ${chapters.map((c) => `${c.slug} ("${c.title}")`).join(', ')}`;

  files.forEach((f, i) => {
    const label = files.length > 1 ? `block ${i + 1}: ` : '';
    const title = typeof f.chapter === 'string' ? f.chapter : '';
    const prefixes = new Set(f.concepts.map((c) => idPrefix((c as { id?: unknown } | null)?.id)).filter((p): p is string => !!p));
    const byTitle = title ? findChapter(chapters, title) : undefined;
    if (byTitle) {
      const wrong = [...prefixes].filter((p) => p !== byTitle.slug);
      if (wrong.length) {
        errors.push(`${label}the chapter is "${byTitle.title}" (ids must start with "${byTitle.slug}.") but some ids start with ${wrong.map((p) => `"${p}."`).join(', ')}.`);
        return;
      }
      if (title !== byTitle.title) notes.push(`${label}chapter "${title}" matched "${byTitle.title}"; the file will use the exact title.`);
      found.push(byTitle);
      return;
    }
    const bySlug = prefixes.size === 1 ? chapters.find((c) => c.slug === [...prefixes][0]) : undefined;
    if (bySlug) {
      notes.push(`${label}chapter title ${title ? `"${title}" is unknown` : 'is missing'}; used "${bySlug.title}" from the id prefix "${bySlug.slug}.".`);
      found.push(bySlug);
      return;
    }
    errors.push(`${label}${title ? `unknown chapter "${title}"` : 'missing "chapter" title'}${prefixes.size ? ` (ids start with ${[...prefixes].map((p) => `"${p}."`).join(', ')})` : ''}; ${valid}.`);
  });
  if (errors.length) return { ok: false, errors };

  const first = found[0];
  const other = found.find((c) => c.slug !== first.slug);
  if (other) return { ok: false, errors: [`The blocks are for different chapters ("${first.title}" and "${other.title}"): import one chapter at a time.`] };
  const concepts = files.flatMap((f) => f.concepts);
  if (!concepts.length) return { ok: false, errors: ['The JSON has no concepts.'] };
  return { ok: true, chapter: first, concepts, notes };
}

// ---------------------------------------------------------------------------------------------
// Merge

export interface MergeResult {
  concepts: unknown[];
  added: string[];
  replaced: string[];
  /** Ids that already exist in the file and were not touched (no --replace). */
  skipped: string[];
  /** Existing concepts that the import does not mention. */
  kept: number;
  /** Ids sent more than once in the import (the last copy wins). */
  duplicatesInImport: string[];
  /** Things to double check when replacing (fewer variants, another section, un-retired). */
  cautions: string[];
}

const conceptId = (c: unknown) => (c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string' ? (c as { id: string }).id : undefined);

/**
 * Merges the imported concepts into the existing ones, by id. New ids are appended; an existing id is replaced in place
 * only with `replace`, otherwise skipped; existing concepts missing from the import are kept.
 */
export function mergeConcepts(existing: unknown[], incoming: unknown[], replace: boolean): MergeResult {
  // The import itself may repeat an id (a re-sent concept in a later message): the last copy wins, at the first position.
  const byId = new Map<string, unknown>();
  const noId: unknown[] = [];
  const dup = new Set<string>();
  for (const c of incoming) {
    const id = conceptId(c);
    if (id === undefined) noId.push(c);
    else {
      if (byId.has(id)) dup.add(id);
      byId.set(id, c);
    }
  }

  const existingById = new Map<string, unknown>();
  for (const c of existing) {
    const id = conceptId(c);
    if (id !== undefined && !existingById.has(id)) existingById.set(id, c);
  }

  const res: MergeResult = { concepts: [], added: [], replaced: [], skipped: [], kept: 0, duplicatesInImport: [...dup], cautions: [] };
  for (const c of existing) {
    const id = conceptId(c);
    const next = id !== undefined ? byId.get(id) : undefined;
    if (id === undefined || next === undefined || existingById.get(id) !== c) {
      res.concepts.push(c);
      if (id === undefined || !byId.has(id)) res.kept++;
      continue;
    }
    if (!replace) {
      res.concepts.push(c);
      res.skipped.push(id);
      continue;
    }
    res.concepts.push(next);
    res.replaced.push(id);
    const a = c as { section?: unknown; retired?: unknown; variants?: unknown };
    const b = next as { section?: unknown; retired?: unknown; variants?: unknown };
    const na = Array.isArray(a.variants) ? a.variants.length : 0;
    const nb = Array.isArray(b.variants) ? b.variants.length : 0;
    if (nb < na) res.cautions.push(`${id}: the replacement has ${nb} variant(s) instead of ${na}; progress logged on the missing variant index(es) is orphaned.`);
    if (a.section !== b.section) res.cautions.push(`${id}: the section changed.`);
    if (a.retired === true && b.retired !== true) res.cautions.push(`${id}: the concept was retired and is not any more.`);
  }
  for (const [id, c] of byId) {
    if (existingById.has(id)) continue;
    res.concepts.push(c);
    res.added.push(id);
  }
  for (const c of noId) res.concepts.push(c); // reported by the checker ("(no id)")
  return res;
}

// ---------------------------------------------------------------------------------------------
// Whole plan

export interface ExistingFile {
  /** Parsed content of content/questions/<slug>.json, undefined when it does not exist. */
  data?: unknown;
  /** Set when the file exists but is not valid JSON. */
  parseError?: string;
}

export type ImportPlan =
  | { ok: false; errors: string[]; /** checker errors as issues (a subset of `errors`) */ errorIssues?: Issue[]; warnings: Issue[]; notes: string[]; chapter?: ChapterInfo }
  | { ok: true; chapter: ChapterInfo; merged: ChapterFile; merge: MergeResult; warnings: Issue[]; notes: string[] };

/**
 * Everything `bank:import` does short of writing: extract, resolve, merge, validate. `ok` is false when anything is an
 * error (nothing must be written). `warnings` are only those about the imported concepts (the user can fix them in the chat).
 */
export function planImport(
  text: string,
  sections: Section[],
  readExisting: (slug: string) => ExistingFile,
  opts: { replace?: boolean } = {},
): ImportPlan {
  const extracted = extractChapterFiles(text);
  const notes = [...extracted.notes];
  if (extracted.errors.length) return { ok: false, errors: extracted.errors, warnings: [], notes };

  const chapters = buildChapters(sections, [], undefined);
  const resolved = resolveChapter(extracted.files.map((f) => f.file), chapters);
  if (!resolved.ok) return { ok: false, errors: resolved.errors, warnings: [], notes };
  notes.push(...resolved.notes);
  const chapter = resolved.chapter;

  const extraKeys = new Set(extracted.files.flatMap((f) => Object.keys(f.file).filter((k) => k !== 'chapter' && k !== 'concepts')));
  if (extraKeys.size) notes.push(`Ignored unknown top-level key(s): ${[...extraKeys].join(', ')}.`);

  const existing = readExisting(chapter.slug);
  const fileName = `${chapter.slug}.json`;
  if (existing.parseError) {
    return { ok: false, errors: [`${fileName} exists but is invalid JSON (${existing.parseError}): fix or restore it first.`], warnings: [], notes, chapter };
  }
  let existingConcepts: unknown[] = [];
  if (existing.data !== undefined) {
    const d = existing.data as { concepts?: unknown } | null;
    if (!d || !Array.isArray(d.concepts)) {
      return { ok: false, errors: [`${fileName} exists but is not a ChapterFile (no "concepts" array): fix or restore it first.`], warnings: [], notes, chapter };
    }
    existingConcepts = d.concepts;
  }

  const merge = mergeConcepts(existingConcepts, resolved.concepts, opts.replace === true);
  const merged: ChapterFile = { chapter: chapter.title, concepts: merge.concepts as ChapterFile['concepts'] };

  const check = checkBank([{ name: fileName, data: merged }], sections);
  const touched = new Set([...merge.added, ...merge.replaced]);
  const noId = resolved.concepts.filter((c) => conceptId(c) === undefined).length;
  // Warnings the user can act on: about the concepts of this import (or the file as a whole).
  const warnings = check.warnings.filter((w) => w.concept === undefined || touched.has(w.concept) || (noId > 0 && w.concept === '(no id)'));
  if (check.errors.length) {
    return { ok: false, errors: check.errors.map((e) => formatIssue(e)), errorIssues: check.errors, warnings, notes, chapter };
  }
  return { ok: true, chapter, merged, merge, warnings, notes };
}

// ---------------------------------------------------------------------------------------------
// Messages for the user

/** A message to paste back into the chat so that it fixes the warnings (same ids, only the corrected concepts). */
export function formatFixMessage(warnings: Issue[]): string {
  const lines = warnings.map((w) => `- ${w.concept && w.concept !== '(file)' ? `\`${w.concept}\`: ` : ''}${w.message}`);
  return [
    'Please fix:',
    '',
    ...lines,
    '',
    'Reply with one JSON code block (a ChapterFile, same format as before) containing only the corrected concepts, each with exactly the same id and section, all variants included, and nothing after the block.',
  ].join('\n');
}
