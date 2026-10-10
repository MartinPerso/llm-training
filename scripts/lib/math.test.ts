import { describe, expect, it } from 'vitest';
import { extractMath } from './math.ts';

describe('extractMath', () => {
  it('finds inline and display math', () => {
    const { spans, errors } = extractMath('so $a+b$ and\n$$\n\\frac{1}{2}\n$$ done');
    expect(errors).toEqual([]);
    expect(spans).toEqual([
      { tex: 'a+b', display: false },
      { tex: '\\frac{1}{2}', display: true },
    ]);
  });

  it('treats \\$ as a literal dollar sign', () => {
    const { spans, errors } = extractMath('it costs \\$5 or \\$6, but $x$ is math');
    expect(errors).toEqual([]);
    expect(spans).toEqual([{ tex: 'x', display: false }]);
  });

  it('reports unbalanced dollars', () => {
    expect(extractMath('price is $5').errors).toHaveLength(1);
    expect(extractMath('open $$ x never closed').errors).toHaveLength(1);
  });

  it('does not let escaped characters close math', () => {
    const { spans, errors } = extractMath('$a \\$ b$');
    expect(errors).toEqual([]);
    expect(spans).toEqual([{ tex: 'a \\$ b', display: false }]);
  });

  it('ignores dollars inside code spans and reports empty math', () => {
    expect(extractMath('use `$HOME` here').errors).toEqual([]);
    expect(extractMath('a $$ $$ b').errors).toHaveLength(1);
  });
});
