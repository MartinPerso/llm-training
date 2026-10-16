// Fetches the book from its public Notion page, converts it to Markdown and splits it into sections.
// Output (never committed): .cache/book/*.md. Committed: content/sections.json (ids, titles, hashes; no text).
//
// Usage: node scripts/fetch-book.ts [--offline]   (--offline reuses .cache/notion-blocks.json)

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { convertBook } from './lib/convert.ts';
import { NotionClient, type BlockMap } from './lib/notion.ts';
import { BOOK_DIR, CACHE_DIR, RAW_BLOCKS_FILE, SECTIONS_FILE } from './lib/paths.ts';
import { isExternal, mergeFetchedSections, readSections } from './lib/sections-file.ts';
import { chapterSlug } from './lib/slugs.ts';

const HOST = 'alisawuffles.notion.site';
const PAGE_ID = '2cd7eb87-3605-8073-b8bc-ffbbbcee3904';

const offline = process.argv.includes('--offline');

let blocks: BlockMap;
if (offline && existsSync(RAW_BLOCKS_FILE)) {
  console.log(`Using cached blocks from ${RAW_BLOCKS_FILE}`);
  blocks = JSON.parse(readFileSync(RAW_BLOCKS_FILE, 'utf8'));
} else {
  console.log(`Fetching https://${HOST} page ${PAGE_ID} ...`);
  blocks = await new NotionClient({ host: HOST, log: console.log }).loadPage(PAGE_ID);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(RAW_BLOCKS_FILE, JSON.stringify(blocks));
}

const { sections, stats } = convertBook(blocks, PAGE_ID);

// .cache/book: delete stale files, then write one file per section plus book.md and index.md.
mkdirSync(BOOK_DIR, { recursive: true });
for (const f of readdirSync(BOOK_DIR)) rmSync(join(BOOK_DIR, f), { recursive: true, force: true });

const pad2 = (n: number) => String(n).padStart(String(sections.length - 1).length < 2 ? 2 : String(sections.length - 1).length, '0');
const fileOf = (s: (typeof sections)[number]) => `${pad2(s.order)}-${s.slug || 'untitled'}.md`;
const comment = (s: (typeof sections)[number]) => `<!-- section: ${s.id} | chapter: ${s.chapter} | ${'H' + s.level} -->`;

for (const s of sections) writeFileSync(join(BOOK_DIR, fileOf(s)), `${comment(s)}\n${s.markdown}\n`);
writeFileSync(join(BOOK_DIR, 'book.md'), sections.map((s) => `${comment(s)}\n${s.markdown}`).join('\n\n') + '\n');
writeFileSync(
  join(BOOK_DIR, 'index.md'),
  [
    '| order | file | level | chapter slug | section id | chars | title |',
    '|---|---|---|---|---|---|---|',
    ...sections.map(
      (s) => `| ${s.order} | ${fileOf(s)} | H${s.level} | ${chapterSlug(s.chapter)} | ${s.id} | ${s.markdown.length} | ${s.title} |`,
    ),
  ].join('\n') + '\n',
);

// content/sections.json: preserve coveredHash by id, keep external-source sections (those with a url) after the book.
const { stored, gone } = mergeFetchedSections(sections, readSections());
mkdirSync(dirname(SECTIONS_FILE), { recursive: true });
writeFileSync(SECTIONS_FILE, JSON.stringify(stored, null, 2) + '\n');

const changed = stored.filter((s) => s.coveredHash && s.coveredHash !== s.hash);
const external = stored.filter(isExternal);
const warnings = [...stats.warnings];
for (const g of gone) warnings.push(`section no longer in the book: ${g.id} "${g.title}" (covered: ${!!g.coveredHash})`);

const chapters = new Set(sections.map((s) => s.chapter));
console.log('\n=== Summary ===');
console.log(`chapters: ${chapters.size}, sections: ${sections.length}`);
if (external.length) console.log(`kept ${external.length} external-source section(s) of ${new Set(external.map((s) => s.chapter)).size} chapter(s)`);
console.log('blocks by type:', Object.entries(stats.blockCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));
console.log(`equations: ${stats.inlineEquations} inline + ${stats.displayEquations} display = ${stats.inlineEquations + stats.displayEquations}`);
console.log(`book size: ${sections.reduce((n, s) => n + s.markdown.length, 0)} characters of Markdown`);
if (changed.length) console.log(`changed since covered: ${changed.length} section(s); run npm run book:diff`);
console.log(warnings.length ? `warnings (${warnings.length}):\n  ${warnings.join('\n  ')}` : 'warnings: none');
console.log(`wrote ${sections.length} files to ${BOOK_DIR} and ${SECTIONS_FILE}`);
