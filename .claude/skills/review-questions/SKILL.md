---
name: review-questions
description: Use when asked to review, audit, check or fix the quiz questions of a chapter of Alisa's book of LLMs in this repo (for example "review the Parallelism questions"). The argument is a chapter slug or chapter title. Run it in a different session from the one that wrote the questions.
---

# Review a chapter's questions

Argument: a chapter slug (`basics`, `math`, `transformer`, `inference`, `scaling`, `gpus`, `architectures`, `posttraining`, `precision`, `parallelism`, `multimodality`) or a chapter title.

1. Resolve the chapter. If you were given a title rather than a slug, run `npm run bank:status` and take the slug from its table. The chapter must not be `todo` (there must be a `content/questions/<slug>.json` to review).
2. Run `npm run bank:task -- <slug> --review` (Node 24 per `.nvmrc`; run `npm ci` first on a fresh clone).
3. Follow the reviewer brief it prints **exactly**, together with `content/GUIDE.md` (read it in full): audit every concept against GUIDE sections 2 to 6 and 12 (non-obviousness, faithfulness to the notes, answer leaks, distractor quality, copied phrasing), fix problems in place with the same ids (retire rather than delete), pass `npm run bank:check -- --stats` with no errors or warnings, commit only the chapter file, and send the report in the format the brief gives.
4. See `AGENTS.md` for the hard rules (never commit `.cache/`, never copy the book's prose, ids are permanent).
