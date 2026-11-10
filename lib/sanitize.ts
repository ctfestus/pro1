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

// An image's size from the editor's resize handle lives in its style ("width:55%"). Styles are not
// kept, so the width moves to the width attribute (which pages and email clients both honour)
// before attributes are filtered. Runs for every sanitizer; only images are touched.
DOMPurify.addHook('uponSanitizeElement', (node: any, data: any) => {
  if (data?.tagName !== 'img' || typeof node?.getAttribute !== 'function') return;
  const style = node.getAttribute('style') ?? '';
  const width = style.match(/(?:^|;)\s*width\s*:\s*(\d{1,3}(?:\.\d+)?)(%|px)/i);
  // The style is what the editor last set (a resize), so it wins over an older width attribute.
  if (width) {
    const n = Math.round(Number(width[1]));
    if (width[2] === '%' ? n >= 5 && n <= 100 : n >= 16 && n <= 2000) node.setAttribute('width', width[2] === '%' ? `${n}%` : String(n));
  }
});

// Styles may not load anything from elsewhere (a background image is a tracking pixel too). A
// browser reads CSS escapes ("u\72l(" is "url(") and ignores comments, so a style with a
// backslash is dropped outright (the editors never write one), and comments are removed before
// the check.
DOMPurify.addHook('uponSanitizeAttribute', (_node: any, data: any) => {
  if (data?.attrName !== 'style') return;
  const value = String(data.attrValue ?? '');
  if (value.includes('\\')) { data.keepAttr = false; return; }
  const css = value.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '');
  if (/url\s*\(|expression\s*\(|@import|image(?:-set)?\s*\(|element\s*\(|cross-fade\s*\(/i.test(css)) {
    data.keepAttr = false;
  }
});

// Which image sources the sanitizer running now accepts. Set only for the duration of one
// sanitize call (DOMPurify is synchronous), and applied to the parsed element, not to the output
// text, so an attribute containing ">" cannot confuse it.
let imageGuard: ((src: string) => boolean) | null = null;
DOMPurify.addHook('afterSanitizeAttributes', (node: any) => {
  if (!imageGuard || node?.nodeName !== 'IMG') return;
  if (!imageGuard(String(node.getAttribute('src') ?? ''))) node.parentNode?.removeChild(node);
});
function withImageGuard<T>(guard: (src: string) => boolean, run: () => T): T {
  const previous = imageGuard;
  imageGuard = guard;
  try { return run(); } finally { imageGuard = previous; }
}

/**
 * Where rich text may show images from: this platform's own Cloudinary account, uploaded images
 * only (/<cloud>/image/upload/..., never another account, and never Cloudinary's "fetch any URL"
 * delivery), and Pexels' image CDN (stock photos from the image library). Anything else is
 * dropped, so content never loads, and emails never carry, an outside image that could track who
 * opened it. The account name is CLOUDINARY_CLOUD_NAME, inlined for the browser by next.config.ts.
 */
export function isAllowedRichTextImage(src: string): boolean {
  try {
    const u = new URL(src);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return false;
    if (u.hostname === 'images.pexels.com') return true;
    const cloud = process.env.CLOUDINARY_CLOUD_NAME ?? '';
    return !!cloud && u.hostname === 'res.cloudinary.com' && u.pathname.startsWith(`/${cloud}/image/upload/`);
  } catch {
    return false;
  }
}

const isHttps = (src: string) => /^https:\/\//i.test(src);

/** Strip HTML tags and null bytes from plain-text input fields. */
export function sanitizePlainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')   // strip any HTML tags
    .replace(/\0/g, '');       // remove null bytes
  // Note: do NOT trim here -- trimming on every keystroke prevents users from typing spaces
}

/**
 * Rich text from the editor: formatting, links, tables, and images from the platform's own image
 * hosting or Pexels only (isAllowedRichTextImage), with their size kept as a width attribute.
 */
export function sanitizeRichText(html: string): string {
  return withImageGuard(isAllowedRichTextImage, () => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li',
                   'h1', 'h2', 'h3', 'h4', 'blockquote', 'a', 'code', 'pre', 'hr', 'span',
                   'img', 'figure', 'figcaption',
                   'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'colspan', 'rowspan', 'scope', 'src', 'alt', 'width'],
    ALLOW_DATA_ATTR: false,
  }));
}

/** Rich text with HTTPS-only images for trusted authoring surfaces that support media. */
export function sanitizeRichTextWithImages(html: string): string {
  // Images without a safe HTTPS source are removed (checked on the parsed element).
  return withImageGuard(isHttps, () => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li',
                   'h1', 'h2', 'h3', 'h4', 'blockquote', 'a', 'code', 'pre', 'hr', 'span',
                   'img', 'figure', 'figcaption',
                   'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'colspan', 'rowspan', 'scope',
                   'src', 'alt', 'width', 'height'],
    ALLOW_DATA_ATTR: false,
  }));
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
/**
 * Older announcements saved YouTube videos as raw <iframe> tags. Iframes are not allowed through
 * the sanitizer, so they are turned into the editor's placeholder first (renderAnnouncementContent
 * makes the player from it). Any other iframe is left for the sanitizer to remove.
 */
function legacyIframesToPlaceholders(html: string): string {
  return html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (match) => {
    const src = match.match(/\bsrc=["']([^"']*)["']/i)?.[1] ?? '';
    const id = src.match(/^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})(?:[?#]|$)/)?.[1];
    return id ? `<div class="yt-embed" title="${id}"></div>` : match;
  });
}

export function sanitizeAnnouncementContent(html: string): string {
  html = legacyIframesToPlaceholders(html);
  return withImageGuard(isAllowedRichTextImage, () => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li',
                   'h1', 'h2', 'h3', 'h4', 'blockquote', 'a', 'code', 'pre', 'hr', 'span',
                   'img', 'figure', 'figcaption',
                   'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'div'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'colspan', 'rowspan', 'scope',
                   'title', 'style', 'class', 'src', 'alt', 'width'],
    ALLOW_DATA_ATTR: false,
  }));
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
