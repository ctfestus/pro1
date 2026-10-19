import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { requireBootcampCohortAccess } from '@/lib/bootcamp-cohort-access';
import { rankCourseAttempts, type CourseRankResult, type RankAttempt, type RankRosterEntry } from '@/lib/course-rank';
import { fetchAllRows, fetchAllRowsByIds } from '@/lib/fetch-all-rows';

export const dynamic = 'force-dynamic';

const INELIGIBLE: CourseRankResult = { eligible: false };

// course_attempts.course_id is a uuid; anything else makes Postgres throw, which would surface as 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/course-rank?course_id=...
// The caller's rank on one course within their own bootcamp cohort. A completed attempt is the
// proof of access: a course that does not exist, is not theirs, or is not finished all return the
// same { eligible: false }, so the response never reveals which. Auth and DB failures are not
// folded into that -- they stay 401 / 500 so an outage does not look like a hidden card.
export async function GET(req: NextRequest) {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth)) return auth.error;

  const courseId = new URL(req.url).searchParams.get('course_id');
  if (!courseId || !UUID_RE.test(courseId)) {
    return NextResponse.json({ error: 'A valid course_id is required.' }, { status: 400 });
  }

  try {
    const serviceDb = auth.serviceDb;

    const { data: profile, error: pErr } = await serviceDb
      .from('students')
      .select('role, cohort_id')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (pErr) {
      console.error('[course-rank] profile fetch', pErr);
      return NextResponse.json({ error: 'Failed to load rank.' }, { status: 500 });
    }
    if (!profile?.cohort_id || profile.role !== 'student') return NextResponse.json(INELIGIBLE);

    const access = await requireBootcampCohortAccess(auth, profile.cohort_id);
    if ('error' in access) {
      return access.error.status >= 500 ? access.error : NextResponse.json(INELIGIBLE);
    }

    // Paged and id-chunked: a single select is silently capped at the project's max rows, which
    // would drop students or retakes and produce a wrong rank, total, or best attempt.
    const roster = await fetchAllRows<RankRosterEntry>((from, to) => serviceDb
      .from('students')
      .select('id, full_name', { count: 'exact' })
      .eq('cohort_id', profile.cohort_id)
      .eq('role', 'student')
      .order('id')
      .range(from, to));
    if (!roster.length) return NextResponse.json(INELIGIBLE);

    const attempts = await fetchAllRowsByIds<RankAttempt>(roster.map(s => s.id), (ids, from, to) => serviceDb
      .from('course_attempts')
      .select('student_id, score, points, completed_at', { count: 'exact' })
      .eq('course_id', courseId)
      .in('student_id', ids)
      .not('completed_at', 'is', null)
      .order('id')
      .range(from, to));

    return NextResponse.json(rankCourseAttempts(attempts, roster, auth.user.id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (err: any) {
    console.error('[course-rank]', err);
    return NextResponse.json({ error: 'Failed to load rank.' }, { status: 500 });
  }
}
