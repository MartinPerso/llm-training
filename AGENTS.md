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
| `npm run book:covered -- <slug>` | Sets `coveredHash = hash` for the chapter's sections in `content/sections.json` (`-- <slug> --section <id>` for one section; `all` for everything) |

Arguments to npm scripts go after `--`. Limit parallel CPU use (for example `--maxWorkers=4`).

## Repo layout

```
PLAN.md                       decisions, data model, sync design
AGENTS.md, CLAUDE.md          this file (CLAUDE.md just imports it)
.claude/skills/               write-questions, review-questions (Claude Code shortcuts to the workflows below)
content/
  GUIDE.md                    question-writing contract (quality bar, kinds, ids, format, self-check)
  sections.json               id, chapter, title, order, hash, coveredHash per section (no book text)
  questions/<slug>.json       the bank: one file per chapter (files starting with `_` are ignored)
scripts/                      content pipeline (Node 24, run with `node scripts/x.ts`, erasable TS only)
  fetch-book.ts, book-diff.ts, check-bank.ts, bank-status.ts, bank-task.ts, mark-covered.ts
  lib/                        testable logic (+ *.test.ts): slugs, bank-files, sections-file, schema, check, diff, chapters, brief, overlap, covered
src/                          the app
  bank/                       bank types (shared contract with scripts) and loading
  srs/                        FSRS wrapper, event replay, session queue
  storage/                    IndexedDB event store, GitHub sync
  grading/                    numeric parsing and tolerance
  ui/                         screens and the KaTeX renderer
.cache/                       gitignored: raw Notion blocks and .cache/book/*.md (the book's text)
.github/workflows/pages.yml   bank:check, test, build, deploy
```

Chapter slugs: `basics`, `math`, `transformer`, `inference`, `scaling`, `gpus`, `architectures`, `posttraining`, `precision`, `parallelism`, `multimodality` (full titles in `content/GUIDE.md` section 11 or `npm run bank:status`).

## Writing questions

When asked to write or add questions for a chapter or section (for example "write questions for the Parallelism chapter"):

1. `npm run bank:status` to see where things stand. Pick the chapter the user named, or a `todo` one if they did not. A title can be resolved to its slug from this table.
2. `npm run bank:task -- <slug>` (add `-- --section <id-or-slug>` if the user asked for one section only). If `.cache/book/` is missing it tells you to run `npm run book:fetch` first.
3. Follow that brief **exactly**, together with `content/GUIDE.md` (read it in full): it names the file to write, the source files to read, the concept targets, the rules, the gate and the report format.
4. Pass the gate: `npm run bank:check -- --stats` with zero errors and zero warnings in your file.
5. Mark the chapter covered: `npm run book:covered -- <slug>`.
6. Commit only `content/questions/<slug>.json` and `content/sections.json`, with the message `Add questions: <Chapter title>`.
7. Reply with the report format from the brief (counts, kind mix, `⚠️` notes, skipped sections).

## Reviewing questions

When asked to review or audit a chapter's questions: `npm run bank:task -- <slug> --review` prints the reviewer brief. A reviewer is a different agent from the writer. It reads the chapter file and its source sections, audits every concept against `content/GUIDE.md` sections 2 to 6 and 12 (non-obviousness, faithfulness to the notes, answer leaks, distractor quality, copied phrasing), fixes problems in place (same ids; retire rather than delete), passes `bank:check`, commits only the chapter file as `Review questions: <Chapter title>`, and reports what it changed.

## Parallel work

Several agents can write different chapters at the same time.

- One agent per chapter. Question files are per chapter, so agents never touch the same file.
- When asked to write questions, an agent never edits another chapter's file, nor anything in `src/` or `scripts/`.
- `content/sections.json` is the only shared file (each agent changes only its chapter's `coveredHash` lines). Give each agent its own git worktree or clone and branch (run `npm ci` and `npm run book:fetch` in each, since `.cache/` is not shared). If merging hits a conflict in `sections.json`, keep the other side's version and re-run `npm run book:covered -- <slug>`; it is idempotent. In a shared working tree, stage files by name, never `git add .`.
- Errors that `bank:check` reports in another chapter's file are not yours: leave them and mention them in your report.

## Hard rules

- **Never commit `.cache/`** (the book's text lives there; it is gitignored). The repo and the site are public.
- **Never copy the book's prose** into any file. Question prose is in your own words; facts, formulas and notation stay exact (GUIDE section 5).
- **Concept ids are permanent**: never rename or reuse one, never delete one (set `"retired": true`), never reorder or remove a concept's variants (progress is logged by id and variant index).
- Never invent facts that the notes do not contain; mark doubts with `⚠️ Note:` and outside knowledge with `(General context, not from the notes: ...)`.
- Do not push, open pull requests, or change `PLAN.md`, `content/GUIDE.md` or the pipeline scripts unless the user asks.
