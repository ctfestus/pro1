import { sanitizeRichText } from '@/lib/sanitize';
import { hasRichContent } from '@/lib/plain-text';

/**
 * A product description is rich text from the editor (bold, italic, lists, headings, links). Older
 * descriptions are plain text with line breaks. Both are handled here, so every reader of the
 * column treats them the same way.
 */

const isHtml = (v: string) => /<[a-z][^>]*>/i.test(v);

const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Decode the few entities the editor and sanitizer produce, for plain-text uses. */
const decodeEntities = (v: string) =>
  v.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** The description as plain text (search previews, social cards), or '' when it has no words. */
export function descriptionText(value: string | null | undefined, max = 20000): string {
  const v = value ?? '';
  const text = isHtml(v)
    ? decodeEntities(v.replace(/<(br|\/p|\/li|\/h[1-6]|\/blockquote)\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, ''))
    : v;
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Safe HTML to render. Plain text is escaped and keeps its line breaks and paragraphs. */
export function descriptionHtml(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (isHtml(v)) return hasRichContent(v) ? sanitizeRichText(v) : '';
  return v.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`).join('');
}

/** What to store from the editor: sanitized rich text, or null when it has no words. */
export function descriptionForSave(value: string | null): string | null {
  if (!value || !hasRichContent(value)) return null;
  return isHtml(value) ? sanitizeRichText(value) : value;
}
