import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError }  from '@/lib/api-auth';
import { getVectorIndex }            from '@/lib/vector';

// Topic probes: broad queries used to discover what areas exist in the catalog
const TOPIC_PROBES = [
  { id: 'data',      label: 'Data & Analytics',         query: 'data science analytics statistics data analysis visualization' },
  { id: 'design',    label: 'Design & UX',               query: 'user experience UX UI design visual interface prototype' },
  { id: 'tech',      label: 'Technology & Development',  query: 'software programming development coding engineering web app' },
  { id: 'business',  label: 'Business & Finance',        query: 'business management finance entrepreneurship strategy operations' },
  { id: 'marketing', label: 'Marketing & Comms',         query: 'marketing communications content creation digital media branding' },
  { id: 'ai',        label: 'AI & Innovation',           query: 'artificial intelligence machine learning deep learning innovation' },
];

export async function GET(req: NextRequest) {
  // Authenticate through the shared boundary rather than reading the bearer token here.
  // Hand-rolled token checks skip the account-state gate in lib/api-auth, which is how
  // this route stayed reachable by a session that had not finished password setup.
  // The empty-payload shape is preserved on failure -- this is a display widget and its
  // callers parse the body without checking status.
  const auth = await requireUser(req);
  if (isAuthError(auth)) {
    return NextResponse.json({ gaps: [] }, { status: auth.error.status });
  }
  const { user, serviceDb: supabase } = auth;
  if (!user.email) return NextResponse.json({ gaps: [] });

  // Get student cohort + completed course IDs in parallel
  const [{ data: student }, { data: completedAttempts }] = await Promise.all([
    supabase.from('students').select('cohort_id').eq('id', user.id).single(),
    supabase
      .from('course_attempts')
      .select('course_id')
      .eq('student_id', user.id)
      .not('completed_at', 'is', null)
      .eq('passed', true),
  ]);

  if (!student?.cohort_id) return NextResponse.json({ gaps: [] });

  const cohortId    = student.cohort_id;
  const completedIds = new Set((completedAttempts ?? []).map((a: any) => a.course_id));

  const index = getVectorIndex();
  if (!index) return NextResponse.json({ gaps: [] });

  const gaps: Array<{ topic: string; course: { formId: string; title: string; slug: string; coverImage?: string; contentType: string } }> = [];
  const seenFormIds = new Set<string>();

  for (const probe of TOPIC_PROBES) {
    if (gaps.length >= 3) break;

    let results: any[];
    try {
      results = await index.query({
        data:            probe.query,
        topK:            8,
        includeMetadata: true,
        filter:          `status = "published"`,
      });
    } catch {
      continue;
    }

    // Filter to courses in this cohort that the student hasn't completed yet
    const inCohortUncompleted = results.filter((r: any) => {
      if (!r.metadata) return false;
      const inCohort = (r.metadata.cohortIds ?? []).includes(cohortId);
      const notDone  = !completedIds.has(r.metadata.formId);
      const unseen   = !seenFormIds.has(r.metadata.formId);
      return inCohort && notDone && unseen;
    });

    if (inCohortUncompleted.length === 0) continue;

    // Skip this topic if the student has already completed something in it
    const studentCoversThisTopic = results.some(
      (r: any) => r.metadata && completedIds.has(r.metadata.formId),
    );
    if (studentCoversThisTopic) continue;

    const best = inCohortUncompleted[0];
    seenFormIds.add(best.metadata.formId);

    gaps.push({
      topic:  probe.label,
      course: {
        formId:      best.metadata.formId,
        title:       best.metadata.title,
        slug:        best.metadata.slug,
        coverImage:  best.metadata.coverImage,
        contentType: best.metadata.contentType,
      },
    });
  }

  return NextResponse.json({ gaps });
}
