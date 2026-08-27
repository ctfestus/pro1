import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const compact = (value: string) => value.replace(/\s+/g, ' ');

describe('Paystack payment properties', () => {
  const core = compact(read('migrations/187_paystack_subscription_transactions.sql'));
  const schema = compact(read('festman-fresh-schema.sql'));

  it('credits a reference at most once under a row lock', () => {
    for (const sql of [core, schema]) {
      expect(sql).toContain('WHERE reference=p_reference FOR UPDATE');
      expect(sql).toContain("WHERE idempotency_key='paystack:'||p_reference");
      expect(sql).toContain('processed_payment_id IS NOT NULL');
    }
  });

  it('blocks credit whenever the transaction has an open blocking incident', () => {
    for (const sql of [core, schema]) {
      expect(sql).toContain('FROM public.paystack_review_incidents');
      expect(sql).toContain("status='open'");
      expect(sql).toContain('blocks_credit=true');
      expect(sql).toContain("reason','open_review_incident'");
    }
  });

  it('uses one uniquely keyed incident as the review and alert source', () => {
    for (const sql of [core, schema]) {
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.paystack_review_incidents');
      expect(sql).toContain('incident_key text NOT NULL UNIQUE');
      expect(sql).toContain('notification_attempts integer NOT NULL DEFAULT 0');
      expect(sql).toContain("status text NOT NULL DEFAULT 'open'");
      expect(sql).toContain("notification_attempts=CASE WHEN existing.status='resolved' THEN 0 ELSE existing.notification_attempts END");
    }
  });

  // Buying online attaches no payment request, so the finalizer has to tell two cases apart:
  // no request was ever attached, which is a direct checkout and fine to credit; and a request was
  // attached but is missing or no longer open, which means the learner paid against something
  // already settled or cancelled and must raise an incident instead. Conflating them either blocks
  // every online payment or loses the protection, so both halves are pinned here.
  it('credits a direct checkout but not one whose request has closed', () => {
    const direct = compact(read('migrations/189_direct_checkout_without_payment_request.sql'));
    for (const sql of [direct, schema]) {
      expect(sql).toContain('IF v_transaction.request_id IS NOT NULL THEN');
      expect(sql).toContain("IF v_request.id IS NULL OR v_request.status<>'pending' THEN");
      expect(sql).toContain("'payment_request_not_open'");
      // The request is only settled when one exists.
      expect(sql).toContain('IF v_request.id IS NOT NULL THEN');
    }
  });

  // Two tabs must not both walk away holding a payable Paystack link. The payment request used
  // to prevent that by being one-per-learner; reserving under a lock on the learner row replaces
  // it, and a check-then-insert in application code would not.
  it('reserves a direct checkout atomically', () => {
    const direct = compact(read('migrations/189_direct_checkout_without_payment_request.sql'));
    for (const sql of [direct, schema]) {
      expect(sql).toContain('PERFORM 1 FROM public.students WHERE id=p_student_id FOR UPDATE');
      expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_paystack_direct_checkout_one_live');
      // An unfinished checkout blocks like any other live state, and is handed back rather than
      // replaced. Retiring it and inserting a new one released the lock between the two, so a
      // second tab could leave both callers holding a payable link.
      expect(sql).toContain("status IN('initialized','pending','ongoing','processing','queued','needs_review')");
      expect(sql).toContain("'status','existing'");
      expect(sql).not.toContain("'superseded_by_new_checkout'");
    }
  });

  // A credited payment is finished history. Counting it as money in play blocked every renewal a
  // learner would ever make after their first payment.
  it('lets a learner who has already paid start a renewal', () => {
    const direct = compact(read('migrations/189_direct_checkout_without_payment_request.sql'));
    for (const sql of [direct, schema]) {
      expect(sql).toContain("(status='success' AND processed_payment_id IS NULL)");
      expect(sql).not.toContain("status IN('pending','ongoing','processing','queued','success','needs_review') LIMIT 1");
    }
  });

  // This runs at deploy time and somebody may be on the Paystack page at that moment. Cancelling
  // their request turns a payment that should grant access instantly into a review incident.
  // A learner's own id on a request does not prove it came from an abandoned checkout. The old
  // code raised a request on both paths, so when Paystack was unconfigured, choosing a plan
  // produced a genuine bank-transfer request -- possibly one where the money has already been
  // sent. A Paystack transaction is what actually tells them apart: the online path always made
  // one, the manual path never did.
  it('only cancels requests with a finished checkout attached', () => {
    const direct = compact(read('migrations/189_direct_checkout_without_payment_request.sql'));
    // Must require evidence of an online checkout the provider already recorded as finished...
    expect(direct).toContain("t.status IN('failed','abandoned')");
    expect(direct).toMatch(/AND EXISTS\( SELECT 1 FROM public\.paystack_subscription_transactions/);
    // ...and refuse if any other checkout is attached at all. An 'initialized' row is not proof
    // that no money moved, however old: Paystack may hold a payable link, or the payment may have
    // gone through with the webhook still to arrive. Age is not evidence.
    expect(direct).toContain("t.status<>'failed' AND t.status<>'abandoned'");
    expect(direct).not.toContain("t.status='initialized' AND t.updated_at < now() - interval '1 hour'");
    // Age of the request is not a condition either: this runs once, nothing revisits what it skips.
    expect(direct).not.toContain("r.created_at < now() - interval '1 hour'");
    // Only self-raised requests, and never one with a receipt already submitted.
    expect(direct).toContain('r.created_by=r.student_id');
    expect(direct).toContain("c.status='pending'");
  });

  // Every condition on starting a checkout belongs in one place. Spreading them across the
  // browser, the route and the database is what made each fix open a new hole.
  it('keeps all checkout preconditions in the reservation', () => {
    const direct = compact(read('migrations/189_direct_checkout_without_payment_request.sql'));
    for (const sql of [direct, schema]) {
      // A genuine open request blocks, and not merely in the browser.
      expect(sql).toContain('FROM public.subscription_payment_requests');
      expect(sql).toContain("'status','open_request'");
      // A checkout with no usable link is handed back for verification, never treated as live.
      expect(sql).toContain("'status','unverified'");
      // A row reserved moments ago is another tab mid-initialization, not something to verify.
      expect(sql).toContain('v_live.authorization_url IS NULL AND v_live.updated_at > now()-p_initializing_grace');
      expect(sql).toContain("'blockingStatus','initializing'");
      expect(sql).toContain('v_live.authorization_url IS NOT NULL AND v_live.updated_at > now()-p_link_stale_after');
    }
  });

  it('does not restore lifecycle ranking, signatures, or transaction alert ownership', () => {
    for (const sql of [core, schema]) {
      expect(sql).not.toContain('lifecycle_event_rank');
      expect(sql).not.toContain('lifecycle_event_signature');
      expect(sql).not.toContain('reconciliation_required_at');
      expect(sql).not.toContain('reconciliation_notified_at');
    }
  });

  it('keeps webhook retries bounded without making webhook rows a second alert queue', () => {
    for (const sql of [core, schema]) {
      expect(sql).toContain('processing_attempts integer NOT NULL DEFAULT 0');
      expect(sql).toContain('last_processing_attempt_at');
      expect(sql).not.toContain('paystack_webhook_events_reconciliation');
    }
  });
});
