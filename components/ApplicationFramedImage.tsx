'use client';

import { useState, type CSSProperties } from 'react';
import type { ApplicationImageFrame } from '@/lib/application-forms';
import {
  applicationCoverQuality,
  applicationImageStyle,
  highQualityApplicationCoverUrl,
  resolveApplicationImageFrame,
} from '@/lib/application-cover';

/**
 * An image shown in a fixed frame with the saved crop, position, and zoom. Used for the form
 * cover and for image blocks, so both render identically. Zoom stays at 100% until the image
 * loads and its real resolution shows how far it can be enlarged while staying sharp.
 */
export function ApplicationFramedImage({ src, alt, frame, className = '', style }: {
  src: string;
  alt: string;
  frame: ApplicationImageFrame;
  className?: string;
  style?: CSSProperties;
}) {
  const displaySrc = highQualityApplicationCoverUrl(src);
  const [loaded, setLoaded] = useState<{ src: string; maximumSharpZoom: number } | null>(null);
  const maximumSharpZoom = loaded?.src === displaySrc ? loaded.maximumSharpZoom : 1;
  return (
    <div className={`overflow-hidden ${className}`} style={style}>
      <img
        src={displaySrc}
        alt={alt}
        onLoad={event => setLoaded({ src: displaySrc, maximumSharpZoom: applicationCoverQuality(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight).maximumSharpZoom })}
        className="h-full w-full"
        style={applicationImageStyle(resolveApplicationImageFrame(frame, maximumSharpZoom))}
      />
    </div>
  );
}
