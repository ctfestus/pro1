import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const compact = (value: string) => value.replace(/\s+/g, ' ');

// An unfinished checkout is a cart: ordinary, the learner's own, and never a debt. The dangerous
// version of this feature is one that chases somebody for money they already paid, or clears a
// checkout while the provider is holding funds, so those two guards are what these pin.

/**
 * Just the unfinished-checkout card. Scoping to it keeps the wording checks about that card
 * rather than about anything else the payments screen happens to say.
 */
function cartSection(component: string): string {
  const start = component.indexOf('data?.cart && !openRequest');
  expect(start).toBeGreaterThan(-1);
  const end = component.indexOf('</section>', start);
  return component.slice(start, end === -1 ? start + 4000 : end);
}

describe('abandoned checkout cart', () => {
  const cart = compact(read('migrations/190_abandoned_checkout_cart.sql'));
  const schema = compact(read('festman-fresh-schema.sql'));

  it('adds no new table to hold a cart', () => {
    expect(cart).not.toMatch(/CREATE TABLE/i);
    expect(cart).toContain('ALTER TABLE public.paystack_subscription_transactions');
  });

  // Clearing a checkout frees the learner to start another. Doing that while Paystack may hold
  // money is how somebody ends up paying twice for one subscription.
  it('refuses to clear a checkout once anything may have been collected', () => {
    for (const sql of [cart, schema]) {
      expect(sql).toContain("IF v_transaction.status<>'initialized' OR v_transaction.request_id IS NOT NULL THEN");
      expect(sql).toContain("'not_dismissable'");
      // The row survives so a late payment against it can still be matched.
      expect(sql).toContain("SET status='abandoned',cart_dismissed_at=now()");
      expect(sql).not.toMatch(/DELETE FROM public\.paystack_subscription_transactions/);
    }
  });

  it('will not clear a checkout belonging to another learner', () => {
    expect(cart).toContain('WHERE reference=p_reference AND student_id=p_student_id FOR UPDATE');
  });

  // Three, then silence. A shop that mails about an abandoned basket forever stops being read.
  it('caps reminders and never sends indefinitely', () => {
    for (const sql of [cart, schema]) {
      expect(sql).toContain('v_transaction.reminder_count>=3');
      expect(sql).toContain("WHEN 0 THEN interval '1 hour'");
      expect(sql).toContain("WHEN 1 THEN interval '24 hours'");
      expect(sql).toContain("ELSE interval '3 days'");
    }
  });

  // Claimed under a lock and stamped before the mail goes, so a second worker cannot repeat it.
  it('claims a reminder before sending it', () => {
    expect(cart).toContain('WHERE reference=p_reference FOR UPDATE');
    expect(cart).toContain('SET reminder_count=reminder_count+1,last_reminder_at=now()');
  });

  // Someone who has since bought access, by any route, must never be chased about a cart -- but
  // the cart must not be taken away from them either. Dismissing it here silently undid the fix
  // that lets renewers see their own unfinished checkout: the card vanished on the next sweep
  // while the transaction stayed open, leaving them blocked with nothing on screen to remove.
  it('stops chasing a subscriber without hiding their cart', () => {
    const visible = compact(read('migrations/193_keep_renewal_carts_visible.sql'));
    for (const sql of [visible, schema]) {
      expect(sql).toContain("s.status='active' AND s.current_period_end>now()");
      // Reminders retired, not the cart.
      expect(sql).toContain("SET reminder_count=3,processing_error='cart_reminders_stopped_active_subscription'");
      expect(sql).not.toContain("SET cart_dismissed_at=now(),processing_error='cart_superseded_by_active_subscription'");
    }
    // Only the sweep sets cart_dismissed_at now, and only when the learner asks.
    expect(schema).toContain("SET status='abandoned',cart_dismissed_at=now()");
  });

  // Our own status is not evidence. A learner can pay and have the row read 'initialized' until
  // the webhook lands, so anything acting on "this was abandoned" asks the provider first -- and
  // credits what it finds, rather than noticing a payment and moving on.
  it('settles with Paystack before nudging, and applies whatever it finds', () => {
    const sender = read('lib/notify-paystack-cart.ts');
    expect(sender).toContain('settleUnfinishedCheckout');
    expect(sender).toContain('if (!settled.abandoned) { skipped++; continue; }');
    const lib = read('lib/paystack-subscriptions.ts');
    expect(lib).toContain('return { abandoned: false, result: await processPaystackSubscriptionReference(db, reference) };');
  });

  // Clearing on the local status alone let a learner remove a checkout Paystack had already
  // charged, then open another and pay twice.
  it('settles with Paystack before clearing a cart', () => {
    const route = read('app/api/student-subscriptions/route.ts');
    expect(route).toContain("await assertNothingCollected(db, { reference }, 'Your');");
  });

  // A payable Paystack link and an open bank transfer for the same plan is two ways to pay once.
  // Checked inside the function that raises the request, under the lock it already holds, because
  // reading the transactions and then inserting are two operations with a gap between them.
  it('refuses a manual payment request while a checkout is open', () => {
    const exclusion = compact(read('migrations/191_manual_request_excludes_open_checkout.sql'));
    for (const sql of [exclusion, schema]) {
      // Unconditional. Whether somebody can end up paying twice must not depend on who filled in
      // the form, so there is no flag for an administrator or an import to switch this off.
      expect(sql).toContain("RAISE EXCEPTION 'an online checkout is already open for this learner'");
      expect(sql).not.toContain('p_block_on_open_checkout');
      // The same predicate the direct-checkout unique index uses, including a success that has
      // not been credited -- money already taken.
      expect(sql).toContain("t.status IN('initialized','pending','ongoing','processing','queued','needs_review')");
      expect(sql).toContain("t.status='success' AND t.processed_payment_id IS NULL");
      // After the lock on the learner's row, not before it.
      expect(sql.indexOf('WHERE id=p_student_id FOR UPDATE')).toBeLessThan(sql.indexOf('an online checkout is already open'));
    }
    // And exactly one definition of it, so a fresh database cannot end up with an older overload
    // alongside that has no interlock at all.
    expect(schema.match(/CREATE OR REPLACE FUNCTION public\.create_individual_subscription_payment_request/g) ?? [])
      .toHaveLength(1);
    const component = read('components/student/subscription-payments.tsx');
    expect(component).toContain('{data?.cart && !openRequest && !readOnly');
  });

  // Gating the card on not having access looked sensible and was exactly backwards. A renewal
  // creates a checkout like any other, so the only people the card refused to appear for were the
  // ones most likely to be holding one -- blocked by their own cart, with no way to see or clear
  // it, and told the block was about "another plan".
  it('shows the cart to a renewing subscriber too', () => {
    const component = read('components/student/subscription-payments.tsx');
    expect(component).not.toContain('data?.cart && !hasActiveAccess');
    // The card must also speak to a renewal rather than describing every cart as a first
    // purchase. Asserted as "it branches on having access", not as one exact sentence, so a
    // rewording of the banner does not read as a regression -- which is how these two went
    // stale when the banner was redesigned.
    expect(cartSection(component)).toMatch(/hasActiveAccess \?/);
  });

  // "another plan" was wrong for the commonest case: the same plan at a different length.
  it('names the unfinished checkout instead of calling it another plan', () => {
    const lib = read('lib/paystack-subscriptions.ts');
    expect(lib).toContain('You have an unfinished checkout${describeOpenCheckout(reservation)}');
    expect(lib).not.toContain('You already have a checkout open for another plan');
    const naming = compact(read('migrations/192_name_the_open_checkout.sql'));
    expect(naming).toContain("'openPlanName',v_live.plan_name,'openDurationMonths',v_live.duration_months");
  });

  // Paying an invoice online opens a checkout carrying that request's id. Cancelling the invoice
  // used to leave it open, which put the learner somewhere nothing on screen could reach: still
  // blocked from starting anything new, and never shown as their cart, because a cart is a
  // checkout with no request attached. The only way out was the database.
  it('releases the checkout an invoice opened when the invoice is cancelled', () => {
    const release = compact(read('migrations/195_cancel_request_releases_checkout.sql'));
    for (const sql of [release, schema]) {
      expect(sql).toContain("SET status='abandoned',processing_error='released_with_cancelled_request'");
      expect(sql).toContain("WHERE request_id=p_request_id AND status='initialized'");
    }
  });

  // Only 'initialized' is released, and the caller asks Paystack first. Anything the provider
  // reports as paid or in flight is settled by that check and leaves 'initialized', so a row still
  // sitting there is one Paystack has confirmed collected nothing.
  it('refuses to cancel an invoice whose payment actually went through', () => {
    const route = read('app/api/payments/route.ts');
    expect(route).toContain("await assertNothingCollected(db, { requestId: String(body.requestId) }, 'Their');");
    // Asked before the cancel, not after.
    expect(route.indexOf("assertNothingCollected(db, { requestId: String(body.requestId) }"))
      .toBeLessThan(route.indexOf('await cancelSubscriptionPaymentRequest(db, body.requestId)'));
  });

  // Four ways to close a payment, one rule. Each of them frees the learner to start paying again,
  // so a site that grew its own copy of the check is a site that can drift into letting somebody
  // pay twice. What the rule itself allows is pinned in tests/lib/paystack-close-guard.test.ts.
  it('asks the same guard everywhere a payment is closed', () => {
    const student = read('app/api/student-subscriptions/route.ts');
    const admin = read('app/api/payments/route.ts');
    expect(student).toContain("await assertNothingCollected(db, { reference }, 'Your');");
    expect(student).toContain("await assertNothingCollected(db, { requestId }, 'Your');");
    expect(admin).toContain("await assertNothingCollected(db, { requestId: String(body.requestId) }, 'Their');");
    expect(admin).toContain("await assertNothingCollected(db, { reference }, 'Their');");
    // No site keeps a hand-rolled version alongside it.
    for (const route of [student, admin]) expect(route).not.toContain('settleUnfinishedCheckout');
  });

  // A cart carries no payment request, so it showed up in no receivables list -- staff could not
  // see one at all, and the only way to free a learner stuck behind theirs was a database edit.
  it('shows staff the carts and lets them clear one', () => {
    const lib = read('lib/db-subscriptions.ts');
    expect(lib).toContain('export async function getOpenPaystackCarts');
    // Scoped like the requests beside them: an instructor sees only their own plans' carts.
    expect(lib).toContain("if (planIds) query = query.in('plan_id', planIds);");
    const route = read('app/api/payments/route.ts');
    expect(route).toContain("body.action === 'clear-student-cart'");
    // Same authorisation as every other write on that screen, then the same guard.
    expect(route.indexOf('await assertPlanAccess(cart.plan_id);'))
      .toBeLessThan(route.indexOf("await assertNothingCollected(db, { reference }, 'Their');"));
    const section = read('components/dashboard/SubscriptionsSection.tsx');
    expect(section).toContain('setOpenCarts(requestsData.carts ?? []);');
    expect(section).toContain('Unfinished checkouts');
  });

  // Choosing bank transfer raises an invoice, and an invoice blocks every other way of paying
  // until it closes. Nothing on the learner's side could close it, so a wrong plan or a change of
  // mind meant waiting for staff to notice.
  it('lets a learner withdraw the invoice they raised themselves', () => {
    const route = read('app/api/student-subscriptions/route.ts');
    expect(route).toContain("body.action === 'cancel-my-request'");
    // Theirs, and only theirs: one the learning team assigned is a record of what somebody decided
    // this learner owes, not a basket item.
    expect(route).toContain('if (request.created_by !== session.id) {');
    expect(route).toContain("if (!request || request.student_id !== session.id) {");
    // And not once they have told staff they paid, which would drop a claim under review.
    expect(route).toContain("if (request.status !== 'pending') {");
    const component = read('components/student/subscription-payments.tsx');
    expect(component).toContain("openRequest.status === 'pending' && openRequest.created_by === userId");
    expect(component).toContain('cancelOwnRequest(ownRequest.id)');
    // The page can only tell whose invoice it is if the API says so.
    expect(route).toContain('paid_at, created_by,');
  });

  // The rows already stuck were nearly freed by a bulk UPDATE in the migration. 'initialized' is
  // our status, not Paystack's -- it is what a paid checkout reads as until the webhook lands -- so
  // releasing them with no provider in the loop is the one assumption the whole flow refuses to
  // make, and it would also put them out of reach of the reminder pass that would have asked.
  it('does not release historical checkouts without asking Paystack', () => {
    const release = read('migrations/195_cancel_request_releases_checkout.sql');
    // Everything outside a function body, which is where a one-off backfill would sit.
    const topLevel = release.split('$$').filter((_, index) => index % 2 === 0).join(' ');
    expect(topLevel).not.toMatch(/UPDATE public\.paystack_subscription_transactions/);
  });

  // Which leaves them to staff -- so they have to be reachable. They carry a request id, and the
  // cart list filtered those out, so without this they would be stranded and invisible at once.
  it('lists the checkouts a closed request left behind, and no live ones', () => {
    const lib = read('lib/db-subscriptions.ts');
    expect(lib).toContain("in('status', ['cancelled', 'paid'])");
    expect(lib).toContain("return rows.filter(row => !row.request_id || strandedBy.has(row.request_id as string));");
    // The staff closer enforces the same boundary in the database, under its own lock.
    const release = compact(read('migrations/195_cancel_request_releases_checkout.sql'));
    for (const sql of [release, schema]) {
      expect(sql).toContain("IF v_request_status IS NULL OR v_request_status NOT IN ('cancelled','paid') THEN");
      expect(sql).toContain("'request_still_open'");
      expect(sql).toContain("IF v_transaction.status<>'initialized' THEN");
    }
    expect(schema.match(/CREATE OR REPLACE FUNCTION public\.clear_paystack_checkout_for_staff/g) ?? [])
      .toHaveLength(1);
  });

  // The row exists before Paystack is asked, so a cancel landing in that window would be followed
  // by a payable link written onto a checkout nobody expects any more.
  it('will not attach a payment link to a checkout that was closed meanwhile', () => {
    const lib = read('lib/paystack-subscriptions.ts');
    const conditional = lib.match(/authorization_url: initialized\.authorizationUrl,\s*\}\)\.eq\('reference', reference\)\.eq\('status', 'initialized'\)/g) ?? [];
    // Both entry points: the direct checkout and the one raised against a payment request.
    expect(conditional).toHaveLength(2);
    expect(lib).toContain("That checkout was closed while it was being opened.");
  });

  // A Paystack session can time out, so neither Continue nor a reminder days later may lead
  // straight to a stored link.
  it('reopens a checkout through recovery rather than a stored link', () => {
    const route = read('app/api/student-subscriptions/route.ts');
    expect(route).toContain("body.action === 'resume-cart'");
    const component = read('components/student/subscription-payments.tsx');
    expect(component).toContain('resumeCart(data.cart.reference)');
    expect(component).not.toContain('href={data.cart.authorization_url}');
    const sender = read('lib/notify-paystack-cart.ts');
    expect(sender).toContain('/student?section=payments');
    expect(sender).not.toContain('href="${escapeHtml(claim.authorizationUrl)}"');
  });

  // An ordinary cart is not something support should be triaging.
  it('keeps ordinary carts out of the admin review queue', () => {
    const queue = read('lib/paystack-review-queue.ts');
    expect(queue).toContain("const IN_FLIGHT_STATUSES = ['pending', 'ongoing', 'processing', 'queued']");
    expect(queue).not.toContain("['initialized', 'pending'");
  });

  it('lets a learner choose bank transfer while Paystack is configured', () => {
    const component = read('components/student/subscription-payments.tsx');
    expect(component).toContain('paystack: data?.paystackEnabled === true && !payManually');
    expect(component).toContain('Prefer to pay by bank transfer or mobile money?');
  });

  // Offered back, not chased. Nothing here says owed, due, or overdue.
  it('offers the unfinished checkout back as a choice', () => {
    const component = read('components/student/subscription-payments.tsx');
    const section = cartSection(component);
    // Offered, not chased. The words that turn a cart into a debt are the regression worth
    // catching; the exact invitation can be rewritten freely.
    for (const chasing of ['owed', 'overdue', 'outstanding', 'past due', 'you must']) {
      expect(section.toLowerCase()).not.toContain(chasing);
    }
    // And it can always be cleared, which is what keeps it a choice.
    expect(component).toContain('dismissCart(data.cart.reference)');
  });
});
