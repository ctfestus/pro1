'use client';

import { useState } from 'react';
import { CaretDown } from '@phosphor-icons/react';

/**
 * The experience's missions before it starts, drawn like the player's mission list (week groups,
 * numbered markers, a dashed line between missions) so a learner recognises it once inside.
 * Read-only. A locked preview carries titles only, so every field past the title is optional.
 *
 * Each titled group is its own soft panel with a header that folds it, so a long outline reads as
 * a stack of sections rather than one long list. With more than two groups only the first starts
 * open. Numbers keep counting through a folded group. The course overview uses it for its outline.
 */
export function MissionOutline({ modules, isDark, text, muted, itemWord = 'lesson' }: {
  modules: Array<{ id: string; title?: string; lessons?: Array<{ id: string; title?: string; requirements?: unknown[] }> }>;
  isDark: boolean;
  text: string;
  muted: string;
  /** What a group counts in its header. */
  itemWord?: string;
}) {
  const faint = isDark ? '#6b6b6b' : '#8a929e';
  const panel = isDark ? 'rgba(255,255,255,0.04)' : '#f5f6f8';
  const [collapsed, setCollapsed] = useState<Set<string>>(() => (
    modules.length > 2 ? new Set(modules.slice(1).map(m => m.id)) : new Set()
  ));
  const toggle = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  let n = 0;
  const numbered = modules.map(mod => ({
    ...mod,
    lessons: (mod.lessons || []).map(les => ({ ...les, number: ++n })),
  }));

  return (
    <div className="flex flex-col gap-2.5">
      {numbered.map(mod => {
        const open = !mod.title || !collapsed.has(mod.id);
        return (
          <div key={mod.id} className="rounded-xl" style={{ background: panel }}>
            {mod.title && (
              <button type="button" onClick={() => toggle(mod.id)} aria-expanded={open}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left">
                <span className="truncate text-[14px] font-semibold" style={{ color: text, fontFamily: 'var(--font-display), sans-serif' }}>{mod.title}</span>
                <span className="flex flex-shrink-0 items-center gap-2 text-xs" style={{ color: faint }}>
                  {mod.lessons.length} {itemWord}{mod.lessons.length === 1 ? '' : 's'}
                  <CaretDown weight="bold" className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
                </span>
              </button>
            )}
            {open && (
              <div className={`px-4 pb-3 ${mod.title ? '' : 'pt-3'}`}>
                {mod.lessons.map((les, li) => {
                  const tasks = les.requirements?.length || 0;
                  const hasNext = li < mod.lessons.length - 1;
                  return (
                    <div key={les.id} className="flex items-stretch gap-3">
                      <span className="flex flex-col items-center flex-shrink-0">
                        <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-xs font-bold tabular-nums"
                          style={{ background: `${faint}26`, color: isDark ? '#c4c4c4' : '#4b5563' }}>
                          {les.number}
                        </span>
                        {/* Stops short of both circles, the same gap at each end. */}
                        {hasNext && <span aria-hidden="true" style={{ flex: 1, width: 0, minHeight: 18, marginTop: 5, marginBottom: 5, borderLeft: `2px dashed ${faint}80` }} />}
                      </span>
                      <span className={`min-w-0 flex-1 pt-[3px] ${hasNext ? 'pb-5' : 'pb-1'}`} style={{ fontFamily: 'var(--font-display), sans-serif' }}>
                        <span className="block text-[14px] font-semibold leading-snug" style={{ color: text }}>{les.title}</span>
                        {tasks > 0 && (
                          <span className="block text-xs mt-0.5" style={{ color: faint }}>{tasks === 1 ? '1 task' : `${tasks} tasks`}</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
