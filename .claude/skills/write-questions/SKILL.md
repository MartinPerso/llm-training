---
name: write-questions
description: Use when asked to write or add quiz questions for a chapter or section of Alisa's book of LLMs in this repo (for example "write questions for the Parallelism chapter", "add questions for Tensor parallelism"). The argument is a chapter slug or chapter title, optionally a section.
---

# Write questions for a chapter

Argument: a chapter slug (`basics`, `math`, `transformer`, `inference`, `scaling`, `gpus`, `architectures`, `posttraining`, `precision`, `parallelism`, `multimodality`) or a chapter title, optionally followed by a section.

1. Resolve the chapter. If you were given a title rather than a slug, run `npm run bank:status` and take the slug from its table. If no chapter was named, pick a `todo` one from that table.
2. Run `npm run bank:task -- <slug>` (Node 24 per `.nvmrc`; run `npm ci` first on a fresh clone). For a single section add `-- --section <section-id-or-slug>`: `npm run bank:task -- <slug> --section <section>`.
3. Follow the brief it prints **exactly**, together with `content/GUIDE.md` (read it in full). The brief covers setup (`npm run book:fetch` when `.cache/book/` is missing), the sources, the output file, the gate (`npm run bank:check -- --stats`), `npm run book:covered -- <slug>`, the commit (only `content/questions/<slug>.json` and `content/sections.json`) and the report format. Do not skip steps and do not improvise other ones.
4. Finish with the report format from the brief. See `AGENTS.md` for the hard rules (never commit `.cache/`, never copy the book's prose, ids are permanent).
