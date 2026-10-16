import { type ChapterInfo, type Totals, formatMix } from './chapters.ts';

const HEADER = ['slug', 'title', 'sections', 'chars', 'target', 'concepts', 'variants', 'mix R/N/M/T', 'status'];
const NUMERIC = new Set([2, 3, 4, 5, 6]);

const num = (n: number | undefined) => (n === undefined ? '?' : String(n));

export function statusRows(chapters: ChapterInfo[], t: Totals): string[][] {
  const rows = chapters.map((c) => [
    c.slug,
    c.title,
    num(c.nonTrivialSections),
    c.sourceUrl ? '-' : num(c.chars),
    c.sourceUrl ? '-' : num(c.target),
    String(c.concepts),
    String(c.variants),
    formatMix(c.kinds),
    c.status,
  ]);
  rows.push([
    'TOTAL',
    `${t.chapters} chapters`,
    num(t.nonTrivialSections),
    num(t.chars),
    num(t.target),
    String(t.concepts),
    String(t.variants),
    formatMix(t.kinds),
    (['done', 'in progress', 'outdated', 'todo'] as const)
      .filter((s) => t.byStatus[s])
      .map((s) => `${t.byStatus[s]} ${s}`)
      .join(', '),
  ]);
  return rows;
}

/** Plain-text table; the last row (totals) is separated by a rule. */
export function formatStatusTable(chapters: ChapterInfo[], t: Totals): string {
  const rows = statusRows(chapters, t);
  const all = [HEADER, ...rows];
  const widths = HEADER.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const fmt = (r: string[]) =>
    r.map((cell, i) => (NUMERIC.has(i) ? cell.padStart(widths[i]) : cell.padEnd(widths[i]))).join('  ').trimEnd();
  const rule = widths.map((w) => '-'.repeat(w)).join('  ');
  return [fmt(HEADER), rule, ...rows.slice(0, -1).map(fmt), rule, fmt(rows[rows.length - 1])].join('\n');
}
