// Marks all sections of the given chapter(s) as covered: coveredHash = hash.
// Usage: node scripts/mark-covered.ts <chapter-slug>...   (or "all")

import { writeFileSync } from 'node:fs';
import { SECTIONS_FILE } from './lib/paths.ts';
import { readSections } from './lib/sections-file.ts';
import { chapterSlug } from './lib/slugs.ts';

const wanted = process.argv.slice(2);
const sections = readSections();
const slugs = new Set(sections.map((s) => chapterSlug(s.chapter)));
if (!wanted.length || wanted.some((w) => w !== 'all' && !slugs.has(w))) {
  console.error(`usage: node scripts/mark-covered.ts <chapter-slug>... | all\nchapter slugs: ${[...slugs].join(', ')}`);
  process.exit(1);
}

let n = 0;
for (const s of sections) {
  if (wanted.includes('all') || wanted.includes(chapterSlug(s.chapter))) {
    s.coveredHash = s.hash;
    n++;
  }
}
writeFileSync(SECTIONS_FILE, JSON.stringify(sections, null, 2) + '\n');
console.log(`marked ${n} section(s) as covered`);
