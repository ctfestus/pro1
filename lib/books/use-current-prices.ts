'use client';

import { useEffect, useState } from 'react';
import { endEndedSales, msUntilNextSaleEnd, type ClientPrice } from '@/lib/books/pricing';

/** Fired by the buy card when checkout reports a different price, so every price on the page follows. */
export const PRICE_CHANGED_EVENT = 'product-price-changed';

/**
 * A product's prices as they stand now, for everything on the page that shows one (the buy card and
 * the phone price bar). A sale that ends while the page is open drops back to the regular price at
 * that moment, and a price checkout reports as changed (PRICE_CHANGED_EVENT) replaces the old one.
 */
export function useCurrentPrices(initial: ClientPrice[]) {
  const [prices, setPrices] = useState<ClientPrice[]>(initial); // an already-ended sale is dropped by the timer below (wait 0), after hydration

  useEffect(() => {
    const wait = msUntilNextSaleEnd(prices);
    if (wait === null) return;
    // setTimeout holds at most about 24 days; a later end is picked up when the timer fires again.
    const t = window.setTimeout(() => setPrices(list => endEndedSales(list)), Math.min(wait, 2 ** 31 - 1));
    return () => window.clearTimeout(t);
  }, [prices]);

  useEffect(() => {
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<ClientPrice>).detail;
      if (next && typeof next.amount === 'number') setPrices(list => list.map(p => (p.currency === next.currency ? next : p)));
    };
    window.addEventListener(PRICE_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(PRICE_CHANGED_EVENT, onChange);
  }, []);

  return prices;
}
