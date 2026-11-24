'use client';

/**
 * A cover video (lib/course-schema CoverVideo). Nothing plays on its own: it shows the video's
 * still with a play button, and pressing play loads the Bunny player in its place, with sound.
 *
 * With `floatOnScroll`, a playing video whose spot scrolls out of view carries on in a small
 * player at the bottom right; scrolling back returns it. It is the same element restyled, never
 * moved in the DOM, so the iframe keeps playing instead of reloading. Closing the small player
 * stops the video.
 */

import { useEffect, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import type { CoverVideo } from '@/lib/course-schema';
import { videoLength } from '@/components/CoverVideoField';

const PLAY_PATH = 'M8 5.5v13l11-6.5z';

export function CoverVideoPlayer({ video, color, floatOnScroll = false }: { video: CoverVideo; color: string; floatOnScroll?: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [offscreen, setOffscreen] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const slot = slotRef.current;
    if (!floatOnScroll || !playing || !slot) return;
    const observer = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting), { threshold: 0.2 });
    observer.observe(slot);
    return () => observer.disconnect();
  }, [floatOnScroll, playing]);

  const floating = floatOnScroll && playing && offscreen;
  const stop = () => { setPlaying(false); setOffscreen(false); };

  return (
    <div ref={slotRef} className="relative aspect-video w-full">
      <div
        className={floating
          ? 'fixed bottom-4 right-4 z-[60] aspect-video w-[min(340px,calc(100vw-32px))] overflow-hidden rounded-[14px] bg-black'
          : 'absolute inset-0 overflow-hidden rounded-2xl bg-black'}
        style={{ boxShadow: floating ? '0 20px 50px -12px rgba(0,0,0,0.45)' : '0 24px 60px -20px rgba(0,0,0,0.55)' }}
      >
        {playing ? (
          <iframe
            src={`${video.embedUrl}?autoplay=true&preload=true&responsive=true`}
            title={video.title || 'Video'}
            className="h-full w-full border-0"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} aria-label={`Play ${video.title || 'video'}`} className="group relative block h-full w-full text-left">
            {video.thumbnail && <img src={video.thumbnail} alt="" className="h-full w-full object-cover" />}
            <span className="absolute left-1/2 top-1/2 grid h-[68px] w-[68px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white pl-1 shadow-[0_8px_24px_rgba(0,0,0,0.3)] transition-transform group-hover:scale-105" style={{ color }}>
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true"><path d={PLAY_PATH} /></svg>
            </span>
            <span className="absolute inset-x-0 bottom-0 flex h-[42px] items-center gap-2.5 px-3.5 text-xs text-white" style={{ background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.65))' }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d={PLAY_PATH} /></svg>
              <span className="h-1 flex-1 rounded-full bg-white/35" />
              {video.duration > 0 && <span>0:00 / {videoLength(video.duration)}</span>}
            </span>
          </button>
        )}
        {floating && (
          <button type="button" onClick={stop} aria-label="Close video" className="absolute right-2 top-2 grid h-[26px] w-[26px] place-items-center rounded-full text-white" style={{ background: 'rgba(0,0,0,0.55)' }}>
            <X weight="bold" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The header of a content page that has a cover video: the site's primary colour instead of the
 * cover photo, the page's own heading on the left at a reading width, and the player on the right.
 * Stacks on a phone.
 */
export function CoverVideoHero({ video, color, children }: { video: CoverVideo; color: string; children: React.ReactNode }) {
  return (
    <section className="w-full" style={{ background: color }}>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-5 py-10 sm:px-10 sm:py-14 lg:flex-row lg:items-center lg:justify-between lg:gap-16 lg:px-16 lg:py-[72px] xl:px-[160px]">
        <div className="min-w-0 lg:max-w-[540px] lg:flex-1">{children}</div>
        <div className="w-full lg:max-w-[520px] lg:flex-1">
          <CoverVideoPlayer video={video} color={color} floatOnScroll />
        </div>
      </div>
    </section>
  );
}
