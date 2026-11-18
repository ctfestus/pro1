'use client';

// The price of a locked course, experience or path, in the side column: a ribbon with the plan,
// the lowest monthly figure, every length on sale, and the one button. The figure is a plan's,
// not the item's, and the card says so: it opens everything in the plan.

import Link from 'next/link';
import { ArrowRight, Lock } from 'lucide-react';
import { enrollLabel, pricingHrefFor, sellablePlans, unlockDurationLabel, unlockMoney, unlockPlanName, type UnlockInfo } from '@/lib/unlock-pricing';

type Kind = 'course' | 'virtual_experience' | 'learning_path';
const NOUN: Record<Kind, string> = { course: 'course', virtual_experience: 'experience', learning_path: 'path' };

/** Whether a locked item has something on sale, so the card (rather than a plain button) shows. */
export function hasPriceCard(locked: boolean | undefined, unlock: UnlockInfo): boolean {
  return !!locked && sellablePlans(unlock).length > 0;
}

export function PriceCard({ kind, itemId, unlock, palette }: {
  kind: Kind;
  itemId: string;
  unlock: UnlockInfo;
  /** The page's own colours; accent is the page's button colour. */
  palette: { card: string; text: string; muted: string; line: string; accent: string; shadow: string };
}) {
  const plans = sellablePlans(unlock);
  const prices = plans.flatMap(plan => plan.prices ?? []);
  if (!prices.length) return null;

  // The lowest a month, among every length of every plan that opens the item. Prices arrive with
  // any running discount already applied.
  const cheapest = prices.reduce((best, price) =>
    price.amount / price.durationMonths < best.amount / best.durationMonths ? price : best);
  const perMonth = unlockMoney(cheapest.currency, cheapest.amount / cheapest.durationMonths);
  const planName = unlockPlanName(unlock);
  const single = plans.length === 1;
  const terms = single
    ? `${prices.map(price => `${unlockMoney(price.currency, price.amount)} for ${unlockDurationLabel(price.durationMonths)}`).join(', or ')}. One payment, no automatic renewal.`
    : `Included in ${plans.length} plans.`;
  const ribbon = single && planName ? `${planName.replace(/\s*plan$/i, '')} plan` : 'Plans';

  return (
    <div style={{ position: 'relative', background: palette.card, borderRadius: 14, padding: '24px 20px 20px', border: `1px solid ${palette.line}`, boxShadow: palette.shadow, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <span style={{
        position: 'absolute', top: -11, right: 14, padding: '4px 18px 4px 10px', borderRadius: '4px 0 0 4px',
        clipPath: 'polygon(0 0, 100% 0, calc(100% - 8px) 50%, 100% 100%, 0 100%)',
        background: `color-mix(in srgb, ${palette.accent} 24%, ${palette.card})`, color: palette.text,
        fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        {ribbon}
      </span>
      <p style={{ display: 'flex', alignItems: 'center', gap: 9, margin: 0, fontSize: 16, fontWeight: 700, color: palette.text }}>
        <Lock style={{ width: 18, height: 18 }} /> Unlock this {NOUN[kind]}
      </p>
      <p style={{ margin: 0, fontSize: 13.5, color: palette.muted }}>
        {!single && 'From '}
        <span style={{ fontSize: 26, fontWeight: 800, color: palette.text, letterSpacing: '-0.02em', marginRight: 4 }}>{perMonth}</span>
        a month
      </p>
      <p style={{ margin: '-6px 0 0', fontSize: 13, lineHeight: 1.55, color: palette.muted }}>{terms}</p>
      <Link href={pricingHrefFor(itemId, kind)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 13, borderRadius: 12, background: palette.accent, color: '#ffffff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
        {enrollLabel(unlock)} <ArrowRight style={{ width: 15, height: 15 }} />
      </Link>
      <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55, color: palette.muted }}>
        Opens every course, path and experience in {single ? 'the plan' : 'each plan'}.{' '}
        <Link href="/pricing" style={{ color: palette.accent, fontWeight: 700, textDecoration: 'none' }}>Compare plans</Link>
      </p>
    </div>
  );
}
