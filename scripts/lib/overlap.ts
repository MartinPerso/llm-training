// Detects question text that reuses runs of words from the source notes (GUIDE section 5: own words).
// Math spans are ignored: formulas and notation are meant to be identical to the book.

export const MIN_RUN_WORDS = 7;

const MATH_RE = /\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g;

export function words(text: string): string[] {
  return text.replace(MATH_RE, ' ').toLowerCase().match(/[a-z0-9]+(?:['’][a-z]+)?/g) ?? [];
}

/** Every window of `n` consecutive words of the sources, as a set of space-joined strings. */
export function shingles(sourceTexts: string[], n = MIN_RUN_WORDS): Set<string> {
  const set = new Set<string>();
  for (const t of sourceTexts) {
    const w = words(t);
    for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(' '));
  }
  return set;
}

/** Maximal runs (at least `n` words) of `text` that also appear verbatim, word for word, in the sources. */
export function copiedRuns(text: string, source: Set<string>, n = MIN_RUN_WORDS): string[] {
  const w = words(text);
  const runs: string[] = [];
  let start = -1;
  let end = -1; // exclusive
  for (let i = 0; i + n <= w.length; i++) {
    if (!source.has(w.slice(i, i + n).join(' '))) continue;
    if (start >= 0 && i <= end) {
      end = i + n; // overlapping or adjacent window: extend the run
    } else {
      if (start >= 0) runs.push(w.slice(start, end).join(' '));
      start = i;
      end = i + n;
    }
  }
  if (start >= 0) runs.push(w.slice(start, end).join(' '));
  return runs;
}

export interface Overlap {
  concept: string;
  variant: number;
  field: string;
  phrase: string;
}

const FIELDS = ['prompt', 'answer', 'explanation'];

/** Copied runs in the prompt/answer/explanation/choices of every non-retired concept of a chapter file. */
export function findOverlaps(chapterData: unknown, sourceTexts: string[], n = MIN_RUN_WORDS): Overlap[] {
  const source = shingles(sourceTexts, n);
  const concepts = (chapterData as { concepts?: unknown } | undefined)?.concepts;
  const out: Overlap[] = [];
  if (!Array.isArray(concepts)) return out;
  for (const c of concepts as { id?: unknown; retired?: unknown; variants?: unknown }[]) {
    if (!c || c.retired || typeof c.id !== 'string' || !Array.isArray(c.variants)) continue;
    c.variants.forEach((v: Record<string, unknown>, vi: number) => {
      const fields: [string, unknown][] = FIELDS.map((f) => [f, v?.[f]]);
      if (Array.isArray(v?.choices)) v.choices.forEach((x, i) => fields.push([`choices[${i}]`, x]));
      for (const [field, value] of fields) {
        if (typeof value !== 'string') continue;
        for (const phrase of copiedRuns(value, source, n)) out.push({ concept: c.id as string, variant: vi, field, phrase });
      }
    });
  }
  return out;
}
