import { describe, it, expect } from 'vitest';

import {
  resolveImageUrl, resolveCoverUrl, isPublicIdRef,
  IMG_HERO, IMG_EMAIL_THUMB, IMG_SOCIAL, socialImageUrl,
} from '@/lib/cloudinary-url';

const CLOUD = 'https://res.cloudinary.com/test-cloud/image/upload';

describe('resolveImageUrl: public_id refs', () => {
  it('builds a delivery URL with the default hero transform', () => {
    expect(resolveImageUrl('users/abc/covers/hash')).toBe(`${CLOUD}/${IMG_HERO}/users/abc/covers/hash`);
  });

  it('honours an explicit transform', () => {
    expect(resolveImageUrl('users/abc/covers/hash', IMG_EMAIL_THUMB))
      .toBe(`${CLOUD}/${IMG_EMAIL_THUMB}/users/abc/covers/hash`);
  });

  it('omits the transform segment entirely when passed an empty string', () => {
    expect(resolveImageUrl('users/abc/covers/hash', '')).toBe(`${CLOUD}/users/abc/covers/hash`);
  });

  it('returns empty for empty input', () => {
    expect(resolveImageUrl(null)).toBe('');
    expect(resolveImageUrl(undefined)).toBe('');
    expect(resolveImageUrl('   ')).toBe('');
  });
});

// Several cover flows persist the absolute URL the upload route returns instead of a bare
// public_id, and every legacy row predates public_id storage. Those must still get optimized.
describe('resolveImageUrl: full Cloudinary URLs', () => {
  it('injects the transform into a bare delivery URL', () => {
    expect(resolveImageUrl(`${CLOUD}/v1712/users/abc/covers/hash.jpg`))
      .toBe(`${CLOUD}/${IMG_HERO}/v1712/users/abc/covers/hash.jpg`);
  });

  it('chains ahead of a transform the upload route already baked in', () => {
    const stored = `${CLOUD}/f_auto,q_auto/v1712/users/abc/covers/hash.jpg`;
    expect(resolveImageUrl(stored)).toBe(`${CLOUD}/${IMG_HERO}/f_auto,q_auto/v1712/users/abc/covers/hash.jpg`);
  });

  it('is idempotent, so a double resolve cannot stack transforms', () => {
    const once = resolveImageUrl(`${CLOUD}/v1712/users/abc/covers/hash.jpg`);
    expect(resolveImageUrl(once)).toBe(once);
  });

  // f_auto makes Cloudinary rasterize an SVG, which is exactly why uploadCoverImage() stores
  // SVG covers as full URLs in the first place. Injecting a transform would undo that.
  it('leaves SVG URLs untouched', () => {
    const svg = `${CLOUD}/v1712/users/abc/covers/logo.svg`;
    expect(resolveImageUrl(svg)).toBe(svg);
  });

  // Cloudinary signs the transformation together with the public_id, so injecting a component
  // both malforms the URL and invalidates the signature -- a 401 seen only as a broken image.
  it('leaves signed delivery URLs untouched', () => {
    const signed = `${CLOUD}/s--Ab3dEf12--/v1712/users/abc/covers/hash.jpg`;
    expect(resolveImageUrl(signed)).toBe(signed);
  });

  it('leaves a signed URL that already carries a transform untouched', () => {
    const signed = `${CLOUD}/s--Ab3dEf12--/w_300,c_fill/v1712/users/abc/covers/hash.jpg`;
    expect(resolveImageUrl(signed)).toBe(signed);
  });

  it('leaves a raw or video delivery URL untouched', () => {
    const raw = 'https://res.cloudinary.com/test-cloud/raw/upload/v1/users/abc/data.zip';
    expect(resolveImageUrl(raw)).toBe(raw);
  });

  it('applies no transform when passed an empty transform', () => {
    const url = `${CLOUD}/v1712/users/abc/covers/hash.jpg`;
    expect(resolveImageUrl(url, '')).toBe(url);
  });
});

describe('resolveImageUrl: other hosts', () => {
  it('returns Supabase Storage URLs unchanged', () => {
    const url = 'https://xyz.supabase.co/storage/v1/object/public/form-assets/covers/1.png';
    expect(resolveImageUrl(url)).toBe(url);
  });

  it('returns third-party, data, blob and app-relative refs unchanged', () => {
    for (const url of [
      'https://images.pexels.com/photos/1/x.jpeg',
      'data:image/png;base64,iVBORw0KGgo=',
      'blob:http://localhost:3000/9f8e',
      '/placeholder-cover.png',
    ]) {
      expect(resolveImageUrl(url)).toBe(url);
    }
  });
});

describe('resolveCoverUrl', () => {
  it('matches resolveImageUrl', () => {
    expect(resolveCoverUrl('users/abc/covers/hash')).toBe(resolveImageUrl('users/abc/covers/hash'));
  });
});

describe('isPublicIdRef', () => {
  it('distinguishes a bare public_id from a full URL', () => {
    expect(isPublicIdRef('users/abc/covers/hash')).toBe(true);
    expect(isPublicIdRef(`${CLOUD}/v1/users/abc/covers/hash.jpg`)).toBe(false);
    expect(isPublicIdRef('/local.png')).toBe(false);
    expect(isPublicIdRef('')).toBe(false);
    expect(isPublicIdRef(null)).toBe(false);
  });
});

describe('socialImageUrl: link-preview crop', () => {
  it('builds a forced-JPEG crop for a bare public_id', () => {
    expect(socialImageUrl('users/abc/covers/hash')).toBe(`${CLOUD}/${IMG_SOCIAL}/users/abc/covers/hash`);
  });

  it('replaces a baked-in f_auto on a versioned legacy URL instead of chaining after it', () => {
    expect(socialImageUrl(`${CLOUD}/f_auto,q_auto/v1780003386/users/abc/covers/x.jpg`))
      .toBe(`${CLOUD}/${IMG_SOCIAL}/v1780003386/users/abc/covers/x.jpg`);
  });

  it('replaces chained transforms on an unversioned legacy URL', () => {
    expect(socialImageUrl(`${CLOUD}/f_auto,q_auto/w_1600,c_limit/users/abc/covers/x.jpg`))
      .toBe(`${CLOUD}/${IMG_SOCIAL}/users/abc/covers/x.jpg`);
  });

  it('never treats a folder name as a transform', () => {
    expect(socialImageUrl(`${CLOUD}/my_folder/cover.jpg`)).toBe(`${CLOUD}/${IMG_SOCIAL}/my_folder/cover.jpg`);
    expect(socialImageUrl(`${CLOUD}/f_auto/w_500`)).toBe(`${CLOUD}/${IMG_SOCIAL}/w_500`);
  });

  it('leaves signed Cloudinary and non-Cloudinary URLs unchanged', () => {
    const signed = `${CLOUD}/s--abc123--/f_auto/v1/x.jpg`;
    expect(socialImageUrl(signed)).toBe(signed);
    const supa = 'https://proj.supabase.co/storage/v1/object/public/form-assets/covers/a.jpg';
    expect(socialImageUrl(supa)).toBe(supa);
  });

  it('returns empty when there is no usable URL', () => {
    expect(socialImageUrl(null)).toBe('');
    expect(socialImageUrl('  ')).toBe('');
    expect(socialImageUrl('data:image/png;base64,AAAA')).toBe('');
  });
});
