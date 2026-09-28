export const APPLICATION_COVER_TARGET = {
  width: 768,
  height: 224,
  pixelRatio: 2,
  recommendedWidth: 1600,
  recommendedHeight: 500,
  maximumZoom: 2.5,
} as const;

export interface ApplicationCoverQuality {
  maximumSharpZoom: number;
  sharpAtBaseSize: boolean;
}

export function applicationCoverQuality(width: number, height: number): ApplicationCoverQuality {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { maximumSharpZoom: 1, sharpAtBaseSize: false };
  }
  const coverScale = Math.max(APPLICATION_COVER_TARGET.width / width, APPLICATION_COVER_TARGET.height / height);
  const availableZoom = 1 / coverScale / APPLICATION_COVER_TARGET.pixelRatio;
  const maximumSharpZoom = Math.min(
    APPLICATION_COVER_TARGET.maximumZoom,
    Math.max(1, Math.floor(availableZoom * 20) / 20),
  );
  return { maximumSharpZoom, sharpAtBaseSize: availableZoom >= 1 };
}

export function highQualityApplicationCoverUrl(url: string): string {
  if (!url.includes('res.cloudinary.com') || !url.includes('/upload/')) return url;
  return url.replace(/q_auto(?=[,/]|$)/, 'q_auto:best');
}
