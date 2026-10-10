// Notion block tree -> Markdown, split into sections (every heading starts one).

import { createHash } from 'node:crypto';
import type { Section } from '../../src/bank/types.ts';
import type { BlockMap, NotionBlock } from './notion.ts';
import { richTextToMarkdown, richTextToPlain, type RichText } from './richtext.ts';
import { chapterSlug, slugify } from './slugs.ts';

export interface ConvertStats {
  blockCounts: Record<string, number>;
  inlineEquations: number;
  displayEquations: number;
  unknownTypes: Record<string, number>;
  warnings: string[];
}

export interface BookSection extends Section {
  slug: string;
  markdown: string;
}

const HEADING_LEVEL: Record<string, 1 | 2 | 3> = { header: 1, sub_header: 2, sub_sub_header: 3 };
const SKIPPED = new Set(['table_of_contents', 'page']);
const TRANSPARENT = new Set(['column_list', 'column']);

type Unit = { kind: 'heading'; id: string; level: 1 | 2 | 3; title: string } | { kind: 'block'; md: string; list: boolean };

const title = (b: NotionBlock): RichText | undefined => (b.properties as { title?: RichText } | undefined)?.title;

class Converter {
  units: Unit[] = [];
  stats: ConvertStats = { blockCounts: {}, inlineEquations: 0, displayEquations: 0, unknownTypes: {}, warnings: [] };
  private blocks: BlockMap;
  private topCounter = { n: 0 };
  constructor(blocks: BlockMap) {
    this.blocks = blocks;
  }

  private rt(rt: RichText | undefined, inTable = false): string {
    return richTextToMarkdown(rt, {
      inTable,
      onInlineEquation: () => this.stats.inlineEquations++,
    }).trim();
  }

  run(rootId: string): void {
    const root = this.blocks[rootId];
    if (!root) throw new Error(`Root block ${rootId} not found`);
    for (const id of root.content ?? []) this.top(id);
  }

  /** Top-level traversal: emits headings and blocks as units. */
  private top(id: string): void {
    const b = this.blocks[id];
    if (!b) {
      this.stats.warnings.push(`missing block ${id}`);
      return;
    }
    this.count(b);
    const level = HEADING_LEVEL[b.type];
    if (level) {
      this.units.push({ kind: 'heading', id: b.id, level, title: richTextToPlain(title(b)).trim() });
      // Toggle headings could have children: keep them in the section.
      for (const c of b.content ?? []) this.top(c);
      return;
    }
    if (TRANSPARENT.has(b.type)) {
      for (const c of b.content ?? []) this.top(c);
      return;
    }
    // A column/callout etc. nested below could hide headings; handled by renderBlock (no headings expected).
    const r = this.renderBlock(b, 0, this.topCounter);
    if (r) this.units.push({ kind: 'block', md: r.md, list: r.list });
  }

  private count(b: NotionBlock): void {
    this.stats.blockCounts[b.type] = (this.stats.blockCounts[b.type] ?? 0) + 1;
  }

  /** Renders children at the given indent, joined by newlines (used inside list items, quotes...). */
  private children(b: NotionBlock, indent: number): string[] {
    const out: string[] = [];
    const counter = { n: 0 };
    for (const id of b.content ?? []) {
      const c = this.blocks[id];
      if (!c) {
        this.stats.warnings.push(`missing child ${id} of ${b.id}`);
        continue;
      }
      this.countNested(c);
      if (TRANSPARENT.has(c.type)) {
        out.push(...this.children(c, indent));
        continue;
      }
      const r = this.renderBlock(c, indent, counter);
      if (r) out.push(r.md);
    }
    return out;
  }

  private countNested(c: NotionBlock): void {
    this.count(c);
  }

  private renderBlock(b: NotionBlock, indent: number, counter: { n: number }): { md: string; list: boolean } | null {
    const pad = ' '.repeat(indent);
    const own = this.rt(title(b));
    const kids = (w: number) => this.children(b, indent + w);
    if (b.type !== 'numbered_list') counter.n = 0;
    switch (b.type) {
      case 'text': {
        const lines = [own, ...kids(0)].filter((s) => s !== '');
        if (!lines.length) return null;
        return { md: indentLines(lines.join('\n'), pad), list: false };
      }
      case 'bulleted_list':
      case 'toggle':
        return { md: [`${pad}- ${own}`, ...kids(2)].join('\n'), list: true };
      case 'numbered_list': {
        counter.n++;
        const marker = `${counter.n}. `;
        return { md: [`${pad}${marker}${own}`, ...kids(marker.length)].join('\n'), list: true };
      }
      case 'to_do': {
        const checked = (b.properties as { checked?: [[string]] } | undefined)?.checked?.[0]?.[0] === 'Yes';
        return { md: [`${pad}- [${checked ? 'x' : ' '}] ${own}`, ...kids(2)].join('\n'), list: true };
      }
      case 'equation': {
        const tex = (title(b)?.[0]?.[0] ?? '').trim();
        if (!tex) return null;
        this.stats.displayEquations++;
        return { md: indentLines(`$$\n${tex}\n$$`, pad), list: false };
      }
      case 'callout':
      case 'quote': {
        const lines = [own, ...kids(0)].filter((s) => s !== '');
        if (!lines.length) return null;
        const body = lines.join('\n\n').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
        return { md: indentLines(body, pad), list: false };
      }
      case 'code': {
        const lang = ((b.properties as { language?: [[string]] } | undefined)?.language?.[0]?.[0] ?? '').toLowerCase();
        const code = title(b)?.map((s) => s[0]).join('') ?? '';
        const fence = code.includes('```') ? '````' : '```';
        return { md: indentLines(`${fence}${lang === 'plain text' ? '' : lang}\n${code}\n${fence}`, pad), list: false };
      }
      case 'header':
      case 'sub_header':
      case 'sub_sub_header':
        this.stats.warnings.push(`heading nested inside a block: "${richTextToPlain(title(b))}"`);
        return { md: `${pad}${'#'.repeat(HEADING_LEVEL[b.type]!)} ${own}`, list: false };
      case 'divider':
        return { md: `${pad}---`, list: false };
      case 'image': {
        const p = b.properties as { caption?: RichText; source?: [[string]]; title?: RichText } | undefined;
        const src = p?.source?.[0]?.[0] ?? '';
        const label = this.rt(p?.caption) || (src.startsWith('http') ? src : richTextToPlain(p?.title) || 'unlabeled');
        return { md: `${pad}[image: ${label}]`, list: false };
      }
      case 'table':
        return { md: indentLines(this.renderTable(b), pad), list: false };
      case 'table_row':
        return null; // rendered by its table
      default: {
        if (SKIPPED.has(b.type)) return null;
        const text = [own, ...kids(0)].filter((s) => s !== '');
        this.stats.unknownTypes[b.type] = (this.stats.unknownTypes[b.type] ?? 0) + 1;
        if (!text.length) return null;
        return { md: indentLines(text.join('\n'), pad), list: false };
      }
    }
  }

  private renderTable(b: NotionBlock): string {
    const order = ((b.format as { table_block_column_order?: string[] } | undefined)?.table_block_column_order) ?? [];
    const hasHeader = !!(b.format as { table_block_column_header?: boolean } | undefined)?.table_block_column_header;
    const rows: string[][] = [];
    for (const id of b.content ?? []) {
      const row = this.blocks[id];
      if (!row) continue;
      this.count(row);
      const props = (row.properties ?? {}) as Record<string, RichText>;
      rows.push(order.map((col) => this.rt(props[col], true).trim()));
    }
    if (!rows.length || !order.length) return '';
    const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
    const head = hasHeader ? rows.shift()! : order.map(() => '');
    return [line(head), line(order.map(() => '---')), ...rows.map(line)].join('\n');
  }
}

/** Indents every non-empty line by `pad`. */
function indentLines(text: string, pad: string): string {
  if (!pad) return text;
  return text.split('\n').map((l) => (l ? pad + l : l)).join('\n');
}

export function hashMarkdown(md: string): string {
  return createHash('sha256').update(md).digest('hex');
}

/** Joins block units: list items stay tight, everything else is separated by a blank line. */
export function joinUnits(units: Extract<Unit, { kind: 'block' }>[]): string {
  let out = '';
  units.forEach((u, i) => {
    if (i > 0) out += units[i - 1].list && u.list ? '\n' : '\n\n';
    out += u.md;
  });
  return out.trim();
}

export interface BookResult {
  sections: BookSection[];
  stats: ConvertStats;
}

export function convertBook(blocks: BlockMap, rootId: string): BookResult {
  const conv = new Converter(blocks);
  conv.run(rootId);
  const { units, stats } = conv;
  const sections: BookSection[] = [];
  let chapter = '';
  let current: { id: string; level: 1 | 2 | 3; title: string; units: Extract<Unit, { kind: 'block' }>[] } | null = null;
  let preamble = 0;
  const flush = () => {
    if (!current) return;
    const order = sections.length;
    const body = joinUnits(current.units);
    const markdown = `${'#'.repeat(current.level)} ${current.title}${body ? `\n\n${body}` : ''}`;
    sections.push({
      id: current.id,
      chapter,
      title: current.title,
      level: current.level,
      order,
      hash: hashMarkdown(markdown),
      slug: slugify(current.title),
      markdown,
    });
    current = null;
  };
  for (const u of units) {
    if (u.kind === 'heading') {
      flush();
      if (u.level === 1) chapter = u.title;
      current = { id: u.id, level: u.level, title: u.title, units: [] };
    } else if (current) {
      current.units.push(u);
    } else {
      preamble++;
    }
  }
  flush();
  if (preamble) stats.warnings.push(`${preamble} block(s) before the first heading were dropped`);
  for (const [t, n] of Object.entries(stats.unknownTypes)) stats.warnings.push(`unknown block type "${t}" x${n}`);
  for (const s of sections) if (!chapterSlug(s.chapter)) stats.warnings.push(`no chapter slug for ${s.chapter}`);
  return { sections, stats };
}
