'use client';

import { useEffect, useState } from 'react';
import { browserOffsetAt, viewerLocalTime, type ViewerLocalTime } from '@/lib/events/local-time';

/**
 * "8:00 PM your time (GMT+3)" under an event's own time, for visitors in another timezone.
 *
 * Worked out only in the browser, after the page loads: the page is built on the server (UTC) and
 * cached for everyone, so it must never contain one visitor's time. Until then, and for anyone on
 * the event's own offset or with an unreadable event timezone, it renders nothing.
 */
export function LocalTime({ date, time, timezone }: { date: string | null; time: string | null; timezone: string | null }) {
  const [local, setLocal] = useState<ViewerLocalTime | null>(null);
  useEffect(() => {
    // Deferred so the first browser render matches the server's (nothing), then fills in.
    const t = setTimeout(() => setLocal(viewerLocalTime(date, time, timezone, browserOffsetAt)), 0);
    return () => clearTimeout(t);
  }, [date, time, timezone]);
  if (!local) return null;
  return (
    <span className="block mt-0.5 text-sm" style={{ color: 'var(--ev-muted,#64748b)' }}>
      {local.date ? `${local.date}, ` : ''}{local.time} your time ({local.zone})
    </span>
  );
}
