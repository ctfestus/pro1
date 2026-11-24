'use client';

/**
 * The "Cover video" field in the course, virtual experience, certification and learning path
 * editors. Picks a video from the Bunny library (the same picker lessons use) and shows it as a
 * still, its title and its length, with Replace and Remove.
 */

import { useMemo, useState } from 'react';
import { PlayCircle } from '@phosphor-icons/react';
import { DARK_C, useC } from '@/lib/theme';
import { normalizeCoverVideo, type CoverVideo } from '@/lib/course-schema';
import { BunnyPicker } from '@/components/create/ve/BunnyPicker';
import { btnSmClass, btnStyle } from '@/components/dashboard/subscriptions/ui';

/** 568 -> "9:28", 3725 -> "1:02:05". */
export function videoLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
}

export function CoverVideoField({ value, onChange, noun }: { value: CoverVideo | null | undefined; onChange: (video: CoverVideo | null) => void; noun: string }) {
  const theme = useC();
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const [picking, setPicking] = useState(false);

  return (
    <div>
      <h3 className="text-base font-semibold" style={{ color: C.text }}>Cover video</h3>
      <p className="mt-1 text-xs" style={{ color: C.faint }}>Optional. Plays when someone presses play on the {noun} page or its card.</p>
      <div className="mt-3">
        {value ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl p-3" style={{ boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
            {value.thumbnail
              ? <img src={value.thumbnail} alt="" className="aspect-video w-28 flex-shrink-0 rounded-lg object-cover" />
              : <span className="grid aspect-video w-28 flex-shrink-0 place-items-center rounded-lg" style={{ background: C.page, color: C.faint }}><PlayCircle className="h-6 w-6" weight="duotone" /></span>}
            <span className="min-w-0 flex-1">
              <b className="block truncate text-sm" style={{ color: C.text }}>{value.title || 'Video'}</b>
              {value.duration > 0 && <span className="text-xs" style={{ color: C.muted }}>{videoLength(value.duration)}</span>}
            </span>
            <button type="button" onClick={() => setPicking(true)} className={btnSmClass} style={btnStyle('sec', C)}>Replace</button>
            <button type="button" onClick={() => onChange(null)} className={btnSmClass} style={btnStyle('danger', C)}>Remove</button>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center rounded-xl" style={{ boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
            <button type="button" onClick={() => setPicking(true)} className={btnSmClass} style={btnStyle('pri', C)}>Choose from video library</button>
          </div>
        )}
      </div>
      {picking && (
        <BunnyPicker C={C} onClose={() => setPicking(false)}
          onPick={(embedUrl, video) => {
            // Library titles are file names ("Intro.mp4"); the extension means nothing to a learner.
            onChange(normalizeCoverVideo({ embedUrl, thumbnail: video.thumbnail, title: video.title.replace(/\.(mp4|mov|m4v|webm|mkv|avi)$/i, ''), duration: video.duration }));
            setPicking(false);
          }} />
      )}
    </div>
  );
}
