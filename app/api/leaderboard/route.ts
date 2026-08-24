import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { requireBootcampCohortAccess } from '@/lib/bootcamp-cohort-access';

export const dynamic = 'force-dynamic';

// GET /api/leaderboard?cohort_id=...
export async function GET(req: NextRequest) {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth)) return auth.error;

  const { searchParams } = new URL(req.url);
  const cohortId = searchParams.get('cohort_id');
  if (!cohortId) return NextResponse.json({ error: 'cohort_id required' }, { status: 400 });

  try {
    const supabase = auth.supabase;
    const access = await requireBootcampCohortAccess(auth, cohortId, { anyCohortRoles: ['instructor', 'admin'] });
    if ('error' in access) return access.error;
    const { profile } = access;
    const isInstructorOrAdmin = profile.role === 'instructor' || profile.role === 'admin';

    // --- Fetch all data in parallel ---
    const [
      { data: students, error: sErr },
    ] = await Promise.all([
      supabase
        .from('students')
        .select('id, full_name, email')
        .eq('cohort_id', cohortId)
        .eq('role', 'student'),
    ]);

    if (sErr) {
      console.error('[leaderboard] students fetch', sErr);
      return NextResponse.json({ error: 'Failed to load leaderboard.' }, { status: 500 });
    }
    if (!students?.length) return NextResponse.json({ rankings: [] });

    const studentIds = students.map((s: any) => s.id);

    // Fetch XP and completions in parallel -- both use indexed columns
    const [{ data: xpRows }, { data: completions }] = await Promise.all([
      supabase
        .from('student_xp')
        .select('student_id, total_xp')
        .in('student_id', studentIds),
      supabase
        .from('course_attempts')
        .select('student_id')
        .in('student_id', studentIds)
        .eq('passed', true)
        .not('completed_at', 'is', null),
    ]);

    const xpMap: Record<string, number> = {};
    for (const x of xpRows ?? []) xpMap[x.student_id] = x.total_xp;

    const completionCount: Record<string, number> = {};
    for (const c of completions ?? []) {
      completionCount[c.student_id] = (completionCount[c.student_id] ?? 0) + 1;
    }

    const callerEmail = (profile.email ?? auth.user.email ?? '').toLowerCase().trim();

    const ranked = students
      .map((s: any) => ({
        id:          s.id,
        email:       s.email,
        name:        s.full_name?.trim() || s.email,
        xp:          xpMap[s.id] ?? 0,
        completions: completionCount[s.id] ?? 0,
      }))
      .sort((a: any, b: any) => b.xp - a.xp || b.completions - a.completions)
      .map((s: any, i: number) => ({ ...s, rank: i + 1 }));

    const response = ranked.map((s: any) => ({
      rank:        s.rank,
      name:        s.name,
      xp:          s.xp,
      completions: s.completions,
      ...(isInstructorOrAdmin ? { email: s.email } : { isMe: s.email.toLowerCase() === callerEmail }),
    }));

    return NextResponse.json({ rankings: response }, {
      headers: {
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch (err: any) {
    console.error('[leaderboard]', err);
    return NextResponse.json({ error: 'Failed to load leaderboard.' }, { status: 500 });
  }
}
