/**
 * Throws away the cached public pricing data.
 *
 * The pricing page does not query the database per visitor: the answer is the same for everyone
 * and changes rarely, so it is computed once and filed under the tag below. Nothing about that
 * copy knows when an admin edits a plan -- the edit happens on another screen, minutes or days
 * later -- so the copy has to be discarded from the write side.
 *
 * Without this the only thing clearing it was the five-minute timer, which meant a plan could be
 * deactivated and still be advertised on the public page, with a working buy button, for up to
 * five minutes. The purchase itself was refused by the API, so the learner met an error after
 * deciding to pay, which is the worst place to meet one.
 *
 * Never let a failure here fail the write. The plan change has already been saved; the worst a
 * failed discard can do is leave the page stale until the timer runs out, which is where it was
 * before this existed.
 */
import { revalidateTag } from 'next/cache';

/** The tag getPricingPageData files its result under. Both ends must agree on this string. */
export const PRICING_CACHE_TAG = 'pricing-page';

export function revalidatePricingPage(): void {
  try {
    revalidateTag(PRICING_CACHE_TAG);
  } catch (err) {
    console.error('[revalidatePricingPage]', err);
  }
}
