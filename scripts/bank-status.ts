// One row per chapter: size, concept target, concepts written, kind mix and status.
// Usage: node scripts/bank-status.ts [--json]
//   todo = no bank file; in progress = file exists but some sections never covered;
//   done = every section covered at its current hash; outdated = a covered section changed since.
//   Needs .cache/book (npm run book:fetch) for sizes and targets; statuses work without it.

import { loadBankFiles } from './lib/bank-files.ts';
import { buildChapters, readBookCache, totals } from './lib/chapters.ts';
import { readSections } from './lib/sections-file.ts';
import { formatStatusTable } from './lib/status-table.ts';

const sections = readSections();
if (!sections.length) {
  console.error('content/sections.json is missing or empty: run `npm run book:fetch` first.');
  process.exit(1);
}

const cache = readBookCache();
const { files, parseErrors } = loadBankFiles();
const chapters = buildChapters(sections, files, cache, parseErrors);
const t = totals(chapters);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ chapters, totals: t, bookCache: cache !== undefined }, null, 2));
} else {
  if (!cache) console.warn('warning: .cache/book/ is missing, so sizes and targets are unknown ("?"). Run `npm run book:fetch`.\n');
  console.log(formatStatusTable(chapters, t));
  console.log(
    '\nsections = non-trivial (body of 40+ chars); chars = their source text; target = sum of per-section targets (about chars/350, at least 1 per section);' +
      '\nmix = % of recall/numeric/mcq/truefalse variants (goal about 30/25/25/20). Write a chapter with: npm run bank:task -- <slug>' +
      (chapters.some((c) => c.sourceUrl) ? '\n"-" = chapter from an external source (a web page, not the book): no cached text, so no size or target.' : ''),
  );
  for (const c of chapters) {
    if (c.parseError) console.warn(`warning: ${c.file} is not valid JSON: ${c.parseError}`);
  }
}
