// Marks sections as covered: coveredHash = hash. Run it only when the questions for them are written and bank:check passes.
// Usage: node scripts/mark-covered.ts <chapter-slug>...      all sections of those chapters (or "all")
//        node scripts/mark-covered.ts <chapter-slug> --section <section-id-or-slug>...   only those sections of that chapter
// Via npm, arguments go after "--": npm run book:covered -- parallelism

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildChapters, findChapter, findSection } from './lib/chapters.ts';
import { markCovered } from './lib/covered.ts';
import { SECTIONS_FILE } from './lib/paths.ts';
import { readSections } from './lib/sections-file.ts';
import { chapterSlug } from './lib/slugs.ts';

const { values, positionals: wanted } = parseArgs({
  allowPositionals: true,
  options: { section: { type: 'string', multiple: true } },
});
const sections = readSections();
const slugs = [...new Set(sections.map((s) => chapterSlug(s.chapter)))];
const usage = `usage: node scripts/mark-covered.ts <chapter-slug>... | all\n       node scripts/mark-covered.ts <chapter-slug> --section <section-id-or-slug>...\nchapter slugs: ${slugs.join(', ')}`;
if (!wanted.length || wanted.some((w) => w !== 'all' && !slugs.includes(w))) {
  console.error(usage);
  process.exit(1);
}

let sectionIds: string[] | undefined;
if (values.section?.length) {
  if (wanted.length !== 1 || wanted[0] === 'all') {
    console.error(`--section needs exactly one chapter slug.\n${usage}`);
    process.exit(1);
  }
  const chapter = findChapter(buildChapters(sections, [], undefined), wanted[0])!;
  const found = values.section.map((q) => ({ q, s: findSection(chapter, q) }));
  const missing = found.filter((f) => !f.s).map((f) => f.q);
  if (missing.length) {
    console.error(`unknown section(s) of ${chapter.slug}: ${missing.join(', ')}\nsections: ${chapter.sections.map((s) => `${s.id} (${s.title})`).join('; ')}`);
    process.exit(1);
  }
  sectionIds = found.map((f) => f.s!.id);
}

const n = markCovered(sections, wanted, sectionIds);
writeFileSync(SECTIONS_FILE, JSON.stringify(sections, null, 2) + '\n');
console.log(`marked ${n} section(s) as covered`);
