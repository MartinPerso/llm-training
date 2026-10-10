// Pull $...$ and $$...$$ out of Markdown before it is rendered, so Markdown never touches the TeX.

export interface MathSegment {
  tex: string;
  display: boolean;
}

export interface Extracted {
  text: string;
  math: MathSegment[];
}

export const MATH_OPEN = '';
export const MATH_CLOSE = '';
export const DOLLAR = '';
// Private-use characters never occur in bank content; strip them so placeholders cannot be forged.
const RESERVED = /[-]/g;

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isDigit = (ch: string | undefined) => ch !== undefined && ch >= '0' && ch <= '9';

/**
 * Replace math with placeholders. Rules:
 * - `\$` is a literal dollar sign.
 * - `$$...$$` is display math (may span lines).
 * - `$...$` is inline math: no space right after the opening or right before the closing `$`,
 *   and the closing `$` must not be followed by a digit ("costs $5 and $10" stays text).
 * - Code spans and fenced code are left alone.
 */
export function extractMath(src: string): Extracted {
  const input = src.replace(RESERVED, '');
  const math: MathSegment[] = [];
  let out = '';
  const push = (tex: string, display: boolean) => {
    math.push({ tex, display });
    out += `${MATH_OPEN}${math.length - 1}${MATH_CLOSE}`;
  };

  let i = 0;
  while (i < input.length) {
    const ch = input[i] as string;

    if (ch === '\\') {
      const next = input[i + 1];
      if (next === '$') {
        out += DOLLAR;
        i += 2;
      } else if (next !== undefined) {
        out += ch + next; // keep escape pairs together, e.g. `\\` before a `$`
        i += 2;
      } else {
        out += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '`') {
      let run = 1;
      while (input[i + run] === '`') run++;
      const fence = '`'.repeat(run);
      const close = input.indexOf(fence, i + run);
      if (close !== -1) {
        out += input.slice(i, close + run);
        i = close + run;
      } else {
        out += fence;
        i += run;
      }
      continue;
    }

    if (ch === '$') {
      if (input[i + 1] === '$') {
        const close = input.indexOf('$$', i + 2);
        const tex = close === -1 ? '' : input.slice(i + 2, close).trim();
        if (close !== -1 && tex) {
          push(tex, true);
          i = close + 2;
          continue;
        }
        out += '$$';
        i += 2;
        continue;
      }
      if (!isSpace(input[i + 1])) {
        let j = i + 1;
        let found = -1;
        while (j < input.length) {
          const c = input[j] as string;
          if (c === '\\') {
            j += 2;
            continue;
          }
          if (c === '$') {
            found = j;
            break;
          }
          if (c === '\n' && input[j + 1] === '\n') break; // never span paragraphs
          j++;
        }
        if (found !== -1 && found > i + 1 && !isSpace(input[found - 1]) && !isDigit(input[found + 1])) {
          push(input.slice(i + 1, found), false);
          i = found + 1;
          continue;
        }
      }
      out += '$';
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }
  return { text: out, math };
}

/** Put rendered math (and literal dollars) back into rendered HTML. */
export function restoreMath(html: string, math: MathSegment[], render: (m: MathSegment) => string): string {
  return html
    .replace(new RegExp(`${MATH_OPEN}(\\d+)${MATH_CLOSE}`, 'g'), (_, n: string) => {
      const seg = math[Number(n)];
      return seg ? render(seg) : '';
    })
    .replaceAll(DOLLAR, '$');
}
