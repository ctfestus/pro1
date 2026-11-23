'use client';

import { CaretRight, CircleNotch, Trophy, X } from '@phosphor-icons/react';
import { PersonAvatar, firstNameOf, type Person } from '@/components/ve/workplace';

/**
 * The manager closing a finished mission: a short word and the way on. On the last mission the
 * way on is finishing the project.
 */
export function MissionSignOff({
  manager, studentName, isDark, accentColor, text, nextTitle, onNext, canFinish, finishing, onFinish, readingOnly = false,
}: {
  manager: Person;
  studentName: string;
  isDark: boolean;
  accentColor: string;
  text: string;
  /** Title of the next mission; absent on the last one. */
  nextTitle?: string;
  onNext: () => void;
  /** Last mission only: every mission's work is done, so the project can be finished. */
  canFinish: boolean;
  finishing: boolean;
  onFinish: () => void;
  /** The mission is only something to read, so there is no work to praise yet. */
  readingOnly?: boolean;
}) {
  const first = firstNameOf(studentName) || 'there';
  const btn = 'inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-[13.5px] transition-all hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed';
  const btnStyle = { background: accentColor, color: isDark ? '#111' : '#fff' };

  return (
    <div className="flex gap-3 px-4 sm:px-8 py-5" style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}` }}>
      <PersonAvatar {...manager} size={34} presence="active" isDark={isDark} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold" style={{ color: text }}>{manager.name}</p>
        {readingOnly && nextTitle ? (
          <p className="text-[14px] leading-relaxed mt-0.5" style={{ color: text }}>
            When you have read this, {first}, your next brief is ready: <b className="font-semibold">{nextTitle}</b>.
          </p>
        ) : readingOnly && canFinish ? (
          <p className="text-[14px] leading-relaxed mt-0.5" style={{ color: text }}>
            When you have read this, {first}, finish the project to see your results.
          </p>
        ) : nextTitle ? (
          <p className="text-[14px] leading-relaxed mt-0.5" style={{ color: text }}>
            Good work on this, {first}. Your next brief is ready: <b className="font-semibold">{nextTitle}</b>.
          </p>
        ) : canFinish ? (
          <p className="text-[14px] leading-relaxed mt-0.5" style={{ color: text }}>
            Good work, {first}. That was the last mission. Finish the project to see your results.
          </p>
        ) : (
          <p className="text-[14px] leading-relaxed mt-0.5" style={{ color: text }}>
            Good work on this one, {first}. Some earlier missions still have work left before the project can be finished.
          </p>
        )}
        <div className="mt-3">
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
      </div>
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
