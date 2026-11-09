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
 * sandbox. Bottom-right placement keeps it off embedded top toolbars.
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
    <div ref={wrapRef} style={{ position: 'relative', height: isFullscreen ? '100%' : height, background: '#fff' }}>
      <iframe
        src={src}
        style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        sandbox={HTML_EMBED_SANDBOX}
        allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
      <button
        type="button"
        onClick={toggle}
        title={isFullscreen ? 'Exit full screen' : 'View full screen'}
        style={{
          position: 'absolute', bottom: 12, right: 12, width: 34, height: 34,
          borderRadius: 9, border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(17,19,18,0.55)', color: '#fff',
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(17,19,18,0.8)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(17,19,18,0.55)'; }}
      >
        {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
    </div>
  );
}
