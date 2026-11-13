import DOMPurify from 'isomorphic-dompurify';
import { sanitizeEmailBody } from '@/lib/sanitize';
import { textOn } from '@/lib/events/page-theme';

/**
 * The broadcast email body (app/api/email, type 'blast') as email HTML.
 *
 * The body comes from the RichTextEditor with images, buttons and video turned on. Email clients
 * cannot run the editor's markup, so after sanitizing (lib/sanitize sanitizeEmailBody):
 *   a.email-button       a table-cell button in the sender's colour (Outlook ignores padding on <a>)
 *   div.yt-embed[title]  the YouTube thumbnail, linked to the video: email cannot play video
 *   img                  full width at most, never overflowing a phone screen
 * Merge tags ({{name}}, {{meeting_link}}, ...) are filled last, HTML-escaped, so a registrant's
 * name can never add markup. A button may point at a merge tag, e.g. {{meeting_link}}: the tag is
 * filled first and the button kept only if the result is a web link (a recipient with no link gets
 * the label as plain text, not a dead button).
 *
 * A body with no markup at all is plain text: escaped, with blank lines as paragraphs. Anything
 * with a tag in it goes through the sanitizer, so no body reaches an email unsanitized.
 */

const YT_ID = /^[a-zA-Z0-9_-]{11}$/;
const MERGE_HREF = /^\{\{\s*([a-z0-9_]+)\s*\}\}$/i;
const WEB_HREF = /^https?:\/\/\S+$/i;

export const escapeHtml = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** A merge value by tag name. Own keys only: {{constructor}} is an unknown tag, not a function. */
export function mergeValue(values: Record<string, string>, key: string): string {
  const k = key.toLowerCase();
  return Object.prototype.hasOwnProperty.call(values, k) ? String(values[k] ?? '') : '';
}

/** Fill {{tags}} in a template; `escape` for a template that is HTML. */
export function fillMergeTags(template: string, values: Record<string, string>, escape = false): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => {
    const v = mergeValue(values, key);
    return escape ? escapeHtml(v) : v;
  });
}

export function renderEmailBody(body: string, values: Record<string, string>, buttonColor: string): string {
  if (!/<[a-z!/]/i.test(body)) {
    const paragraphs = escapeHtml(body.trim()).split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    return fillMergeTags(paragraphs, values, true);
  }
  const clean = sanitizeEmailBody(body);
  const color = /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(buttonColor) ? buttonColor : '#111827';
  const onColor = textOn(color);

  // An inert document to rework the sanitized markup in (jsdom on the server).
  const doc = (DOMPurify.sanitize('', { RETURN_DOM_FRAGMENT: true }) as DocumentFragment).ownerDocument;
  const root = doc.createElement('div');
  root.innerHTML = clean;

  // A block replaces its paragraph when it is the only thing in it (the editor puts it there).
  const replaceBlock = (el: Element, html: string) => {
    const holder = doc.createElement('div');
    holder.innerHTML = html;
    const parent = el.parentElement;
    const target = parent && parent !== root && parent.tagName === 'P' && parent.textContent?.trim() === el.textContent?.trim() && parent.children.length === 1
      ? parent : el;
    target.replaceWith(...Array.from(holder.childNodes));
  };

  // A link to a merge tag is filled here, not with the text, so the result can be checked: a tag
  // that fills to nothing, or to anything but a web link, leaves no link behind.
  root.querySelectorAll('a[href]').forEach(a => {
    const tag = (a.getAttribute('href') ?? '').trim().match(MERGE_HREF);
    if (!tag) return;
    const href = mergeValue(values, tag[1]).trim();
    if (WEB_HREF.test(href)) a.setAttribute('href', href);
    else a.removeAttribute('href');
  });

  root.querySelectorAll('a.email-button').forEach(a => {
    const href = (a.getAttribute('href') ?? '').trim();
    const label = (a.textContent ?? '').trim();
    if (!label || !WEB_HREF.test(href)) { a.replaceWith(doc.createTextNode(label)); return; }
    replaceBlock(a, `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;"><tr>`
      + `<td style="border-radius:8px;background-color:${color};">`
      + `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 26px;color:${onColor};font-weight:bold;font-size:15px;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>`
      + `</td></tr></table>`);
  });

  root.querySelectorAll('div.yt-embed').forEach(div => {
    const id = div.getAttribute('title') ?? '';
    if (!YT_ID.test(id)) { div.remove(); return; }
    const watch = `https://www.youtube.com/watch?v=${id}`;
    replaceBlock(div, `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;"><tr><td>`
      + `<a href="${watch}" target="_blank" rel="noopener noreferrer"><img src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="Watch the video" width="100%" style="display:block;width:100%;max-width:100%;height:auto;border:0;border-radius:8px;"></a>`
      + `</td></tr><tr><td style="padding-top:8px;"><a href="${watch}" target="_blank" rel="noopener noreferrer" style="color:${color};font-weight:bold;text-decoration:none;">Watch the video on YouTube</a></td></tr></table>`);
  });

  root.querySelectorAll('img').forEach(img => {
    if (img.closest('table[role="presentation"]')) return;
    img.setAttribute('style', 'display:block;max-width:100%;height:auto;border:0;border-radius:6px;margin:12px 0;');
  });

  return fillMergeTags(root.innerHTML, values, true);
}
