import { describe, expect, it } from 'vitest';
import { applicationCoverQuality, highQualityApplicationCoverUrl } from '@/lib/application-cover';

describe('application cover quality', () => {
  it('limits zoom to the sharp range of the original image', () => {
    expect(applicationCoverQuality(800, 250)).toEqual({ maximumSharpZoom: 1, sharpAtBaseSize: false });
    expect(applicationCoverQuality(1600, 500)).toEqual({ maximumSharpZoom: 1, sharpAtBaseSize: true });
    expect(applicationCoverQuality(2400, 750).maximumSharpZoom).toBe(1.55);
    expect(applicationCoverQuality(4000, 1250).maximumSharpZoom).toBe(2.5);
  });

  it('requests the best automatic Cloudinary quality without changing other sources', () => {
    expect(highQualityApplicationCoverUrl('https://res.cloudinary.com/demo/image/upload/f_auto,q_auto/sample.webp')).toContain('q_auto:best');
    expect(highQualityApplicationCoverUrl('https://images.pexels.com/photos/example.jpeg')).toBe('https://images.pexels.com/photos/example.jpeg');
  });
});
