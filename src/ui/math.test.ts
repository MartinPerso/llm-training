import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdownRender.ts';
import { extractMath, restoreMath } from './math.ts';

describe('extractMath', () => {
  it('extracts inline and display math', () => {
    const { text, math } = extractMath('Let $x^2$ and $$\\sum_i y_i$$ end.');
    expect(math).toEqual([
      { tex: 'x^2', display: false },
      { tex: '\\sum_i y_i', display: true },
    ]);
    expect(text).not.toContain('$');
  });

  it('handles display math across lines', () => {
    const { math } = extractMath('a\n$$\n\\frac{a}{b}\n$$\nb');
    expect(math).toEqual([{ tex: '\\frac{a}{b}', display: true }]);
  });

  it('treats \\$ as a literal dollar sign', () => {
    const { text, math } = extractMath('costs \\$5 and \\$10, but $x$ is math');
    expect(math).toEqual([{ tex: 'x', display: false }]);
    expect(restoreMath(text, math, () => 'M')).toBe('costs $5 and $10, but M is math');
  });

  it('does not treat prices or stray dollars as math', () => {
    expect(extractMath('it costs $5 and $10 total').math).toEqual([]);
    expect(extractMath('a lone $ sign').math).toEqual([]);
    expect(extractMath('$ spaced $').math).toEqual([]);
    expect(extractMath('unterminated $x').math).toEqual([]);
  });

  it('keeps escaped characters inside math', () => {
    expect(extractMath('$a\\$b$').math).toEqual([{ tex: 'a\\$b', display: false }]);
    expect(extractMath('$\\{x\\}$').math).toEqual([{ tex: '\\{x\\}', display: false }]);
  });

  it('leaves code spans alone', () => {
    const { text, math } = extractMath('use `$HOME` and `$$` then $y$');
    expect(math).toEqual([{ tex: 'y', display: false }]);
    expect(text).toContain('`$HOME`');
  });

  it('does not span paragraphs', () => {
    expect(extractMath('$a\n\nb$').math).toEqual([]);
  });

  it('strips reserved placeholder characters from the input', () => {
    const { math } = extractMath('evil 0 text');
    expect(math).toEqual([]);
  });
});

describe('renderMarkdown', () => {
  it('renders math with KaTeX and Markdown around it', () => {
    const html = renderMarkdown('**bold** $x_1$ and\n\n$$E=mc^2$$');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('class="katex"');
    expect(html).toContain('katex-display');
  });

  it('math content is not touched by Markdown (underscores, asterisks)', () => {
    const html = renderMarkdown('$a_1 * b_2 * c_3$');
    expect(html).not.toContain('<em>');
    expect(html).toContain('class="katex"');
  });

  it('disables raw HTML', () => {
    const html = renderMarkdown('<script>alert(1)</script> <b onclick="x()">hi</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b ');
    expect(html).toContain('&lt;script&gt;');
  });

  it('opens links in a new tab safely, and linkifies', () => {
    const html = renderMarkdown('see [book](https://example.com/a) or https://example.org/x');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
  });

  it('refuses javascript: links', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href="javascript');
  });

  it('renders literal dollars and does not throw on bad TeX', () => {
    expect(renderMarkdown('costs \\$5')).toContain('costs $5');
    expect(() => renderMarkdown('$\\badcommand{$')).not.toThrow();
    expect(renderMarkdown('$\\badcommand$')).toContain('katex');
  });

  it('inline mode has no paragraph wrapper', () => {
    expect(renderMarkdown('plain $x$', true)).not.toContain('<p>');
  });
});
