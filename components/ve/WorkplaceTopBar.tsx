'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { FolderOpen, Loader2, MessageSquare } from 'lucide-react';
import { PersonAvatar, firstNameOf, localDayTime, type Person } from '@/components/ve/workplace';

// A clock store that changes once a minute, on the minute.
function subscribeMinute(onChange: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => { timer = setTimeout(() => { onChange(); schedule(); }, 60000 - (Date.now() % 60000)); };
  schedule();
  return () => clearTimeout(timer);
}
function currentMinute(): number {
  return Math.floor(Date.now() / 60000);
}

function ProgressRing({ pct, accent, track, text }: { pct: number; accent: string; track: string; text: string }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex-shrink-0" style={{ width: 34, height: 34 }} title={`Project ${pct}% done`}
      role="img" aria-label={`Project ${pct}% done`}>
      <svg width={34} height={34} viewBox="0 0 34 34" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={17} cy={17} r={r} fill="none" stroke={track} strokeWidth={3.5} />
        <circle cx={17} cy={17} r={r} fill="none" stroke={accent} strokeWidth={3.5} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} style={{ transition: 'stroke-dashoffset 0.4s' }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9.5px] font-extrabold tabular-nums" style={{ color: text }}>
        {pct}%
      </span>
    </div>
  );
}

/**
 * The player's top bar, read as a work status bar: where you work, your own day and
 * time, your files, your manager and how far the project is.
 */
export function WorkplaceTopBar({
  isDark, accentColor, text, muted, logoUrl,
  company, manager, onAsk, pct, saving, onOpenFiles, filesCount, filesNew,
}: {
  isDark: boolean;
  accentColor: string;
  text: string;
  muted: string;
  logoUrl?: string;
  company?: string;
  manager: Person;
  /** Opens the ask-your-manager chat. Absent when this mission has no brief to ask about yet. */
  onAsk?: () => void;
  pct: number;
  saving: boolean;
  /** Opens the Files drawer (desktop; phones use the tab bar). */
  onOpenFiles: () => void;
  filesCount: number;
  /** Files have arrived since the learner last opened Files: the count pulses. */
  filesNew: boolean;
}) {
  const surface = isDark ? '#1e1e1e' : '#ffffff';
  // The learner's own day and time, refreshed on the minute. Nothing on the server render: the
  // server has no idea what time it is for them.
  const minute = useSyncExternalStore(subscribeMinute, currentMinute, () => null);
  const now = minute === null ? null : new Date(minute * 60000);
  const track = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)';

  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-3 sm:px-5 py-2.5"
      style={{ background: isDark ? '#141414' : '#F2F5FA', minHeight: 56 }}>
      {/* Left: platform logo, then the company */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {logoUrl && (
          <Link href="/dashboard" className="hidden sm:flex items-center flex-shrink-0 pr-1" title="Back to dashboard">
            <img src={logoUrl} alt="" style={{ height: 22, width: 'auto', objectFit: 'contain' }} />
          </Link>
        )}
        {company && (
          <div className="flex items-center gap-2.5 min-w-0">
            {logoUrl && <span className="hidden sm:block flex-shrink-0" style={{ width: 1, height: 18, background: track }} aria-hidden="true" />}
            <span className="text-[14px] font-bold truncate" style={{ color: text }}>{company}</span>
          </div>
        )}
      </div>

      {/* Centre (desktop): the learner's own day and time */}
      {now && (
        <div className="hidden lg:flex items-center px-3.5 py-1.5 rounded-full flex-shrink-0" style={{ background: surface }}>
          <span className="text-[12.5px] font-medium tabular-nums" style={{ color: text, fontFamily: 'var(--font-mono), ui-monospace, monospace' }}>
            {localDayTime(now)}
          </span>
        </div>
      )}

      {/* Right: saving, files (desktop), manager, progress */}
      <div className="flex items-center justify-end gap-1 sm:gap-1.5 flex-1">
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" style={{ color: muted }} />}
        <button onClick={onOpenFiles}
          className="hidden sm:inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-full transition-opacity hover:opacity-80 flex-shrink-0"
          style={{ background: isDark ? '#1e1e1e' : '#ffffff', color: text }}
          title="Everything shared with you and everything you sent">
          <FolderOpen className="w-3.5 h-3.5" style={{ color: muted }} /> Files
          {filesCount > 0 && (
            <span className="relative flex">
              {filesNew && (
                <span className="absolute inset-0 rounded-full animate-ping motion-reduce:animate-none" style={{ background: accentColor, opacity: 0.5 }} aria-hidden="true" />
              )}
              <span className="relative min-w-[18px] h-[18px] px-1 rounded-full text-[10.5px] font-bold flex items-center justify-center tabular-nums"
                style={{ background: accentColor, color: isDark ? '#111' : '#fff' }}>{filesCount}</span>
            </span>
          )}
        </button>
        {onAsk && (
          <button onClick={onAsk}
            className="hidden sm:inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 py-1.5 rounded-full transition-opacity hover:opacity-80 flex-shrink-0"
            style={{ background: `${accentColor}14`, color: accentColor }}>
            <MessageSquare className="w-3.5 h-3.5" /> Ask {firstNameOf(manager.name)}
          </button>
        )}
        <div className="px-1 flex-shrink-0">
          <PersonAvatar {...manager} size={30} presence="active" isDark={isDark} />
        </div>
        <ProgressRing pct={pct} accent={accentColor} track={track} text={text} />
      </div>
    </div>
  );
}
