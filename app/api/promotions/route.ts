import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { isPromoPlacement, parsePromoExcludes } from '@/lib/promotions';

// GET /api/promotions?placement=landing|student|course&exclude=<id>,<id>
// The one live promo this viewer should see next, or { promotion: null }.
//
// Public: the landing pages call it signed out. With a Bearer token the viewer's cohort is used for
// audience targeting, and requireStudentUser resolves a Student Mode target, so an admin viewing as
// a student sees that student's promos. A token that fails auth falls back to the signed-out
// audience rather than erroring, since everyone-audience promos are public anyway.
export async function GET(req: NextRequest) {
  const placement = req.nextUrl.searchParams.get('placement');
  if (!isPromoPlacement(placement)) {
    return NextResponse.json({ error: 'Invalid placement' }, { status: 400 });
  }
  const exclude = parsePromoExcludes(req.nextUrl.searchParams.get('exclude'));

  let db = adminClient();
  let cohortId: string | null = null;
  if (req.headers.get('authorization')?.startsWith('Bearer ')) {
    const auth = await requireStudentUser(req);
    if (!isAuthError(auth)) {
      db = auth.serviceDb;
      const { data: student } = await db.from('students').select('cohort_id').eq('id', auth.user.id).maybeSingle();
      cohortId = student?.cohort_id ?? null;
    }
  }

  const { data, error } = await db.rpc('get_active_promotion', {
    p_placement: placement,
    p_cohort_id: cohortId,
    p_exclude: exclude,
  });
  if (error) {
    // Includes a tenant that has not run migration 219 yet: no promo, not a broken page.
    console.error('[promotions] lookup failed:', error.message);
    return NextResponse.json({ promotion: null });
  }
  const promotion = Array.isArray(data) ? data[0] ?? null : null;
  return NextResponse.json({ promotion }, { headers: { 'Cache-Control': 'private, no-store' } });
}
