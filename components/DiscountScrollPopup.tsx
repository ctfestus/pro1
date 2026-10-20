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
// Inside a course it waits for the lesson that reaches the midpoint instead; see `reachedAt`.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useC } from '@/lib/theme';
import { promotionHeading } from '@/lib/subscription-discount';
import { durationLabel, offerKey, planPromotions, type PromotionTeaser } from '@/lib/pricing-offer';
import { pricingPlanFromRow } from '@/lib/pricing-contract';

const CLOSED_KEY = 'discount-popup-closed';
// Long enough that one offer does not follow a learner around every page, short enough that a
// promotion running for weeks gets a second look.
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
// A page too short to scroll has no "halfway"; a container at least this share of the viewport
// is the page's own scroller rather than a carousel or a code block someone happens to scroll.
const MIN_SCROLLABLE_PX = 240;
const MAIN_SCROLLER_SHARE = 0.6;

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

/**
 * Whether this exact offer is still on sale, read fresh from the same public view the pricing
 * page uses. The view only carries a promotion while it is running, so one that has ended, been
 * withdrawn or been repriced since the page loaded reads as gone. Any failure reads as gone too:
 * advertising terms checkout will not honour is worse than skipping the prompt.
 */
async function stillOffered(promotion: PromotionTeaser): Promise<boolean> {
  const { data, error } = await supabase
    .from('public_pricing_plans')
    .select('plan_id, plan_name, plan_description, recommended, prices')
    .eq('plan_id', promotion.planId)
    .maybeSingle();
  if (error || !data) return false;
  const key = offerKey(promotion);
  return planPromotions([pricingPlanFromRow(data)]).some(current => offerKey(current) === key);
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

export function DiscountScrollPopup({ promotion, reachedAt, checkpoint = 0 }: {
  promotion: PromotionTeaser | null;
  /**
   * When given, the host decides when the moment has come instead of the scroll position: the
   * time (epoch ms) it came, or null until then. A signed-in learner on an open course goes
   * straight into the course with no overview to scroll, so the page passes the moment they
   * finish the lesson that reaches the midpoint.
   */
  reachedAt?: number | null;
  /**
   * Bumped by the host when the moment is near (one lesson from the midpoint), to re-read the
   * offer then. The page loaded it when the course opened, which can be hours earlier.
   */
  checkpoint?: number;
}) {
  const C = useC();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inCourse = reachedAt !== undefined;
  const key = promotion ? offerKey(promotion) : null;
  // Who may see which offer, and since when. Keyed by offer rather than a plain flag, so a
  // different promotion arriving while this stays mounted starts over instead of inheriting.
  const [audience, setAudience] = useState<{ key: string; signedIn: boolean; at: number } | null>(null);
  // The last live reading of whether this exact offer is still on sale, and when it was taken.
  const [offerCheck, setOfferCheck] = useState<{ key: string; live: boolean; at: number } | null>(null);
  const ready = key !== null && audience?.key === key ? audience : null;
  // On the overview the lookup itself is the trigger, so ready means open. In a course both
  // readings are taken ahead of time and must have landed BEFORE the midpoint lesson was
  // finished: then the prompt opens in the same render as the next slide. If either was still
  // in flight, this opening is skipped rather than arriving late over a slide being read.
  const open = Boolean(ready) && (!inCourse || (
    reachedAt != null
    && (ready as { at: number }).at <= reachedAt
    && offerCheck?.key === key && offerCheck.live && offerCheck.at <= reachedAt
  ));

  useEffect(() => {
    if (!promotion || closedRecently(promotion)) return;
    const offer = offerKey(promotion);
    let cancelled = false;

    if (inCourse) {
      viewerCanSubscribe()
        .then(result => {
          if (!cancelled && result.eligible) setAudience({ key: offer, signedIn: result.signedIn, at: Date.now() });
        })
        .catch(() => {});
      return () => { cancelled = true; };
    }

    // On the overview the offer is read again with the eligibility, at the moment it would show:
    // the page may have been open long enough for the promotion to end or change.
    const lookUp = () => {
      Promise.all([viewerCanSubscribe(), stillOffered(promotion)])
        .then(([result, live]) => {
          if (!cancelled && result.eligible && live) setAudience({ key: offer, signedIn: result.signedIn, at: Date.now() });
        })
        .catch(() => {});
    };

    // Nothing is looked up until the visitor is halfway: most never get there. The listener goes
    // as soon as it has fired once, so it does not keep reading layout on every scroll afterwards.
    // Capture phase, because scroll does not bubble and some detail pages scroll an inner
    // container rather than the window.
    const past = (share: number | null) => share !== null && share >= 0.5;
    let triggered = false;
    const trigger = () => {
      if (triggered) return;
      triggered = true;
      window.removeEventListener('scroll', onScroll, { capture: true });
      lookUp();
    };
    function onScroll(event: Event) {
      if (past(scrolledShare(event.target))) trigger();
    }
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    // A restored scroll position can already be past halfway when the page mounts.
    if (past(scrolledShare(document))) trigger();
    return () => {
      cancelled = true;
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [promotion, inCourse]);

  // In a course, read the offer when the course opens and again at each checkpoint, so the one
  // in hand at the midpoint is minutes old rather than hours: a promotion that ended, was
  // withdrawn or was repriced in between is not advertised.
  useEffect(() => {
    if (!inCourse || !promotion || closedRecently(promotion)) return;
    const offer = offerKey(promotion);
    let cancelled = false;
    stillOffered(promotion)
      .then(live => { if (!cancelled) setOfferCheck({ key: offer, live, at: Date.now() }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [promotion, inCourse, checkpoint]);
  // showModal gives focus trapping, Escape and the inert page behind it for free. A layout effect,
  // so mid-course the prompt is up before the next slide is painted rather than a frame after.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) dialog.showModal();
  }, [open]);

  if (!promotion || !open || !ready) return null;

  // Every way out -- the buttons, the backdrop, Escape -- ends in the dialog's close event, so the
  // closing is remembered once, in onClose, rather than by each control.
  const dismiss = () => dialogRef.current?.close();
  const onClosed = () => {
    rememberClosed(promotion);
    setAudience(null);
  };
  const term = durationLabel(promotion.durationMonths);
  // Mid-course, the prompt must not cost the learner their place: the way out reads as carrying
  // on, and the plans open in a new tab so the lesson is still there behind it.
  const badge = promotionHeading(promotion.label, 'Limited offer');

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="discount-popup-title"
      onClose={onClosed}
      onClick={event => { if (event.target === dialogRef.current) dismiss(); }}
      className="discount-popup"
      style={{ background: C.card, color: C.text, border: 'none', borderRadius: 20, padding: 0, width: 'min(400px, calc(100vw - 32px))', boxShadow: '0 24px 64px rgba(0,0,0,0.28)' }}
    >
      <style>{`
        .discount-popup::backdrop { background: rgba(0,0,0,0.45); }
        @media (prefers-reduced-motion: no-preference) {
          .discount-popup[open] { animation: discount-popup-in 220ms ease-out; }
          @keyframes discount-popup-in { from { opacity: 0; transform: translateY(12px) scale(0.98); } }
        }
      `}</style>
      <div style={{ position: 'relative', padding: '28px 24px 24px', textAlign: 'center' }}>
        <button type="button" onClick={dismiss} aria-label="Close"
          className="flex items-center justify-center rounded-full transition-opacity hover:opacity-70"
          style={{ position: 'absolute', top: 12, right: 12, width: 30, height: 30, background: C.pill, border: 'none', cursor: 'pointer' }}>
          <X className="w-4 h-4" style={{ color: C.muted }} />
        </button>
        <span className="inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-wider"
          style={{ background: C.successBg, color: C.successText }}>
          {badge}
        </span>
        <p className="mt-4 font-black tracking-tight" style={{ fontSize: 44, lineHeight: 1, color: C.text }}>
          {promotion.percentOff}% off
        </p>
        <h2 id="discount-popup-title" className="mt-3 text-lg font-bold" style={{ color: C.text }}>
          Subscribe to {promotion.planName} for {term} and save {promotion.percentOff}%
        </h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: C.muted }}>
          {ready.signedIn
            ? `Choose ${term} on the pricing page to get everything in the plan for less while the offer lasts.`
            : `Create a free account, then choose ${term} on the pricing page to get everything in the plan for less while the offer lasts.`}
        </p>
        <Link href="/pricing" onClick={() => rememberClosed(promotion)}
          {...(inCourse ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="mt-6 flex items-center justify-center rounded-xl text-sm font-bold transition-opacity hover:opacity-90"
          style={{ background: C.cta, color: C.ctaText, padding: '13px 16px', textDecoration: 'none' }}>
          See plans
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