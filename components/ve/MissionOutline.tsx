'use client';

/**
 * The experience's missions before it starts, drawn like the player's mission list (week groups,
 * numbered markers, a dashed line between missions) so a learner recognises it once inside.
 * Read-only. A locked preview carries titles only, so every field past the title is optional.
 */
export function MissionOutline({ modules, isDark, text, muted }: {
  modules: Array<{ id: string; title?: string; lessons?: Array<{ id: string; title?: string; requirements?: unknown[] }> }>;
  isDark: boolean;
  text: string;
  muted: string;
}) {
  const faint = isDark ? '#6b6b6b' : '#8a929e';
  let n = 0;
  const numbered = modules.map(mod => ({
    ...mod,
    lessons: (mod.lessons || []).map(les => ({ ...les, number: ++n })),
  }));

  return (
    <div className="flex flex-col gap-4">
      {numbered.map(mod => (
        <div key={mod.id}>
          <div className="flex items-baseline justify-between gap-2 mb-1.5">
            <span className="text-[12px] font-bold truncate" style={{ color: muted }}>{mod.title}</span>
            <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: faint }}>
              {mod.lessons.length} {mod.lessons.length === 1 ? 'mission' : 'missions'}
            </span>
          </div>
          {mod.lessons.map((les, li) => {
            const tasks = les.requirements?.length || 0;
            const hasNext = li < mod.lessons.length - 1;
            return (
              <div key={les.id} className="flex items-stretch gap-3">
                <span className="flex flex-col items-center flex-shrink-0">
                  <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[11.5px] font-bold tabular-nums"
                    style={{ background: `${faint}26`, color: isDark ? '#c4c4c4' : '#4b5563' }}>
                    {les.number}
                  </span>
                  {hasNext && <span aria-hidden="true" style={{ flex: 1, width: 0, minHeight: 10, marginTop: 4, borderLeft: `2px dashed ${faint}80` }} />}
                </span>
                <span className={`min-w-0 flex-1 pt-[3px] ${hasNext ? 'pb-4' : 'pb-1'}`} style={{ fontFamily: 'var(--font-display), sans-serif' }}>
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
