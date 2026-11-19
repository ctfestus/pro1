'use client';

import { useEffect, useState } from 'react';

/**
 * The time on the viewer's clock, ticking each second, or null on the server and the first render.
 * Dates and countdowns wait for it, so the server and the browser never disagree about them.
 */
export function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // Read the clock once mounted, then every second.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, []);
  return now;
}
