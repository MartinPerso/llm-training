import { describe, expect, it } from 'vitest';
import { convertBook } from './convert.ts';
import type { BlockMap, NotionBlock } from './notion.ts';

function build(spec: Array<Partial<NotionBlock> & { id: string; type: string }>, root: string[]): BlockMap {
  const map: BlockMap = { page: { id: 'page', type: 'page', content: root } };
  for (const b of spec) map[b.id] = b as NotionBlock;
  return map;
}
const t = (s: string, anns?: unknown[]) => [anns ? [s, anns] : [s]];

describe('convertBook', () => {
  const blocks = build(
    [
      { id: 'h1', type: 'header', properties: { title: t('Chapter A') } },
      { id: 'intro', type: 'text', properties: { title: t('intro text') } },
      { id: 'h2', type: 'sub_header', properties: { title: t('Section A1') } },
      { id: 'b1', type: 'bulleted_list', properties: { title: [['uses '], ['⁍', [['e', 'x^2']]], [' and '], ['bold', [['b']]]] }, content: ['b1a'] },
      { id: 'b1a', type: 'bulleted_list', properties: { title: t('nested') }, content: ['b1a1', 'eq'] },
      { id: 'b1a1', type: 'bulleted_list', properties: { title: t('deeper') } },
      { id: 'eq', type: 'equation', properties: { title: t('y = \\frac{1}{2}') } },
      { id: 'h3', type: 'sub_sub_header', properties: { title: t('Detail A1a') } },
      { id: 'n1', type: 'numbered_list', properties: { title: t('first') } },
      { id: 'n2', type: 'numbered_list', properties: { title: t('second') } },
      { id: 'h1b', type: 'header', properties: { title: t('Chapter B') } },
      { id: 'cl', type: 'column_list', content: ['c1', 'c2'] },
      { id: 'c1', type: 'column', content: ['ct1'] },
      { id: 'c2', type: 'column', content: ['ct2'] },
      { id: 'ct1', type: 'text', properties: { title: t('left') } },
      { id: 'ct2', type: 'text', properties: { title: t('right') } },
      { id: 'weird', type: 'mystery', properties: { title: t('odd text') } },
      { id: 'tbl', type: 'table', format: { table_block_column_order: ['a', 'b'], table_block_column_header: true }, content: ['r1', 'r2'] },
      { id: 'r1', type: 'table_row', properties: { a: t('sym', [['b']]), b: t('dim', [['b']]) } },
      { id: 'r2', type: 'table_row', properties: { a: [['⁍', [['e', 'B']]]], b: t('batch') } },
    ],
    ['h1', 'intro', 'h2', 'b1', 'h3', 'n1', 'n2', 'h1b', 'cl', 'weird', 'tbl'],
  );
  const { sections, stats } = convertBook(blocks, 'page');

  it('starts a new section at every heading', () => {
    expect(sections.map((s) => [s.title, s.level, s.chapter, s.order])).toEqual([
      ['Chapter A', 1, 'Chapter A', 0],
      ['Section A1', 2, 'Chapter A', 1],
      ['Detail A1a', 3, 'Chapter A', 2],
      ['Chapter B', 1, 'Chapter B', 3],
    ]);
    expect(sections[0].markdown).toBe('# Chapter A\n\nintro text');
  });

  it('renders nested bullets with 2-space indentation and display math', () => {
    expect(sections[1].markdown).toBe(
      ['## Section A1', '', '- uses $x^2$ and **bold**', '  - nested', '    - deeper', '    $$', '    y = \\frac{1}{2}', '    $$'].join('\n'),
    );
  });

  it('numbers lists and keeps them tight', () => {
    expect(sections[2].markdown).toBe('### Detail A1a\n\n1. first\n2. second');
  });

  it('flattens columns, tables and unknown blocks', () => {
    expect(sections[3].markdown).toBe(
      ['# Chapter B', '', 'left', '', 'right', '', 'odd text', '', '| **sym** | **dim** |', '| --- | --- |', '| $B$ | batch |'].join('\n'),
    );
    expect(stats.unknownTypes).toEqual({ mystery: 1 });
    expect(stats.warnings.some((w) => w.includes('mystery'))).toBe(true);
  });

  it('counts equations and gives stable hashes', () => {
    expect(stats.inlineEquations).toBe(2);
    expect(stats.displayEquations).toBe(1);
    expect(sections[0].hash).toMatch(/^[0-9a-f]{64}$/);
    expect(convertBook(blocks, 'page').sections.map((s) => s.hash)).toEqual(sections.map((s) => s.hash));
    expect(new Set(sections.map((s) => s.hash)).size).toBe(sections.length);
  });
});
