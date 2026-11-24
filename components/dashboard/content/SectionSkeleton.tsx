'use client';

// The loading shape of an admin section: page header, stat cards, search row, then either cover
// cards (content pages) or list rows (list pages). Bars use the theme's skeleton colour; the
// pulse stops when the viewer asks for reduced motion.

import type { ThemeColors } from '@/lib/theme';

function Bar({ C, className = '', light = false }: { C: ThemeColors; className?: string; light?: boolean }) {
  return <div className={`rounded-lg ${className}`} style={{ background: C.skeleton, opacity: light ? 0.6 : 1 }} />;
}

export function SectionSkeleton({ C, shape, stats = 3, header = true }: {
  C: ThemeColors;
  shape: 'cards' | 'rows';
  stats?: number;
  /** Leave out when the section already shows its real page header while it loads. */
  header?: boolean;
}) {
  return (
    <div className="grid gap-5 animate-pulse motion-reduce:animate-none" aria-hidden="true">
      {header && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-2">
            <Bar C={C} className="h-8 w-48" />
            <Bar C={C} className="h-3.5 w-72 max-w-[70vw]" light />
          </div>
          <Bar C={C} className="h-10 w-36 rounded-xl" />
        </div>
      )}

      {stats > 0 && (
        <div className={`grid gap-3 ${stats === 4 ? 'grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
          {Array.from({ length: stats }).map((_, i) => (
            <div key={i} className="rounded-2xl p-4 grid gap-2.5" style={{ background: C.card }}>
              <Bar C={C} className="h-8 w-10" />
              <Bar C={C} className="h-3.5 w-28" />
              <Bar C={C} className="h-3 w-40 max-w-full" light />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="h-11 flex-1 rounded-xl" style={{ background: C.card }} />
        {[0, 1, 2].map(i => <Bar key={i} C={C} className="hidden sm:block h-10 w-20 rounded-full" />)}
      </div>

      {shape === 'cards' ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl p-3 grid gap-2.5" style={{ background: C.card }}>
              <Bar C={C} className="aspect-video w-full rounded-xl" />
              <Bar C={C} className="h-4 w-3/4" />
              <Bar C={C} className="h-3 w-1/2" light />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl px-4" style={{ background: C.card }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-3.5" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
              <Bar C={C} className="h-10 w-10 rounded-xl flex-shrink-0" />
              <div className="grid gap-2 flex-1 min-w-0">
                <Bar C={C} className="h-3.5 w-56 max-w-full" />
                <Bar C={C} className="h-3 w-36 max-w-full" light />
              </div>
              <Bar C={C} className="hidden sm:block h-3.5 w-20" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
