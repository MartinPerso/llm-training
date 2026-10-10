import { DEFAULT_TOLERANCE } from '../bank/types.ts';

const SUFFIX: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
  g: 1e9,
  t: 1e12,
};

// number [k|M|B|G|T] [%] [^ exponent]
const TERM = /^(\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?([kmbgt])?(%)?(?:\^([+-]?(?:\d+(?:\.\d*)?|\.\d+)))?$/i;

function parseTerm(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let sign = 1;
  while (s.startsWith('-') || s.startsWith('+')) {
    if (s[0] === '-') sign = -sign;
    s = s.slice(1).trim();
  }
  const m = TERM.exec(s);
  if (!m) return null;
  const [, mant, exp, suffix, percent, power] = m;
  let value = Number(mant + (exp ?? ''));
  if (suffix) value *= SUFFIX[suffix.toLowerCase()] as number;
  if (percent) value /= 100;
  if (power !== undefined) value = value ** Number(power);
  value *= sign;
  return Number.isFinite(value) ? value : null;
}

/** Remove thousands separators ("1,000") and treat a lone decimal comma ("1,5") as a point. */
function normalizeSeparators(s: string): string {
  return s
    .replace(/(?<=\d),(?=\d{3}(?!\d))/g, '')
    .replace(/(?<=\d),(?=\d)/g, '.')
    .replace(/(?<=\d)[_\u202f\u00a0](?=\d)/g, '');
}

/**
 * Parse what a person might type for a number: `18`, `1.5e9`, `1.5B`, `3k`, `2.5M`, `1T`,
 * `2^30`, `1,000`, `-0.5`, `50%` (= 0.5). Products and quotients of such terms work too
 * (`1.5*2^10`, `1/3`). Returns null when the input is not a number.
 */
export function parseNumeric(input: string): number | null {
  const s = normalizeSeparators(
    input
      .replace(/[\u2212\u2013]/g, '-')
      .replace(/\*\*/g, '^')
      .replace(/\s*\^\s*/g, '^')
      .replace(/(\d)\s+([kmbgt%])(?![a-z])/gi, '$1$2')
      .trim(),
  );
  if (!s) return null;
  const parts = s.split(/\s*([*×·/])\s*/);
  let acc = parseTerm(parts[0] as string);
  if (acc === null) return null;
  for (let i = 1; i < parts.length; i += 2) {
    const next = parseTerm(parts[i + 1] ?? '');
    if (next === null) return null;
    acc = parts[i] === '/' ? acc / next : acc * next;
  }
  return Number.isFinite(acc) ? acc : null;
}

const EXACT_EPSILON = 1e-9;

/** Relative tolerance; 0 means exact (within 1e-9); an expected answer of 0 uses an absolute epsilon. */
export function checkNumeric(input: string, answer: number, tolerance: number = DEFAULT_TOLERANCE): boolean {
  const x = parseNumeric(input);
  return x !== null && isCloseEnough(x, answer, tolerance);
}

export function isCloseEnough(x: number, answer: number, tolerance: number = DEFAULT_TOLERANCE): boolean {
  if (!Number.isFinite(x)) return false;
  const diff = Math.abs(x - answer);
  if (answer === 0) return diff <= EXACT_EPSILON;
  if (tolerance === 0) return diff <= EXACT_EPSILON * Math.max(1, Math.abs(answer));
  return diff <= tolerance * Math.abs(answer) + EXACT_EPSILON * Math.abs(answer);
}

/** Human-friendly rendering of the expected answer. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return n.toExponential(3).replace(/\.?0+e/, 'e');
  return n.toLocaleString('en-US', { maximumSignificantDigits: 12 });
}
