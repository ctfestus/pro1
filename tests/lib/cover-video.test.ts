import { describe, expect, it } from 'vitest';
import { normalizeCoverVideo } from '@/lib/course-schema';

describe('normalizeCoverVideo', () => {
  const picked = {
    embedUrl: 'https://iframe.mediadelivery.net/embed/123/abc-def?autoplay=false',
    thumbnail: 'https://vz-1.b-cdn.net/abc-def/thumbnail_1.jpg',
    title: 'Introduction to projects',
    duration: 568.4,
  };

  it('keeps a Bunny player link without its query, the https still, the title and whole seconds', () => {
    expect(normalizeCoverVideo(picked)).toEqual({
      embedUrl: 'https://iframe.mediadelivery.net/embed/123/abc-def',
      thumbnail: 'https://vz-1.b-cdn.net/abc-def/thumbnail_1.jpg',
      title: 'Introduction to projects',
      duration: 568,
    });
  });

  it('reads anything that is not a Bunny player link as no video', () => {
    expect(normalizeCoverVideo({ ...picked, embedUrl: 'https://example.com/embed/1/2' })).toBeNull();
    expect(normalizeCoverVideo({ ...picked, embedUrl: 'http://iframe.mediadelivery.net/embed/1/2' })).toBeNull();
    expect(normalizeCoverVideo({ ...picked, embedUrl: 'javascript:alert(1)' })).toBeNull();
    expect(normalizeCoverVideo({ ...picked, embedUrl: 'https://iframe.mediadelivery.net/play/1/2' })).toBeNull();
    expect(normalizeCoverVideo(null)).toBeNull();
    expect(normalizeCoverVideo('https://iframe.mediadelivery.net/embed/1/2')).toBeNull();
  });

  it('drops a still that is not https and a length that is not a positive number', () => {
    expect(normalizeCoverVideo({ ...picked, thumbnail: 'javascript:alert(1)', duration: -3 })).toMatchObject({ thumbnail: null, duration: 0 });
  });
});
