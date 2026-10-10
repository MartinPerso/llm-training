# Question-writing guide

You are writing quiz questions for a personal spaced-repetition app. This guide is the contract: follow it exactly. It is written for an LLM writer working in Claude Code, one chapter at a time.

## 1. Goal

One person has already **read** Alisa's book of LLMs. They want to **retain** it over a 10-day window, with questions that make them *use* the ideas, not recognise them. Every concept is reviewed several times, so a question that can be answered by pattern-matching on wording is worthless. Aim for questions that the reader would get wrong after a week unless they actually understood the mechanism, the number, or the trap.

Inputs you read: `.cache/book/*.md` (one file per section, gitignored) and `.cache/book/index.md` (order, file, chapter slug, section id, size). `.cache/book/book.md` is the whole book. Outputs you write: `content/questions/<chapter-slug>.json`, then `content/sections.json` (`coveredHash`). The data contract is `src/bank/types.ts`; `scripts/lib/schema.ts` is its strict validator.

## 2. Quality bar

### Do

1. **Test understanding, not recognition.** Ask for a mechanism ("why"), a consequence ("what breaks if..."), a comparison ("X vs Y: which one and why"), a number that matters (memory, FLOPs, shapes, orders of magnitude), or a misconception (a trap that sounds right).
2. **One idea per concept.** If you need "and" to describe the answer, split it into two concepts.
3. **The prompt never gives away the answer.** Do not put the key term, the formula's result, or a paraphrase of the answer in the question.
4. **State assumptions and units** in numeric prompts (dtype, which symbols are given, per token or per layer, ...).
5. **Explain the why** in every explanation, in 1-3 sentences. The explanation is what the reader learns from a miss.
6. **Prefer "what happens if" over "what is".** Perturb the setup: halve a dimension, drop a term, swap an order, change a dtype.
7. **Use the book's notation** (`$B$, $S$, $D$, $L$, $N$, $K$, $H$, $F$, $V$, ...) so the question matches what the reader saw.
8. **Make each variant self-contained.** The app shows one variant per review. Variant 2 must not need variant 1 to be understood, and must not leak variant 1's answer.

### Don't

- No definition-only questions ("What is X?" when the notes give a one-line definition). Turn them into a use or a contrast.
- No trivia (names, dates, paper titles, which company) unless the notes make it the point.
- No answer in the prompt, no "obviously"/"clearly", no hints like "(hint: think about memory)".
- No "all of the above" / "none of the above" / "both A and B" choices. No references to position ("the first option").
- No references to "the book", "the notes", "the section above". The app links to the section separately.
- No compound questions with two independent answers.
- No questions whose answer depends on information the notes do not contain.
- Do not paste code from the notes. Describe behaviour in your own words, or write a tiny snippet of your own.

### Bad to good rewrites

| Bad (recognition, gives away, or trivia) | Good (needs the idea) |
|---|---|
| "What does the KV cache store?" | "Decoding token 501 of a prompt, which tensors from the previous 500 steps are reused, and which per-token computation is still done fresh?" |
| "What is a vanishing gradient?" | "Why does stacking 50 sigmoid layers make early layers learn far slower than late ones, even if each layer's weights are well scaled? Give the bound that drives it." |
| "Softmax turns logits into a probability distribution. True or false?" (trivially true) | "True or false: adding the same constant $c$ to every logit changes the softmax output." (False, and it is why subtracting the max is safe.) |
| "What is the formula for LoRA rank?" (formula recall with no use) | "A frozen $d\times d$ weight gets a rank-$r$ update. For $d=4096$, $r=16$, how many trainable parameters does one such matrix add?" (numeric: $2dr$) |
| "Flash attention is faster because it is optimized. True or false?" | "Flash attention does not reduce the number of attention FLOPs. What does it reduce, and why does that make it faster in practice?" |
| "Which optimizer uses momentum? A) SGD B) Adam C) Adam with momentum D) All of the above" | "Adam keeps two running statistics per parameter. Which one rescales the step per parameter, and what does that do to parameters with consistently large gradients?" |
| "GQA stands for?" | MCQ: "A model has 32 query heads and 8 KV heads. By what factor is its KV cache smaller than full multi-head attention?" with 4 close numeric distractors (2, 4, 8, 32) |
| "Why is the learning rate important?" (vague) | "You double the learning rate and the loss curve starts spiking after warmup, then recovers. Give one mechanism-level reason spikes are more likely at a higher rate." |
| "Describe PPO." | "PPO clips the probability ratio $r_t$. For a positive advantage, at what value of $r_t$ does the gradient stop pushing the probability up, and why is that desirable?" |
| "How many bytes is FP16?" (trivial) | "A 7B-parameter model is served in BF16. How many GB do the weights take, ignoring everything else?" (numeric, $\approx 14$ GB) |

## 3. Choosing the kind

Each concept has 1 to 3 **variants**; each variant is one of four kinds:

| Kind | Use it for | Notes |
|---|---|---|
| `numeric` | Accounting, FLOPs, memory, shapes, orders of magnitude | Only when the notes support a **definite number**. State dtype/units/assumptions in the prompt. |
| `recall` | Mechanisms, "why", "what breaks if", comparisons | Self-graded: the reader reveals your model answer and judges themselves. Write an answer that is easy to grade: 1-3 sentences naming the key points. |
| `mcq` | Telling apart **confusable** things (two optimizers, two parallelism schemes, MQA vs GQA vs MLA) | Exactly 4 choices, one correct. |
| `truefalse` | Misconceptions and traps: statements that sound right but are subtly wrong | Aim for about half false. Avoid double negatives and absolute words ("always", "never") that give the answer away. |

Target mix across a chapter's variants (adapt to the section; never force a kind the section does not support): about **30% recall, 25% numeric, 25% mcq, 20% truefalse**. If a chapter has little quantitative content (for example Multimodality), shift the numeric share to recall and mcq. Do not invent numbers to hit the quota.

### Kind-specific rules

- **numeric:** `answer` is a plain finite number (`131072`, `1.5e9`, `0.25`). `tolerance` is **relative**: default is 0.05 (5%), `0` means exact (use for small integers such as byte counts per parameter), maximum 1. `unit` is optional text shown next to the input (`"bytes"`, `"GB"`, `"FLOPs"`). Pick the unit so the answer is a readable number; prefer one decimal power of ten the reader can type. Make sure the explanation shows the arithmetic.
- **recall:** keep `answer` under about 400 characters (a longer one triggers a warning). `explanation` is optional; use it for the why or a caveat.
- **mcq:** exactly 4 `choices`, all distinct, `correct` is the 0-based index. Distractors come from real confusions (the neighbouring concept, the off-by-a-factor number, the inverted relation). Keep the four choices similar in length and style; do not make the correct one the longest. Vary the correct index across questions (the app shuffles, but keep the file balanced anyway).
- **truefalse:** `answer` is a boolean. The prompt is a single declarative statement, not a question.

### Variants: 2-3 per concept, different angles

Cover the same underlying idea from different directions so the reader learns the idea, not the card:

- cause to effect, then effect to cause;
- the number, then the reason for the number;
- the right mechanism, then a trap that applies it wrongly.

Use 1 variant only for a genuinely narrow fact. Never more than 3. Each variant must be answerable on its own and must not give away another variant's answer.

## 4. Faithfulness

- Stick to what the notes say. **Never invent facts** that are not in the notes.
- When the notes look wrong, incomplete or ambiguous: write the question on the uncontroversial part and add a sentence starting with `⚠️ Note:` to the explanation saying what looks off and why.
- General, well-known background may appear **only in explanations**, and must be marked as outside context, for example `(General context, not from the notes: ...)`.
- Formulas, symbols and notation stay **identical** to the book. Do not rename `$S$` to `$T$` or restate a formula in another form unless the question is precisely about that equivalence.
- If a section's notes are too thin to support a non-obvious question, write fewer concepts rather than padding with trivia.

## 5. Copyright

The book's text must never be committed, and the question bank is public.

- Write all prose (prompts, answers, choices, explanations) **in your own words**. Do not copy or lightly reword sentences from the notes. A reader should not be able to answer by recognising the book's phrasing.
- Facts, formulas and notation are not prose: keep them exact (see section 4).
- Do not paste code or tables from the notes.
- The same rule applies to every committed file: nothing from `.cache/` may be copied into the repository.

## 6. Formatting

- All text fields are **Markdown** with KaTeX: `$inline$` and `$$display$$`. Use `$$...$$` sparingly (a prompt that needs it is probably too long).
- In JSON strings every backslash is doubled: `"$\\frac{1}{2}$"`, `"$\\mathbb{R}^{n}$"`. A literal dollar sign is written `\\$` in the JSON (so `"costs \\$5"`); an unescaped lone `$` is an error. Inside math, write `\\%` for a percent sign.
- Newlines inside a string are `\n`. Prefer single paragraphs.
- Keep **prompts under about 300 characters** and **explanations to 1-3 sentences**.
- Plain Markdown only: no raw HTML, no images, no tables. Bold and inline code are fine.
- `npm run bank:check` renders every `$...$` and `$$...$$` with KaTeX and fails on errors, so fix what it reports. It also warns when a recall answer exceeds 400 characters or a prompt contains its own answer verbatim: treat those warnings as defects.

## 7. Concept ids

Format: `<chapter-slug>.<section-slug>.<idea-slug>`, for example `inference.kv-cache.bytes-per-token`.

- Allowed characters: lowercase letters, digits, and `-` inside the second and later segments. Regex: `^[a-z0-9]+(\.[a-z0-9-]+)+$`.
- `chapter-slug` is the single-word slug from the table in section 11 (no hyphens). Every id in a file starts with the same chapter slug.
- `section-slug`: a short kebab-case slug of the section title (1-3 words), the same for every concept of that section, for example `kv-cache`, `grpo`, `train-memory`.
- `idea-slug`: 2-4 words naming the idea, unique within the section.
- **Ids are permanent.** Never rename or reuse one. To drop a concept, keep it and add `"retired": true`. If an idea's meaning changes, create a new id and retire the old one.
- `section` is the section's Notion block id (the `section:` value in the first-line comment of `.cache/book/<file>.md`, also `id` in `content/sections.json`). The section must belong to the file's chapter.

## 8. File format

One file per chapter: `content/questions/<chapter-slug>.json`, a `ChapterFile`: `{ "chapter": "<exact chapter title>", "concepts": [ ... ] }`. Files starting with `_` are ignored by the checker (use `_scratch.json` for drafts). Unknown keys are rejected.

Complete example with all four kinds (valid against the checker; the facts are original, written for this guide):

```json
{
  "chapter": "Inference",
  "concepts": [
    {
      "id": "inference.kv-cache.bytes-per-token",
      "section": "2f47eb87-3605-80c1-a4a4-d8dc201f202c",
      "variants": [
        {
          "kind": "numeric",
          "prompt": "A model has $L=32$ layers, $K=8$ KV heads and head dimension $H=128$, and caches keys and values in FP16. How much KV cache does ONE token add?",
          "answer": 128,
          "tolerance": 0,
          "unit": "KiB",
          "explanation": "Per token: $2\\cdot L\\cdot K\\cdot H$ values (the 2 is K and V) $=2\\cdot 32\\cdot 8\\cdot 128=65536$ values, times 2 bytes $=131072$ bytes $=128$ KiB."
        },
        {
          "kind": "truefalse",
          "prompt": "Doubling the batch size $B$ at a fixed sequence length leaves the total KV cache size unchanged.",
          "answer": false,
          "explanation": "Each sequence has its own keys and values, so the cache is proportional to $B\\cdot S$."
        }
      ]
    },
    {
      "id": "inference.reducing-kv-cache.mla-latent",
      "section": "2ed7eb87-3605-809d-b091-c7cde03bd832",
      "variants": [
        {
          "kind": "recall",
          "prompt": "Multi-head latent attention caches something other than the full keys and values. What is cached, and what does this cost at each decoding step?",
          "answer": "A smaller per-token latent vector (of size latent_dim) instead of all heads' K and V; at every step it must be projected back up to full-size keys and values, which adds compute.",
          "explanation": "It trades extra decode-time compute for a smaller cache."
        },
        {
          "kind": "mcq",
          "prompt": "A model has 32 query heads. Which attention variant shrinks its KV cache by exactly a factor of 32 relative to standard multi-head attention?",
          "choices": [
            "Multi-query attention: all query heads share one K and V",
            "Group-query attention with 8 groups",
            "Cross-layer attention sharing KV between adjacent layers",
            "Local attention with a fixed window"
          ],
          "correct": 0,
          "explanation": "One shared K/V instead of 32 per-head copies gives a 32x reduction. 8 groups gives 4x, sharing across 2 layers gives 2x, and a window bounds the length instead of the per-token size."
        },
        {
          "kind": "truefalse",
          "prompt": "Because multi-head latent attention only compresses what is cached, it combines with rotary position embeddings without any special handling.",
          "answer": false,
          "explanation": "The notes say MLA is not compatible with RoPE. ⚠️ Note: (General context, not from the notes: DeepSeek-V2 works around this by carrying a separate, decoupled RoPE component.)"
        }
      ]
    }
  ]
}
```

## 9. Coverage

- Aim for roughly **one concept per 300-400 characters of dense notes** (see the `chars` column in `.cache/book/index.md`). Dense math or algorithm sections can deserve more; sections that are mostly links or figures deserve fewer.
- Cover every non-trivial section. A section that is only a heading, a link list, or a figure gets no concepts (it still gets its `coveredHash`, see the workflow).
- Every heading (H1, H2 and H3) is its own section with its own id. An H1 section holds only the chapter's intro text; an H2 can be followed by H3 sections that have their own ids. Attach each concept to the **most specific** section it comes from.
- Figures appear as `[image: ...]` placeholders: the picture is not available, so never write a question that depends on one.
- Some notes contain code listings (training loops, attention, AdamW...). You may ask about what the code does (behaviour, shapes, ordering of steps), described in your own words.
- Spread the concepts of a section over its distinct ideas; avoid several concepts that test the same fact.

## 10. Workflow, chapter by chapter

1. `npm run book:diff` to see what needs questions (sections are listed per chapter).
2. Read every `.cache/book/<NN>-<slug>.md` file of the chapter (`index.md` maps chapters to files).
3. Draft concepts section by section, following sections 2-9. Write `content/questions/<chapter-slug>.json`.
4. Run `npm run bank:check` until it exits 0 with no warnings you can fix. Add `-- --stats` to see counts per chapter and kind: `npm run bank:check -- --stats`.
5. Re-read your questions once against the checklist in section 12.
6. Mark the chapter's sections as covered: `node scripts/mark-covered.ts <chapter-slug>` sets `coveredHash = hash` for every section of that chapter in `content/sections.json` (run it only when the chapter is finished; heading-only sections are covered too). Prefix node commands with the project's Node 24 setup (`nvm use 24`).
7. When the book changes: `npm run book:fetch` refreshes hashes while keeping `coveredHash`; `npm run book:diff` then lists sections whose text changed. Write questions only for new or changed material, keep existing ids for unchanged ideas, retire (do not delete) concepts whose idea is gone.

## 11. Chapters and slugs

Section counts and sizes are of the current fetch; the `chapter` string in the file must match the title exactly. The authoritative list of sections is `content/sections.json`.

| Chapter title (exact) | File / id prefix | Sections | Approx. size |
|---|---|---|---|
| Neural net basics | `basics` | 7 | 22k chars |
| Mathy things | `math` | 6 | 13k |
| The modern transformer LM | `transformer` | 14 | 19k |
| Inference | `inference` | 7 | 10k |
| Scaling laws | `scaling` | 1 | 1k |
| GPUs | `gpus` | 1 | under 1k |
| Other architectures | `architectures` | 6 | 4k |
| Post-training | `posttraining` | 6 | 17k |
| Precision | `precision` | 1 | 4k |
| Parallelism | `parallelism` | 5 | 13k |
| Multimodality | `multimodality` | 1 | 2k |

For example, the file for "The modern transformer LM" is `content/questions/transformer.json` and its ids look like `transformer.train-memory.optimizer-bytes`.

## 12. Self-check before you finish a chapter

- [ ] Could the reader answer any question just by recognising a phrase from the book? Rewrite it.
- [ ] Does any prompt contain its own answer, or a hint at it?
- [ ] Is every numeric answer derivable from the notes, with units and assumptions in the prompt and the arithmetic in the explanation?
- [ ] Do all MCQ distractors represent a real confusion, with a balanced correct index and similar lengths?
- [ ] Are true/false statements about half false, and are the false ones plausible?
- [ ] Is every claim in a prompt, answer or explanation supported by the notes (or clearly marked as general context / `⚠️ Note:`)?
- [ ] Is the prose my own, with notation identical to the book?
- [ ] Is the kind mix close to 30/25/25/20 where the section allows?
- [ ] Are ids unique, permanent and in the `<chapter>.<section>.<idea>` form, and does each `section` belong to the file's chapter?
- [ ] Does `npm run bank:check` pass, and did I then run `node scripts/mark-covered.ts <chapter-slug>`?
