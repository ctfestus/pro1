'use client';

// A horizontally scrolling row of cards: its scroll buttons, and whether it has more cards than
// fit, so the buttons show only when there is something to scroll to.

import { useEffect, useState } from 'react';

export function useScrollRow(step = 320) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 1);
    // A ResizeObserver reports once on observe, so this also sets the first value.
    const resize = new ResizeObserver(check);
    resize.observe(el);
    const cards = new MutationObserver(check);
    cards.observe(el, { childList: true });
    return () => { resize.disconnect(); cards.disconnect(); };
  }, [el]);

  return {
    attach: setEl,
    overflows,
    scrollBy: (dir: number) => el?.scrollBy({ left: dir * step, behavior: 'smooth' }),
  };
}
