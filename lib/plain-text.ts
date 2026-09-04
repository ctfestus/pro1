/**
 * Authored rich text, flattened to a single readable line.
 *
 * Descriptions are written in a rich-text editor, so they arrive as HTML. A full-width page
 * renders that HTML; a card that truncates to a line or two must not, or the reader gets
 * "<p>Learn how to..." instead of a sentence. This is the one place that conversion lives, so
 * every card flattens the same way.
 *
 * Not a sanitiser. It produces text to display AS text -- never pass the result to
 * dangerouslySetInnerHTML. Use sanitizeRichText when you mean to render the markup.
 */
export function toPlainText(html: string | null | undefined): string {
  return String(html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether authored text actually contains markup.
 *
 * Descriptions predate the rich-text editor, so a path saved years ago holds plain text with real
 * newlines in it. Handing that to dangerouslySetInnerHTML renders it as one run-on paragraph,
 * because HTML collapses whitespace -- the author's spacing simply disappears. Rich text needs
 * rendering; plain text needs its line breaks respected. This says which one you have.
 */
export function looksLikeHtml(value: string | null | undefined): boolean {
  return /<\/?[a-z][^>]*>/i.test(String(value ?? ''));
}
