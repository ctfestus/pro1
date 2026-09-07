import DOMPurify from 'isomorphic-dompurify';

// Force all links to open in a new tab safely.
// Without rel="noopener noreferrer", a new tab can access window.opener
// and redirect the original tab (reverse tabnapping).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Strip HTML tags and null bytes from plain-text input fields. */
export function sanitizePlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')   // strip any HTML tags
    .replace(/\0/g, '');       // remove null bytes
  // Note: do NOT trim here -- trimming on every keystroke prevents users from typing spaces
}

export function sanitizeRichText(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li',
                   'h1', 'h2', 'h3', 'h4', 'blockquote', 'a', 'code', 'pre', 'hr', 'span',
                   'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'colspan', 'rowspan', 'scope'],
    ALLOW_DATA_ATTR: false,
  });
}

/** Rich text with HTTPS-only images for trusted authoring surfaces that support media. */
export function sanitizeRichTextWithImages(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li',
                   'h1', 'h2', 'h3', 'h4', 'blockquote', 'a', 'code', 'pre', 'hr', 'span',
                   'img', 'figure', 'figcaption',
                   'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'colspan', 'rowspan', 'scope',
                   'src', 'alt', 'width', 'height', 'style'],
    ALLOW_DATA_ATTR: false,
  });
  // Remove images without a safe HTTPS source. DOMPurify may strip a dangerous src first and
  // leave an empty <img>, so validate the complete sanitized tag rather than only matching src.
  return clean.replace(/<img\b[^>]*>/gi, (match) => {
    const src = match.match(/\bsrc="([^"]+)"/i)?.[1] ?? '';
    return src.startsWith('https://') ? match : '';
  });
}

/** Sanitizer for email body content authored in the VE briefing editor. */
export function sanitizeEmailContent(html: string): string {
  return sanitizeRichTextWithImages(html);
}

/**
 * Sanitizer for certification question content authored with RichTextEditor: rich text + tables +
 * images (https-only). Same policy as sanitizeEmailContent (which already permits img/table safely).
 */
export function sanitizeQuestionContent(html: string): string {
  return sanitizeRichTextWithImages(html);
}

const YT_IFRAME = (id: string) =>
  `<div style="width:100%;margin:8px 0;"><iframe src="https://www.youtube.com/embed/${id}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen title="YouTube video" style="width:100%;aspect-ratio:16/9;display:block;border-radius:8px;border:none;"></iframe></div>`;

/**
 * SAVE-TIME sanitizer. Strips dangerous HTML while preserving yt-embed placeholder divs
 * (inserted by RichTextEditor). The placeholder is a <div class="yt-embed" title="VIDEO_ID">
 * that gets converted to a real iframe only at display time by renderAnnouncementContent.
 */
export function sanitizeAnnouncementContent(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li',
                   'h1', 'h2', 'h3', 'h4', 'blockquote', 'a', 'code', 'pre', 'hr', 'span',
                   'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'div'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'colspan', 'rowspan', 'scope',
                   'title', 'style', 'class'],
    ALLOW_DATA_ATTR: false,
  });
}

/** Finds the end index of the matching closing div, accounting for nesting. */
function matchingDivClose(html: string, openTagEnd: number): number {
  let depth = 1;
  let i = openTagEnd;
  while (i < html.length && depth > 0) {
    const open  = html.indexOf('<div', i);
    const close = html.indexOf('</div>', i);
    if (close === -1) break;
    if (open !== -1 && open < close) { depth++; i = open + 4; }
    else { depth--; if (depth === 0) return close + 6; i = close + 6; }
  }
  return -1;
}

export function renderAnnouncementContent(html: string): string {
  // New format: <div class="yt-embed" title="VIDEO_ID"> -- may contain nested divs (legacy saves)
  let result = '';
  const openRe = /<div\b[^>]+class="[^"]*yt-embed[^"]*"[^>]+title="([a-zA-Z0-9_-]{11})"[^>]*>/gi;
  let m: RegExpExecArray | null;
  let lastIndex = 0;
  while ((m = openRe.exec(html)) !== null) {
    const openTagEnd = m.index + m[0].length;
    const closeEnd = matchingDivClose(html, openTagEnd);
    if (closeEnd === -1) continue;
    result += html.slice(lastIndex, m.index) + YT_IFRAME(m[1]);
    lastIndex = closeEnd;
    openRe.lastIndex = closeEnd;
  }
  result += html.slice(lastIndex);
  // Legacy format: raw <iframe> tags already saved in older announcements
  result = result.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (match) => {
    const src = match.match(/\bsrc=["']([^"']*)["']/i)?.[1] ?? '';
    const id = src.match(/youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/)?.[1];
    return id ? YT_IFRAME(id) : '';
  });
  return result;
}
