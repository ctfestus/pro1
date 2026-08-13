import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

function functionBody(sql: string, name: string): string {
  const start = sql.indexOf(`FUNCTION public.${name}`);
  if (start < 0) throw new Error(`Missing SQL function ${name}`);
  const end = sql.indexOf('$$;', start);
  if (end < 0) throw new Error(`Unterminated SQL function ${name}`);
  return sql.slice(start, end);
}

describe('subscription production safety regressions', () => {
  const lockMigration = read('migrations/175_subscription_confirmation_lock_order.sql');
  const studentDeletionMigration = read('migrations/176_close_subscriptions_on_student_delete.sql');
  const schema = read('festman-fresh-schema.sql');
  const digest = read('app/api/cron/at-risk-digest/route.ts');

  it.each([
    'approve_subscription_payment_confirmation',
    'reject_subscription_payment_confirmation',
  ])('%s locks the request before the confirmation', name => {
    for (const sql of [lockMigration, schema]) {
      const body = functionBody(sql, name);
      const requestLock = body.indexOf('FROM public.subscription_payment_requests');
      const confirmationLock = body.indexOf('FROM public.subscription_payment_confirmations', body.indexOf('FOR UPDATE'));
      expect(requestLock).toBeGreaterThan(-1);
      expect(confirmationLock).toBeGreaterThan(requestLock);
    }
  });

  it('excludes released bootcamp enrollments from the weekly digest', () => {
    const enrollmentQuery = digest.slice(
      digest.indexOf("supabase.from('bootcamp_enrollments')"),
      digest.indexOf("supabase.from('course_attempts')", digest.indexOf("supabase.from('bootcamp_enrollments')")),
    );
    expect(enrollmentQuery).toContain(".is('released_at', null)");
  });

  it('closes active subscriptions before a student is deleted', () => {
    for (const sql of [studentDeletionMigration, schema]) {
      const body = functionBody(sql, 'close_subscription_before_student_delete');
      expect(body).toContain("status = 'cancelled'");
      expect(body).toContain('student_id = OLD.id');
      expect(sql).toContain('BEFORE DELETE ON public.students');
    }
  });

  it('repairs already-orphaned active subscription state', () => {
    expect(studentDeletionMigration).toContain('WHERE student_id IS NULL');
    expect(studentDeletionMigration).toContain("AND status = 'active'");
  });

  it('cancels open payment requests and rejects pending confirmations on deletion', () => {
    for (const sql of [studentDeletionMigration, schema]) {
      const body = functionBody(sql, 'close_subscription_before_student_delete');
      const requestLock = body.indexOf('FROM public.subscription_payment_requests');
      const confirmationUpdate = body.indexOf('UPDATE public.subscription_payment_confirmations');
      const requestUpdate = body.indexOf('UPDATE public.subscription_payment_requests');
      expect(requestLock).toBeGreaterThan(-1);
      expect(confirmationUpdate).toBeGreaterThan(requestLock);
      expect(requestUpdate).toBeGreaterThan(confirmationUpdate);
      expect(body).toContain("status IN ('pending', 'confirmation_submitted')");
      expect(body).toContain("confirmation.status = 'pending'");
    }
  });

  it('approval locks student, request, then confirmation', () => {
    for (const sql of [studentDeletionMigration, schema]) {
      const body = functionBody(sql, 'approve_subscription_payment_confirmation');
      const studentLock = body.indexOf('FROM public.students');
      const requestLock = body.indexOf('FROM public.subscription_payment_requests', studentLock);
      const confirmationLock = body.indexOf('FROM public.subscription_payment_confirmations', requestLock);
      expect(studentLock).toBeGreaterThan(-1);
      expect(requestLock).toBeGreaterThan(studentLock);
      expect(confirmationLock).toBeGreaterThan(requestLock);
    }
  });

  it('repairs already-orphaned open payment requests', () => {
    const orphanRepair = studentDeletionMigration.slice(
      studentDeletionMigration.indexOf('-- Today, an open request can have a NULL student_id'),
    );
    expect(orphanRepair).toContain('WHERE student_id IS NULL');
    expect(orphanRepair).toContain('ORDER BY id');
    expect(orphanRepair.indexOf('FOR UPDATE')).toBeLessThan(
      orphanRepair.indexOf('UPDATE public.subscription_payment_confirmations'),
    );
    expect(orphanRepair).toContain("status IN ('pending', 'confirmation_submitted')");
  });
});
