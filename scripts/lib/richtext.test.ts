import { describe, expect, it } from 'vitest';
import { richTextToMarkdown, richTextToPlain, type RichText } from './richtext.ts';

describe('richTextToMarkdown', () => {
  it('renders inline equations and ignores their placeholder text', () => {
    const rt: RichText = [['a layer with '], ['⁍', [['e', 'n_\\text{in}']]], [' inputs']];
    expect(richTextToMarkdown(rt)).toBe('a layer with $n_\\text{in}$ inputs');
  });

  it('counts inline equations through the callback', () => {
    const seen: string[] = [];
    richTextToMarkdown([['⁍', [['e', 'x']]], [' and '], ['⁍', [['e', 'y']]]], { onInlineEquation: (t) => seen.push(t) });
    expect(seen).toEqual(['x', 'y']);
  });

  it('combines bold and a link', () => {
    const rt: RichText = [['see the '], ['paper', [['b'], ['a', 'https://example.com/p']]], [' now']];
    expect(richTextToMarkdown(rt)).toBe('see the [**paper**](https://example.com/p) now');
  });

  it('keeps whitespace outside emphasis markers and merges neighbours', () => {
    const rt: RichText = [['bold ', [['b']]], ['text ', [['b']]], ['plain']];
    expect(richTextToMarkdown(rt)).toBe('**bold text** plain');
  });

  it('handles italic, code and strikethrough, ignoring colors', () => {
    const rt: RichText = [['i', [['i']]], [' '], ['c', [['c']]], [' '], ['s', [['s']]], [' '], ['h', [['h', 'blue_background']]]];
    expect(richTextToMarkdown(rt)).toBe('*i* `c` ~~s~~ h');
  });

  it('wraps math inside bold', () => {
    expect(richTextToMarkdown([['⁍', [['b'], ['e', 'x^2']]]])).toBe('**$x^2$**');
  });

  it('escapes literal dollar signs in plain text only', () => {
    expect(richTextToMarkdown([['costs $5 and '], ['⁍', [['e', 'x']]]])).toBe('costs \\$5 and $x$');
  });

  it('makes table cells pipe-safe, including inside math', () => {
    const out = richTextToMarkdown([['a|b '], ['⁍', [['e', '|x|']]]], { inTable: true });
    expect(out).toBe('a\\|b $\\vert x\\vert $');
  });

  it('returns an empty string for missing rich text', () => {
    expect(richTextToMarkdown(undefined)).toBe('');
    expect(richTextToPlain([['a'], ['⁍', [['e', 'y']]]])).toBe('a$y$');
  });
});
