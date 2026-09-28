import { describe, expect, it } from 'vitest';
import {
  applicationCoverFrame,
  applicationCoverFramePatch,
  applicationCoverQuality,
  applicationImageStyle,
  highQualityApplicationCoverUrl,
  resolveApplicationImageFrame,
} from '@/lib/application-cover';

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

  it('resolves a shared image frame with defaults and caps zoom at the sharp limit', () => {
    expect(resolveApplicationImageFrame({})).toEqual({ fit: 'cover', positionX: 50, positionY: 50, zoom: 1 });
    expect(resolveApplicationImageFrame({ positionX: 140, positionY: -5, zoom: 2 }, 1.5)).toEqual({ fit: 'cover', positionX: 100, positionY: 0, zoom: 1.5 });
    expect(applicationImageStyle({ fit: 'cover', positionX: 20, positionY: 80, zoom: 1.4 })).toEqual({
      objectFit: 'cover', objectPosition: '20% 80%', transform: 'scale(1.4)', transformOrigin: '20% 80%',
    });
    expect(applicationImageStyle({ fit: 'contain', positionX: 50, positionY: 50, zoom: 2 }).transform).toBe('none');
  });

  it('maps the cover fields to and from a frame, keeping the legacy vertical position', () => {
    expect(applicationCoverFrame({ coverImagePosition: 'bottom' }).positionY).toBe(100);
    expect(applicationCoverFrame({ coverImagePosition: 'top', coverImagePositionY: 30 }).positionY).toBe(30);
    expect(applicationCoverFramePatch({ positionX: 10, zoom: 1.2 })).toEqual({ coverImagePositionX: 10, coverImageZoom: 1.2 });
    expect(applicationCoverFramePatch({ fit: 'contain' })).toEqual({ coverImageFit: 'contain' });
  });
});
