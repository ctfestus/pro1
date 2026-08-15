import 'server-only';

const DEFAULT_ALLOWED_HOSTS = ['res.cloudinary.com'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function allowedHosts() {
  const configured = process.env.OG_IMAGE_ALLOWED_HOSTS
    ?.split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);

  return new Set(configured?.length ? configured : DEFAULT_ALLOWED_HOSTS);
}

export function isAllowedLandingOgImageUrl(raw: string, hosts = allowedHosts()) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && hosts.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function hasExpectedSignature(bytes: Uint8Array, contentType: string) {
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));

  switch (contentType) {
    case 'image/png':
      return bytes.length >= 8
        && bytes[0] === 0x89
        && ascii(1, 4) === 'PNG'
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a;
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/webp':
      return bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
    case 'image/gif':
      return bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
    case 'image/avif':
      return bytes.length >= 12
        && ascii(4, 8) === 'ftyp'
        && ['avif', 'avis'].includes(ascii(8, 12));
    default:
      return false;
  }
}

export async function loadLandingOgImageDataUrl(raw: string): Promise<string | null> {
  if (!isAllowedLandingOgImageUrl(raw)) return null;

  try {
    const response = await fetch(raw, {
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 3600 },
    });
    if (!response.ok) return null;

    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) return null;

    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > MAX_IMAGE_BYTES) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES || !hasExpectedSignature(bytes, contentType)) return null;

    return `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
  } catch {
    return null;
  }
}
