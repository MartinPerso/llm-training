// Renders the self-contained Markdown "chat pack" printed by `npm run bank:pack`: everything a chat assistant
// (claude.ai, ChatGPT, Gemini...) needs to write one chapter's questions, with no tools and no access to the repo.
// Pure: file contents are passed in, so this is testable. The instructions mirror the agent brief (brief.ts) but have
// no shell commands and no repo paths.

import type { ChapterInfo, SectionInfo } from './chapters.ts';

export interface PackInput {
  chapter: ChapterInfo;
  /** Set to pack a single section of the chapter. */
  section?: SectionInfo;
  /** The "Architecture" section of "The modern transformer LM": where the book's notation is defined. */
  notation?: SectionInfo;
  /** Body text (see sectionBody) of the notation section. */
  notationText?: string;
  /** Section id -> body text of its source file. */
  sourceTexts: Map<string, string>;
  /** Full text of content/GUIDE.md. */
  guide: string;
  /** Full text of src/bank/types.ts. */
  typesSource: string;
  /** Parsed content/questions/inference.json (or anything with a `concepts` array) to draw the calibrated example from. */
  exampleSource?: unknown;
}

export const estimateTokens = (chars: number) => Math.round(chars / 4);

/** `parallelism.md`, or `parallelism--data-parallelism.md` for a single-section pack. */
export function packFileName(slug: string, section?: Pick<SectionInfo, 'suggestedSlug'>): string {
  return section ? `${slug}--${section.suggestedSlug}.md` : `${slug}.md`;
}

// ---------------------------------------------------------------------------------------------
// Pieces taken from other files

/** Raises every Markdown heading by `by` levels (outside code fences) so an embedded document nests under our headings. */
export function demoteHeadings(md: string, by = 1): string {
  let fence: string | undefined;
  return md
    .split('\n')
    .map((line) => {
      const f = /^\s*(`{3,}|~{3,})/.exec(line);
      if (f) {
        if (!fence) fence = f[1][0];
        else if (f[1][0] === fence) fence = undefined;
        return line;
      }
      if (fence) return line;
      return /^#{1,6}\s/.test(line) ? '#'.repeat(by) + line : line;
    })
    .join('\n');
}

/** The part of src/bank/types.ts that describes a question file: Question, Concept, ChapterFile and the tolerance default. */
export function extractTypesBlock(typesSource: string): string {
  const start = typesSource.indexOf('export type Question');
  if (start < 0) return typesSource.trim();
  const end = typesSource.indexOf('export const BOOK_URL', start);
  return typesSource.slice(start, end < 0 ? undefined : end).trim();
}

/** Concepts to show as the calibrated example: all four kinds, derivations in the explanations, several sections. */
export const EXAMPLE_IDS = [
  'inference.speculative-decoding.accept-rule',
  'inference.speculative-decoding.resample-residual',
  'inference.kv-cache.size-accounting',
  'inference.reducing-kv-cache.gqa-factor',
  'inference.reducing-kv-cache.mla',
  'inference.batching-packing.idle-slots',
  'inference.sampling.nucleus-boundary',
  'inference.flash-attention.hbm-traffic',
];

interface LooseConcept {
  id?: unknown;
  retired?: unknown;
}

/** Active (non-retired) concepts: the preferred ids first, in the given order, then the first others to reach `n`. */
export function pickExamples(source: unknown, preferred: string[] = EXAMPLE_IDS, n = 8): unknown[] {
  const raw = (source as { concepts?: unknown } | undefined)?.concepts;
  const active = (Array.isArray(raw) ? raw : []).filter((c): c is LooseConcept => !!c && typeof c === 'object' && (c as LooseConcept).retired !== true);
  const picked = preferred.map((id) => active.find((c) => c.id === id)).filter((c): c is LooseConcept => c !== undefined);
  for (const c of active) {
    if (picked.length >= n) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.slice(0, n);
}

// ---------------------------------------------------------------------------------------------
// Instructions

const targetOf = (s: SectionInfo) => (s.target === undefined ? '?' : s.trivial ? 'no concepts needed' : String(s.target));

function sectionTable(c: ChapterInfo, sections: SectionInfo[]): string {
  const showWritten = c.fileExists;
  const head = `| Section title | Section id (use as \`section\`) | Concept target | Id segment |${showWritten ? ' Written so far |' : ''}`;
  const sep = `|---|---|---|---|${showWritten ? '---:|' : ''}`;
  const rows = sections.map(
    (s) =>
      `| ${'#'.repeat(s.level)} ${s.title} | \`${s.id}\` | ${targetOf(s)} | \`${s.suggestedSlug}\` |${showWritten ? ` ${s.concepts} |` : ''}`,
  );
  return [head, sep, ...rows].join('\n');
}

function existingBlock(c: ChapterInfo, scope: SectionInfo[]): string {
  if (!c.fileExists) return '';
  const retired = new Set(c.retiredIds);
  const lines = scope
    .filter((s) => s.conceptIds.length)
    .map((s) => `- ${s.title}:\n${s.conceptIds.map((id) => `  - \`${id}\`${retired.has(id) ? ' (retired)' : ''}`).join('\n')}`);
  const out = [
    '## Concepts that already exist',
    '',
    `This chapter already has ${c.concepts} live concept(s) (${c.retired} retired) in the user's bank. You cannot see their content, only their ids${scope.length < c.sections.length ? ' (for the sections in scope)' : ''}:`,
    '',
    lines.length ? lines.join('\n') : '(none yet for this scope)',
    '',
    'Rules for extending a bank that already exists:',
    '- Never rename or reuse one of these ids, and do not output them again: your new concepts need **new** ids. The user merges your JSON into their file; an id that already exists is skipped.',
    '- Do not write a concept that tests an idea already covered by one of the ids above (their names tell you what they cover). Add the ideas that are missing.',
    '- You never delete anything: retiring a concept is the user\'s decision, not yours.',
  ];
  return out.join('\n');
}

function instructions(i: PackInput): string {
  const c = i.chapter;
  const only = i.section;
  const scope = only ? [only] : c.sections;
  const target = only
    ? only.target === undefined
      ? '?'
      : only.trivial
        ? '0'
        : String(only.target)
    : c.target === undefined
      ? '?'
      : String(c.target);
  const firstReal = scope.find((s) => !s.trivial) ?? scope[0];
  const exampleSlug = firstReal?.suggestedSlug ?? 'section';
  const scopeWords = only ? `the section "${only.title}" of the chapter "${c.title}"` : `the chapter "${c.title}"`;
  const out: string[] = [];

  out.push(`## Task: write quiz questions for ${scopeWords}`);
  out.push(
    '',
    `You are helping build a personal spaced-repetition quiz about "Alisa's book of LLMs". The user has already read the book and wants to **retain it over the next 10 days**: every concept you write will be reviewed several times, so a question that can be answered by recognising the book's wording is worthless. Write questions that make the reader *use* the ideas: a mechanism ("why"), a consequence ("what breaks if..."), a comparison, a number that matters, or a trap that sounds right.`,
    '',
    'This file is self-contained and you have no tools: everything you need is below (instructions, the full style guide, the data format, a calibrated example, and the source notes). The user will only add a short message such as "Write the questions." Do not ask questions back: start writing.',
  );

  out.push('', '## Output contract', '');
  out.push(
    '- Reply with **one JSON code block** (a ```json fence) that holds a `ChapterFile` (see "The data types" below):',
    '',
    '```',
    `{ "chapter": "${c.title}", "concepts": [ ... ] }`,
    '```',
    '',
    '- **Nothing after the code block.** If you must tell the user something (for example which sections remain), put at most two or three plain lines *before* the block. Never put anything else in a code fence.',
    '- The block is saved to a file and checked by a program, so it must be strictly valid JSON (see "JSON escaping").',
    `- The \`chapter\` string must be exactly \`"${c.title}"\`.`,
    only
      ? `- Scope: write concepts for **this section only**: "${only.title}" (section id \`${only.id}\`). Every concept's \`section\` is that id. Ignore the other sections of the chapter.`
      : `- Scope: the whole chapter. Aim for about **${target} concepts** in total (roughly one per 350 characters of notes, per section as in the table below). That is a guide, not a quota: write fewer when the notes are thin, never pad with trivia.`,
  );
  if (only) {
    out.push(
      `- Target for this section: ${target === '?' ? 'unknown' : only.trivial ? 'none (heading only)' : `about ${target} concept${target === '1' ? '' : 's'}`}.`,
    );
  }

  out.push('', '## Ids and sections', '');
  out.push(
    `- Concept id: \`${c.slug}.<section-slug>.<idea-slug>\`, for example \`${c.slug}.${exampleSlug}.<idea-slug>\`. Allowed characters: lowercase letters, digits, and \`-\` inside the second and later segments (regex \`^[a-z0-9]+(\\.[a-z0-9-]+)+$\`). Every id starts with \`${c.slug}.\`.`,
    '- `<section-slug>`: use the "Id segment" suggested in the table for the section the concept comes from (the same for every concept of that section). `<idea-slug>`: 2 to 4 words naming the idea, unique within the section.',
    '- **Ids are permanent**: never rename or reuse one.',
    '- `section` is the **section id** from the table, copied exactly (a UUID with dashes). Attach each concept to the most specific section it comes from. Every heading of the book is its own section, so look at which source section below actually holds the idea.',
    '',
    sectionTable(c, scope),
  );
  const trivial = scope.filter((s) => s.trivial);
  if (trivial.length) {
    out.push('', `Heading-only sections (${trivial.map((s) => `"${s.title}"`).join(', ')}) need no concepts: skip them.`);
  }

  const existing = existingBlock(c, scope);
  if (existing) out.push('', existing);

  out.push('', '## The rules that matter most (read them even if you skim the rest)', '');
  out.push(
    'These come from section 2.1 of the guide that follows and **override** anything else in it. After a first playthrough the reader asked for questions that are **easy to understand and hard to answer**: the difficulty must come from *knowing* something in the notes, never from decoding the prompt or doing arithmetic.',
    '',
    '1. **Short, plain prompts**: one or two sentences, ideally under **150 characters** (the checker warns above 180). No scenario to set up, no list of given values to parse. If you need a setup paragraph, the question is wrong.',
    '2. **The answer is a specific piece of knowledge from the notes** (a mechanism, a fact, a formula, a number the notes state). Someone with common sense who has not retained the notes must not be able to answer.',
    '3. **Numeric only when the number is the knowledge** (for example "How many times does standard attention move the $N\\times N$ matrix through HBM?" with answer 4). Never give all the inputs and ask for the product. No common-sense calculations (throughput = requests x speed, percentages of idle time). Arithmetic, if any, is a one-liner. When in doubt, use recall.',
    '4. **True/false** is one short declarative line stating a plausible misconception or its correction; about half false; no "always/never" giveaways; no double negatives.',
    '5. **MCQ**: exactly 4 choices, each a few words and **under 90 characters**, similar in length and style (the correct one is never the longest), distractors from real confusions (the neighbouring concept, the off-by-a-factor number, the inverted relation). Vary the correct index across questions. No "all/none of the above", no "both A and B", no "the first option".',
    '6. **Short prompt, rich explanation.** Every variant has an explanation (recall included) of **2 to 4 sentences, about 200-450 characters** (the checker warns under 120): (a) why the answer is right, with the mechanism; (b) why the tempting wrong answer or each distractor is wrong; (c) a link to a neighbouring idea from the notes. Never just name the answer.',
    '7. **Show the math, do not paraphrase it.** When the answer rests on a formula or derivation, the explanation shows a short chain of equalities (display math `$$...$$` is fine there, up to about 600 characters), then one sentence of interpretation. Prose that describes an equation in words is not enough.',
    '8. **The answer must not be implied by the name of the thing or by the prompt.** No hints, no "obviously", no key term from the answer in the question.',
    '9. **One idea per concept, 1 to 3 variants** (usually 2 or 3) from different angles (cause to effect then effect to cause; the number then the reason; the right mechanism then a trap). Each variant is self-contained: shown alone, answerable alone, and it must not leak another variant\'s answer. Never reference "the book", "the notes" or "the section above". Never ask about a figure (`[image: ...]` placeholders: the picture is not available). No definition-only questions, no trivia (names, dates, papers).',
    '10. **Faithfulness.** Never invent facts: stay within the source notes. If the notes look wrong, incomplete or ambiguous, ask about the uncontroversial part and add a sentence starting with `⚠️ Note:` to the explanation saying what looks off. Outside knowledge may appear only in explanations, marked `(General context, not from the notes: ...)`.',
    '11. **Own words, exact notation.** The question bank is public and the book must not be republished: write all prose in your own words (no copied or lightly reworded sentences, no pasted code or tables). Formulas, symbols and notation stay **identical** to the book (do not rename $S$ to $T$). Use the symbols given in the notation at the end of this file.',
    '12. **Coverage**: spread concepts over the distinct ideas of each section, no two concepts testing the same fact.',
  );

  out.push('', '## Kinds and the kind mix', '');
  out.push(
    'Target mix over all variants: about **35% recall, 15% numeric, 25% mcq, 25% truefalse**. Adapt to the content and never invent numbers to hit the quota (a chapter with little quantitative content shifts the numeric share to recall and mcq).',
    '',
    '| Kind | Fields | Notes |',
    '|---|---|---|',
    '| `recall` | `prompt`, `answer` (string), optional `explanation` (but write one) | Self-graded: the reader reveals your answer. 1-3 sentences, under about 400 characters, easy to grade. |',
    '| `numeric` | `prompt`, `answer` (finite number), optional `tolerance`, optional `unit`, `explanation` | `tolerance` is relative (default 0.05, `0` = exact, max 1). State dtype/units/assumptions in the prompt; show the arithmetic in the explanation. |',
    '| `mcq` | `prompt`, `choices` (exactly 4 distinct strings), `correct` (0-based index), `explanation` | Choices under 90 characters. |',
    '| `truefalse` | `prompt` (a statement), `answer` (boolean), `explanation` | About half false. |',
    '',
    'A concept is `{ "id": "...", "section": "<section id>", "variants": [ ... ] }` (1 to 3 variants). Unknown keys are rejected. Do not add `"retired"`.',
  );

  out.push('', '## JSON escaping (the most common mistake)', '');
  out.push(
    '- All text fields are Markdown with KaTeX: `$inline$` and rarely `$$display$$`. **In JSON every backslash is doubled**: write `"$\\\\frac{1}{2}$"`, `"$\\\\mathbb{R}^{n}$"`, `"$\\\\times$"`, `"$\\\\beta$"`. A single backslash before `f`, `t`, `b`, `r` or `n` silently corrupts the text.',
    '- A literal dollar sign is `\\\\$` in the JSON (a lone `$` is an error); a percent sign inside math is `\\\\%`.',
    '- Newlines inside a string are `\\n`: prefer single paragraphs. Straight double quotes only, no trailing commas, no comments, no raw HTML, images or tables.',
    '- Answer with the code block exactly once, as raw JSON (not a JSON string containing JSON).',
  );

  out.push('', '## Self-check before you answer', '');
  out.push(
    'Go through this list for the whole answer before sending it, and fix what fails:',
    '',
    '- [ ] Every prompt is short and plain (about 150 characters or less), so the time goes into recalling, not reading.',
    '- [ ] No question can be answered by recognising a phrase from the book, or by common sense alone.',
    '- [ ] No prompt contains its own answer or a hint at it; no answer is implied by a name.',
    '- [ ] Every numeric answer is a number the notes support, with units and assumptions in the prompt and the arithmetic in the explanation; the number itself is the knowledge.',
    '- [ ] Every explanation has 2-4 sentences: why right, why the distractors are wrong, a link to a neighbouring idea; derivations are shown as chains of equalities.',
    '- [ ] MCQ: exactly 4 distinct choices under 90 characters, similar lengths, correct one not the longest, correct index varied, no "all/none/both".',
    '- [ ] True/false: about half false, and the false ones are plausible.',
    '- [ ] Every claim is supported by the source notes, or marked `(General context, not from the notes: ...)` / `⚠️ Note:`.',
    '- [ ] All prose is in my own words; notation is identical to the book.',
    '- [ ] Ids are new, unique, permanent-looking, shaped `' + c.slug + '.<section-slug>.<idea-slug>`; every `section` is copied from the table above.',
    '- [ ] Kind mix is close to 35/15/25/25 where the content allows.',
    '- [ ] The reply is one valid JSON code block, every LaTeX backslash doubled, and nothing after it.',
  );

  out.push('', '## Long chapters: several messages are fine', '');
  out.push(
    `If the chapter is large, it's fine to answer in several messages: write concepts for some sections first, and the user will say "continue". **Each message is a valid ChapterFile JSON block** (\`{ "chapter": "${c.title}", "concepts": [ ... ] }\`) containing **only the new concepts** of that message, never ones already sent. The user saves each block and imports them one after the other (new ids are merged into the same file). Say, in the lines before the block, which sections you covered and which remain.`,
  );
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------
// Assembly

export function renderPack(i: PackInput): string {
  const c = i.chapter;
  const only = i.section;
  const sources = only ? [only] : c.sections;
  const out: string[] = [];

  out.push(`# Chat pack: quiz questions for "${c.title}"${only ? ` (section "${only.title}")` : ''}`);
  out.push('', '> Parts, in order: 1. instructions, 2. the reference style guide, 3. the data types, 4. a calibrated example, 5. the source notes.');
  out.push('', '---', '', '# PART 1: Instructions', '', instructions(i));

  out.push('', '---', '', '# PART 2: Reference contract (the full style guide)', '');
  out.push(
    'This is the reference contract for the question bank, written for a coding agent. Section 2.1 ("Calibrated style") **wins** over anything else in it, and so do the instructions in Part 1. Ignore everything about running commands, files, scripts, the workflow and committing (sections 1, 10 and parts of 8, 9 and 12): you have no tools, you only reply with the JSON block described in Part 1.',
    '',
    demoteHeadings(i.guide.trim(), 1),
  );

  out.push('', '---', '', '# PART 3: The data types', '');
  out.push('The shape of the JSON you produce (TypeScript, from the app that reads it). A file is a `ChapterFile`; your reply is a `ChapterFile` (several of them, one per message, for a long chapter).', '', '```ts', extractTypesBlock(i.typesSource), '```');

  const examples = pickExamples(i.exampleSource);
  if (examples.length) {
    out.push('', '---', '', '# PART 4: A calibrated example', '');
    out.push(
      `Below are ${examples.length} concepts from another chapter ("Inference"), already accepted by the reader and the checker: **an example of style and format, not content to copy.** Look at how short the prompts are, how the kinds are mixed, how every explanation teaches (why right, why the distractors fail, a neighbouring idea) and how formulas are derived as chains of equalities. Its ids and \`section\` values belong to that other chapter: yours come from Part 1.`,
      '',
      '```json',
      JSON.stringify({ chapter: 'Inference', concepts: examples }, null, 2),
      '```',
    );
  }

  out.push('', '---', '', `# PART ${examples.length ? 5 : 4}: Source notes${only ? ` (section "${only.title}")` : ` for "${c.title}"`}`, '');
  out.push(
    'These are the notes the questions must be based on (the reader has read them). Each section has its own header with its title and section id. Figures show as `[image: ...]` placeholders: never ask about a picture.',
  );
  for (const s of sources) {
    const body = i.sourceTexts.get(s.id) ?? '';
    out.push('', `## Source section: ${s.title} (section id: \`${s.id}\`)`, '');
    out.push(body.trim() ? body.trim() : '(heading only: no notes, no concepts needed)');
  }

  const notationInSources = i.notation !== undefined && sources.some((s) => s.id === i.notation!.id);
  if (i.notation && i.notationText && !notationInSources) {
    out.push('', '---', '', "## Notation reference (don't write questions on it)", '');
    out.push(
      `The book's symbols ($B$ batch, $S$ sequence length, $D$ model dimension, $L$ layers, $N$, $K$, $H$, $F$, $V$, ...) are defined in the section "${i.notation.title}" of the chapter "The modern transformer LM", reproduced here so your formulas and symbols are identical to the book's. A chapter may define extra symbols of its own: use those too, exactly as written.`,
      '',
      i.notationText.trim(),
    );
  } else if (notationInSources) {
    out.push(
      '',
      `> Notation: the section "${i.notation!.title}" above defines the book's symbols. Use them exactly as written in every other section's questions.`,
    );
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

export const PACKS_README = `# chat-packs

Generated by \`npm run bank:pack\`. This folder is gitignored: the packs contain the book's text, which must never be committed.

Write questions with a chat assistant (claude.ai, ChatGPT, Gemini...), no coding agent needed:

1. \`npm run bank:pack -- <chapter-slug>\` (or \`all\`; \`-- <slug> --section <id-or-slug>\` for one section) writes \`chat-packs/<slug>.md\`.
2. Drop that file into a fresh chat with the message "Write the questions." (for a long chapter the assistant may answer in several messages: say "continue").
3. Save the JSON reply (the code block) to a file, for example \`reply.json\` (\`.md\` and \`.txt\` work too; one file per message, or all messages in one file).
4. \`npm run bank:import -- reply.json\` merges it into \`content/questions/<slug>.json\` after validating it. It prints a ready-to-paste "Please fix:" message when the checker has warnings: paste it into the chat, save the corrected reply and import it with \`--replace\`.
5. Review in the app (\`npm run dev\`), then \`npm run book:covered -- <slug>\`, commit \`content/questions/<slug>.json\` and \`content/sections.json\`, and \`git push\`.

Chapter slugs: \`basics\`, \`math\`, \`transformer\`, \`inference\`, \`scaling\`, \`gpus\`, \`architectures\`, \`posttraining\`, \`precision\`, \`parallelism\`, \`multimodality\`.
`;
