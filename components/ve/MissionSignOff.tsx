'use client';

import { CaretRight, CircleNotch, Trophy, X } from '@phosphor-icons/react';
import { firstNameOf } from '@/components/ve/workplace';

/**
 * The way on from a finished mission: the next brief, or on the last mission, finishing the project.
 */
export function MissionSignOff({
  isDark, accentColor, nextTitle, onNext, canFinish, finishing, onFinish,
}: {
  isDark: boolean;
  accentColor: string;
  /** Title of the next mission; absent on the last one. */
  nextTitle?: string;
  onNext: () => void;
  /** Last mission only: every mission's work is done, so the project can be finished. */
  canFinish: boolean;
  finishing: boolean;
  onFinish: () => void;
}) {
  const btn = 'inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-[13.5px] transition-all hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed';
  const btnStyle = { background: accentColor, color: isDark ? '#111' : '#fff' };

  return (
    <div className="px-4 sm:px-8 py-5" style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
      {nextTitle ? (
        <button onClick={onNext} className={btn} style={btnStyle}>
          Open next brief <CaretRight weight="bold" className="w-4 h-4" />
        </button>
      ) : (
        <button onClick={onFinish} disabled={!canFinish || finishing} className={btn} style={btnStyle}>
          {finishing ? <CircleNotch weight="bold" className="w-4 h-4 animate-spin" /> : <Trophy weight="duotone" className="w-4 h-4" />} Finish the project
        </button>
      )}
    </div>
  );
}

/** Shown once when a learner comes back to an unfinished experience: where they stopped and what is waiting. */
export function WelcomeBack({ studentName, missionTitle, left, isDark, accentColor, text, muted, onClose }: {
  studentName: string;
  missionTitle: string;
  /** Things still owed in this mission. */
  left: number;
  isDark: boolean;
  accentColor: string;
  text: string;
  muted: string;
  onClose: () => void;
}) {
  const first = firstNameOf(studentName);
  return (
    <div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{ background: isDark ? '#1e1e1e' : '#ffffff' }} role="status">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: accentColor }} />
      <p className="flex-1 min-w-0 text-[13px] leading-snug" style={{ color: text }}>
        <b className="font-semibold">Welcome back{first ? `, ${first}` : ''}.</b>{' '}
        You stopped at &quot;{missionTitle}&quot;.{' '}
        {left === 0 ? 'Everything in it is done.' : left === 1 ? '1 thing left in this mission.' : `${left} things left in this mission.`}
      </p>
      <button onClick={onClose} aria-label="Close" className="p-1 rounded-md flex-shrink-0 transition-opacity hover:opacity-70" style={{ color: muted }}>
        <X weight="bold" className="w-4 h-4" />
      </button>
    </div>
  );
}
