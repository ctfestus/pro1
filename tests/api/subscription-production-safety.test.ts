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
});
