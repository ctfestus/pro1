'use client';

/**
 * Starts a plan purchase from the public pricing page.
 *
 * The pricing page is where someone chooses, so it is where the purchase begins. It used to hand
 * off to the payments screen instead, which asked the same question again -- and for an account
 * with no plan that screen offered nothing to buy at all, so the two pages pointed at each other
 * and a new learner could not purchase.
 *
 * The choice is never lost. Signed out, it is remembered across signing up, the confirmation
 * email and onboarding, and the length they picked is selected for them when they arrive. Where
 * a checkout cannot be opened here -- no card provider, or a rule only the payments screen can
 * explain -- they are handed to that screen with the same choice in the link, rather than shown
 * an error and left on a page with nothing to do next.
 */
import { supabase } from '@/lib/supabase';
import { rememberPurchaseIntent } from '@/lib/pending-purchase';

export type CheckoutOutcome =
  /** The browser is already navigating to the payment provider. */
  | { kind: 'redirecting' }
  /** Sign in first; the choice is stored and replayed afterwards. */
  | { kind: 'signin'; href: string }
  /** Finish on the payments screen, which can explain what this page cannot. */
  | { kind: 'handoff'; href: string; message?: string };

/** The payments screen, carrying the chosen length so it is not chosen twice. */
export function paymentsHrefFor(priceId: string): string {
  return `/student?priceId=${encodeURIComponent(priceId)}#payments`;
}

export async function startPlanCheckout(
  priceId: string,
  options: { paystackEnabled: boolean },
): Promise<CheckoutOutcome> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    rememberPurchaseIntent(`?priceId=${encodeURIComponent(priceId)}`);
    return { kind: 'signin', href: '/auth?mode=signup' };
  }

  // Bank transfer and mobile money raise a request the learner has to submit a receipt against,
  // and that whole flow lives on the payments screen. Sending them there is the finished journey,
  // not a failure.
  if (!options.paystackEnabled) return { kind: 'handoff', href: paymentsHrefFor(priceId) };

  try {
    const res = await fetch('/api/student-subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'purchase-plan', priceId, paystack: true }),
    });
    const body = await res.json().catch(() => ({}));

    if (res.ok && body.checkout?.authorizationUrl) {
      window.location.href = body.checkout.authorizationUrl;
      return { kind: 'redirecting' };
    }
    // Already paid, already subscribed, a checkout still open, or a plan they may not buy. Every
    // one of those has an explanation and an action on the payments screen and none here.
    return { kind: 'handoff', href: paymentsHrefFor(priceId), message: body.error };
  } catch {
    return { kind: 'handoff', href: paymentsHrefFor(priceId) };
  }
}
