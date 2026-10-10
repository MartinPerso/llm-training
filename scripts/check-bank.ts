// Validates content/questions/*.json. Exit 0 if valid (or no files), 1 on errors.
// Usage: node scripts/check-bank.ts [--stats]

import { loadBankFiles } from './lib/bank-files.ts';
import { checkBank, formatIssue } from './lib/check.ts';
import { readSections } from './lib/sections-file.ts';

const sections = readSections();
const { files, parseErrors } = loadBankFiles();
const { errors, warnings, stats } = checkBank(files, sections);

for (const p of parseErrors) errors.push({ file: p.file, message: p.message });
for (const w of warnings) console.warn(`warning: ${formatIssue(w)}`);
for (const e of errors) console.error(`error: ${formatIssue(e)}`);

if (process.argv.includes('--stats')) {
  console.log('\nConcepts and variants per chapter:');
  for (const [chapter, c] of Object.entries(stats.chapters)) console.log(`  ${chapter}: ${c.concepts} concepts, ${c.variants} variants`);
  console.log('Variants per kind:', ['recall', 'numeric', 'mcq', 'truefalse'].map((k) => `${k}=${stats.kinds[k] ?? 0}`).join(', '));
  console.log(`Total: ${stats.totalConcepts} concepts (${stats.retired} retired), ${stats.totalVariants} variants`);
}

if (errors.length) {
  console.error(`\nbank:check FAILED: ${errors.length} error(s), ${warnings.length} warning(s)`);
  process.exit(1);
}
console.log(`bank:check OK: ${files.length} file(s), ${stats.totalConcepts} concept(s), ${warnings.length} warning(s)`);
