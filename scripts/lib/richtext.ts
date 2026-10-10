// Notion rich text -> Markdown.
// A rich text value is an array of segments: [text] or [text, annotations[]],
// where an annotation is [kind, arg?]: b i c s (bold, italic, code, strike),
// ["a", url], ["e", tex] (inline equation), ["h", color] and others (ignored).

export type Annotation = [string, ...unknown[]];
export type Segment = [string, Annotation[]?];
export type RichText = Segment[];

export interface RenderOptions {
  /** Make the output safe inside a Markdown table cell (escape pipes). */
  inTable?: boolean;
  /** Called for every inline equation (used for statistics). */
  onInlineEquation?: (tex: string) => void;
}

interface Piece {
  rendered: string; // escaped, ready for Markdown
  raw: string; // unescaped (used inside code spans)
  fmt: { b: boolean; i: boolean; c: boolean; s: boolean; a: string | null };
  isMath: boolean;
}

const fmtKey = (f: Piece['fmt']) => `${+f.b}${+f.i}${+f.c}${+f.s}|${f.a ?? ''}`;

export function escapePlain(text: string, inTable = false): string {
  let t = text.replaceAll('$', '\\$');
  if (inTable) t = t.replaceAll('|', '\\|').replaceAll('\n', ' ');
  return t;
}

function mathPipeSafe(tex: string): string {
  return tex.replace(/(?<!\\)\|/g, '\\vert ');
}

/** Wraps `inner` in `mark`, keeping leading/trailing whitespace outside (so `**a **` becomes `**a** `). */
function wrap(inner: string, mark: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  if (!m[2]) return inner;
  return `${m[1]}${mark}${m[2]}${mark}${m[3]}`;
}

export function richTextToMarkdown(rt: RichText | undefined, opts: RenderOptions = {}): string {
  if (!rt?.length) return '';
  const pieces: Piece[] = [];
  for (const seg of rt) {
    const [text, anns = []] = seg;
    const fmt: Piece['fmt'] = { b: false, i: false, c: false, s: false, a: null };
    let tex: string | null = null;
    for (const ann of anns) {
      switch (ann[0]) {
        case 'b': fmt.b = true; break;
        case 'i': fmt.i = true; break;
        case 'c': fmt.c = true; break;
        case 's': fmt.s = true; break;
        case 'a': fmt.a = String(ann[1]); break;
        case 'e': tex = String(ann[1]); break;
        default: break; // colors, highlights, comments...
      }
    }
    if (tex !== null) {
      opts.onInlineEquation?.(tex);
      const t = opts.inTable ? mathPipeSafe(tex) : tex;
      // Code formatting makes no sense on math.
      pieces.push({ rendered: `$${t}$`, raw: `$${t}$`, fmt: { ...fmt, c: false }, isMath: true });
    } else {
      pieces.push({ rendered: escapePlain(text, opts.inTable), raw: text, fmt, isMath: false });
    }
  }
  // Merge adjacent pieces that share formatting, so `**a****b**` never happens.
  const merged: Piece[] = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && fmtKey(last.fmt) === fmtKey(p.fmt) && !(p.fmt.c && (p.isMath || last.isMath))) {
      last.rendered += p.rendered;
      last.raw += p.raw;
      last.isMath = last.isMath && p.isMath;
    } else {
      merged.push({ ...p, fmt: { ...p.fmt } });
    }
  }
  let out = '';
  for (const p of merged) {
    let s = p.rendered;
    if (p.fmt.c) {
      // inside backticks nothing needs escaping
      s = opts.inTable ? p.raw.replaceAll('|', '\\|') : p.raw;
      s = wrap(s, s.includes('`') ? '``' : '`');
    }
    if (p.fmt.s) s = wrap(s, '~~');
    if (p.fmt.i) s = wrap(s, '*');
    if (p.fmt.b) s = wrap(s, '**');
    if (p.fmt.a) s = linkWrap(s, p.fmt.a);
    out += s;
  }
  return out;
}

function linkWrap(inner: string, url: string): string {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
  if (!m[2]) return inner;
  return `${m[1]}[${m[2]}](${url.replaceAll(')', '%29')})${m[3]}`;
}

/** Plain text of a rich text value (inline equations kept as `$tex$`). */
export function richTextToPlain(rt: RichText | undefined): string {
  if (!rt?.length) return '';
  return rt
    .map(([text, anns = []]) => {
      const e = anns.find((a) => a[0] === 'e');
      return e ? `$${String(e[1])}$` : text;
    })
    .join('');
}
