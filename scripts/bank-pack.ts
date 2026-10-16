// Writes chat-packs/<slug>.md: one self-contained Markdown file to drop into a chat assistant (claude.ai, ChatGPT, Gemini...)
// together with "Write the questions." The reply is merged back with `npm run bank:import`.
// Usage: node scripts/bank-pack.ts <chapter-slug>|all [--section <section-id-or-slug>] [--out-dir <dir>]
// Via npm, arguments go after "--": npm run bank:pack -- parallelism

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadBankFiles } from './lib/bank-files.ts';
import { type ChapterInfo, type SectionInfo, buildChapters, findChapter, findSection, readBookCache, sectionBody } from './lib/chapters.ts';
import { PACKS_README, estimateTokens, packFileName, renderPack } from './lib/pack.ts';
import { BOOK_DIR, ROOT } from './lib/paths.ts';
import { readSections } from './lib/sections-file.ts';

function parse() {
  try {
    return parseArgs({ allowPositionals: true, options: { section: { type: 'string' }, 'out-dir': { type: 'string' } } });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return process.exit(1);
  }
}
const { values, positionals } = parse();

const cache = readBookCache();
if (!cache) {
  console.error('.cache/book/ is missing or empty: run npm run book:fetch first.');
  process.exit(1);
}
const sections = readSections();
if (!sections.length) {
  console.error('content/sections.json is missing or empty: run npm run book:fetch first.');
  process.exit(1);
}
const { files, parseErrors } = loadBankFiles();
const chapters = buildChapters(sections, files, cache, parseErrors);
const slugs = chapters.map((c) => `${c.slug} (${c.title})`).join('\n  ');
const usage = `usage: npm run bank:pack -- <chapter-slug>|all [--section <section-id-or-slug>]\nvalid chapter slugs:\n  ${slugs}`;

const query = positionals[0];
if (!query) {
  console.error(`Missing chapter.\n${usage}`);
  process.exit(1);
}
if (positionals.length > 1) {
  console.error(`Unexpected extra argument(s): ${positionals.slice(1).join(' ')}`);
  process.exit(1);
}
const all = query.toLowerCase() === 'all';
const chapter = all ? undefined : findChapter(chapters, query);
if (!all && !chapter) {
  console.error(`Unknown chapter "${query}".\n${usage}`);
  process.exit(1);
}
if (all && values.section) {
  console.error('--section needs one chapter slug, not "all".');
  process.exit(1);
}

const externalMessage = (c: { slug: string; title: string; sourceUrl?: string }) =>
  `Chapter ${c.slug} ("${c.title}") comes from an external source, ${c.sourceUrl}, not from the Notion book: there is no cached text to build a pack from. ` +
  `Write a prompt that links the page instead (see "External sources" in AGENTS.md), then import the reply with npm run bank:import.`;
if (chapter?.sourceUrl) {
  console.error(externalMessage(chapter));
  process.exit(1);
}

const notation: SectionInfo | undefined = chapters.find((c) => c.slug === 'transformer')?.sections.find((s) => s.title.toLowerCase() === 'architecture');
const read = (s: SectionInfo) => (s.file ? sectionBody(readFileSync(join(BOOK_DIR, s.file), 'utf8')) : '');
const notationText = notation ? read(notation) : undefined;
const guide = readFileSync(join(ROOT, 'content', 'GUIDE.md'), 'utf8');
const typesSource = readFileSync(join(ROOT, 'src', 'bank', 'types.ts'), 'utf8');
const exampleFile = join(ROOT, 'content', 'questions', 'inference.json');
const exampleSource = existsSync(exampleFile) ? (JSON.parse(readFileSync(exampleFile, 'utf8')) as unknown) : undefined;

const outDir = resolve(values['out-dir'] ?? join(ROOT, 'chat-packs'));
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(outDir, 'README.md'))) writeFileSync(join(outDir, 'README.md'), PACKS_README);

function pack(c: ChapterInfo, section?: SectionInfo) {
  const scope = section ? [section] : c.sections;
  const sourceTexts = new Map(scope.map((s) => [s.id, read(s)]));
  const text = renderPack({ chapter: c, section, notation, notationText, sourceTexts, guide, typesSource, exampleSource });
  const path = join(outDir, packFileName(c.slug, section));
  writeFileSync(path, text);
  const kb = (Buffer.byteLength(text) / 1024).toFixed(1);
  console.log(`${relative(process.cwd(), path) || path}  ${kb} KB  ~${estimateTokens(text.length).toLocaleString('en-US')} tokens`);
}

if (all) {
  for (const c of chapters) {
    if (c.sourceUrl) console.log(`skipped ${c.slug}: external source (${c.sourceUrl}), no cached text`);
    else pack(c);
  }
} else {
  let section: SectionInfo | undefined;
  if (values.section) {
    section = findSection(chapter!, values.section);
    if (!section) {
      console.error(
        `Unknown section "${values.section}" in chapter ${chapter!.slug}. Valid sections (id, or slug of the title):\n  ${chapter!.sections
          .map((s) => `${s.id}  ${s.title}`)
          .join('\n  ')}`,
      );
      process.exit(1);
    }
  }
  pack(chapter!, section);
}
console.log('\nNext: drop the file into a chat with "Write the questions.", save the JSON reply, then: npm run bank:import -- <file>');
