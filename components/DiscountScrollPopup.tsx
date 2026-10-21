'use client';

// The running subscription discount, offered once a visitor is halfway down a learning detail
// page. Halfway is the point: someone who has read that far is weighing the content, and the
// discount is otherwise only stated on the landing and pricing pages they may never return to.
//
// Shown to people who could act on it: signed-out visitors and signed-in students without a
// running plan, on free and locked content alike. Staff and bootcamp learners (who cannot buy a
// plan) never see it. Closing it is remembered per browser for that same offer, so it does not
// nag on every page they open.
//
// Inside a course it waits for the learner to finish the midpoint lesson instead; see `reached`.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useC } from '@/lib/theme';
import { useTenant } from '@/components/TenantProvider';
import { contrastRatio } from '@/lib/ve-accent';
import { promotionHeading } from '@/lib/subscription-discount';
import { durationLabel, offerKey, type PromotionTeaser } from '@/lib/pricing-offer';

const CLOSED_KEY = 'discount-popup-closed';
// Long enough that one offer does not follow a learner around every page, short enough that a
// promotion running for weeks gets a second look.
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
// A page too short to scroll has no "halfway"; a container at least this share of the viewport
// is the page's own scroller rather than a carousel or a code block someone happens to scroll.
const MIN_SCROLLABLE_PX = 240;
const MAIN_SCROLLER_SHARE = 0.6;
// Faint percent marks in the brand band, echoing the pricing hero. Decoration only.
const PERCENT_MARKS: React.CSSProperties[] = [
  { top: '18%', left: '9%', width: 18, height: 18 },
  { top: '58%', left: '17%', width: 13, height: 13 },
  { top: '22%', right: '19%', width: 15, height: 15 },
  { bottom: '20%', right: '9%', width: 21, height: 21 },
];

// Offer key to when it was closed. Keyed per offer, so closing one does not forget another: a
// visitor moving between a free course and a locked one can be shown two different offers.
function readClosed(): Record<string, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function closedRecently(promotion: PromotionTeaser): boolean {
  return Date.now() - Number(readClosed()[offerKey(promotion)] ?? 0) < REMIND_AFTER_MS;
}

function rememberClosed(promotion: PromotionTeaser) {
  try {
    const now = Date.now();
    // Expired closings are dropped on the way, so the record cannot grow without bound.
    const live = Object.fromEntries(
      Object.entries(readClosed()).filter(([, at]) => now - Number(at) < REMIND_AFTER_MS),
    );
    localStorage.setItem(CLOSED_KEY, JSON.stringify({ ...live, [offerKey(promotion)]: now }));
  } catch {}
}

/**
 * Whether this viewer could take the offer: signed out, or a student with no running plan.
 *
 * Always the signed-in person, never a Student Mode target. Student Mode is staff viewing as a
 * learner, and judging the target would show staff an offer they are not meant to see.
 */
async function viewerCanSubscribe(): Promise<{ eligible: boolean; signedIn: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { eligible: true, signedIn: false };
  const studentId = session.user.id;
  const [{ data: student }, { data: subscription, error }] = await Promise.all([
    supabase.from('students').select('role, enrollment_model').eq('id', studentId).maybeSingle(),
    supabase.from('individual_subscriptions')
      .select('status, current_period_end')
      .eq('student_id', studentId)
      .maybeSingle(),
  ]);
  // When in doubt, stay quiet: offering a discount to someone who already paid is worse than
  // missing one visitor.
  if (error || !student || student.role !== 'student' || student.enrollment_model === 'bootcamp') {
    return { eligible: false, signedIn: true };
  }
  const running = subscription?.status === 'active'
    && new Date(subscription.current_period_end).getTime() > Date.now();
  return { eligible: !running, signedIn: true };
}

/** How far down its scroller the event's target is, 0 to 1, or null when it is not the page. */
function scrolledShare(target: EventTarget | null): number | null {
  const el = target === document || target === window
    ? document.scrollingElement ?? document.documentElement
    : target instanceof HTMLElement ? target : null;
  if (!el) return null;
  const isPage = el === document.scrollingElement || el === document.documentElement;
  if (!isPage && el.clientHeight < window.innerHeight * MAIN_SCROLLER_SHARE) return null;
  const range = el.scrollHeight - el.clientHeight;
  if (range < MIN_SCROLLABLE_PX) return null;
  return el.scrollTop / range;
}

export function DiscountScrollPopup({ promotion, reached }: {
  promotion: PromotionTeaser | null;
  /**
   * When given, the host says when the moment has come instead of the scroll position. A
   * signed-in learner on an open course goes straight into the course with no overview to
   * scroll, so the page passes "finished the midpoint lesson" here.
   */
  reached?: boolean;
}) {
  const C = useC();
  const { primaryColor } = useTenant();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inCourse = reached !== undefined;
  // Who may see the offer, read once when the page loads. Null until known, and again once closed.
  const [audience, setAudience] = useState<{ signedIn: boolean } | null>(null);
  const [scrolledHalfway, setScrolledHalfway] = useState(false);
  const open = Boolean(promotion && audience && (inCourse ? reached : scrolledHalfway));

  useEffect(() => {
    if (!promotion || closedRecently(promotion)) return;
    let cancelled = false;
    viewerCanSubscribe()
      .then(result => { if (!cancelled && result.eligible) setAudience({ signedIn: result.signedIn }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [promotion]);

  // On a detail page, halfway down. Capture phase, because scroll does not bubble and some detail
  // pages scroll an inner container rather than the window. The listener goes once it has fired.
  useEffect(() => {
    if (inCourse || scrolledHalfway) return;
    const past = (target: EventTarget | null) => {
      const share = scrolledShare(target);
      return share !== null && share >= 0.5;
    };
    const onScroll = (event: Event) => { if (past(event.target)) setScrolledHalfway(true); };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    // A restored scroll position can already be past halfway when the page mounts.
    const frame = requestAnimationFrame(() => { if (past(document)) setScrolledHalfway(true); });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [inCourse, scrolledHalfway]);
  // showModal gives focus trapping, Escape and the inert page behind it for free. A layout effect,
  // so mid-course the prompt is up before the next slide is painted rather than a frame after.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  if (!promotion || !open || !audience) return null;

  // Every way out -- the buttons, the backdrop, Escape -- ends in the dialog's close event, so the
  // closing is remembered once, in onClose, rather than by each control.
  const dismiss = () => dialogRef.current?.close();
  const onClosed = () => {
    rememberClosed(promotion);
    setAudience(null);
  };
  const term = durationLabel(promotion.durationMonths);
  const badge = promotionHeading(promotion.label, 'Limited offer');
  // The band is the tenant's brand colour, as the pricing hero is; its text is white unless the
  // colour is too pale for that, the same rule the promo card uses.
  const bandColor = primaryColor || C.cta;
  const bandText = /^#[0-9a-f]{6}$/i.test(bandColor) && contrastRatio('#ffffff', bandColor) < contrastRatio('#111827', bandColor)
    ? '#111827' : '#ffffff';

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="discount-popup-title"
      onClose={onClosed}
      onClick={event => { if (event.target === dialogRef.current) dismiss(); }}
      className="discount-popup"
      // margin: auto is what centres a modal dialog; the CSS reset zeroes it, which left the
      // dialog pinned to the left edge.
      style={{ margin: 'auto', background: C.card, color: C.text, border: 'none', borderRadius: 24, padding: 0, overflow: 'hidden', width: 'min(420px, calc(100vw - 32px))', maxHeight: 'calc(100dvh - 32px)', boxShadow: '0 32px 80px rgba(0,0,0,0.30), 0 4px 16px rgba(0,0,0,0.12)' }}
    >
      <style>{`
        .discount-popup::backdrop { background: rgba(15,23,42,0.55); backdrop-filter: blur(3px); }
        @media (prefers-reduced-motion: no-preference) {
          .discount-popup[open] { animation: discount-popup-in 260ms cubic-bezier(0.2, 0.8, 0.2, 1); }
          .discount-popup[open]::backdrop { animation: discount-popup-fade 260ms ease-out; }
          @keyframes discount-popup-in { from { opacity: 0; transform: translateY(16px) scale(0.96); } }
          @keyframes discount-popup-fade { from { opacity: 0; } }
        }
      `}</style>

      {/* Brand band: the offer in one glance. */}
      <div style={{ position: 'relative', overflow: 'hidden', background: bandColor, color: bandText, padding: '28px 24px 40px', textAlign: 'center' }}>
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute rounded-full" style={{ right: '-30%', top: '-60%', width: 320, height: 320, background: 'radial-gradient(circle, rgba(255,255,255,0.22), transparent 68%)' }} />
          {PERCENT_MARKS.map((mark, i) => (
            <svg key={i} className="absolute" style={{ ...mark, opacity: 0.35 }} viewBox="0 0 24 24" fill="none" stroke={bandText} strokeWidth="1.75">
              <circle cx="7.5" cy="7.5" r="2.5" />
              <circle cx="16.5" cy="16.5" r="2.5" />
              <path d="M18.5 5.5 5.5 18.5" strokeLinecap="round" />
            </svg>
          ))}
        </div>
        <button type="button" onClick={dismiss} aria-label="Close"
          className="absolute flex items-center justify-center rounded-full transition-opacity hover:opacity-80"
          style={{ top: 12, right: 12, width: 32, height: 32, background: 'rgba(255,255,255,0.22)', border: 'none', cursor: 'pointer' }}>
          <X className="w-4 h-4" style={{ color: bandText }} />
        </button>
        <span className="relative inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
          style={{ background: '#FFFFFF', color: C.successText }}>
          <Sparkles className="h-3 w-3" />
          {badge}
        </span>
        <p className="relative mt-4 font-black tracking-tight" style={{ fontSize: 64, lineHeight: 0.95 }}>
          {promotion.percentOff}%
          <span className="ml-1 align-top text-2xl font-black tracking-normal" style={{ lineHeight: 1.6 }}>OFF</span>
        </p>
      </div>

      {/* The ticket, in the same treatment the pricing page gives a promotion. */}
      <div style={{ padding: '0 24px', marginTop: -24, position: 'relative' }}>
        <div className="ticket-cutout rounded-2xl px-5 py-3.5" style={{ background: '#FFCC00', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
            <div className="min-w-0 text-left">
              <p className="truncate text-sm font-black" style={{ color: '#101828' }}>{promotion.planName}</p>
              <p className="text-xs font-bold" style={{ color: 'rgba(16,24,40,0.62)' }}>{term} of full access</p>
            </div>
            <div className="border-l-2 border-dashed pl-4 text-right" style={{ borderColor: 'rgba(16,24,40,0.35)' }}>
              <p className="text-[11px] font-bold" style={{ color: 'rgba(16,24,40,0.62)' }}>You save</p>
              <p className="text-base font-black" style={{ color: '#101828' }}>{promotion.percentOff}%</p>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 24px 24px', textAlign: 'center' }}>
        <h2 id="discount-popup-title" className="text-lg font-bold leading-snug" style={{ color: C.text, textWrap: 'balance' }}>
          Subscribe to {promotion.planName} for {term} and save {promotion.percentOff}%
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: C.muted }}>
          {audience.signedIn
            ? `Choose ${term} on the pricing page to get everything in the plan for less while the offer lasts.`
            : `Create a free account, then choose ${term} on the pricing page to get everything in the plan for less while the offer lasts.`}
        </p>
        <Link href="/pricing" onClick={() => rememberClosed(promotion)}
          // Mid-course the plans open in a new tab, so the lesson is still there behind it.
          {...(inCourse ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="mt-6 flex items-center justify-center gap-2 rounded-xl text-sm font-bold transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none"
          style={{ background: C.cta, color: C.ctaText, padding: '14px 16px', textDecoration: 'none' }}>
          See plans <ArrowRight className="h-4 w-4" />
        </Link>
        <button type="button" onClick={dismiss}
          className="mt-2 w-full rounded-xl text-sm font-semibold transition-opacity hover:opacity-70"
          style={{ background: 'transparent', color: C.muted, padding: '10px 16px', border: 'none', cursor: 'pointer' }}>
          {inCourse ? 'Continue learning' : 'Not now'}
        </button>
      </div>
    </dialog>
  );
}