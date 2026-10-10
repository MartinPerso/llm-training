// Extraction of $inline$ and $$display$$ math from Markdown text. `\$` is a literal dollar sign.

export interface MathSpan {
  tex: string;
  display: boolean;
}

export interface MathExtraction {
  spans: MathSpan[];
  errors: string[];
}

export function extractMath(text: string): MathExtraction {
  const spans: MathSpan[] = [];
  const errors: string[] = [];
  let i = 0;
  const n = text.length;

  /** Index of the next unescaped `delim` at or after `from`, or -1. */
  const findClose = (delim: string, from: number): number => {
    for (let j = from; j < n; j++) {
      if (text[j] === '\\') {
        j++; // skip the escaped character (so `\$` and `\\` never close math)
        continue;
      }
      if (text.startsWith(delim, j)) return j;
    }
    return -1;
  };

  while (i < n) {
    const ch = text[i];
    if (ch === '\\') {
      i += 2; // escaped character, including `\$`
      continue;
    }
    if (ch === '`') {
      // Skip inline code spans: `$` inside code is literal.
      const close = text.indexOf('`', i + 1);
      if (close !== -1) {
        i = close + 1;
        continue;
      }
    }
    if (ch === '$') {
      const display = text[i + 1] === '$';
      const delim = display ? '$$' : '$';
      const start = i + delim.length;
      const close = findClose(delim, start);
      if (close === -1) {
        errors.push(`unbalanced "${delim}" at position ${i} (use \\$ for a literal dollar sign)`);
        i = start;
        continue;
      }
      const tex = text.slice(start, close).trim();
      if (!tex) errors.push(`empty math at position ${i}`);
      else spans.push({ tex, display });
      i = close + delim.length;
      continue;
    }
    i++;
  }
  return { spans, errors };
}
