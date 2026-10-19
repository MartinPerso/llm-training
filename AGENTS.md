# AGENTS.md

Entry point for any coding agent (Claude Code, Codex, Copilot CLI, ...) working in this repo.

## What this is

A personal spaced-repetition quiz app (Vite + React + TypeScript, installable PWA, FSRS scheduling) for memorizing [Alisa's book of LLMs](https://alisawuffles.notion.site/alisa-s-book-of-llms). The book is fetched from Notion into a gitignored cache; the **question bank** (`content/questions/<chapter>.json`) is written by coding agents following `content/GUIDE.md`, then shipped with the app to GitHub Pages. Design and decisions: `PLAN.md`.

## Setup and commands

Node 24 is pinned in `.nvmrc` (`nvm install && nvm use`). Then `npm ci`.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm test` | Vitest (app and scripts) |
| `npm run typecheck` | `tsc -b` (app and scripts) |
| `npm run build` | typecheck + production build into `dist/` |
| `npm run book:fetch` | Downloads the book from Notion into `.cache/book/` (gitignored) and refreshes `content/sections.json` (section ids, hashes; keeps `coveredHash`). Needed on every fresh clone, worktree or machine before writing or reviewing questions. |
| `npm run book:diff` | Sections that are new, changed since covered, or without concepts |
| `npm run bank:check` | Validates the question bank (schema, ids, KaTeX, soft checks). `-- --stats` adds counts. CI runs it. |
| `npm run bank:status` | One row per chapter: size, concept target, concepts written, kind mix, status (`todo`, `in progress`, `done`, `outdated`). `-- --json` for machine output. |
| `npm run bank:task -- <slug>` | Prints the self-contained brief for writing that chapter. `-- --section <id-or-slug>` scopes it to one section; `-- --review` prints the reviewer brief. |
| `npm run bank:pack -- <slug>` | Writes `chat-packs/<slug>.md` (gitignored): one self-contained file to drop into a chat assistant (claude.ai, ChatGPT, Gemini...) to write that chapter's questions without a coding agent. `-- <slug> --section <id-or-slug>` packs one section, `-- all` one pack per chapter. Needs `.cache/book/`. |
| `npm run bank:import -- <file>` | Validates what the chat replied (`.json`, `.md` or `.txt`, JSON code blocks) and merges it into `content/questions/<slug>.json` (new ids appended, existing ids skipped unless `--replace`; nothing is written on errors). `--dry-run` only reports. |
| `npm run book:covered -- <slug>` | Sets `coveredHash = hash` for the chapter's sections in `content/sections.json` (`-- <slug> --section <id>` for one section; `all` for everything) |

Arguments to npm scripts go after `--`. Limit parallel CPU use (for example `--maxWorkers=4`).

## Repo layout

```
PLAN.md                       decisions, data model, sync design
AGENTS.md, CLAUDE.md          this file (CLAUDE.md just imports it)
.claude/skills/               write-questions, review-questions (Claude Code shortcuts to the workflows below)
content/
  GUIDE.md                    question-writing contract (quality bar, kinds, ids, format, self-check)
  sections.json               id, chapter, title, order, hash, coveredHash per section (no book text); url for external sources
  questions/<slug>.json       the bank: one file per chapter (files starting with `_` are ignored)
scripts/                      content pipeline (Node 24, run with `node scripts/x.ts`, erasable TS only)
  fetch-book.ts, book-diff.ts, check-bank.ts, bank-status.ts, bank-task.ts, bank-pack.ts, bank-import.ts, mark-covered.ts
  lib/                        testable logic (+ *.test.ts): slugs, bank-files, sections-file, schema, check, diff, chapters, brief, pack, import, overlap, covered
src/                          the app
  bank/                       bank types (shared contract with scripts) and loading
  srs/                        FSRS wrapper, event replay, session queue
  storage/                    IndexedDB event store, GitHub sync
  grading/                    numeric parsing and tolerance
  ui/                         screens and the KaTeX renderer
.cache/                       gitignored: raw Notion blocks and .cache/book/*.md (the book's text)
chat-packs/                   gitignored: packs for chat assistants (contain the book's text), see "Writing questions with a chat assistant"
.github/workflows/pages.yml   bank:check, test, build, deploy
```

Chapter slugs: `basics`, `math`, `transformer`, `inference`, `scaling`, `gpus`, `architectures`, `posttraining`, `precision`, `parallelism`, `multimodality`, plus the six RL chapters of the external source below: `rlfoundations`, `rlrewards`, `rlpolicy`, `rlreasoning`, `rlagentic`, `rlsystems` (full titles in `content/GUIDE.md` section 11 or `npm run bank:status`).

## Writing questions

When asked to write or add questions for a chapter or section (for example "write questions for the Parallelism chapter"):

1. `npm run bank:status` to see where things stand. Pick the chapter the user named, or a `todo` one if they did not. A title can be resolved to its slug from this table.
2. `npm run bank:task -- <slug>` (add `-- --section <id-or-slug>` if the user asked for one section only). If `.cache/book/` is missing it tells you to run `npm run book:fetch` first.
3. Follow that brief **exactly**, together with `content/GUIDE.md` (read it in full): it names the file to write, the source files to read, the concept targets, the rules, the gate and the report format.
4. Pass the gate: `npm run bank:check -- --stats` with zero errors and zero warnings in your file.
5. Mark the chapter covered: `npm run book:covered -- <slug>`.
6. Commit only `content/questions/<slug>.json` and `content/sections.json`, with the message `Add questions: <Chapter title>`.
7. Reply with the report format from the brief (counts, kind mix, `⚠️` notes, skipped sections).

## Writing questions with a chat assistant (drag and drop)

For writing questions in a chat (claude.ai, ChatGPT, Gemini...) with no coding agent: the chat gets one file and replies with JSON, which `bank:import` validates and merges.

1. **Pack**: `npm run bank:pack -- <chapter-slug>` (needs `.cache/book/`; run `npm run book:fetch` first). It writes `chat-packs/<slug>.md` and prints its size and approximate token count. That file holds the instructions for the assistant, the full `content/GUIDE.md`, the data types, a calibrated example, and the chapter's source notes (plus the notation section), so it is self-contained. `-- <slug> --section <id-or-slug>` packs a single section (`chat-packs/<slug>--<section>.md`), `-- all` writes one pack per chapter. `chat-packs/` is gitignored because the packs contain the book's text: never commit it, never paste it anywhere public.
2. **Ask**: start a new chat, drag and drop the pack file and send "Write the questions." A big chapter may come in several messages: answer "continue" until all sections are covered.
3. **Save the reply**: copy the JSON code block (or the whole reply; with several messages, one file per message or all in one) into a file such as `reply.json`, `reply.md` or `reply.txt`.
4. **Import**: `npm run bank:import -- reply.json`. It extracts the JSON (the whole file, or every fenced ```json block, concatenating the concepts of several blocks), finds the chapter by its title and the ids, validates with the same checker as `bank:check`, and merges into `content/questions/<slug>.json`: new ids are appended, an id that already exists is skipped (replaced only with `--replace`), existing concepts missing from the import are kept. Errors (including invalid JSON, with the position) mean nothing is written. Unescaped LaTeX backslashes (the most common mistake) are repaired automatically and reported.
5. **Fix warnings**: warnings do not block the import but should be fixed. The command prints a ready-to-paste "Please fix:" message: paste it back into the same chat, save the corrected reply and import it with `--replace` (the concepts keep their ids).
6. **Review** in the app with `npm run dev`. For a deeper audit, `npm run bank:task -- <slug> --review` gives a reviewer brief for a coding agent.
7. **Mark covered** when satisfied: `npm run book:covered -- <slug>` (`-- <slug> --section <id>` if only part of the chapter was written).
8. **Commit and publish**: `git add content/questions/<slug>.json content/sections.json && git commit -m "Add questions: <Chapter title>"`, then `git push`.

## External sources (chapters from a web page)

A chapter can come from a web page instead of the Notion book. The current one is [a blog post on RL and agentic RL](https://jxzhangjhu.github.io/blog/2026/everything-about-rl-and-agentic-rl/), split into six chapters following its Parts and grouped in the app under the source "RL & agentic RL interview notes": `rlfoundations` (Foundations & problem setup), `rlrewards` (Rewards & preferences), `rlpolicy` (Policy optimization algorithms), `rlreasoning` (Reasoning, test-time scaling & evaluation), `rlagentic` (Agentic RL), `rlsystems` (RL infrastructure & systems). Their sections are ordinary entries of `content/sections.json` with a `url`:

```json
{ "id": "ppo-trust-regions", "chapter": "Policy optimization algorithms", "source": "RL & agentic RL interview notes", "title": "The PPO family and trust regions", "level": 2, "order": 61, "hash": "2026-06",
  "url": "https://jxzhangjhu.github.io/blog/2026/everything-about-rl-and-agentic-rl/#7--the-ppo-family-and-trust-regions" }
```

- `source` is the short title of the page: required on sections with a `url`, forbidden on book sections, identical for all sections of a chapter. The app groups chapters by it (Focus menu; the book's chapters sit under "Alisa's book of LLMs"). `id` is a short kebab-case key (the concepts' `section`, and by convention the middle segment of their ids). `url` is the page plus the heading's `#anchor` (the app's "Read the source" link). `hash` is a revision label of your choice (the post's date): `book:diff` reports the section as changed only when you bump it. `order` goes after the book; `book:fetch` keeps these entries and renumbers them after the book's sections. A chapter is either all book sections or all external ones (`bank:check` enforces it, and that each `url` is http(s)).
- Concept ids of a source split into several chapters all share one first segment (here `agenticrl.`), not the chapter slug: the first file of the source sets it and `bank:check` warns when another chapter of the same source differs (no "differs from the chapter slug" warning for external chapters). The id is permanent, so chapters can be re-split without renaming concepts. `bank:import` finds the chapter by its title, or else by the sections of the concepts.
- `bank:check`, `bank:import`, `bank:status` (sizes and targets show `-`), `book:diff` and `book:covered` work as for book chapters. `bank:task` and `bank:pack` refuse: the text is not cached, so write a self-contained prompt that links the page, with the section keys, and import the reply with `bank:import`.
- To add a source: append one entry per section (the page's headings, in order) with the chapter title, make sure `chapterSlug` (`scripts/lib/slugs.ts`) gives a slug without hyphens (it does for most titles), run `npm run bank:check`, and commit `content/sections.json`.

## Reviewing questions

When asked to review or audit a chapter's questions: `npm run bank:task -- <slug> --review` prints the reviewer brief. A reviewer is a different agent from the writer. It reads the chapter file and its source sections, audits every concept against `content/GUIDE.md` sections 2 to 6 and 12 (non-obviousness, clarity, faithfulness to the notes, answer leaks, distractor quality, copied phrasing), fixes problems in place (same ids; retire rather than delete), passes `bank:check`, commits only the chapter file as `Review questions: <Chapter title>`, and reports what it changed.

## Parallel work

Several agents can write different chapters at the same time.

- One agent per chapter. Question files are per chapter, so agents never touch the same file.
- When asked to write questions, an agent never edits another chapter's file, nor anything in `src/` or `scripts/`.
- `content/sections.json` is the only shared file (each agent changes only its chapter's `coveredHash` lines). Give each agent its own git worktree or clone and branch (run `npm ci` and `npm run book:fetch` in each, since `.cache/` is not shared). If merging hits a conflict in `sections.json`, keep the other side's version and re-run `npm run book:covered -- <slug>`; it is idempotent. In a shared working tree, stage files by name, never `git add .`.
- Errors that `bank:check` reports in another chapter's file are not yours: leave them and mention them in your report.

## Hard rules

- **Never commit `.cache/` or `chat-packs/`** (the book's text lives there; both are gitignored). The repo and the site are public.
- **Never copy the book's prose** into any file. Question prose is in your own words; facts, formulas and notation stay exact (GUIDE section 5).
- **Concept ids are permanent**: never rename or reuse one, never delete one (set `"retired": true`), never reorder or remove a concept's variants (progress is logged by id and variant index).
- Never invent facts that the notes do not contain; mark doubts with `⚠️ Note:` and outside knowledge with `(General context, not from the notes: ...)`.
- Do not push, open pull requests, or change `PLAN.md`, `content/GUIDE.md` or the pipeline scripts unless the user asks.
