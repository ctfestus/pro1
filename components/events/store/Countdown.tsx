'use client';

/**
 * A live countdown to an event's next session: days, hours, minutes, seconds. For the two hours
 * after the start (the same length the calendar entries use) it reads "Happening now"; after that
 * it hides. Rendered empty on the server and filled in the browser, so the cached page never
 * carries a stale time and the first render matches.
 */
import { useEffect, useState } from 'react';

const LIVE_MS = 2 * 60 * 60 * 1000;
const UNITS: [label: string, ms: number][] = [['Days', 86_400_000], ['Hours', 3_600_000], ['Minutes', 60_000], ['Seconds', 1000]];

export function Countdown({ startsAt, primaryColor }: { startsAt: string; primaryColor: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, 1000);
    return () => { window.clearTimeout(first); window.clearInterval(id); };
  }, []);

  const start = Date.parse(startsAt);
  if (now === null || Number.isNaN(start)) return <div className="h-[68px]" aria-hidden />;
  const left = start - now;
  if (left <= -LIVE_MS) return null;
  if (left <= 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold" style={{ background: '#f0fdf4', color: '#15803d' }}>
        <span className="relative flex w-2.5 h-2.5">
          <span className="absolute inline-flex w-full h-full rounded-full opacity-75 animate-ping" style={{ background: '#22c55e' }} />
          <span className="relative inline-flex w-2.5 h-2.5 rounded-full" style={{ background: '#16a34a' }} />
        </span>
        Happening now
      </div>
    );
  }

  // Each unit is what is left after the larger ones: days whole, hours within the day, and so on.
  const parts = UNITS.map(([label, ms], i) => ({ label, n: Math.floor((i === 0 ? left : left % UNITS[i - 1][1]) / ms) }));
  return (
    <div role="timer" aria-label="Time until the event starts">
      <p className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--ev-muted,#64748b)' }}>Starts in</p>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {parts.map(p => (
          <div key={p.label} className="rounded-xl py-2 text-center" style={{ background: `${primaryColor}12` }}>
            <div className="text-xl font-extrabold tabular-nums leading-tight" style={{ color: 'var(--ev-text,#0f172a)' }}>{String(p.n).padStart(2, '0')}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ev-muted,#64748b)' }}>{p.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
