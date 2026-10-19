import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { requireBootcampCohortAccess } from '@/lib/bootcamp-cohort-access';
import { rankCourseAttempts, type CourseRankResult } from '@/lib/course-rank';

export const dynamic = 'force-dynamic';

const INELIGIBLE: CourseRankResult = { eligible: false };

// GET /api/course-rank?course_id=...
// The caller's rank on one course within their own bootcamp cohort. A completed attempt is the
// proof of access: a course that does not exist, is not theirs, or is not finished all return the
// same { eligible: false }, so the response never reveals which. Auth and DB failures are not
// folded into that -- they stay 401 / 500 so an outage does not look like a hidden card.
export async function GET(req: NextRequest) {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth)) return auth.error;

  const courseId = new URL(req.url).searchParams.get('course_id');
  if (!courseId) return NextResponse.json({ error: 'course_id required' }, { status: 400 });

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

    const { data: roster, error: rErr } = await serviceDb
      .from('students')
      .select('id, full_name')
      .eq('cohort_id', profile.cohort_id)
      .eq('role', 'student');
    if (rErr) {
      console.error('[course-rank] roster fetch', rErr);
      return NextResponse.json({ error: 'Failed to load rank.' }, { status: 500 });
    }
    if (!roster?.length) return NextResponse.json(INELIGIBLE);

    const { data: attempts, error: aErr } = await serviceDb
      .from('course_attempts')
      .select('student_id, score, points, completed_at')
      .eq('course_id', courseId)
      .in('student_id', roster.map((s: any) => s.id))
      .not('completed_at', 'is', null);
    if (aErr) {
      console.error('[course-rank] attempts fetch', aErr);
      return NextResponse.json({ error: 'Failed to load rank.' }, { status: 500 });
    }

    return NextResponse.json(rankCourseAttempts(attempts ?? [], roster, auth.user.id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (err: any) {
    console.error('[course-rank]', err);
    return NextResponse.json({ error: 'Failed to load rank.' }, { status: 500 });
  }
}
