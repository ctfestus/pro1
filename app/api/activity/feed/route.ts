import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError }  from '@/lib/api-auth';
import { getRedis }                  from '@/lib/redis';
import { activityKey }               from '@/lib/activity';
import { requireBootcampCohortAccess } from '@/lib/bootcamp-cohort-access';

export async function GET(req: NextRequest) {
  const cohortId = req.nextUrl.searchParams.get('cohort_id');
  if (!cohortId) return NextResponse.json({ events: [] });

  // Authenticate through the shared boundary rather than reading the bearer token here.
  // Hand-rolled token checks skip the account-state gate in lib/api-auth, which is how
  // this route stayed reachable by a session that had not finished password setup.
  // The empty-payload shape is preserved on failure -- this is a display widget and its
  // callers parse the body without checking status.
  const auth = await requireUser(req);
  if (isAuthError(auth)) {
    return NextResponse.json({ events: [] }, { status: auth.error.status });
  }
  const access = await requireBootcampCohortAccess(auth, cohortId);
  if ('error' in access) return NextResponse.json({ events: [] }, { status: access.error.status });

  const redis = getRedis();
  if (!redis) return NextResponse.json({ events: [] });

  try {
    const since = Date.now() - 24 * 60 * 60 * 1000; // last 24 h
    // zrange with BYSCORE + REV returns highest-score (newest) first
    const raw = await redis.zrange(activityKey(cohortId), '+inf', since, {
      byScore: true,
      rev:     true,
      offset:  0,
      count:   20,
    });

    const events = (raw as string[])
      .map(s => { try { return JSON.parse(s); } catch { return null; } })
      .filter(Boolean);

    return NextResponse.json({ events });
  } catch (err) {
    console.error('[activity/feed]', err);
    return NextResponse.json({ events: [] });
  }
}
