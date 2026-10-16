// Prints a self-contained Markdown brief telling any coding agent how to write (or review) one chapter's questions.
// Usage: node scripts/bank-task.ts <chapter-slug-or-title> [--section <section-id-or-slug>] [--review]
// Via npm, arguments go after "--": npm run bank:task -- parallelism --review

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadBankFiles } from './lib/bank-files.ts';
import { renderReviewBrief, renderTaskBrief } from './lib/brief.ts';
import { buildChapters, findChapter, findSection, readBookCache } from './lib/chapters.ts';
import { findOverlaps } from './lib/overlap.ts';
import { BOOK_DIR } from './lib/paths.ts';
import { readSections } from './lib/sections-file.ts';

function parse() {
  try {
    return parseArgs({ allowPositionals: true, options: { section: { type: 'string' }, review: { type: 'boolean' } } });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return process.exit(1);
  }
}
const { values, positionals } = parse();

const sections = readSections();
if (!sections.length) {
  console.error('content/sections.json is missing or empty: run `npm run book:fetch` first.');
  process.exit(1);
}
const cache = readBookCache();
const { files, parseErrors } = loadBankFiles();
const chapters = buildChapters(sections, files, cache, parseErrors);
const slugs = chapters.map((c) => `${c.slug} (${c.title})`).join('\n  ');

const query = positionals[0];
const chapter = query ? findChapter(chapters, query) : undefined;
if (!chapter) {
  console.error(
    `${query ? `Unknown chapter "${query}".` : 'Missing chapter.'}\nusage: npm run bank:task -- <chapter-slug> [--section <section-id-or-slug>] [--review]\nvalid chapter slugs:\n  ${slugs}`,
  );
  process.exit(1);
}
if (positionals.length > 1) {
  console.error(`Unexpected extra argument(s): ${positionals.slice(1).join(' ')}`);
  process.exit(1);
}

const externalMessage = (c: { slug: string; title: string; sourceUrl?: string }) =>
  `Chapter ${c.slug} ("${c.title}") comes from an external source, ${c.sourceUrl}, not from the Notion book: there is no cached text to build a brief from. ` +
  `Write a prompt that links the page instead (see "External sources" in AGENTS.md), then import the reply with npm run bank:import.`;
if (chapter.sourceUrl) {
  console.error(externalMessage(chapter));
  process.exit(1);
}

const notation = chapters.find((c) => c.slug === 'transformer')?.sections.find((s) => s.title.toLowerCase() === 'architecture');
const base = { chapter, notation, cacheAvailable: cache !== undefined };

if (values.review) {
  if (values.section) {
    console.error('--section cannot be combined with --review (a review always covers the whole chapter file).');
    process.exit(1);
  }
  const data = files.find((f) => f.name === `${chapter.slug}.json`)?.data;
  const sourceTexts = chapter.sections.flatMap((s) => (s.file ? [readFileSync(`${BOOK_DIR}/${s.file}`, 'utf8')] : []));
  const overlaps = cache && data ? findOverlaps(data, sourceTexts) : [];
  process.stdout.write(renderReviewBrief({ ...base, overlaps }));
} else {
  let section;
  if (values.section) {
    section = findSection(chapter, values.section);
    if (!section) {
      console.error(
        `Unknown section "${values.section}" in chapter ${chapter.slug}. Valid sections (id, or slug of the title):\n  ${chapter.sections
          .map((s) => `${s.id}  ${s.title}`)
          .join('\n  ')}`,
      );
      process.exit(1);
    }
  }
  process.stdout.write(renderTaskBrief({ ...base, section }));
}
