import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Supabase service role key not configured');
  return createClient(url, key);
}

async function getSessionUser(req: NextRequest) {
  const auth = await requireStudentUser(req);
  return isAuthError(auth) ? null : auth.user;
}

// GET /api/leaderboard?cohort_id=...
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const cohortId = searchParams.get('cohort_id');
  if (!cohortId) return NextResponse.json({ error: 'cohort_id required' }, { status: 400 });

  try {
    const supabase = adminClient();

    // Resolve caller's profile -- single indexed lookup by PK
    const { data: profile } = await supabase
      .from('students')
      .select('role, cohort_id, email')
      .eq('id', user.id)
      .single();

    if (!profile) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const isInstructorOrAdmin = profile.role === 'instructor' || profile.role === 'admin';

    // --- Access control ---
    if (!isInstructorOrAdmin) {
      // Students can only view their own cohort's leaderboard
      if (profile.cohort_id !== cohortId) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

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

    const callerEmail = (profile.email ?? user.email ?? '').toLowerCase().trim();

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
