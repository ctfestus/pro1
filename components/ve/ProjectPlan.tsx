'use client';

import { Check, Download, Lock, X } from 'lucide-react';
import { lessonCompletionPct } from '@/lib/ve-completion';
import { initialsOf, type Person } from '@/components/ve/workplace';
import type { Dataset, Module, Progress } from '@/components/ve/requirements/types';

type Status = 'done' | 'progress' | 'ready' | 'locked';

function ManagerDot({ manager, size, faded }: { manager: Person; size: number; faded: boolean }) {
  const style = { width: size, height: size, opacity: faded ? 0.45 : 1 };
  if (manager.avatarUrl) {
    return <img src={manager.avatarUrl} alt="" className="rounded-full object-cover flex-shrink-0" style={style} />;
  }
  return (
    <span className="rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white"
      style={{ ...style, background: manager.color, fontSize: Math.round(size * 0.36) }}>
      {initialsOf(manager.name)}
    </span>
  );
}

/**
 * The mission list: missions grouped under their modules, each with who
 * it comes from and a plain status. Locked missions say what unlocks them.
 */
export function ProjectPlan({
  isDark, accentColor, text, muted, border, role, heading, modules, progress, currentLesId, isUnlocked, onOpen,
  manager, dataset, onDownloadDataset, onCollapse,
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
  manager: Person;
  dataset?: Dataset;
  onDownloadDataset: () => void;
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
          <h2 className="text-[17px] font-semibold leading-snug pt-0.5" style={{ color: text, fontFamily: 'var(--font-display), sans-serif' }}>
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
              {lessons.map(lesson => {
                const idx = positionOf.get(lesson.id) ?? 0;
                const pct = lessonCompletionPct(lesson, progress);
                const isCurr = lesson.id === currentLesId;
                const locked = !isUnlocked(idx);
                const status: Status = pct === 100 ? 'done' : locked ? 'locked' : (isCurr || pct > 0) ? 'progress' : 'ready';
                const unlocksAfter = idx > 0 ? allLessons[idx - 1].title : '';
                return (
                  <button key={lesson.id}
                    onClick={() => !locked && onOpen(mod.id, lesson.id, idx)}
                    disabled={locked}
                    aria-current={isCurr ? 'step' : undefined}
                    className="w-full flex items-center gap-2.5 text-left px-2 py-2 rounded-xl transition-colors disabled:cursor-not-allowed"
                    style={{ background: isCurr ? `${accentColor}14` : 'transparent' }}>
                    <ManagerDot manager={manager} size={26} faded={locked} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-semibold leading-snug truncate"
                        style={{ color: isCurr ? accentColor : locked ? faint : text }}>
                        {lesson.title}
                      </span>
                      <span className="flex items-center gap-1 text-[11px] mt-px min-w-0"
                        style={{ color: status === 'done' ? accentColor : status === 'progress' ? text : faint, fontWeight: status === 'progress' ? 600 : 400 }}>
                        {status === 'done' && <><Check className="w-3 h-3 flex-shrink-0" strokeWidth={3} /> Done</>}
                        {status === 'progress' && 'In progress'}
                        {status === 'ready' && 'Ready to start'}
                        {status === 'locked' && (
                          <>
                            <Lock className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{unlocksAfter ? `Finish "${unlocksAfter}" first` : 'Locked'}</span>
                          </>
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

      {dataset && (
        <div className="px-3 py-3 border-t flex-shrink-0" style={{ borderColor: border }}>
          <button onClick={onDownloadDataset}
            className="w-full flex items-center gap-2 text-xs font-semibold py-2 px-3 rounded-xl transition-all hover:opacity-80"
            style={{ background: `${accentColor}18`, color: accentColor }}>
            <Download className="w-3.5 h-3.5" />
            <span className="truncate">{dataset.filename || 'Download file'}</span>
          </button>
          {dataset.description && <p className="text-[11px] mt-1.5 px-1" style={{ color: muted }}>{dataset.description}</p>}
        </div>
      )}
    </>
  );
}
