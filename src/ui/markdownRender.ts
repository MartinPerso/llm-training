import katex from 'katex';
import MarkdownIt from 'markdown-it';
import { extractMath, restoreMath, type MathSegment } from './math.ts';

// Raw HTML is disabled; bank content is trusted but we keep it that way.
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });

const defaultLinkOpen =
  md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  token.attrSet('target', '_blank');
  token.attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

function renderMath({ tex, display }: MathSegment): string {
  return katex.renderToString(tex, { throwOnError: false, displayMode: display, strict: 'ignore' });
}

/** Markdown + KaTeX to an HTML string. Output is meant for `dangerouslySetInnerHTML` (see Markdown.tsx). */
export function renderMarkdown(src: string, inline = false): string {
  const { text, math } = extractMath(src);
  const html = inline ? md.renderInline(text) : md.render(text);
  return restoreMath(html, math, renderMath);
}
