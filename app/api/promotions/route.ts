import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { isPromoPlacement, parseClosedPromos, parseViewerDate } from '@/lib/promotions';

// GET /api/promotions?placement=landing|student|course&closed=<id>:<closedAtEpochSeconds>,...&today=YYYY-MM-DD
// Answers { promotion, today }: the one live promo this viewer should see next (or null), and the
// date its event rows were judged by. A closed promo stays hidden unless its reshow_after_days has
// passed since it was closed. The `today` parameter is the viewer's local date.
//
// Public: the landing pages call it signed out. With a Bearer token the viewer's cohort is used for
// audience targeting, and requireStudentUser resolves a Student Mode target, so an admin viewing as
// a student sees that student's promos. A token that fails auth falls back to the signed-out
// audience rather than erroring, since everyone-audience promos are public anyway.
//
// A temporary database failure answers 503 so PromoCard retries it; answering "no promo" would
// clear the slot for the rest of the day. A tenant that has not run migrations 219/220 yet gets
// "no promo" instead, since retrying cannot fix a missing table or function.

// PostgREST: function / table not in the schema cache. Postgres: undefined function / table /
// column (get_live_promotion or the 220 columns not created yet).
const NOT_MIGRATED_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42P01', '42703']);

function retryLater(what: string, message: string) {
  console.error(`[promotions] ${what} failed:`, message);
  return NextResponse.json(
    { promotion: null, error: 'Promotions are temporarily unavailable' },
    { status: 503, headers: { 'Retry-After': '30', 'Cache-Control': 'no-store' } },
  );
}

export async function GET(req: NextRequest) {
  const placement = req.nextUrl.searchParams.get('placement');
  if (!isPromoPlacement(placement)) {
    return NextResponse.json({ error: 'Invalid placement' }, { status: 400 });
  }
  const closed = parseClosedPromos(req.nextUrl.searchParams.get('closed'));
  // The date event rows are judged by: the viewer's own, or the server's (UTC) when the viewer's
  // is missing or implausible (a device clock days off). It is returned with the promo and the
  // card judges rows by the same date, so the two can never disagree about which rows passed.
  const today = parseViewerDate(req.nextUrl.searchParams.get('today')) ?? new Date().toISOString().slice(0, 10);

  let db = adminClient();
  let cohortId: string | null = null;
  if (req.headers.get('authorization')?.startsWith('Bearer ')) {
    const auth = await requireStudentUser(req);
    if (!isAuthError(auth)) {
      db = auth.serviceDb;
      const { data: student, error: studentError } = await db.from('students').select('cohort_id').eq('id', auth.user.id).maybeSingle();
      // Guessing "no cohort" here would silently hide this viewer's targeted promos.
      if (studentError) return retryLater('cohort lookup', studentError.message);
      cohortId = student?.cohort_id ?? null;
    }
  }

  const { data, error } = await db.rpc('get_live_promotion', {
    p_placement: placement,
    p_cohort_id: cohortId,
    p_closed_ids: closed.ids,
    p_closed_at: closed.closedAt,
    p_today: today,
  });
  if (error) {
    if (error.code && NOT_MIGRATED_CODES.has(error.code)) {
      console.error('[promotions] not migrated:', error.code, error.message);
      return NextResponse.json({ promotion: null, today }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    return retryLater('lookup', error.message);
  }
  const promotion = Array.isArray(data) ? data[0] ?? null : null;
  return NextResponse.json({ promotion, today }, { headers: { 'Cache-Control': 'private, no-store' } });
}
