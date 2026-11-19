'use client';

// The price of a locked course, experience or path, in the side column: a ribbon with the plan,
// the lowest monthly figure, every length on sale, and the one button. The figure is a plan's,
// not the item's, and the card says so: it opens everything in the plan.

import Link from 'next/link';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';
import { DEFAULT_VE_ACCENT } from '@/lib/ve-accent';
import { enrollLabel, pricingHrefFor, sellablePlans, unlockDurationLabel, unlockMoney, type UnlockInfo } from '@/lib/unlock-pricing';

type Kind = 'course' | 'virtual_experience' | 'learning_path';
const NOUN: Record<Kind, string> = { course: 'course', virtual_experience: 'experience', learning_path: 'path' };

// What the plan opens, one line per kind it has, in the order a learner cares about. Plans are
// meant to open everything of a kind, including what is added later, so the card names the kinds
// rather than counting today's items.
const KINDS = [
  { key: 'courses', label: 'Unlimited courses' },
  { key: 'learning_paths', label: 'Unlimited learning paths' },
  { key: 'virtual_experiences', label: 'Unlimited virtual experiences' },
  { key: 'certifications', label: 'Unlimited certifications' },
] as const;

/** Whether a locked item has something on sale, so the card (rather than a plain button) shows. */
export function hasPriceCard(locked: boolean | undefined, unlock: UnlockInfo): boolean {
  return !!locked && sellablePlans(unlock).length > 0;
}

export function PriceCard({ kind, itemId, unlock, paystackEnabled, palette }: {
  kind: Kind;
  itemId: string;
  unlock: UnlockInfo;
  /** Online checkout is on: Paystack takes Mobile Money, card and bank, so the card can say so. */
  paystackEnabled: boolean;
  /** The page's own colours; accent is the page's button colour. */
  palette: { card: string; text: string; muted: string; line: string; accent: string; shadow: string; dark: boolean };
}) {
  // One offer: the best value (lowest a month) among every length of every plan that opens the
  // item, with any running discount already applied. Lead with what is charged, then what that
  // comes to a day. Every other option is on the pricing page the button opens.
  const offers = sellablePlans(unlock).flatMap(plan => (plan.prices ?? []).map(price => ({ plan, price })));
  if (!offers.length) return null;
  const { plan, price: best } = offers.reduce((cheapest, offer) =>
    offer.price.amount / offer.price.durationMonths < cheapest.price.amount / cheapest.price.durationMonths ? offer : cheapest);
  const planName = (plan.name ?? '').trim();
  const saving = best.listAmount && best.listAmount > best.amount ? Math.round((1 - best.amount / best.listAmount) * 100) : 0;
  // The price a day, a month counted as 30 days, always to the cent ("GHS 0.50", not "GHS 0.5").
  const perDay = `${best.currency || 'GHS'} ${(best.amount / (best.durationMonths * 30)).toFixed(2)}`;
  const included = KINDS.filter(({ key }) => (plan.coverage?.[key] ?? 0) > 0).map(({ label }) => label);

  return (
    <div style={{ position: 'relative', background: palette.card, borderRadius: 14, padding: '24px', border: `1px solid ${palette.line}`, boxShadow: palette.shadow, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <span style={{
        position: 'absolute', top: -12, right: 16, padding: '4px 16px 4px 12px', borderRadius: '4px 0 0 4px',
        clipPath: 'polygon(0 0, 100% 0, calc(100% - 8px) 50%, 100% 100%, 0 100%)',
        // Light gold, as on Explore's labels; the ocean blue in dark mode.
        background: palette.dark ? '#3E93FF' : '#F5D77A', color: palette.dark ? '#ffffff' : '#3d2e00',
        fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
      }}>
        {planName ? `${planName.replace(/\s*plan$/i, '')} plan` : 'Best value'}
      </span>
      {/* The price is the plan's, so the card leads with the plan, not with unlocking this one item. */}
      <p style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 700, color: palette.text }}>
        Get this {NOUN[kind]} and more.
      </p>
      <p style={{ margin: 0, fontSize: 14, color: palette.muted }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: palette.text, letterSpacing: '-0.02em', marginRight: 4 }}>{unlockMoney(best.currency, best.amount)}</span>
        for {unlockDurationLabel(best.durationMonths)}
      </p>
      {/* A running discount, as the pricing page shows it: the usual price and the saving. */}
      {saving > 0 && (
        <p style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '-8px 0 0', fontSize: 14, color: palette.muted }}>
          Usually <s>{unlockMoney(best.currency, best.listAmount!)}</s>
          <span style={{ padding: '2px 8px', borderRadius: 999, background: '#ffffff', color: '#16a34a', fontSize: 12, fontWeight: 800, boxShadow: '0 0 0 1px rgba(22,163,74,0.25)' }}>Save {saving}%</span>
        </p>
      )}
      <p style={{ margin: '-8px 0 0', fontSize: 14, lineHeight: 1.55, color: palette.muted }}>
        Only{' '}
        <span style={{ position: 'relative', display: 'inline-block', fontWeight: 800, color: palette.text, paddingBottom: 3 }}>
          {perDay}
          {/* A hand-drawn swoosh under the figure: the platform green of the Enroll buttons, or the ocean blue in dark mode. */}
          <svg aria-hidden="true" viewBox="0 0 100 10" preserveAspectRatio="none"
            style={{ position: 'absolute', left: 0, bottom: -3, width: '100%', height: 7, overflow: 'visible' }}>
            <path d="M2 7 C 25 1, 70 1, 98 5" fill="none" stroke={palette.dark ? '#3E93FF' : DEFAULT_VE_ACCENT} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </span>{' '}
        a day. One payment, no automatic renewal.
      </p>
      {included.length > 0 && (
        // Space Grotesk, the display face of the pricing page's offer strip and hero.
        <div style={{ borderTop: `1px solid ${palette.line}`, paddingTop: 12, fontFamily: 'var(--font-display), sans-serif' }}>
          <p style={{ margin: 0, fontSize: 12, fontWeight: 700, color: palette.muted }}>What&apos;s included:</p>
          <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 8 }}>
            {included.map(line => (
              <li key={line} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: palette.text }}>
                <Check style={{ width: 16, height: 16, flexShrink: 0, color: '#16a34a' }} /> {line}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link href={pricingHrefFor(itemId, kind)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 12, background: palette.accent, color: '#ffffff', fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
        {planName ? `Enroll with ${planName}` : enrollLabel(unlock)} <ArrowRight style={{ width: 15, height: 15 }} />
      </Link>
      {paystackEnabled && (
        <p style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '-4px 0 0', fontSize: 12, lineHeight: 1.5, color: palette.muted }}>
          <ShieldCheck style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2 }} /> Pay with Mobile Money, card or bank. Secure checkout by Paystack.
        </p>
      )}
    </div>
  );
}
