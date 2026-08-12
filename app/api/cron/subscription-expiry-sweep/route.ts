/**
 * Hourly subscription expiry sweep.
 * QStash schedule: 0 * * * * POST /api/cron/subscription-expiry-sweep
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { expireSubscription } from '@/lib/db-subscriptions';
import { verifyQStashRequest } from '@/lib/qstash';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { valid } = await verifyQStashRequest(req);
  if (!valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = adminClient();
  const { data: candidates, error } = await db
    .from('individual_subscriptions')
    .select('id')
    .eq('status', 'active')
    .lt('current_period_end', new Date().toISOString());

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let expired = 0;
  let skipped = 0;
  let failed = 0;

  for (const candidate of candidates ?? []) {
    try {
      const result = await expireSubscription(db, candidate.id);
      if (result.skipped) skipped++;
      else expired++;
    } catch (err) {
      failed++;
      console.error('[cron/subscription-expiry-sweep]', candidate.id, err);
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    processed: (candidates ?? []).length,
    expired,
    skipped,
    failed,
  });
}
