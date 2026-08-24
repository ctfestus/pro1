import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { parseReviewNotes } from '@/lib/reviewRecord';
import { readFileSync } from 'fs';
import { join } from 'path';
import JSZip from 'jszip';

export const dynamic = 'force-dynamic';

function inferTopics(questions: any[]): string[] {
  const topicMap: Record<string, string> = {
    sql_exercise:       'SQL',
    sql_review:         'SQL',
    sql_playground:     'SQL',
    python_exercise:    'Python',
    python_review:      'Python',
    excel_review:       'Excel',
    dashboard_critique: 'Data Visualization',
    code_review:        'Programming',
    document_review:    'Business Analysis',
  };
  const found = new Set<string>();
  for (const q of questions ?? []) {
    const topic = topicMap[q.type as string];
    if (topic) found.add(topic);
  }
  return [...found];
}

function extractModuleTitles(modules: any[]): string[] {
  return (modules ?? []).map((m: any) => m.title ?? m.name).filter(Boolean);
}

// GET /api/portfolio
// Returns portfolio-builder.zip containing:
// portfolio-builder/SKILL.md -- the Claude skill
// portfolio-builder/portfolio-data.json -- the student's completed work data
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;
  const scopeType = req.nextUrl.searchParams.get('type');
  const scopeId = req.nextUrl.searchParams.get('id');
  const scopedVeId = scopeType === 'virtual_experience' && scopeId ? scopeId : null;
  const scopedAssignmentId = scopeType === 'assignment' && scopeId ? scopeId : null;

  if ((scopeType || scopeId) && !scopedVeId && !scopedAssignmentId) {
    return NextResponse.json({ error: 'Unknown portfolio package scope' }, { status: 400 });
  }

  try {
    // --- Assemble portfolio data ---

    const { data: student } = await supabase
      .from('students')
      .select('full_name, email, skills, bio')
      .eq('id', user.id)
      .single();

    const { data: courseAttempts } = await supabase
      .from('course_attempts')
      .select('score, passed, completed_at, course_id')
      .eq('student_id', user.id)
      .not('completed_at', 'is', null)
      .eq('passed', true);

    const courseIds = [...new Set((courseAttempts ?? []).map((a: any) => a.course_id).filter(Boolean))];
    const { data: courseRows } = courseIds.length
      ? await supabase.from('courses').select('id, title, description, learn_outcomes, category, questions').in('id', courseIds)
      : { data: [] };
    const courseMap = Object.fromEntries((courseRows ?? []).map((r: any) => [r.id, r]));

    let veAttemptsQuery = supabase
      .from('guided_project_attempts')
      .select('completed_at, ve_id')
      .eq('student_id', user.id)
      .not('completed_at', 'is', null);
    const { data: veAttempts } = await veAttemptsQuery;

    const veIds = [...new Set((veAttempts ?? []).map((a: any) => a.ve_id).filter(Boolean))];
    const { data: veRows } = veIds.length
      ? await supabase
          .from('virtual_experiences')
          .select('id, title, description, tagline, industry, role, company, tools, learn_outcomes, background, difficulty, duration, modules')
          .in('id', veIds)
      : { data: [] };
    const veMap = Object.fromEntries((veRows ?? []).map((r: any) => [r.id, r]));

    let submissionsQuery = supabase
      .from('assignment_submissions')
      .select('score, submitted_at, status, feedback, assignment_id, participants')
      .in('status', ['submitted', 'graded']);
    submissionsQuery = submissionsQuery
      .eq('student_id', user.id)
      .not('feedback', 'is', null);
    const { data: submissions } = await submissionsQuery;

    let selectedSubmission: any | null = null;
    if (scopedAssignmentId && !(submissions ?? []).some((s: any) => s.assignment_id === scopedAssignmentId)) {
      const { data } = await supabase
        .from('assignment_submissions')
        .select('score, submitted_at, status, feedback, assignment_id, participants')
        .eq('assignment_id', scopedAssignmentId)
        .in('status', ['submitted', 'graded'])
        .or(`student_id.eq.${user.id},participants.cs.{${user.id}}`)
        .maybeSingle();
      selectedSubmission = data ?? null;
    }

    const allSubmissions = selectedSubmission
      ? [...(submissions ?? []), selectedSubmission]
      : (submissions ?? []);

    const assignmentIds = [...new Set(allSubmissions.map((s: any) => s.assignment_id).filter(Boolean))];
    const { data: assignmentRows } = assignmentIds.length
      ? await supabase.from('assignments').select('id, title, type, scenario, brief, tasks').in('id', assignmentIds)
      : { data: [] };
    const assignmentMap = Object.fromEntries((assignmentRows ?? []).map((r: any) => [r.id, r]));

    let certsQuery = supabase
      .from('certificates')
      .select('id, issued_at, course_id, ve_id, learning_path_id')
      .eq('student_id', user.id)
      .eq('revoked', false)
      .order('issued_at', { ascending: false });
    const { data: certs } = await certsQuery;

    const { data: earnedBadges } = await supabase
      .from('student_badges')
      .select('awarded_at, badge_id')
      .eq('student_id', user.id);

    const badgeIds = [...new Set((earnedBadges ?? []).map((b: any) => b.badge_id).filter(Boolean))];
    const { data: badgeRows } = badgeIds.length
      ? await supabase.from('badges').select('id, name, description').in('id', badgeIds)
      : { data: [] };
    const badgeMap = Object.fromEntries((badgeRows ?? []).map((r: any) => [r.id, r]));

    const portfolio = {
      selectedProject: scopedVeId
        ? { type: 'virtual_experience', id: scopedVeId }
        : scopedAssignmentId
          ? { type: 'assignment', id: scopedAssignmentId }
          : null,
      student: {
        name:   student?.full_name ?? '',
        email:  student?.email ?? '',
        skills: student?.skills ?? [],
        bio:    student?.bio ?? '',
      },
      courses: (courseAttempts ?? []).map((a: any) => {
        const c = courseMap[a.course_id] ?? {};
        return {
          title:         c.title ?? '',
          description:   c.description ?? '',
          category:      c.category ?? '',
          learnOutcomes: (c.learn_outcomes ?? []).filter(Boolean),
          topics:        inferTopics(c.questions ?? []),
          score:         a.score,
          passed:        a.passed,
          completedAt:   a.completed_at,
        };
      }).filter((c: any) => c.title),
      virtualExperiences: (veAttempts ?? []).map((a: any) => {
        const v = veMap[a.ve_id] ?? {};
        return {
          title:         v.title ?? '',
          tagline:       v.tagline ?? '',
          description:   v.description ?? '',
          background:    v.background ?? '',
          industry:      v.industry ?? '',
          role:          v.role ?? '',
          company:       v.company ?? '',
          tools:         (v.tools ?? []).filter(Boolean),
          learnOutcomes: (v.learn_outcomes ?? []).filter(Boolean),
          modules:       extractModuleTitles(v.modules ?? []),
          difficulty:    v.difficulty ?? '',
          duration:      v.duration ?? '',
          completedAt:   a.completed_at,
        };
      }).filter((v: any) => v.title),
      assignments: allSubmissions.map((s: any) => {
        const asgn = assignmentMap[s.assignment_id] ?? {};
        const record = s.feedback ? parseReviewNotes(s.feedback) : null;
        const report = record?.report;
        return {
          title:              asgn.title ?? '',
          type:               asgn.type ?? '',
          scenario:           asgn.scenario ?? '',
          brief:              asgn.brief ?? '',
          tasks:              asgn.tasks ?? '',
          submittedAt:        s.submitted_at,
          score:              s.score,
          executiveSummary:   report?.executiveSummary ?? '',
          topRecommendations: report?.topRecommendations ?? [],
          rubricGrades:       (report?.rubricGrades ?? []).map((g: any) => ({
            criterion: g.criterion,
            passed:    g.passed,
            comment:   g.comment,
          })),
        };
      }).filter((a: any) => a.title),
      certificates: (certs ?? []).map((c: any) => ({
        certId:   c.id,
        courseId: c.course_id ?? null,
        veId:     c.ve_id ?? null,
        pathId:   c.learning_path_id ?? null,
        issuedAt: c.issued_at,
      })),
      badges: (earnedBadges ?? []).map((b: any) => ({
        name:        badgeMap[b.badge_id]?.name ?? '',
        description: badgeMap[b.badge_id]?.description ?? '',
        awardedAt:   b.awarded_at,
      })).filter((b: any) => b.name),
    };

    // --- Bundle SKILL.md + portfolio-data.json into one zip ---
    const skillContent = readFileSync(join(process.cwd(), 'lib', 'portfolio-skill.md'), 'utf8');
    const dataContent  = JSON.stringify(portfolio, null, 2);

    const zip = new JSZip();
    const folder = zip.folder('portfolio-builder')!;
    folder.file('SKILL.md', skillContent);
    folder.file('portfolio-data.json', dataContent);

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':        'application/zip',
        'Content-Disposition': 'attachment; filename="portfolio-builder.zip"',
      },
    });
  } catch (err) {
    console.error('[/api/portfolio]', err);
    return NextResponse.json({ error: 'Failed to generate portfolio package' }, { status: 500 });
  }
}
