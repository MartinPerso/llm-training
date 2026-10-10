import { describe, expect, it } from 'vitest';
import type { Section } from '../../src/bank/types.ts';
import { buildChapters } from './chapters.ts';
import {
  extractChapterFiles,
  extractFences,
  formatFixMessage,
  mergeConcepts,
  parseJson,
  planImport,
  repairBackslashes,
  resolveChapter,
} from './import.ts';

const sections: Section[] = [
  { id: 'p0', chapter: 'Parallelism', title: 'Parallelism', level: 1, order: 0, hash: 'h0' },
  { id: 'p1', chapter: 'Parallelism', title: 'Data parallelism', level: 2, order: 1, hash: 'h1' },
  { id: 'i1', chapter: 'Inference', title: 'KV cache', level: 2, order: 2, hash: 'h2' },
];
const chapters = buildChapters(sections, [], undefined);

const EXPL = 'Because every rank holds a full replica of the parameters, gradients must be averaged across ranks before the update. That all-reduce is the price of data parallelism, and it grows with model size, unlike activations.';
const concept = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  section: 'p1',
  variants: [{ kind: 'truefalse', prompt: 'Data parallelism splits the model across devices.', answer: false, explanation: EXPL }],
  ...over,
});
const file = (concepts: unknown[], chapter = 'Parallelism') => ({ chapter, concepts });
const none = () => ({});

describe('repairBackslashes', () => {
  it('doubles lone backslashes before LaTeX commands, even those that look like JSON escapes', () => {
    const r = repairBackslashes('{"a": "$\\frac{1}{2}\\times\\beta\\neq\\theta \\right$"}');
    expect(r.count).toBe(6);
    expect(JSON.parse(r.text).a).toBe('$\\frac{1}{2}\\times\\beta\\neq\\theta \\right$');
  });
  it('doubles invalid escapes such as \\( \\{ \\% \\underbrace', () => {
    const r = repairBackslashes('{"a": "\\(x\\) \\{y\\} 5\\% \\underbrace{z}"}');
    expect(JSON.parse(r.text).a).toBe('\\(x\\) \\{y\\} 5\\% \\underbrace{z}');
  });
  it('leaves valid JSON untouched', () => {
    const ok = '{"a": "$\\\\frac{1}{2}$ \\"q\\" line\\nnext \\u00e9 a\\/b \\\\$5"}';
    expect(repairBackslashes(ok)).toEqual({ text: ok, count: 0 });
  });
  it('keeps real newline escapes and only touches string literals', () => {
    const t = '{"a": "x\\ny", "b": [1, 2]}\n';
    expect(repairBackslashes(t)).toEqual({ text: t, count: 0 });
  });
  it('escapes raw line breaks inside strings', () => {
    const r = repairBackslashes('{"a": "line1\nline2"}');
    expect(r.count).toBe(1);
    expect(JSON.parse(r.text).a).toBe('line1\nline2');
  });
});

describe('parseJson', () => {
  it('parses valid JSON without repair', () => {
    expect(parseJson('{"a": 1}')).toEqual({ ok: true, value: { a: 1 }, repaired: 0 });
  });
  it('repairs text that fails to parse', () => {
    const r = parseJson('{"a": "$\\mathbb{R}$"}');
    expect(r).toMatchObject({ ok: true, repaired: 1 });
    expect((r as { value: { a: string } }).value.a).toBe('$\\mathbb{R}$');
  });
  it('repairs text that parses but to the wrong string (\\frac read as form feed)', () => {
    const r = parseJson('{"a": "$\\frac{1}{2}$"}');
    expect((r as { value: { a: string } }).value.a).toBe('$\\frac{1}{2}$');
    expect(r).toMatchObject({ ok: true, repaired: 1 });
  });
  it('reports position, line, column and a snippet for real errors', () => {
    const r = parseJson('{\n  "a": 1,\n  "b": oops\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.line).toBe(3);
      expect(r.failure.column).toBe(8);
      expect(r.failure.snippet).toContain('"b": oops');
      expect(r.failure.snippet).toContain('^');
    }
  });
});

describe('extractFences', () => {
  it('finds json and bare fences and ignores other languages in extractChapterFiles', () => {
    const t = 'intro\n```json\n{"a":1}\n```\ntext\n```\n{"b":2}\n```\n```python\nprint(1)\n```\n';
    const f = extractFences(t);
    expect(f.map((x) => [x.lang, x.body, x.terminated])).toEqual([
      ['json', '{"a":1}', true],
      ['', '{"b":2}', true],
      ['python', 'print(1)', true],
    ]);
  });
  it('handles longer fences and unterminated blocks', () => {
    expect(extractFences('````json\n{"a":"```"}\n````\n')[0].body).toBe('{"a":"```"}');
    expect(extractFences('```json\n{"a":')[0].terminated).toBe(false);
  });
});

describe('extractChapterFiles', () => {
  const a = file([concept('parallelism.data-parallelism.a')]);
  const b = file([concept('parallelism.data-parallelism.b')]);
  it('takes the whole file when it parses', () => {
    const r = extractChapterFiles(JSON.stringify(a));
    expect(r.errors).toEqual([]);
    expect(r.files).toHaveLength(1);
  });
  it('accepts an array of ChapterFiles', () => {
    expect(extractChapterFiles(JSON.stringify([a, b])).files).toHaveLength(2);
  });
  it('extracts every json fence of a multi-message answer', () => {
    const text = `Here you go\n\`\`\`json\n${JSON.stringify(a, null, 2)}\n\`\`\`\n\n---\ncontinue\n\n\`\`\`json\n${JSON.stringify(b, null, 2)}\n\`\`\`\n`;
    const r = extractChapterFiles(text);
    expect(r.errors).toEqual([]);
    expect(r.files.map((f) => (f.file.concepts[0] as { id: string }).id)).toEqual(['parallelism.data-parallelism.a', 'parallelism.data-parallelism.b']);
  });
  it('ignores bare fences that are not JSON and other languages', () => {
    const text = `\`\`\`\nnpm run x\n\`\`\`\n\`\`\`json\n${JSON.stringify(a)}\n\`\`\`\n`;
    const r = extractChapterFiles(text);
    expect(r.errors).toEqual([]);
    expect(r.files).toHaveLength(1);
  });
  it('falls back to the outermost braces when there is no fence', () => {
    const r = extractChapterFiles(`Sure!\n${JSON.stringify(a)}\nHope it helps`);
    expect(r.errors).toEqual([]);
    expect(r.files).toHaveLength(1);
    expect(r.notes.join(' ')).toContain('No ```json code block');
  });
  it('repairs backslashes and says so', () => {
    const r = extractChapterFiles('```json\n{"chapter": "Parallelism", "concepts": [{"id": "x", "t": "$\\frac{1}{2}$"}]}\n```');
    expect(r.errors).toEqual([]);
    expect(r.notes.join(' ')).toContain('fixed 1 unescaped backslash');
    expect(((r.files[0].file.concepts[0]) as { t: string }).t).toBe('$\\frac{1}{2}$');
  });
  it('reports invalid JSON with position and the backslash hint', () => {
    const r = extractChapterFiles('```json\n{"chapter": "P", "concepts": [,]}\n```');
    expect(r.files).toEqual([]);
    expect(r.errors[0]).toContain('invalid JSON at line 2');
    expect(r.errors[0]).toContain('backslashes in LaTeX must be doubled');
  });
  it('reports a cut-off reply', () => {
    expect(extractChapterFiles('```json\n{"chapter": "P", "concepts": [').errors[0]).toContain('never closed');
  });
  it('reports no JSON, and JSON that is not a ChapterFile', () => {
    expect(extractChapterFiles('just words').errors[0]).toContain('No JSON found');
    expect(extractChapterFiles('{"a": 1}').errors[0]).toContain('not a ChapterFile');
    expect(extractChapterFiles('  ').errors[0]).toContain('empty');
  });
});

describe('resolveChapter', () => {
  it('matches the title and the id prefix', () => {
    const r = resolveChapter([file([concept('parallelism.a.b')])], chapters);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.chapter.slug).toBe('parallelism');
  });
  it('rejects ids of another chapter', () => {
    const r = resolveChapter([file([concept('inference.a.b')])], chapters);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('ids must start with "parallelism."');
  });
  it('infers the chapter from the id prefix when the title is wrong or missing', () => {
    const r = resolveChapter([file([concept('parallelism.a.b')], 'Paralelism')], chapters);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.notes[0]).toContain('used "Parallelism"');
    expect(resolveChapter([{ concepts: [concept('inference.a.b')] }], chapters)).toMatchObject({ ok: true });
  });
  it('lists the valid chapters for an unknown one', () => {
    const r = resolveChapter([file([concept('zzz.a.b')], 'Nope')], chapters);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('valid chapters: parallelism ("Parallelism")');
  });
  it('rejects blocks for different chapters and empty imports', () => {
    expect(resolveChapter([file([concept('parallelism.a.b')]), file([concept('inference.a.b')], 'Inference')], chapters).ok).toBe(false);
    expect(resolveChapter([file([])], chapters).ok).toBe(false);
  });
});

describe('mergeConcepts', () => {
  const x = concept('parallelism.a.x');
  const y = concept('parallelism.a.y');
  const x2 = concept('parallelism.a.x', { section: 'p0' });
  const z = concept('parallelism.a.z');
  it('appends new ids and keeps existing concepts missing from the import', () => {
    const r = mergeConcepts([x, y], [z], false);
    expect(r.concepts).toEqual([x, y, z]);
    expect(r).toMatchObject({ added: ['parallelism.a.z'], replaced: [], skipped: [], kept: 2 });
  });
  it('skips existing ids without --replace', () => {
    const r = mergeConcepts([x, y], [x2, z], false);
    expect(r.concepts).toEqual([x, y, z]);
    expect(r).toMatchObject({ added: ['parallelism.a.z'], skipped: ['parallelism.a.x'], replaced: [], kept: 1 });
  });
  it('replaces in place with --replace and warns about risky replacements', () => {
    const fewer = concept('parallelism.a.y', { variants: [] });
    const two = concept('parallelism.a.y', { variants: [x.variants[0], x.variants[0]] });
    const r = mergeConcepts([x, two], [x2, fewer], true);
    expect(r.concepts).toEqual([x2, fewer]);
    expect(r.replaced).toEqual(['parallelism.a.x', 'parallelism.a.y']);
    expect(r.kept).toBe(0);
    expect(r.cautions.join('\n')).toContain('the section changed');
    expect(r.cautions.join('\n')).toContain('0 variant(s) instead of 2');
  });
  it('uses the last copy of an id sent twice in the import', () => {
    const r = mergeConcepts([], [x, z, x2], false);
    expect(r.concepts).toEqual([x2, z]);
    expect(r.duplicatesInImport).toEqual(['parallelism.a.x']);
  });
});

describe('planImport', () => {
  const text = (concepts: unknown[]) => '```json\n' + JSON.stringify(file(concepts), null, 2) + '\n```';
  const existing = (concepts: unknown[]) => () => ({ data: file(concepts) });

  it('creates the file from scratch', () => {
    const p = planImport(text([concept('parallelism.data-parallelism.a')]), sections, none);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.chapter.slug).toBe('parallelism');
      expect(p.merged.chapter).toBe('Parallelism');
      expect(p.merge.added).toEqual(['parallelism.data-parallelism.a']);
      expect(p.warnings).toEqual([]);
    }
  });
  it('merges: appends, skips existing ids without --replace, keeps the rest', () => {
    const old = concept('parallelism.data-parallelism.old');
    const a = concept('parallelism.data-parallelism.a');
    const a2 = concept('parallelism.data-parallelism.a', { retired: true });
    const p = planImport(text([a2, concept('parallelism.data-parallelism.b')]), sections, existing([old, a]));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.merged.concepts.map((c) => c.id)).toEqual(['parallelism.data-parallelism.old', 'parallelism.data-parallelism.a', 'parallelism.data-parallelism.b']);
      expect(p.merge.skipped).toEqual(['parallelism.data-parallelism.a']);
      expect(p.merged.concepts[1].retired).toBeUndefined();
    }
    const q = planImport(text([a2]), sections, existing([old, a]), { replace: true });
    expect(q.ok && q.merged.concepts[1].retired).toBe(true);
  });
  it('fails on checker errors and writes nothing (no plan)', () => {
    const p = planImport(text([concept('parallelism.data-parallelism.a', { section: 'nope' })]), sections, none);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors.join('\n')).toContain('section nope does not exist');
    const wrongChapter = planImport(text([concept('parallelism.data-parallelism.a', { section: 'i1' })]), sections, none);
    expect(wrongChapter.ok).toBe(false);
  });
  it('fails on KaTeX errors', () => {
    const bad = concept('parallelism.data-parallelism.a', {
      variants: [{ kind: 'truefalse', prompt: 'Is $\\frac{1}{$ fine?', answer: true, explanation: EXPL }],
    });
    const p = planImport(text([bad]), sections, none);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errorIssues?.[0].message).toContain('KaTeX');
  });
  it('keeps warnings of imported concepts only, and writes anyway', () => {
    const short = concept('parallelism.data-parallelism.short', {
      variants: [{ kind: 'truefalse', prompt: 'Short statement here.', answer: true, explanation: 'Too short.' }],
    });
    const oldShort = concept('parallelism.data-parallelism.oldshort', {
      variants: [{ kind: 'truefalse', prompt: 'Short statement here.', answer: true, explanation: 'Too short.' }],
    });
    const p = planImport(text([short]), sections, existing([oldShort]));
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.warnings.map((w) => w.concept)).toEqual(['parallelism.data-parallelism.short']);
      const msg = formatFixMessage(p.warnings);
      expect(msg).toContain('Please fix:');
      expect(msg).toContain('`parallelism.data-parallelism.short`: variants[0].explanation');
      expect(msg).toContain('same id');
    }
  });
  it('concatenates the concepts of several blocks', () => {
    const t = [text([concept('parallelism.data-parallelism.a')]), 'more', text([concept('parallelism.data-parallelism.b')])].join('\n\n');
    const p = planImport(t, sections, none);
    expect(p.ok && p.merge.added).toEqual(['parallelism.data-parallelism.a', 'parallelism.data-parallelism.b']);
  });
  it('fails on an existing file that is invalid', () => {
    const p = planImport(text([concept('parallelism.data-parallelism.a')]), sections, () => ({ parseError: 'Unexpected token' }));
    expect(p.ok).toBe(false);
  });
  it('fails on bad JSON before anything else', () => {
    const p = planImport('```json\n{"chapter": \n```', sections, none);
    expect(p.ok).toBe(false);
  });
});
