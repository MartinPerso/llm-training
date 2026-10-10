import { useMemo } from 'react';
import { renderMarkdown } from './markdownRender.ts';

/**
 * The only place in the app that uses dangerouslySetInnerHTML. The input is trusted bank content,
 * markdown-it runs with `html: false`, and KaTeX is rendered with its default (untrusted) settings.
 * Text typed by the user is never passed through here.
 */
export default function Markdown({ text, inline = false, className }: { text: string; inline?: boolean; className?: string }) {
  const html = useMemo(() => renderMarkdown(text, inline), [text, inline]);
  const cls = `md${className ? ' ' + className : ''}`;
  return inline ? (
    <span className={cls} dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <div className={cls} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
