'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { HTML_EMBED_SANDBOX } from '@/lib/safe-embed-url';

/**
 * Player-side frame for interactive HTML embeds (see lib/safe-embed-url).
 * Keeps the sandbox that isolates instructor HTML from the app session, and
 * adds a full-screen toggle so landscape dashboards get the whole viewport
 * even when the surrounding content column is narrow. The toggle fullscreens
 * the wrapper div (parent-owned DOM), so it works regardless of the iframe
 * sandbox. It sits in a small bar above the frame, so it never covers the
 * tool's own content. The bar uses neutral tones because the frame is shared
 * by players on light and dark cards.
 */
export function HtmlEmbedFrame({ src, height = '80vh' }: { src: string; height?: number | string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void wrapRef.current?.requestFullscreen();
  };

  return (
    <div
      ref={wrapRef}
      style={{
        display: 'flex', flexDirection: 'column',
        ...(isFullscreen ? { height: '100%', background: '#fff', padding: 12, color: '#111' } : {}),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(128,128,128,0.95)' }}>
          Interactive tool
        </span>
        <button
          type="button"
          onClick={toggle}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 11px', borderRadius: 9, border: 'none', cursor: 'pointer',
            fontSize: 12.5, fontWeight: 600, color: 'inherit',
            background: 'rgba(128,128,128,0.14)',
          }}
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          {isFullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
      <div style={{ height: isFullscreen ? undefined : height, flex: isFullscreen ? 1 : undefined, minHeight: 0, background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 0 0 1px rgba(128,128,128,0.18)' }}>
        <iframe
          src={src}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
          sandbox={HTML_EMBED_SANDBOX}
          allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      </div>
    </div>
  );
}
