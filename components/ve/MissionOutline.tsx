'use client';

import { ChevronDown } from 'lucide-react';

/**
 * The experience's missions before it starts, drawn like the player's mission list (week groups,
 * numbered markers, a dashed line between missions) so a learner recognises it once inside.
 * Read-only. A locked preview carries titles only, so every field past the title is optional.
 *
 * The course overview draws its outline the same way, with groups that fold: pass `collapsed` and
 * `onToggle`. Numbers keep counting through a folded group.
 */
export function MissionOutline({ modules, isDark, text, muted, divider, collapsed, onToggle, itemWord = 'lesson' }: {
  modules: Array<{ id: string; title?: string; lessons?: Array<{ id: string; title?: string; requirements?: unknown[] }> }>;
  isDark: boolean;
  text: string;
  muted: string;
  /** Hairline between weeks. */
  divider: string;
  collapsed?: Set<string>;
  onToggle?: (groupId: string) => void;
  /** What a group counts in its folding header. */
  itemWord?: string;
}) {
  const faint = isDark ? '#6b6b6b' : '#8a929e';
  let n = 0;
  const numbered = modules.map(mod => ({
    ...mod,
    lessons: (mod.lessons || []).map(les => ({ ...les, number: ++n })),
  }));

  return (
    <div className="flex flex-col">
      {numbered.map((mod, mi) => (
        <div key={mod.id} style={mi ? { borderTop: `1px solid ${divider}`, marginTop: 14, paddingTop: 16 } : undefined}>
          {onToggle && mod.title ? (
            <button type="button" onClick={() => onToggle(mod.id)} aria-expanded={!collapsed?.has(mod.id)}
              className="mb-2.5 flex w-full items-center justify-between gap-3 text-left">
              <span className="truncate text-[10.5px] font-bold uppercase tracking-[0.1em]" style={{ color: muted }}>{mod.title}</span>
              <span className="flex flex-shrink-0 items-center gap-1.5 text-[11.5px]" style={{ color: faint }}>
                {mod.lessons.length} {itemWord}{mod.lessons.length === 1 ? '' : 's'}
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapsed?.has(mod.id) ? '-rotate-90' : ''}`} />
              </span>
            </button>
          ) : mod.title ? (
            <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] truncate mb-2.5" style={{ color: muted }}>{mod.title}</p>
          ) : null}
          {!collapsed?.has(mod.id) && mod.lessons.map((les, li) => {
            const tasks = les.requirements?.length || 0;
            const hasNext = li < mod.lessons.length - 1;
            return (
              <div key={les.id} className="flex items-stretch gap-3">
                <span className="flex flex-col items-center flex-shrink-0">
                  <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[11.5px] font-bold tabular-nums"
                    style={{ background: `${faint}26`, color: isDark ? '#c4c4c4' : '#4b5563' }}>
                    {les.number}
                  </span>
                  {/* Stops short of both circles, the same gap at each end. */}
                  {hasNext && <span aria-hidden="true" style={{ flex: 1, width: 0, minHeight: 18, marginTop: 5, marginBottom: 5, borderLeft: `2px dashed ${faint}80` }} />}
                </span>
                <span className={`min-w-0 flex-1 pt-[3px] ${hasNext ? 'pb-6' : 'pb-1'}`} style={{ fontFamily: 'var(--font-display), sans-serif' }}>
                  <span className="block text-[14px] font-semibold leading-snug" style={{ color: text }}>{les.title}</span>
                  {tasks > 0 && (
                    <span className="block text-[11.5px] mt-0.5" style={{ color: faint }}>{tasks === 1 ? '1 task' : `${tasks} tasks`}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
