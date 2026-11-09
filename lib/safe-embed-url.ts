/**
 * Returns a safe iframe embed URL for known video providers, or null if the
 * input cannot be validated.
 *
 * YouTube and Vimeo: extract the typed ID and reconstruct a canonical embed URL
 * so no raw user-supplied URL ever reaches the iframe src.
 *
 * Bunny.net and Canva: validate protocol, exact hostname, and path prefix with
 * new URL() -- prevents substring-bypass attacks like:
 *   https://evil.com/?x=iframe.mediadelivery.net/embed/123
 * The original URL is returned unchanged so query params are preserved.
 */
/**
 * App route that re-serves storage-hosted HTML as a renderable page. Supabase
 * intentionally serves HTML files as plain text on the default *.supabase.co
 * domain (anti-phishing), so storage URLs cannot be iframed directly; the
 * proxy returns real text/html under a CSP sandbox (opaque origin -- the page
 * cannot touch this app's cookies, storage, or DOM).
 */
export const HTML_EMBED_PROXY_PATH = '/api/html-embed';

/**
 * The sandbox for instructor HTML embeds, used both as the iframe's sandbox attribute and (as
 * `sandbox ...`) in the proxy's CSP -- a browser applies both, so they must agree.
 *   allow-scripts  the embed's own interactivity runs
 *   allow-popups   its links can open a new tab
 *   allow-popups-to-escape-sandbox  that new tab is an ordinary page: a tab opened from a
 *                  sandboxed frame otherwise inherits the sandbox, and a page that needs storage,
 *                  cookies or forms (this app included) breaks in it
 * Never allow-same-origin: with allow-scripts the embed could remove its own sandbox and reach the
 * app's session. A link that navigates inside the frame itself stays sandboxed (by design).
 */
export const HTML_EMBED_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';

/**
 * True for self-contained interactive HTML pages hosted on this project's own
 * Supabase Storage public form-assets bucket (uploaded via lib/uploadToStorage).
 * Strict protocol + exact-hostname + path-prefix + extension check.
 */
export function isStorageHtmlEmbedUrl(raw: string): boolean {
  if (!raw) return false;
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;

  let storageOrigin: string;
  try { storageOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin; } catch { return false; }
  if (!storageOrigin || parsed.origin !== storageOrigin) return false;

  // Keep the folder check case-sensitive because Supabase object names are
  // case-sensitive and the storage policy protects this exact prefix.
  const path = parsed.pathname;
  return path.startsWith('/storage/v1/object/public/form-assets/lesson-html/') &&
    /\.html?$/i.test(path);
}

/**
 * True if the URL is an interactive HTML embed in either its stored form (the
 * storage URL kept in videoUrl) or its served form (the proxy URL safeEmbedUrl
 * returns). Players use this to size the frame tall and sandbox the iframe.
 */
export function isHtmlEmbedUrl(raw: string): boolean {
  if (!raw) return false;
  return isStorageHtmlEmbedUrl(raw) || raw.startsWith(`${HTML_EMBED_PROXY_PATH}?`);
}

export function safeEmbedUrl(raw: string): string | null {
  if (!raw) return null;

  // YouTube -- reconstruct canonical embed URL from extracted video ID
  const yt = raw.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?rel=0`;

  // Vimeo -- reconstruct canonical embed URL from extracted numeric ID
  const vimeo = raw.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;

  // Already-proxied HTML embed (e.g. copied from a rendered iframe) -- checked
  // before the absolute-URL parse below since it is a relative path. Only pass
  // it through when the inner storage URL revalidates.
  if (raw.startsWith(`${HTML_EMBED_PROXY_PATH}?`)) {
    const inner = new URLSearchParams(raw.slice(HTML_EMBED_PROXY_PATH.length + 1)).get('url') || '';
    return isStorageHtmlEmbedUrl(inner) ? raw : null;
  }

  // Parse all other providers strictly -- substring checks are bypassable
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;

  const { hostname, pathname } = parsed;

  // Bunny.net embed players (iframe.mediadelivery.net and player.mediadelivery.net)
  // Path must start with /embed/ to match the expected embed URL shape
  if (
    (hostname === 'iframe.mediadelivery.net' || hostname === 'player.mediadelivery.net') &&
    pathname.startsWith('/embed/')
  ) return raw;

  // Bunny.net direct stream variant
  if (hostname === 'video.bunnycdn.com') return raw;

  // Canva presentations -- append ?embed if no query string present
  if (
    (hostname === 'www.canva.com' || hostname === 'canva.com') &&
    pathname.startsWith('/design/')
  ) return raw.includes('?') ? raw : `${raw}?embed`;

  // Interactive HTML embeds -- .html files on this project's own public
  // form-assets bucket, served through the sandboxing proxy (see
  // HTML_EMBED_PROXY_PATH above for why they cannot be iframed directly)
  if (isStorageHtmlEmbedUrl(raw)) {
    return `${HTML_EMBED_PROXY_PATH}?url=${encodeURIComponent(raw)}`;
  }

  return null;
}
