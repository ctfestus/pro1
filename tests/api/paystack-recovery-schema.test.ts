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
