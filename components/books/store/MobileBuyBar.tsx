'use client';

/**
 * On phones the buy card sits below the product's header, so a slim bar at the bottom of the
 * screen keeps the price and a way to it in reach. It only scrolls to the buy card (#buy), which
 * does the real work, and hides while that card is on screen. Hidden on large screens, where the
 * buy card stays in view beside the content.
 */
import { useEffect, useState } from 'react';
import { PriceTag } from '@/components/books/store/PriceTag';
import { useCurrentPrices } from '@/lib/books/use-current-prices';
import type { ClientPrice } from '@/lib/books/pricing';

export function MobileBuyBar({ title, free, prices, primaryColor }: {
  title: string;
  free: boolean;
  prices: ClientPrice[];
  primaryColor: string;
}) {
  const [cardVisible, setCardVisible] = useState(true);

  useEffect(() => {
    const card = document.getElementById('buy');
    if (!card || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => setCardVisible(entry.isIntersecting));
    io.observe(card);
    return () => io.disconnect();
  }, []);

  // The same prices as the buy card: an ended sale or a price checkout reported updates both.
  const current = useCurrentPrices(prices);
  const price = current[0] ?? null;

  return (
    <div aria-hidden={cardVisible} className="lg:hidden fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-2 transition-transform duration-300"
      style={{ transform: cardVisible ? 'translateY(120%)' : 'translateY(0)' }}>
      <div className="mx-auto max-w-xl flex items-center gap-3 rounded-2xl px-4 py-3 backdrop-blur-xl"
        style={{ background: 'rgba(255,255,255,0.86)', boxShadow: '0 12px 40px rgba(15,23,42,0.18)' }}>
        <div className="flex-1 min-w-0">
          <p className="text-xs truncate" style={{ color: '#64748b' }}>{title}</p>
          {free
            ? <p className="text-base font-bold" style={{ color: '#16a34a' }}>Free</p>
            : price && <PriceTag prices={[price]} className="text-base font-bold" style={{ color: '#0f172a' }} />}
        </div>
        <a href="#buy" tabIndex={cardVisible ? -1 : 0} className="shrink-0 rounded-xl px-5 py-2.5 text-sm font-semibold" style={{ background: primaryColor, color: '#ffffff' }}>
          {free ? 'Get it' : 'Buy now'}
        </a>
      </div>
    </div>
  );
}
