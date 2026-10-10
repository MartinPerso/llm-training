// Lists sections whose text is new/changed since questions were written, and sections without concepts.
// Usage: node scripts/book-diff.ts   (always exits 0)

import { loadBankFiles } from './lib/bank-files.ts';
import { diffSections, needsWork } from './lib/diff.ts';
import { readSections } from './lib/sections-file.ts';

const sections = readSections();
if (!sections.length) {
  console.log('content/sections.json is missing or empty: run npm run book:fetch first.');
  process.exit(0);
}

const counts = new Map<string, number>();
for (const f of loadBankFiles().files) {
  const concepts = (f.data as { concepts?: unknown })?.concepts;
  if (!Array.isArray(concepts)) continue;
  for (const c of concepts as { section?: unknown; retired?: unknown }[]) {
    if (typeof c?.section === 'string' && !c.retired) counts.set(c.section, (counts.get(c.section) ?? 0) + 1);
  }
}

const diffs = diffSections(sections, counts);
const todo = diffs.filter(needsWork);
const byChapter = new Map<string, typeof todo>();
for (const d of todo) byChapter.set(d.section.chapter, [...(byChapter.get(d.section.chapter) ?? []), d]);

for (const [chapter, items] of byChapter) {
  console.log(`\n${chapter}`);
  for (const d of items) {
    const flags = [
      d.status === 'new' ? 'new' : d.status === 'changed' ? 'CHANGED since covered' : null,
      d.concepts === 0 ? 'no concepts' : `${d.concepts} concepts`,
    ].filter(Boolean);
    console.log(`  ${'#'.repeat(d.section.level)} ${d.section.title}  [${flags.join(', ')}]  ${d.section.id}`);
  }
}

const changed = diffs.filter((d) => d.status === 'changed').length;
const fresh = diffs.filter((d) => d.status === 'new').length;
const empty = diffs.filter((d) => d.concepts === 0).length;
console.log(
  `\n${todo.length}/${sections.length} sections need work: ${fresh} never covered, ${changed} changed since covered, ${empty} without concepts.`,
);
