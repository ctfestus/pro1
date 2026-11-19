'use client';

import { Check, Lock, X } from 'lucide-react';
import { lessonCompletionPct } from '@/lib/ve-completion';
import type { Module, Progress } from '@/components/ve/requirements/types';

type Status = 'done' | 'progress' | 'ready' | 'locked';

/** The mission's state at a glance: a tick when done, its number while open, a lock when locked. */
function StatusMarker({ status, number, accentColor, faint, isDark }: {
  status: Status; number: number; accentColor: string; faint: string; isDark: boolean;
}) {
  const base = 'w-[26px] h-[26px] rounded-full flex items-center justify-center flex-shrink-0 text-[11.5px] font-bold tabular-nums';
  if (status === 'done') {
    return <span className={base} style={{ background: accentColor, color: isDark ? '#111' : '#fff' }}><Check className="w-3.5 h-3.5" strokeWidth={3} /></span>;
  }
  if (status === 'locked') {
    return <span className={base} style={{ background: `${faint}26`, color: faint }}><Lock className="w-3 h-3" /></span>;
  }
  if (status === 'progress') {
    return <span className={base} style={{ background: accentColor, color: isDark ? '#111' : '#fff' }}>{number}</span>;
  }
  return <span className={base} style={{ background: `${faint}26`, color: faint }}>{number}</span>;
}

/**
 * The mission list: missions grouped under their modules, each with a status marker and a plain
 * status line. Locked missions say what unlocks them.
 */
export function ProjectPlan({
  isDark, accentColor, text, muted, border, role, heading, modules, progress, currentLesId, isUnlocked, onOpen,
  onCollapse,
}: {
  isDark: boolean;
  accentColor: string;
  text: string;
  muted: string;
  border: string;
  role?: string;
  /** What the learner is doing, shown under the role: "Virtual Experience" or "Course". */
  heading: string;
  modules: Module[];
  progress: Progress;
  currentLesId: string;
  /** Same rule the player uses, by position in the flattened mission list. */
  isUnlocked: (flatIdx: number) => boolean;
  onOpen: (moduleId: string, lessonId: string, flatIdx: number) => void;
  onCollapse: () => void;
}) {
  const faint = isDark ? '#6b6b6b' : '#8a929e';
  // Each mission's position in the flattened list (what isUnlocked takes) and the mission before
  // it, which is the one a locked mission waits on.
  const allLessons = modules.flatMap(m => m.lessons || []);
  const positionOf = new Map(allLessons.map((l, i) => [l.id, i]));

  return (
    <>
      <div className="flex items-start px-4 pt-4 pb-2 flex-shrink-0">
        <div className="min-w-0 flex-1">
          {role && <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] truncate" style={{ color: faint }}>{role}</p>}
          <h2 className="flex items-center gap-2 text-[17px] font-semibold leading-snug pt-0.5" style={{ color: text, fontFamily: 'var(--font-display), sans-serif' }}>
            {/* Live dot: the experience is running. Holds still under reduced motion. */}
            <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping motion-reduce:animate-none" style={{ background: accentColor }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: accentColor }} />
            </span>
            {heading}
          </h2>
        </div>
        <div className="relative group ml-2 flex-shrink-0">
          <button onClick={onCollapse} style={{ color: muted }} className="hover:opacity-60 p-1" aria-label="Collapse mission list">
            <X className="w-4 h-4" strokeWidth={2.5} />
          </button>
          {/* Tooltip below: aside has overflow:hidden so left direction is clipped */}
          <span className="pointer-events-none absolute top-full mt-1 right-0 z-50 px-2 py-1 rounded-md text-[11px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900 text-white">
            Collapse mission list
          </span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-3">
        {modules.map(mod => {
          const lessons = mod.lessons || [];
          const doneCount = lessons.filter(l => lessonCompletionPct(l, progress) === 100).length;
          return (
            <div key={mod.id} className="mt-3">
              <div className="flex items-baseline justify-between gap-2 px-2 mb-1">
                <span className="text-[11.5px] font-bold truncate" style={{ color: muted }}>{mod.title}</span>
                <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: faint }}>{doneCount} / {lessons.length}</span>
              </div>
              {lessons.map((lesson, li) => {
                const idx = positionOf.get(lesson.id) ?? 0;
                const pct = lessonCompletionPct(lesson, progress);
                const isCurr = lesson.id === currentLesId;
                const locked = !isUnlocked(idx);
                const status: Status = pct === 100 ? 'done' : locked ? 'locked' : (isCurr || pct > 0) ? 'progress' : 'ready';
                const unlocksAfter = idx > 0 ? allLessons[idx - 1].title : '';
                const hasNext = li < lessons.length - 1;
                return (
                  <button key={lesson.id}
                    onClick={() => !locked && onOpen(mod.id, lesson.id, idx)}
                    disabled={locked}
                    aria-current={isCurr ? 'step' : undefined}
                    className="relative w-full flex items-stretch gap-2.5 text-left px-2 rounded-xl transition-colors disabled:cursor-not-allowed"
                    style={{ background: isCurr ? `${accentColor}14` : 'transparent' }}>
                    {/* The line down to the next mission in this week: solid accent once this mission is
                        done, so it fills in as the learner moves forward. Drawn from just below this
                        marker to just above the next one, over the row highlight, so the selected
                        mission's background does not cut it off. Marker: 8px down, 26px tall, centred
                        8 + 13px in; 5px gap at each end. */}
                    {hasNext && (
                      <span aria-hidden="true" className="absolute pointer-events-none" style={{
                        left: 20, top: 8 + 26 + 5, bottom: -3, width: 0, zIndex: 1,
                        borderLeft: status === 'done' ? `2px solid ${accentColor}` : `2px dashed ${faint}80`,
                      }} />
                    )}
                    <span className="flex flex-col items-center flex-shrink-0 pt-2">
                      <StatusMarker status={status} number={idx + 1} accentColor={accentColor} faint={faint} isDark={isDark} />
                    </span>
                    <span className={`flex-1 min-w-0 pt-2 ${hasNext ? 'pb-4' : 'pb-2'}`} style={{ fontFamily: 'var(--font-display), sans-serif' }}>
                      <span className="block text-[13px] font-semibold leading-snug truncate"
                        style={{ color: isCurr ? accentColor : locked ? faint : text, fontFamily: "'Google Sans', 'Google Sans Text', var(--font-sans), sans-serif" }}>
                        {lesson.title}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] mt-px min-w-0"
                        style={{ color: status === 'done' ? accentColor : status === 'progress' ? text : faint, fontWeight: status === 'progress' ? 600 : 400 }}>
                        {status === 'done' && 'Done'}
                        {status === 'progress' && 'In progress'}
                        {status === 'ready' && 'Ready to start'}
                        {status === 'locked' && (
                          <span className="truncate">{unlocksAfter ? `Finish "${unlocksAfter}" first` : 'Locked'}</span>
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

    </>
  );
}
