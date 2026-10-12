// Renders the self-contained Markdown briefs printed by `npm run bank:task` (writer) and `... --review` (reviewer).
// Pure: everything comes from the ChapterInfo built in chapters.ts.

import { type ChapterInfo, type SectionInfo, formatKindCounts, formatMix } from './chapters.ts';
import type { Overlap } from './overlap.ts';

export interface BriefContext {
  chapter: ChapterInfo;
  /** Set to scope the writer brief to one section of the chapter. */
  section?: SectionInfo;
  /** The "Architecture" section of "The modern transformer LM": where the book's notation is defined. */
  notation?: SectionInfo;
  /** Reviewer brief only: runs of source words found verbatim in the questions. */
  overlaps?: Overlap[];
  /** False when .cache/book is missing, so no overlap check could be done and sizes are unknown. */
  cacheAvailable: boolean;
}

const cachePath = (s: SectionInfo) => (s.file ? `.cache/book/${s.file}` : '(run `npm run book:fetch`, then re-run this command)');
const sizeOf = (s: SectionInfo) => (s.chars === undefined ? '?' : String(s.chars));
const targetOf = (s: SectionInfo) => (s.target === undefined ? '?' : s.trivial ? 'no concepts needed' : String(s.target));

// ---------------------------------------------------------------------------------------------
// Shared blocks

function setupBlock(c: ChapterInfo, cacheAvailable: boolean): string {
  const lines = [
    '## Setup (once per machine or clone)',
    '',
    '1. Use Node 24: the version is pinned in `.nvmrc` (for example `nvm install && nvm use`, or `nvm use 24`). Everything below runs on it.',
    '2. `npm ci`',
    '3. `.cache/book/` holds the book text. It is gitignored, so a fresh clone, worktree or another machine does not have it: if the folder is missing, run `npm run book:fetch` (public Notion page, no login; it also refreshes the hashes in `content/sections.json` and keeps `coveredHash`). Then run this command again so sizes and targets are filled in. If the fetch fails (no network), stop and tell the user.',
  ];
  if (!cacheAvailable) {
    lines.push(
      '',
      `> **\`.cache/book/\` is missing right now**, so source files, sizes and per-section targets show as \`?\` below. Do step 3, then re-run \`npm run bank:task -- ${c.slug}\` for the complete brief.`,
    );
  }
  return lines.join('\n');
}

function notationBlock(ctx: BriefContext): string {
  const n = ctx.notation;
  const where = !n
    ? 'the "Architecture" section of the chapter "The modern transformer LM" (`.cache/book/`, see `.cache/book/index.md`)'
    : ctx.chapter.slug === 'transformer'
      ? `the "${n.title}" section of this chapter (\`${cachePath(n)}\`, already in your sources)`
      : `\`${cachePath(n)}\` (section "${n.title}" of "The modern transformer LM")`;
  return [
    '## Notation',
    '',
    `The book's symbols ($B$ batch, $S$ sequence length, $D$ model dimension, $L$ layers, $N$, $K$, $H$, $F$, $V$, ...) are defined in ${where}. Read it before writing so that formulas and symbols in your questions are identical to the book's. A chapter may define extra symbols of its own (for example $M$ devices in Parallelism): use those too, exactly as written.`,
  ].join('\n');
}

function sourcesTable(sections: SectionInfo[]): string {
  const rows = sections.map(
    (s) =>
      `| ${'#'.repeat(s.level)} ${s.title} | \`${s.id}\` | \`${cachePath(s)}\` | ${sizeOf(s)} | ${targetOf(s)} | ${s.concepts} | \`${s.suggestedSlug}\` |`,
  );
  return [
    '| Section | Section id (use as `section`) | Source file | Chars | Concept target | Written | Id segment |',
    '|---|---|---|---:|---|---:|---|',
    ...rows,
  ].join('\n');
}

function trivialNote(sections: SectionInfo[]): string {
  const t = sections.filter((s) => s.trivial);
  if (!t.length) return '';
  return `\nHeading-only sections (${t.map((s) => `"${s.title}"`).join(', ')}) need no concepts: skip them, they still get their \`coveredHash\` when you mark the chapter covered.`;
}

function existingBlock(c: ChapterInfo, only?: SectionInfo): string {
  if (!c.fileExists) return '';
  const retired = new Set(c.retiredIds);
  const scope = only ? c.sections.filter((s) => s.id === only.id) : c.sections;
  const fmt = (ids: string[]) => ids.map((id) => `  - \`${id}\`${retired.has(id) ? ' (retired)' : ''}`).join('\n');
  const parts = ['## Existing questions: extend, never rename', ''];
  parts.push(
    `\`${c.file}\` already exists with ${c.concepts} live concept(s) (${c.retired} retired), ${c.variants} variants. **Read it first. Concept ids are permanent**: never rename or reuse one, never delete one (add \`"retired": true\` instead), and keep each concept's variants in place (the app logs answers by variant index, so only append a variant, up to 3, or fix wording in place).`,
  );
  const lines = scope.filter((s) => s.conceptIds.length).map((s) => `- ${s.title}: ${s.concepts} live\n${fmt(s.conceptIds)}`);
  const known = new Set(c.sections.flatMap((s) => s.conceptIds));
  const orphans = only ? [] : c.conceptIds.filter((id) => !known.has(id));
  if (lines.length) parts.push('', 'Concept ids by section:', '', ...lines);
  if (orphans.length) parts.push('', `- (attached to an unknown section: fix these)\n${fmt(orphans)}`);
  if (!lines.length && !orphans.length) parts.push('', '(no concepts yet for this scope)');
  return parts.join('\n');
}

function stateBlock(c: ChapterInfo, only?: SectionInfo): string {
  const scoped = (list: SectionInfo[]) => (only ? list.filter((s) => s.id === only.id) : list);
  const changed = scoped(c.changedSections);
  const fresh = scoped(c.uncoveredSections);
  const out: string[] = ['## Current state', ''];
  out.push(`Chapter status: **${c.status}**.`);
  if (c.status === 'todo') out.push('There is no question file yet: create it.');
  if (c.status === 'in progress') out.push('The file exists but some sections have never been marked covered.');
  if (c.status === 'done') out.push('Every section is covered at its current hash. Only add concepts if the user asked for more coverage; do not rewrite what is there.');
  if (c.status === 'outdated') out.push('The book changed since these sections were covered.');
  if (changed.length) {
    out.push(
      '',
      '**Sections whose text changed since they were covered** (re-read them and compare with their existing concepts; write questions for the new or changed material only, keep the ids of ideas that did not change, and for an idea whose meaning changed create a new id and retire the old one):',
      ...changed.map((s) => `- ${s.title} (\`${s.id}\`)`),
    );
  }
  if (fresh.length && c.status !== 'todo') {
    out.push('', 'Sections never marked covered:', ...fresh.map((s) => `- ${s.title} (\`${s.id}\`, ${s.concepts} concepts so far)`));
  }
  return out.join('\n');
}

const RULES = `## Rules summary (the full contract is \`content/GUIDE.md\`: read it in full before writing)

**What a good question is** (GUIDE sections 2, 3, 12)
- The reader has already read the book and will review each concept many times over 10 days. A question answerable by recognising the book's wording is worthless. Test understanding: a mechanism ("why"), a consequence ("what breaks if..."), a comparison, a number that matters, or a trap that sounds right. Prefer "what happens if" (perturb the setup) over "what is".
- One idea per concept (if the answer needs "and", split it). No definition-only questions, no trivia (names, dates, papers), no figures (\`[image: ...]\` placeholders), no compound questions.
- The prompt never contains or hints at its answer. No "all/none of the above", no "the first option", no references to "the book/notes/section".
- Every variant has an explanation of 2-4 sentences (about 200-450 characters): why the answer is right, why the tempting wrong answers are wrong, and a link to a neighbouring idea (GUIDE §2.1: short prompt, rich explanation). When the answer rests on a formula, show the derivation as a chain of equalities (display math allowed, up to about 600 characters) instead of describing it in words. Prompts short and plain: under about 150 characters (GUIDE §2.1: easy to understand, hard to answer; the difficulty is in knowing, never in parsing or arithmetic).
- Clear, and worth knowing (GUIDE §2.1): the answer teaches something (no "obviously" on reveal); the prompt names the quantity (FLOPs, bytes, parameters), the scope (per layer, per token, prefill) and what is included when a term is ambiguous; a symbol used differently from the book's symbol table (such as $N$ for sequence length) is glossed; plain words, not the notes' internal labels; no convention puzzles (mask polarity, which tensor carries a bar); no algebra on a formula the prompt hands over.
- 1-3 variants per concept, from different angles (cause to effect then effect to cause; the number then the reason; the mechanism then a trap). Each variant is self-contained and does not leak another variant's answer.
- Kinds: \`numeric\` (only when the notes give a definite number; state dtype/units/assumptions; tolerance is relative, 0 = exact, default 0.05), \`recall\` (self-graded; model answer 1-3 sentences, under 400 chars), \`mcq\` (exactly 4 distinct choices, distractors from real confusions, similar lengths, correct index varied, never the longest), \`truefalse\` (one declarative statement, about half false, no "always/never" giveaways). Target mix over the chapter about **35% recall, 15% numeric, 25% mcq, 25% truefalse**: adapt to the content, never invent numbers to hit it. Numeric only when the number itself is the knowledge (GUIDE §2.1); MCQ choices under 90 characters.

**Faithfulness** (GUIDE section 4)
- Never invent facts. Stay within what the notes say. Where the notes look wrong, incomplete or ambiguous, ask about the uncontroversial part and add a sentence starting with \`⚠️ Note:\` to the explanation saying what looks off.
- General background knowledge may appear only in explanations, marked \`(General context, not from the notes: ...)\`.
- Formulas, symbols and notation stay identical to the book. If the notes are too thin for a non-obvious question, write fewer concepts instead of padding.

**Copyright** (GUIDE section 5): the repo and the site are public. Write all prose (prompts, answers, choices, explanations) in your own words: no copied or lightly reworded sentences, no pasted code or tables. Facts, formulas and notation are exempt. Nothing from \`.cache/\` may end up in any committed file.

**Format** (GUIDE sections 6, 7, 8)
- Markdown + KaTeX: \`$inline$\`, rarely \`$$display$$\`. In JSON every backslash is doubled (\`"$\\\\frac{1}{2}$"\`), a literal dollar is \`\\\\$\`, newline is \`\\n\`. No raw HTML, images or tables.
- Concept id: \`<chapter-slug>.<section-slug>.<idea-slug>\`, regex \`^[a-z0-9]+(\\.[a-z0-9-]+)+$\`; the chapter slug has no hyphen; section-slug is a short kebab slug of the section title (the "Id segment" column below suggests one; reuse the one already used by existing ids of that section); idea-slug is 2-4 words, unique within the section. **Ids are permanent.**
- \`section\` is the section id from the table (the most specific heading the idea comes from). The file is \`{ "chapter": "<exact title>", "concepts": [ ... ] }\`; unknown keys are rejected; a complete example is in GUIDE section 8 and the types are in \`src/bank/types.ts\`.`;

function guardrails(c: ChapterInfo): string {
  return [
    '## Guardrails',
    '',
    `- The only files you change are \`${c.file}\` and (when marking covered) \`content/sections.json\`. Never edit another chapter's file, \`src/\`, \`scripts/\`, \`content/GUIDE.md\` or \`package.json\` for this task (other agents may be working on them at the same time). If you think the guide or a script has a gap, say so in your report.`,
    '- Never commit `.cache/` (it is gitignored: keep it that way) and never copy the book\'s text into any file.',
    '- Do not push, and do not open a pull request, unless the user asks.',
  ].join('\n');
}

function reportFormat(c: ChapterInfo, review: boolean): string {
  if (review) {
    return [
      '## Report back to the user',
      '',
      'Use this structure, short and factual:',
      '',
      '```',
      `Reviewed: ${c.title} (${c.slug}), <N> live concepts, <V> variants`,
      'Verdict: <one sentence: bar met / met after fixes / needs more work>',
      'Changed: <n> concepts edited, <n> variants rewritten, <n> concepts added, <n> retired',
      'By category: non-obviousness <n>, clarity <n>, faithfulness <n>, answer leaks <n>, distractors <n>, copied phrasing <n>, format <n>',
      'Details: one line per changed concept id: what was wrong, what you did',
      'Retired: <id>: <why>   (none if none)',
      'Kind mix before -> after: recall/numeric/mcq/truefalse',
      '⚠️ notes: ids whose ⚠️ Note you kept, added or removed, and why',
      'Open questions for the user: things in the notes you could not verify or that look wrong',
      'Gate: bank:check OK, 0 warnings',
      'Commit: <hash> "Review questions: ' + c.title + '" (or "not committed")',
      '```',
    ].join('\n');
  }
  return [
    '## Report back to the user',
    '',
    'When finished, reply with this structure, short and factual:',
    '',
    '```',
    `Chapter: ${c.title} (${c.slug}), status now: done`,
    'Concepts: <N> written (target <T>) across <S> sections; <V> variants',
    'Kind mix: recall <a>, numeric <b>, mcq <c>, truefalse <d>  (= <pct>/<pct>/<pct>/<pct> %)',
    '⚠️ notes: <concept id>: what looks wrong or ambiguous in the notes   (none if none)',
    'Skipped sections: <title>: heading only / too thin / figure only   (none if none)',
    'Gate: bank:check OK, 0 errors, 0 warnings',
    `Commit: <hash> "Add questions: ${c.title}"`,
    'Other: gaps in GUIDE.md or the scripts, errors seen in other chapters\' files, anything the user should decide',
    '```',
    '',
    'Take the counts from `npm run bank:status` (your chapter\'s row) rather than counting by hand.',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Writer brief

export function renderTaskBrief(ctx: BriefContext): string {
  const c = ctx.chapter;
  const only = ctx.section;
  const sources = only ? [only] : c.sections;
  const scopeTitle = only ? ` (only the section "${only.title}")` : '';
  const target = only ? (only.target === undefined ? '?' : only.trivial ? '0' : String(only.target)) : c.target === undefined ? '?' : String(c.target);
  const out: string[] = [];

  out.push(`# Task: write quiz questions for "${c.title}"${scopeTitle}`);
  out.push(
    '',
    `You are writing quiz questions for a personal spaced-repetition app about "Alisa's book of LLMs". The user has already read the book and wants to retain it, so the questions must make them *use* the ideas, not recognise wording. This brief is self-contained apart from one file you must read in full: **\`content/GUIDE.md\`** (the contract). Follow both exactly. Work only on ${only ? `the section "${only.title}" of this chapter` : 'this chapter'}.`,
  );

  out.push('', '## Output', '');
  out.push(`- File: \`${c.file}\` (${c.fileExists ? 'exists: extend it' : 'does not exist yet: create it'}).`);
  out.push(`- Chapter title string, exactly: \`"${c.title}"\`. Top-level shape: \`{ "chapter": "${c.title}", "concepts": [ ... ] }\`.`);
  out.push(`- Concept ids start with \`${c.slug}.\`.`);
  if (only) {
    out.push(
      `- Scope: concepts for the section "${only.title}" (\`${only.id}\`) only. Leave every other concept of the file untouched. Target for this section: ${target === '?' ? 'unknown until the cache exists' : only.trivial ? 'none (heading only)' : `about ${target} concept${target === '1' ? '' : 's'}`}.`,
    );
  } else {
    out.push(
      `- Target: about ${target} concepts for the chapter (sum of the per-section targets below, roughly one concept per 350 characters of notes). It is a guide, not a quota: fewer is fine when the notes are thin, padding with trivia is not.`,
    );
  }

  out.push('', setupBlock(c, ctx.cacheAvailable));
  out.push('', stateBlock(c, only));

  out.push('', `## Sources to read (${only ? 'this section' : 'every section of the chapter, in full'})`, '');
  out.push(sourcesTable(sources));
  out.push(trivialNote(sources));
  if (!only) {
    out.push(
      '',
      'Each section file starts with a `<!-- section: <id> | ... -->` line, then the heading, then the notes. Every heading (H1, H2, H3) is its own section: attach each concept to the most specific one it comes from. Figures show as `[image: ...]` placeholders, so never ask about a picture.',
    );
  }

  out.push('', notationBlock(ctx));
  const existing = existingBlock(c, only);
  if (existing) out.push('', existing);
  out.push('', RULES);

  out.push('', '## Steps', '');
  out.push(
    '1. Do the setup above, then read `content/GUIDE.md` in full (especially sections 2, 3, 4, 6, 7 and the checklist in 12).',
    `2. Read the notation file${only ? '' : ', then every source file in the table'}. Before drafting a concept, check that the notes really support the answer.`,
    `3. Write ${only ? 'the concepts' : 'the chapter file section by section'} to \`${c.file}\`, valid JSON, following the rules above. Save as you go.`,
    '4. Run the gate (below) until it passes.',
    '5. Re-read your questions once against the checklist in GUIDE section 12 and fix what fails.',
    '6. Mark covered (below), then commit (below).',
    '7. Send the report (below).',
  );

  out.push(
    '',
    '## The gate',
    '',
    '```',
    'npm run bank:check -- --stats',
    '```',
    '',
    `It must print no \`error:\` and no \`warning:\` line for \`${c.slug}.json\` and end with \`bank:check OK: ... 0 warning(s)\`. Treat warnings as defects (a recall answer over 400 characters, a prompt that contains its own answer): fix them. Errors in *other* chapters' files are not yours: do not touch those files, just mention them in the report. Afterwards run \`npm run bank:status\` and check your chapter's row (concepts vs target, kind mix).`,
  );

  out.push('', '## Mark covered', '');
  out.push(
    'Only after the gate passes and you are done with the scope:',
    '',
    '```',
    only ? `npm run book:covered -- ${c.slug} --section ${only.id}` : `npm run book:covered -- ${c.slug}`,
    '```',
    '',
    only
      ? `This sets \`coveredHash = hash\` for that section in \`content/sections.json\`. (To cover the whole chapter at once: \`npm run book:covered -- ${c.slug}\`; only when every section is finished.)`
      : `This sets \`coveredHash = hash\` in \`content/sections.json\` for every section of the chapter, heading-only ones included (arguments go after the \`--\`; it accepts one or more chapter slugs, or \`all\`). Do not edit \`sections.json\` by hand.`,
  );

  out.push('', '## Commit', '');
  out.push(
    `Stage only these two files and commit with this message:`,
    '',
    '```',
    `git add ${c.file} content/sections.json`,
    `git commit -m "Add questions: ${c.title}${only ? ` (${only.title})` : ''}"`,
    '```',
    '',
    'Never `git add .` or `git add -A`: that could pick up other agents\' work. Never commit `.cache/`. If another agent working in the same tree already changed `content/sections.json` (their chapter\'s `coveredHash`), that is expected: it only holds hashes, no text.',
  );

  out.push('', guardrails(c));
  out.push('', reportFormat(c, false));
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// ---------------------------------------------------------------------------------------------
// Reviewer brief

const AUDIT = `## What to audit

Go through **every** live concept (skip \`"retired": true\` ones) and every variant. Read the matching source section before judging a concept. Audit against GUIDE sections 2, 3, 4, 5, 6 and 12, with the emphasis below.

1. **Non-obviousness.** Could the reader answer by recognising a phrase from the book, or by common sense without the idea? Flag definition-only questions, trivia, "what is X" with a one-line definition, true/false statements that are trivially true, vague prompts ("why is X important"). Fix by turning them into a use, a contrast, a perturbation ("what happens if...") or a number. Delete nothing that is already fine: do not churn.
   Also flag what the reader has flagged before in play: answers that teach nothing ("nothing surprises me in the answer"), convention puzzles whose difficulty is a double negation (boolean mask polarity, which tensor carries a bar), and numerics that are algebra on a formula the prompt hands over (given $F=8D/3$, "what plain FFN width matches?"). Fix by asking for the reason or the consequence, or retire.
2. **Clarity.** The prompt must be understood on the first read (GUIDE §2.1). It names what is counted (FLOPs, bytes, parameters), the scope (per layer, per token, prefill) and what is included when a term has a narrow and a broad meaning (SwiGLU the activation vs the SwiGLU FFN). A symbol that the section uses differently from the symbol table (for example $N$ as sequence length) is glossed in the prompt. Plain words ("the residual stream", "the RMSNorm output"), not the notes' internal labels ("the branch input", "the fill selector").
3. **Faithfulness to the notes.** Check every claim in every prompt, answer, choice and explanation against the source section. Recompute every numeric answer from the notes' formulas, with the prompt's stated assumptions, and check unit and tolerance (\`tolerance\` is relative; 0 = exact). Anything not in the notes must be marked \`(General context, not from the notes: ...)\` and only in explanations; anything invented in a prompt or answer must go. Check that each \`⚠️ Note:\` is justified (the notes really are wrong or unclear there) and that notation (\`$B$, $S$, $D$, ...\`) is identical to the book.
4. **Answer leaks.** The prompt must not contain the answer, the key term, or a hint. Variants of one concept must not leak each other (each is shown alone and must be answerable alone). MCQ: no tell in length or style (the correct choice must not be the longest or the only detailed one), no "all/none of the above", no "the first option", correct index balanced across the chapter (count them). True/false: no "always/never/only" giveaways, no double negatives, about half false.
5. **Distractor quality (MCQ).** Four distinct choices, each a real confusion: the neighbouring concept, the off-by-a-factor number, the inverted relation. Reject distractors nobody would pick (absurd, off-topic) and distractors that are also arguably correct. For numeric: is the tolerance sensible (accepts rounding, rejects the common wrong answer)?
6. **Copied phrasing.** The bank is public and Alisa's text must not be republished. Use the automated report below as a starting point, then read for lightly reworded sentences (same structure, synonyms swapped), pasted code, copied tables. Rewrite in your own words. Formulas, symbols and facts are exempt and must stay exact.
7. **Mechanics and coverage.** One idea per concept (split compound ones: add a new concept with a new id, narrow the old one only if that does not change what its id means); 2-3 variants from different angles (1 only for a narrow fact); right kind for the content (GUIDE section 3), kind mix near 35/15/25/25 where the content allows; LaTeX valid and escaped; prompts short and plain, under about 150 characters (GUIDE §2.1); explanations 2-4 sentences, about 200-450 characters, explaining why the answer is right and the distractors wrong; recall answers under about 400 characters. Compare the per-section counts with the targets in the sources table: add concepts for important ideas that are missing, retire near-duplicates (several concepts testing the same fact) rather than keeping both.

## How to fix

- Edit \`<file>\` **in place**. Keep every concept id and its \`section\`. Ids are permanent: never rename or reuse one.
- Never delete a concept: to drop one, set \`"retired": true\` and keep it. If a concept's meaning changes materially, give the new meaning a **new id** and retire the old one.
- Never reorder or remove variants (the app logs answers by variant index): rewrite a variant in place, or append a new one (maximum 3). A variant that is beyond repair is rewritten into a new angle on the same idea, or the whole concept is retired.
- New concepts follow the writer rules (GUIDE sections 2-9) and use ids that do not exist yet.
- Do not "improve" what already meets the bar. Every edit should fix a concrete defect you can name in the report.
- Do not change \`coveredHash\`, \`content/sections.json\`, other chapters' files, \`src/\`, \`scripts/\` or GUIDE.`;

export function renderReviewBrief(ctx: BriefContext): string {
  const c = ctx.chapter;
  const out: string[] = [];
  out.push(`# Review: audit the quiz questions for "${c.title}"`);
  if (!c.fileExists) {
    out.push(
      '',
      `> **Nothing to review yet: \`${c.file}\` does not exist.** Do not write it yourself in this role. Tell the user the chapter is still \`todo\` and that the writer brief is \`npm run bank:task -- ${c.slug}\`. The rest of this brief applies once the file exists.`,
    );
  }
  out.push(
    '',
    `You are an independent **reviewer**. Another agent wrote \`${c.file}\`; you did not. Read the file and its source notes, audit every concept, fix the problems in place, and report what you changed. You are the quality gate for a personal spaced-repetition app about "Alisa's book of LLMs": the user has already read the book and will review each concept many times over 10 days, so a question that can be answered by pattern-matching on wording is worthless. **\`content/GUIDE.md\`** is the contract: read it in full first (especially sections 2 to 6 and the self-check in 12).`,
  );

  out.push('', '## Input and output', '');
  out.push(`- File to review and fix: \`${c.file}\` (chapter string \`"${c.title}"\`, ids start with \`${c.slug}.\`).`);
  out.push(
    `- Current content: ${c.concepts} live concepts (${c.retired} retired), ${c.variants} variants, kind mix ${formatKindCounts(c.kinds)} (${formatMix(c.kinds)} % recall/numeric/mcq/truefalse). Chapter status: ${c.status}. Target: about ${c.target === undefined ? '?' : c.target} concepts.`,
  );

  if (c.changedSections.length) {
    out.push(
      `- The book changed since these sections were covered, so check that their concepts still match the current text: ${c.changedSections.map((s) => `"${s.title}"`).join(', ')}.`,
    );
  }

  out.push('', setupBlock(c, ctx.cacheAvailable));

  out.push('', '## Sources to read (every section of the chapter, in full)', '');
  out.push(sourcesTable(c.sections));
  out.push(trivialNote(c.sections));
  out.push('', notationBlock(ctx));

  out.push('', AUDIT.replace('<file>', c.file));

  out.push('', '## Automated copied-phrasing report', '');
  if (!ctx.cacheAvailable) {
    out.push('Not available: `.cache/book/` is missing. Fetch it (see Setup) and re-run this command to get the report.');
  } else if (!ctx.overlaps?.length) {
    out.push('No run of 7 or more consecutive words (math excluded) is shared verbatim between the questions and the source notes. Still read for lightly reworded sentences.');
  } else {
    out.push(
      `Runs of ${7}+ consecutive words (math excluded, case-insensitive) that appear word for word in the source notes. Each one is a likely copy: rewrite it unless it is a technical term or an unavoidable fact.`,
      '',
      ...ctx.overlaps.map((o) => `- \`${o.concept}\` variant ${o.variant}, ${o.field}: "${o.phrase}"`),
    );
  }

  out.push('', '## The gate', '');
  out.push(
    '```',
    'npm run bank:check -- --stats',
    '```',
    '',
    `It must print no \`error:\` and no \`warning:\` line for \`${c.slug}.json\` and end with \`bank:check OK: ... 0 warning(s)\`. Errors in other chapters' files are not yours: do not touch them, just mention them. Run \`npm run bank:status\` for the new counts and mix.`,
  );

  out.push('', '## Commit', '');
  out.push(
    `Stage only the chapter file and commit it:`,
    '',
    '```',
    `git add ${c.file}`,
    `git commit -m "Review questions: ${c.title}"`,
    '```',
    '',
    'Never `git add .` or `git add -A`. Never commit `.cache/`. Do not push unless the user asks. If you changed nothing, do not commit.',
  );

  out.push('', guardrails(c).replace(/^- The only files you change are .*$/m, `- The only file you change is \`${c.file}\`. Never edit another chapter's file, \`src/\`, \`scripts/\`, \`content/GUIDE.md\`, \`content/sections.json\` or \`package.json\` for this task (other agents may be working on them at the same time). If you think the guide or a script has a gap, say so in your report.`));
  out.push('', reportFormat(c, true));
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
