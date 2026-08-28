import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const compact = (value: string) => value.replace(/\s+/g, ' ');

// An unfinished checkout is a cart: ordinary, the learner's own, and never a debt. The dangerous
// version of this feature is one that chases somebody for money they already paid, or clears a
// checkout while the provider is holding funds, so those two guards are what these pin.

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

  // Someone who has since bought access, by any route, must never be chased about a cart.
  it('stops chasing a learner who already has access', () => {
    expect(cart).toContain("s.status='active' AND s.current_period_end>now()");
    expect(cart).toContain('cart_superseded_by_active_subscription');
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
    expect(route).toContain('const settled = await settleUnfinishedCheckout(db, reference);');
    expect(route).toContain('if (!settled.abandoned) {');
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
    expect(component).toContain('{data?.cart && !hasActiveAccess && !openRequest && !readOnly');
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
    expect(component).toContain('You were considering');
    expect(component).toContain('dismissCart(data.cart.reference)');
  });
});
