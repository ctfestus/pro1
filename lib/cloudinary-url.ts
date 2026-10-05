/**
 * Resolve a stored cover/image reference to a deliverable URL.
 *
 * New uploads store a bare Cloudinary public_id (e.g. "users/<uid>/covers/abc").
 * Legacy values are full URLs (Cloudinary, Supabase Storage, or any other host). Those still
 * work: a Cloudinary URL has the transform injected so it is optimized like a public_id ref,
 * and any other host is returned unchanged.
 *
 * Storing the public_id instead of a baked-in URL means switching the Cloudinary
 * account only requires moving the assets and updating CLOUDINARY_CLOUD_NAME --
 * no database rows have to be rewritten and no saved URL can point at a dead account.
 */
// Single source of truth: CLOUDINARY_CLOUD_NAME. It's non-secret (it appears in every delivery
// URL), and next.config.ts exposes it to the browser bundle under the same name, so this one var
// works both client- and server-side -- no NEXT_PUBLIC_ duplicate to keep in sync.
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME ?? '';

/**
 * Delivery presets. `c_limit` only ever scales DOWN, so a master smaller than the bound is
 * delivered untouched -- which makes these safe to apply to content already in the database.
 *
 * Width matters as much as format here: without a `w_`, every surface downloads the full
 * stored resolution, so a 400px card in a grid pulls the entire master. Sizing at delivery
 * is also non-destructive and retroactive, unlike sizing at upload.
 */
export const IMG_HERO = 'f_auto,q_auto,w_1600,c_limit';        // full-width banner / page hero
export const IMG_EMAIL = 'f_auto,q_auto,w_600,c_limit';        // email body image (600px-wide table)
export const IMG_EMAIL_THUMB = 'f_auto,q_auto,w_150,c_limit';  // 64-72px email thumbnail, at 2x
export const IMG_ICON = 'f_auto,q_auto,w_128,c_limit';        // 13-64px tool logo, at 2x

const DEFAULT_TRANSFORM = IMG_HERO;

/** Cloudinary puts the transformation immediately after this segment. */
const UPLOAD_SEGMENT = '/image/upload/';

/**
 * Apply a transform to a full Cloudinary delivery URL.
 *
 * Several cover flows persist the absolute URL the upload route returns (it bakes in
 * f_auto,q_auto) instead of a bare public_id, and every legacy row predates public_id
 * storage entirely. Without this, none of them would ever get a width cap.
 *
 * The transform is PREPENDED as an additional chained component rather than replacing
 * whatever sits after /image/upload/. Cloudinary applies chained components in order, so a
 * duplicated f_auto is harmless, whereas mistaking a public_id segment for a transform and
 * replacing it would destroy the URL. Non-Cloudinary hosts (Supabase Storage, Pexels) and
 * /raw/ or /video/ delivery are left alone.
 *
 * SVGs are skipped: f_auto makes Cloudinary rasterize them, which is precisely what
 * uploadCoverImage() avoids by storing SVG covers as full URLs in the first place.
 *
 * Signed delivery URLs (`/s--<sig>--/`) are skipped too. Cloudinary computes the signature
 * over the transformation and public_id, so injecting a component both malforms the URL and
 * invalidates the signature -- a 401 that surfaces only as a silently broken image. Covers
 * are public today; this keeps the resolver safe if authenticated delivery is ever enabled.
 */
function transformCloudinaryUrl(url: string, transform: string): string {
  if (!transform) return url;
  if (!url.includes('res.cloudinary.com') || !url.includes(UPLOAD_SEGMENT)) return url;
  if (/\/s--[^/]+--\//.test(url)) return url;
  if (/\.svg([?#]|$)/i.test(url)) return url;
  if (url.includes(`${UPLOAD_SEGMENT}${transform}/`)) return url; // already applied
  return url.replace(UPLOAD_SEGMENT, `${UPLOAD_SEGMENT}${transform}/`);
}

/** True when the value is already a full URL or data/blob ref we should deliver as-is. */
function isAbsoluteRef(ref: string): boolean {
  return (
    ref.startsWith('http://') ||
    ref.startsWith('https://') ||
    ref.startsWith('data:') ||
    ref.startsWith('blob:') ||
    ref.startsWith('/') // app-relative path
  );
}

/**
 * Turn a stored reference into a deliverable image URL.
 * @param ref       Stored value: a bare Cloudinary public_id, a full URL, or empty.
 * @param transform Cloudinary transformation string (default IMG_HERO). Pass '' for none.
 */
export function resolveImageUrl(ref?: string | null, transform: string = DEFAULT_TRANSFORM): string {
  if (!ref) return '';
  const value = ref.trim();
  if (!value) return '';
  // Legacy full URL / data / blob. Cloudinary URLs still get the transform applied so they
  // are width-capped like public_id refs; everything else is delivered unchanged.
  if (isAbsoluteRef(value)) return transformCloudinaryUrl(value, transform);

  // Bare Cloudinary public_id. Without a configured cloud we cannot build a URL,
  // so return the raw value rather than emit a guaranteed-broken cloudinary URL.
  if (!CLOUD_NAME) return value;

  const t = transform ? `${transform}/` : '';
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${t}${value}`;
}

/**
 * Link-preview crop (og:image). Forced JPEG, never f_auto: Cloudinary picks the f_auto format
 * from the requester's Accept/User-Agent and hands WebP to the Facebook/WhatsApp/LinkedIn
 * crawlers, which then drop the thumbnail and show title + description only.
 */
export const IMG_SOCIAL = 'f_jpg,q_auto,w_1200,h_630,c_fill,g_auto';

/**
 * Turn a stored cover reference into a link-preview image URL.
 *
 * Unlike resolveImageUrl, this REPLACES any transformation already baked into a legacy
 * Cloudinary URL rather than prepending to it: chained components apply in order, so a stored
 * trailing f_auto would override the f_jpg and the crawler would still get WebP. Cloudinary
 * places transformations before the version segment (v123...), so when one is present
 * everything between /image/upload/ and it is transformation and can be dropped. Without a
 * version, leading segments made only of known transformation parameters are dropped instead,
 * which leaves a folder such as "my_folder" alone. Signed URLs are returned unchanged
 * (rewriting breaks the signature); non-Cloudinary hosts likewise.
 */
const TRANSFORM_PARAM = /^(a|ac|af|ar|b|bo|br|c|co|cs|d|dl|dn|dpr|du|e|eo|f|fl|fn|fps|g|h|if|ki|l|o|p|pg|q|r|so|sp|t|u|vc|vs|w|x|y|z)_[^,]+$/;
const isTransformSegment = (segment: string) =>
  segment !== '' && segment.split(',').every(part => TRANSFORM_PARAM.test(part));

export function socialImageUrl(ref?: string | null): string {
  const url = resolveImageUrl(ref, '');
  if (!url.startsWith('https://') && !url.startsWith('http://')) return '';
  const at = url.indexOf(UPLOAD_SEGMENT);
  if (!url.includes('res.cloudinary.com') || at === -1) return url;
  if (/\/s--[^/]+--\//.test(url)) return url;
  const head = url.slice(0, at + UPLOAD_SEGMENT.length);
  const segments = url.slice(head.length).split('/');
  const version = segments.findIndex(s => /^v\d+$/.test(s));
  let start = version;
  if (start === -1) {
    start = 0;
    while (start < segments.length - 1 && isTransformSegment(segments[start])) start++;
  }
  return `${head}${IMG_SOCIAL}/${segments.slice(start).join('/')}`;
}

/** Convenience alias for content cover images. */
export const resolveCoverUrl = (ref?: string | null, transform?: string) => resolveImageUrl(ref, transform);

/**
 * Candidate widths for an image that fills the page width, for an <img srcSet> with sizes="100vw".
 * One fixed width is either too heavy for a phone or too soft on a wide or high-density screen,
 * where a 1600px image is stretched to twice its size. c_limit still never scales a master up.
 */
export const heroSrcSet = (ref?: string | null): string =>
  [800, 1280, 1920, 2560]
    .map(w => `${resolveImageUrl(ref, `f_auto,q_auto,w_${w},c_limit`)} ${w}w`)
    .join(', ');

/** True when a stored value is a bare public_id (i.e. needs resolving), not a full URL. */
export const isPublicIdRef = (ref?: string | null): boolean =>
  !!ref && !!ref.trim() && !isAbsoluteRef(ref.trim());
