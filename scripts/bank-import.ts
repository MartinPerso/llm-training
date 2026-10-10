// Merges a chat assistant's reply (.json, .md or .txt) into content/questions/<chapter-slug>.json, after validating it.
// Usage: node scripts/bank-import.ts <file> [--replace] [--dry-run] [--questions-dir <dir>]
// Via npm, arguments go after "--": npm run bank:import -- reply.json
//   --replace         replace concepts whose id already exists (otherwise they are reported and skipped)
//   --dry-run         validate and report, write nothing
//   --questions-dir   write to another folder than content/questions (for tests)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildChapters, readBookCache } from './lib/chapters.ts';
import { formatIssue } from './lib/check.ts';
import { type ExistingFile, formatFixMessage, planImport } from './lib/import.ts';
import { QUESTIONS_DIR } from './lib/paths.ts';
import { readSections } from './lib/sections-file.ts';

function parse() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: { replace: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, 'questions-dir': { type: 'string' } },
    });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return process.exit(1);
  }
}
const { values, positionals } = parse();
const usage = 'usage: npm run bank:import -- <file.json|.md|.txt> [--replace] [--dry-run]';

if (positionals.length !== 1) {
  console.error(`${positionals.length ? `Unexpected extra argument(s): ${positionals.slice(1).join(' ')}` : 'Missing file.'}\n${usage}`);
  process.exit(1);
}
const inputPath = resolve(positionals[0]);
if (!existsSync(inputPath)) {
  console.error(`File not found: ${positionals[0]}\n${usage}`);
  process.exit(1);
}
const sections = readSections();
if (!sections.length) {
  console.error('content/sections.json is missing or empty: run npm run book:fetch first.');
  process.exit(1);
}

const questionsDir = resolve(values['questions-dir'] ?? QUESTIONS_DIR);
const readExisting = (slug: string): ExistingFile => {
  const path = join(questionsDir, `${slug}.json`);
  if (!existsSync(path)) return {};
  try {
    return { data: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (e) {
    return { parseError: e instanceof Error ? e.message : String(e) };
  }
};

const plan = planImport(readFileSync(inputPath, 'utf8'), sections, readExisting, { replace: values.replace === true });
for (const n of plan.notes) console.log(`note: ${n}`);

if (!plan.ok) {
  console.error(`\nImport FAILED, nothing was written:\n`);
  for (const e of plan.errors) console.error(`error: ${e}`);
  if (plan.errorIssues?.length) {
    console.error(`\nSend this back to the chat assistant, then save its new reply and import it:\n\n----\n${formatFixMessage([...plan.errorIssues, ...plan.warnings])}\n----`);
  }
  process.exit(1);
}

const { chapter, merged, merge, warnings } = plan;
const slug = chapter.slug;
const target = join(questionsDir, `${slug}.json`);
const fileLabel = `content/questions/${slug}.json`;

console.log(`\nChapter: ${chapter.title} (${slug})`);
console.log(
  `${values['dry-run'] ? 'Would merge into' : 'Merged into'} ${fileLabel}: ${merge.added.length} added, ${merge.replaced.length} replaced, ${merge.skipped.length} skipped, ${merge.kept} existing kept (untouched).`,
);
if (merge.skipped.length) {
  console.log(`\nAlready in the file, left as they are (re-run with --replace to overwrite them with the imported version):\n${merge.skipped.map((id) => `  ${id}`).join('\n')}`);
}
if (merge.duplicatesInImport.length) {
  console.log(`\nSent more than once in the import (the last copy was used):\n${merge.duplicatesInImport.map((id) => `  ${id}`).join('\n')}`);
}
for (const c of merge.cautions) console.warn(`caution: ${c}`);

if (merge.added.length + merge.replaced.length === 0) {
  console.log(`\nNothing to write: ${fileLabel} is unchanged.`);
} else if (!values['dry-run']) {
  mkdirSync(questionsDir, { recursive: true });
  writeFileSync(target, JSON.stringify(merged, null, 2) + '\n');
  console.log(`\nWrote ${fileLabel}.`);
}

// Where the chapter stands now: live concepts per section against the targets (targets need .cache/book).
const info = buildChapters(sections, [{ name: `${slug}.json`, data: merged }], readBookCache()).find((c) => c.slug === slug)!;
console.log('\nConcepts per section (written / target):');
for (const s of info.sections) {
  const goal = s.target === undefined ? '?' : s.trivial ? 'none needed' : String(s.target);
  console.log(`  ${s.concepts} / ${goal}  ${s.title}`);
}
const todo = info.sections.filter((s) => s.concepts === 0 && !s.trivial);
if (todo.length) console.log(`\nSections without concepts yet: ${todo.map((s) => s.title).join(', ')}. Say "continue" in the chat if more is coming.`);

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s) in the imported concepts:`);
  for (const w of warnings) console.log(`warning: ${formatIssue(w)}`);
  console.log(`\nSend this to the chat assistant, save its corrected reply and import it with --replace:\n\n----\n${formatFixMessage(warnings)}\n----`);
} else {
  console.log('\nThe checker reports no warnings.');
}

console.log(`
Next steps:
  1. Review the questions in the app:   npm run dev
  2. When satisfied, mark the chapter covered (add --section <id> for a single section):
       npm run book:covered -- ${slug}
  3. Commit:
       git add ${fileLabel} content/sections.json && git commit -m "Add questions: ${chapter.title}"
  4. Publish:
       git push`);
