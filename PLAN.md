# LLM Book Quiz: plan

A personal web app to memorize [Alisa's book of LLMs](https://alisawuffles.notion.site/alisa-s-book-of-llms) with non-obvious quiz questions and spaced repetition.

## Decisions

| Topic | Decision |
|---|---|
| Content | The whole book (already read), practiced over a **10-day window**. |
| Question bank | Written by Claude in Claude Code sessions, stored as JSON in the repo. No LLM at runtime, no API key. |
| Answer formats | Mixed: **numeric** (auto-checked), **recall** (self-graded), **multiple choice** and **true/false traps** (auto-checked). |
| Scheduling | FSRS via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs), 90% target recall. **No daily limit**, only a pace hint. |
| Storage | Local-first in IndexedDB, synced to **one shared progress file** in the **private repo `MartinPerso/llm-training-progress`** through the GitHub REST API. No server. Phone and computer share the same progress. |
| Token | Fine-grained, limited to the progress repo (Contents: read and write), **expires after 30 days**. |
| Stack | Vite + React + TypeScript, KaTeX, `vite-plugin-pwa` (installable, offline), Vitest. Node 24 via nvm (`.nvmrc`). |
| Hosting | Public repo `MartinPerso/llm-training`, deployed by GitHub Actions to https://martinperso.github.io/llm-training/ |

## The source

11 chapters and 44 sections, about 107k rendered characters of dense bullet notes and about 860 LaTeX snippets. Notion serves the page as JSON with no login (`/api/v3/loadPageChunk`, 100 blocks per call, paginated with a cursor). Each heading has a block ID that also works as a deep link (`…/alisa-s-book-of-llms#<id without dashes>`).

| Chapter | Size | Est. concepts | Status |
|---|---|---|---|
| Neural net basics | 21k | ~50 | todo |
| Mathy things | 14k | ~35 | todo |
| The modern transformer LM | 19k | ~45 | todo |
| Inference | 10k | ~25 | **calibration chapter** |
| Scaling laws | 1k | ~4 | todo |
| GPUs | stub | 0 | todo (re-check later) |
| Other architectures | 4k | ~10 | todo |
| Post-training | 20k | ~50 | todo |
| Precision | 4k | ~10 | todo |
| Parallelism | 13k | ~30 | todo |
| Multimodality | 1k | ~4 | todo |

Total: roughly 250–300 concepts with 2–3 variants each.

## Architecture

```
Notion page ──scripts/fetch-book──► .cache/book/<section>.md      (gitignored: Alisa's text is never committed)
                                          │
                              Claude writes questions (content/GUIDE.md)
                                          ▼
                        content/questions/<chapter>.json          (committed, my own wording)
                                          │  npm run bank:check
                                          ▼
GitHub Actions ──build──► GitHub Pages: static app + question bank (PWA, works offline)
                                          │
                    IndexedDB: event log + derived card states     (local copy on each device)
                                          │  pull on open, merge-then-push after answers
                                          ▼
                    Private repo llm-training-progress: progress.json, shared by all devices
```

## Repo layout

```
llm-training/
├─ PLAN.md, .nvmrc, package.json, vite.config.ts, tsconfig.json, index.html
├─ src/
│  ├─ bank/        loading and types for the question bank
│  ├─ srs/         FSRS wrapper, event replay → card states, session queue
│  ├─ storage/     IndexedDB event store, GitHub sync
│  ├─ grading/     numeric parsing and tolerance
│  └─ ui/          Today, Session, Stats, Settings; <Math> renderer (KaTeX)
├─ content/
│  ├─ GUIDE.md                  question-writing rules (calibration results go here)
│  ├─ sections.json             id, chapter, title, order, hash, coveredHash (no text)
│  └─ questions/<chapter>.json  the bank, one file per chapter
├─ scripts/
│  ├─ fetch-book.ts    Notion JSON → Markdown with $LaTeX$ → .cache/book + sections.json
│  ├─ book-diff.ts     sections where hash ≠ coveredHash (new or changed since questions were written)
│  └─ check-bank.ts    schema, unique ids, valid section ids, KaTeX compiles, MCQ sanity
└─ .github/workflows/pages.yml   check → test → build → deploy

llm-training-progress/   (private)
└─ progress.json         { schema, settings, events[] }: one file shared by all devices
```

## Data model

### Question bank

```ts
interface Concept {
  id: string;            // permanent, e.g. "inference.kv-cache.bytes-per-token". Never reused.
  section: string;       // Notion block id: used for the deep link and for change detection
  variants: Question[];  // 1–3 angles on the same idea; one is shown per review
  retired?: true;        // retire, never delete: old progress stays readable
}

type Question =
  | { kind: "numeric";   prompt: string; answer: number; tolerance?: number; unit?: string; explanation: string }
  | { kind: "recall";    prompt: string; answer: string; explanation?: string }
  | { kind: "mcq";       prompt: string; choices: string[]; correct: number; explanation: string }
  | { kind: "truefalse"; prompt: string; answer: boolean; explanation: string };
// All text is Markdown with $inline$ / $$display$$ LaTeX. Numeric tolerance is relative (default 5%, 0 = exact).
```

### Progress = an append-only event log

```ts
type ReviewEvent = { c: string; v: number; t: number; r: 1 | 2 | 3 | 4; ms: number; a?: string };
//                   concept   variant   epoch ms  Again…Easy  time to answer  what you typed
type FlagEvent   = { c: string; t: number; flag: string };   // "this question is ambiguous because…"
```

Card states are **never stored as the source of truth**. They come from replaying each concept's reviews through FSRS in time order. Merging two devices then means taking the union of their events (keyed by concept and timestamp; the newer settings win). Any FSRS randomness ("fuzz") must be seeded so the replay is deterministic.

## Sync

- **On open:** render from IndexedDB right away. Then GET `progress.json` (bypassing the browser's HTTP cache), merge, and replay.
- **After each answer:** save locally, then PUT the merged file along with the version (`sha`) it was based on. Pushes are debounced and happen at most once a minute while you're answering; they also flush when the tab is hidden (best effort).
- **No overwrites:** if the other device wrote in between, GitHub rejects the write. The app re-reads, merges, and retries. Every write is a commit, so the repo history doubles as a backup.
- **Status chip:** `synced 2 min ago`, `3 answers pending`, or `offline`. With no token, the app works fully locally.

## Practice window and scheduling

- **Window:** 10 days, starting at your first answer, so the bank can be finished before the clock starts. There is no daily limit.
- **Unit of scheduling:** the **concept**. Each review shows one variant, preferring one you didn't see last time, and multiple-choice options are shuffled. You learn the idea, not the card.
- **Session queue, in order:**
  1. Questions you just missed, re-asked about 1 and 10 minutes later.
  2. Due reviews: concepts whose predicted recall has dropped to the target, weakest first.
  3. New concepts, taken round-robin across chapters.
  4. Extra practice once 1–3 are empty: whatever you're most likely to forget right now. You can always keep going.
- **Target recall (90%):** a concept comes back when the predicted chance you still remember it drops to 90%. If you clear what's due each day, every concept you've already seen stays predicted at 90% or more, through day 10. Raising it to 95% means more repetitions.
- **Pace hint, never a cap:** to give every concept spaced reviews before the end, introduce all of them by about day 6 (about 45–50 new per day). The Today screen shows whether you're on track.
- **Expected load:** roughly 100–150 answers per day in the first week (about 45–60 min), less afterwards.
- **Grading:**
  - Auto-checked (numeric, multiple choice, true/false): wrong → *Again*. If right, you confirm with **Guessed** (*Hard*), **Knew it** (*Good*) or **Easy**, so lucky guesses don't inflate intervals.
  - Recall: reveal, then *Again / Hard / Good / Easy*.
- After each answer you see the explanation and a **Read in the book ↗** link to the exact section.
- Keyboard: `Space` reveals, `1`–`4` grade, `F` flags. Focus mode limits a session to one chapter.
- Numeric input accepts `18`, `1.5e9`, `1.5B`, `3k`, `2^30`.

## Question quality bar (seed for `content/GUIDE.md`)

1. Test understanding, not recognition: mechanisms ("why"), consequences ("what breaks if…"), comparisons ("X vs Y: which one, and why"), numbers that matter (accounting, orders of magnitude), and misconceptions (traps).
2. No definition-only questions, and the prompt must not give away the answer.
3. Stay faithful to the notes. Where I think the notes are incomplete or wrong, I say so in the explanation (⚠️) instead of teaching it.
4. Prose is in my own words. The site is public, so copying the notes would republish Alisa's work, and reused sentences can be answered by recognizing their wording. **Facts, formulas and notation stay identical to the book** ($B$, $S$, $D$, $L$, …) so they match what you read.
5. Every question has a 1–3 sentence explanation of the *why*.
6. Multiple choice: 4 options, with distractors drawn from real confusions and no "all of the above".
7. Numeric: the prompt states units and assumptions, and the tolerance accepts reasonable rounding.
8. 2–3 variants per concept from different angles (cause → effect, effect → cause, number vs. why).
9. One idea per concept: compound facts get split.

Examples of the bar:
- *Numeric:* With mixed-precision Adam, how many bytes per parameter for weights, gradients and optimizer state? → **18** (4 FP32 master + 2 BF16 copy + 8 moments + 4 FP32 gradients)
- *Recall:* Which per-layer activation term grows with the square of sequence length, and how does flash attention make it linear?
- *Trap:* "GRPO's group-mean subtraction is just a baseline." → False: it also divides by the group's standard deviation, which rescales each prompt's gradient.

## Content workflow

1. `npm run book:fetch` refreshes `.cache/book` and the section hashes.
2. Claude writes or updates `content/questions/<chapter>.json` following `GUIDE.md`.
3. `npm run bank:check` must pass. CI runs it too.
4. You play the chapter and flag bad questions in the app.
5. Set `coveredHash = hash` for the covered sections.

**When the book changes:** `npm run book:diff` lists new and changed sections, and only those get new questions. An unchanged idea keeps its ID. If an idea's meaning changes, it gets a new ID and the old one is retired.

**Improvement loop (also during the 10 days):** ask "review my flags". I read `progress.json` with `gh`, gather the flagged concepts and the ones you keep missing, then rewrite or split them.

## Setup: who does what

**Claude**
- `nvm install 24`: your current default Node stays untouched. Add an `.nvmrc` to the project.
- Scaffold the app and run `git init`. Create the **public** repo `MartinPerso/llm-training`, push, and enable Pages with GitHub Actions as the source.
- Create the **private** repo `MartinPerso/llm-training-progress` with an empty `progress.json`.

**You (once)**
- Create a fine-grained token at *Settings → Developer settings → Fine-grained tokens*:
  - *Repository access:* only `llm-training-progress`
  - *Permissions:* Contents, read and write
  - *Expiration:* 30 days
- On each device, paste the token into the app's Settings. Claude never handles the token.

## Phases (each one ends live on Pages)

1. **Skeleton.** Vite/React/TS app, CI and Pages deploy, Node 24, both repos. *Done when the site is live.*
2. **Content pipeline.** `fetch-book`, `sections.json`, bank schema and `check-bank`, `GUIDE.md`. *Done when all 44 sections are listed with hashes and the check passes.*
3. **Quiz MVP with sync.** The 4 question types, KaTeX, FSRS, the session queue, IndexedDB log, Today screen with the pace hint, feedback with book links, sync between phone and computer, and unit tests (grading, replay, merge, queue). *Done when a session started on the phone continues on the computer.*
4. **Calibration: Inference** (about 25 concepts, all 4 types). You play one session and tell me what's too easy, too hard or ambiguous. I update `GUIDE.md` and rewrite. *Same day.*
5. **Rest of the book.** One commit per chapter, each passing `bank:check`. Once the bar is set, chapters can be written in parallel. *Target: the full bank within a day or two after calibration.*
6. **Polish during your 10 days, as needed.** Stats (per-chapter recall, weakest concepts), flags, JSON export/import.

**Later, optional:** Claude-graded free-text answers (needs your API key).

## Security notes

- The token lives in `localStorage` on `martinperso.github.io`. That origin is shared with your other Pages sites (`abagames`, `assets`, `bomberman` today), so any script running on them could read it. They only load their own scripts today, so the risk is a future compromised dependency or third-party script.
- Mitigations:
  - The token can only touch the progress repo.
  - It expires after 30 days.
  - A Content-Security-Policy (`<meta>` tag) lets this app send data only to `api.github.com`.
  - The app renders only content from your own repos, with raw HTML disabled.
- The app repo is public, so the questions are public. They're paraphrased and credit and link to Alisa's page. The site carries `noindex`.

## Risks

- Notion's JSON API is unofficial. If it changes, the fallback is extracting from the rendered page in a browser, which already works.
- Node 20 is end-of-life and too old for the current Vite, so the project pins Node 24.
