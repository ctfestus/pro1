/**
 * Downscale and re-encode an image in the browser before it is POSTed to /api/upload.
 *
 * Two things make this necessary. Vercel rejects a serverless request body over ~4.5MB at the
 * edge (413 FUNCTION_PAYLOAD_TOO_LARGE) before the route handler ever runs, so a photo straight
 * off a phone can never reach Cloudinary whatever limit the route allows. And a multi-megabyte
 * master is pure cost: slow to upload on a mobile connection, and stored forever.
 *
 * Re-encoding is DESTRUCTIVE -- Cloudinary keeps what we send and cannot upscale a lost master --
 * so folders opt IN to a tighter profile and anything unlisted keeps the detail-preserving
 * default. A surface added later can therefore never be silently over-compressed.
 *
 * Every failure path returns the original file, so this can only help an upload, never break one.
 */

export type CompressProfile = {
  /** Longest edge kept, in pixels. */
  maxDim: number;
  /** Byte ceiling. Exceeding it steps down the quality ladder, it is not a size to hit. */
  targetBytes: number;
};

const MB = 1024 * 1024;

/**
 * Detail-preserving default. Lesson images are often screenshots of a formula bar, a SQL
 * query or a dashboard, where downscaling destroys the legibility that is the whole point,
 * so this only intervenes when a file is genuinely oversized.
 */
export const DEFAULT_PROFILE: CompressProfile = { maxDim: 2400, targetBytes: 1.8 * MB };

/**
 * Covers are decorative, are delivered width-capped (see lib/cloudinary-url), and are the
 * upload an instructor makes from a phone, so they can be much tighter. 2000px still covers
 * a full-width banner on a retina display.
 */
export const COVER_PROFILE: CompressProfile = { maxDim: 2000, targetBytes: 1.2 * MB };

/** Upload folders that opt in to a tighter profile. Everything else gets DEFAULT_PROFILE. */
const PROFILES: Record<string, CompressProfile> = {
  covers: COVER_PROFILE,
  'datasets/covers': COVER_PROFILE,
};

export function profileFor(folder: string): CompressProfile {
  return PROFILES[folder] ?? DEFAULT_PROFILE;
}

/**
 * Tried in order against the chosen profile; the first result inside targetBytes wins.
 * `dimScale` is relative to profile.maxDim, so one ladder serves every profile.
 */
const LADDER: Array<{ dimScale: number; quality: number }> = [
  { dimScale: 1, quality: 0.85 },
  { dimScale: 1, quality: 0.7 },
  { dimScale: 0.75, quality: 0.7 },
  { dimScale: 0.6, quality: 0.6 },
];

/** The canvas size and encoder quality each rung of the ladder would use. */
export function ladderSteps(srcW: number, srcH: number, profile: CompressProfile) {
  const longest = Math.max(srcW, srcH);
  return LADDER.map(({ dimScale, quality }) => {
    const scale = Math.min(1, (profile.maxDim * dimScale) / longest);
    return {
      width: Math.max(1, Math.round(srcW * scale)),
      height: Math.max(1, Math.round(srcH * scale)),
      quality,
    };
  });
}

/** Formats canvas cannot round-trip: SVG is vector, GIF would lose its animation. */
const SKIP = /^image\/(svg\+xml|gif)$/;

/**
 * Whether this file is a raster image safe to re-encode. Checked by mime AND by extension,
 * because a file picked from some devices arrives with an empty or wrong `type`.
 */
export function isCompressibleImage(type: string, name = ''): boolean {
  if (!type.startsWith('image/')) return false;
  if (SKIP.test(type)) return false;
  const lower = name.toLowerCase();
  return !(lower.endsWith('.svg') || lower.endsWith('.gif'));
}

/**
 * Whether an already-decoded image can be uploaded as-is.
 *
 * BOTH bounds have to hold. Checking pixels alone would let a 1800px 3MB JPEG through, and
 * checking bytes against the platform's request cap rather than the profile's quality target
 * is what makes this a workaround instead of an optimization.
 */
export function shouldSkipCompression(
  width: number,
  height: number,
  bytes: number,
  profile: CompressProfile,
): boolean {
  return Math.max(width, height) <= profile.maxDim && bytes <= profile.targetBytes;
}

async function loadImage(file: File | Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    // 'from-image' so a portrait phone photo is not silently rotated by the re-encode.
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not decode image'));
      img.src = url;
    });
  } finally {
    // Safe once the image has loaded -- the decoded pixels stay with the element.
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality));
}

let webpEncodes: boolean | null = null;

/** Probed once on a 1x1 canvas: toBlob silently falls back to PNG for an unsupported type. */
function canEncodeWebp(): boolean {
  if (webpEncodes === null) {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    webpEncodes = probe.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webpEncodes;
}

/**
 * WebP keeps alpha (a transparent PNG logo must not gain a black background) and beats JPEG
 * at equal quality, so it is the first choice. Without WebP encoding, a source that may carry
 * transparency has to stay PNG; anything else becomes JPEG, which is always available and
 * always smaller than PNG for a photo.
 */
function encodeAs(sourceType: string): string {
  if (canEncodeWebp()) return 'image/webp';
  return /^image\/(png|webp|avif|heic|heif)$/.test(sourceType) ? 'image/png' : 'image/jpeg';
}

function withExtension(name: string, mime: string): string {
  const ext = mime.split('/')[1] || 'webp';
  const base = name.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}.${ext}`;
}

export async function compressImageForUpload(
  file: File | Blob,
  profile: CompressProfile = DEFAULT_PROFILE,
): Promise<File | Blob> {
  const fileName = file instanceof File ? file.name : '';
  if (typeof document === 'undefined' || !isCompressibleImage(file.type || '', fileName)) return file;

  let image: ImageBitmap | HTMLImageElement | null = null;
  try {
    image = await loadImage(file);
    const srcW = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
    const srcH = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
    if (!srcW || !srcH) return file;

    // Inside the profile on BOTH axes -- keep the original bytes and encoding untouched.
    if (shouldSkipCompression(srcW, srcH, file.size, profile)) return file;

    const name = fileName || 'image';
    const mime = encodeAs(file.type);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high'; // large downscales alias badly otherwise

    let smallest: Blob | null = null;
    for (const { width, height, quality } of ladderSteps(srcW, srcH, profile)) {
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const blob = await toBlob(canvas, mime, quality);
      if (!blob) break;
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= profile.targetBytes) break;
    }

    if (!smallest) return file;
    // Never trade quality for nothing: if re-encoding grew the file and the original already
    // fits the profile's byte ceiling, upload the original.
    if (smallest.size >= file.size && file.size <= profile.targetBytes) return file;

    return new File([smallest], withExtension(name, smallest.type), {
      type: smallest.type,
      lastModified: file instanceof File ? file.lastModified : Date.now(),
    });
  } catch {
    return file;
  } finally {
    if (image && !(image instanceof HTMLImageElement)) image.close();
  }
}
