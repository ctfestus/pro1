'use client';

import Link from 'next/link';
import { Download, Loader2, MessageSquare, Volume2, VolumeX } from 'lucide-react';
import { PersonAvatar, firstNameOf, type Person } from '@/components/ve/workplace';

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

// Hamburger -- matches the course player (tighter line spacing than lucide's Menu).
function MenuIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" className={className}>
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
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
 * The player's top bar, read as a work status bar: where you work, the simulated
 * work clock, your manager, the sound switch and how far the project is.
 */
export function WorkplaceTopBar({
  isDark, accentColor, text, muted, logoUrl, showMenu, onOpenMenu,
  company, clock, manager, onAsk, soundOn, onToggleSound, pct, saving, onDownloadDataset, datasetName,
}: {
  isDark: boolean;
  accentColor: string;
  text: string;
  muted: string;
  logoUrl?: string;
  /** Phone only: the mission list is closed, so offer the way to open it. */
  showMenu: boolean;
  onOpenMenu: () => void;
  company?: string;
  /** Simulated time of the newest message in this mission; dayIdx is the mission's day in the week. */
  clock: { day: string; time: string; dayIdx: number; dayNumber: number };
  manager: Person;
  /** Opens the ask-your-manager chat. Absent when this mission has no brief to ask about yet. */
  onAsk?: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  pct: number;
  saving: boolean;
  onDownloadDataset?: () => void;
  datasetName?: string;
}) {
  const surface = isDark ? '#1e1e1e' : '#ffffff';
  const track = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(15,23,42,0.08)';
  const iconBtn = `p-2 rounded-lg transition-colors flex-shrink-0 ${isDark ? 'hover:bg-zinc-800' : 'hover:bg-white'}`;

  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-3 sm:px-5 py-2.5"
      style={{ background: isDark ? '#141414' : '#F2F5FA', minHeight: 56 }}>
      {/* Left: menu (phone), platform logo, then the company */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {showMenu && (
          <button onClick={onOpenMenu} className={`sm:hidden ${iconBtn}`} style={{ color: muted }}
            title="Open mission list" aria-label="Open mission list">
            <MenuIcon className="w-5 h-5" />
          </button>
        )}
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

      {/* Centre (desktop): the work clock, from the same timestamps the messages use */}
      <div className="hidden lg:flex items-center gap-2.5 px-3 py-1.5 rounded-full flex-shrink-0"
        style={{ background: surface }} title={`Day ${clock.dayNumber} of the project`}>
        <span className="text-[12.5px] font-medium tabular-nums"
          style={{ color: text, fontFamily: 'var(--font-mono), ui-monospace, monospace' }}>
          {clock.day} {clock.time}
        </span>
        <span className="flex gap-[3px]" aria-hidden="true">
          {WEEK.map((d, i) => (
            <span key={d} className="rounded-sm" style={{
              width: 14, height: 4,
              background: i <= clock.dayIdx ? accentColor : track,
              opacity: i < clock.dayIdx ? 0.45 : 1,
            }} />
          ))}
        </span>
      </div>

      {/* Right: saving, dataset (phone), sound, manager, progress */}
      <div className="flex items-center justify-end gap-1 sm:gap-1.5 flex-1">
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" style={{ color: muted }} />}
        {onDownloadDataset && (
          <button onClick={onDownloadDataset} className={`sm:hidden ${iconBtn}`} style={{ color: muted }}
            title={datasetName ? `Download ${datasetName}` : 'Download dataset'} aria-label="Download dataset">
            <Download className="w-4 h-4" />
          </button>
        )}
        <button onClick={onToggleSound} className={iconBtn} style={{ color: muted }}
          title={soundOn ? 'Sound on' : 'Sound off'} aria-label={soundOn ? 'Turn sound off' : 'Turn sound on'} aria-pressed={soundOn}>
          {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
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
