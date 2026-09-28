import type { CSSProperties } from 'react';
import type { ApplicationFormConfig, ApplicationImageFrame } from '@/lib/application-forms';

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

export interface ResolvedApplicationImageFrame {
  fit: 'cover' | 'contain';
  positionX: number;
  positionY: number;
  zoom: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Fills defaults and caps zoom at what the image can show without going soft. */
export function resolveApplicationImageFrame(
  frame: ApplicationImageFrame,
  maximumSharpZoom: number = APPLICATION_COVER_TARGET.maximumZoom,
): ResolvedApplicationImageFrame {
  return {
    fit: frame.fit ?? 'cover',
    positionX: clamp(frame.positionX ?? 50, 0, 100),
    positionY: clamp(frame.positionY ?? 50, 0, 100),
    zoom: clamp(frame.zoom ?? 1, 1, maximumSharpZoom),
  };
}

/** Styles for the img inside a frame. Only the display changes; the original file is never cropped. */
export function applicationImageStyle(frame: ResolvedApplicationImageFrame): CSSProperties {
  const cropped = frame.fit === 'cover';
  return {
    objectFit: frame.fit,
    objectPosition: `${frame.positionX}% ${frame.positionY}%`,
    transform: cropped ? `scale(${frame.zoom})` : 'none',
    transformOrigin: `${frame.positionX}% ${frame.positionY}%`,
  };
}

type CoverFields = Pick<ApplicationFormConfig, 'coverImageFit' | 'coverImagePosition' | 'coverImagePositionX' | 'coverImagePositionY' | 'coverImageZoom'>;

/** The cover keeps its frame in flat config fields, plus a legacy top/center/bottom position. */
export function applicationCoverFrame(config: CoverFields): ApplicationImageFrame {
  const legacyY = config.coverImagePosition === 'top' ? 0 : config.coverImagePosition === 'bottom' ? 100 : 50;
  return {
    fit: config.coverImageFit,
    positionX: config.coverImagePositionX,
    positionY: config.coverImagePositionY ?? legacyY,
    zoom: config.coverImageZoom,
  };
}

export function applicationCoverFramePatch(patch: ApplicationImageFrame): Partial<ApplicationFormConfig> {
  return {
    ...('fit' in patch ? { coverImageFit: patch.fit } : {}),
    ...('positionX' in patch ? { coverImagePositionX: patch.positionX } : {}),
    ...('positionY' in patch ? { coverImagePositionY: patch.positionY } : {}),
    ...('zoom' in patch ? { coverImageZoom: patch.zoom } : {}),
  };
}
