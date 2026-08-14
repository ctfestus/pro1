import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'crypto';
import { hasNudgeBeenSent, recordNudge } from '@/lib/nudge-helpers';
import { getRedis, leaderboardKey, studentNameKey } from '@/lib/redis';
import { publishActivity } from '@/lib/activity';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { updateLearningPathProgress } from '@/lib/learning-path-progress';
import { courseResultEmail } from '@/lib/email-templates';
import { pointsSystemFromCourseRow, linkedInSharePointsFor, type PointsSystem } from '@/lib/course-schema';
import { computeAttemptPoints, isScorableQuestion } from '@/lib/attempt-points';
import { claimLinkedInShare, loadClaimedShareItemIds } from '@/lib/linkedin-share';
import { gradeQuestion, parseAnswer, normalizePythonOutput } from '@/lib/grade-question';
import { ensureCertificate, awardContentBadge, sendCertificateEmailOnce } from '@/lib/issue-certificate';
import { checkRequiredSqlPatterns, compareResults, type SQLResult } from '@/lib/sql-engine';
import { computeServerSqlResult } from '@/lib/sql-engine-server';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Supabase service role key not configured');
  return createClient(url, key);
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getSessionUser(req: NextRequest): Promise<{ id: string; email: string } | null> {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth) || !auth.user.email) return null;
  return { id: auth.user.id, email: auth.user.email.trim().toLowerCase() };
}

function pythonProofSecret(): string {
  return process.env.COURSE_PYTHON_PROOF_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function signPythonProof(courseId: string, questionId: string, output: string): string {
  const secret = pythonProofSecret();
  if (!secret) throw new Error('Python proof secret not configured');
  const payload = JSON.stringify({
    v: 1,
    courseId,
    questionId,
    output: normalizePythonOutput(output),
  });
  return `v1:${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

function verifyPythonProof(courseId: string, questionId: string, output: string, proof: unknown): boolean {
  if (typeof proof !== 'string' || !proof.startsWith('v1:')) return false;
  try {
    const expected = signPythonProof(courseId, questionId, output);
    const a = Buffer.from(proof);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function sqlProofSecret(): string {
  return process.env.COURSE_SQL_PROOF_SECRET || process.env.COURSE_PYTHON_PROOF_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
}

function normalizeSqlProofQuery(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function signSqlProof(courseId: string, studentId: string, questionId: string, query: string): string {
  const secret = sqlProofSecret();
  if (!secret) throw new Error('SQL proof secret not configured');
  const payload = JSON.stringify({
    v: 1,
    courseId,
    studentId,
    questionId,
    query: normalizeSqlProofQuery(query),
  });
  return `v1:${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

function verifySqlProof(courseId: string, studentId: string, questionId: string, query: string, proof: unknown): boolean {
  if (typeof proof !== 'string' || !proof.startsWith('v1:')) return false;
  try {
    const expected = signSqlProof(courseId, studentId, questionId, query);
    const a = Buffer.from(proof);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function coerceSqlResult(value: unknown): SQLResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.columns) || !Array.isArray(record.rows)) return null;
  if (record.columns.length > 100 || record.rows.length > 5000) return null;
  const columns = record.columns.map(column => String(column ?? ''));
  const rows: unknown[][] = [];
  for (const row of record.rows) {
    if (!Array.isArray(row) || row.length > 100) return null;
    rows.push(row.map(cell => {
      if (cell == null || ['string', 'number', 'boolean'].includes(typeof cell)) return cell;
      return String(cell);
    }));
  }
  return {
    columns,
    rows,
    totalRows: Number.isFinite(Number(record.totalRows)) ? Number(record.totalRows) : rows.length,
  };
}

function mergeAnswerFlag(existing: unknown, patch: Record<string, unknown>) {
  const parsed = parseAnswer(existing);
  return JSON.stringify({
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
    ...patch,
  });
}

type ExerciseAnswerContext = {
  courseId: string;
  studentId: string;
  questionId: string;
};

function questionTypeMap(questions: unknown): Map<string, string> {
  const map = new Map<string, string>();
  for (const q of Array.isArray(questions) ? questions : []) {
    if (!q || typeof q !== 'object') continue;
    const record = q as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    if (id) map.set(id, String(record.type ?? 'multiple_choice'));
  }
  return map;
}

function isProofRequiredQuestion(type: string | undefined): boolean {
  return type === 'sql_exercise' || type === 'python_exercise';
}

function hasValidExerciseProof(type: string | undefined, answer: unknown, ctx: ExerciseAnswerContext): boolean {
  if (!isProofRequiredQuestion(type)) return false;
  const parsed = parseAnswer(answer);
  if (!parsed || typeof parsed !== 'object' || parsed.passed !== true) return false;
  if (type === 'sql_exercise') {
    return verifySqlProof(ctx.courseId, ctx.studentId, ctx.questionId, String(parsed.query ?? ''), parsed.proof);
  }
  if (type === 'python_exercise') {
    return verifyPythonProof(ctx.courseId, ctx.questionId, parsed.output, parsed.proof);
  }
  return false;
}

function sanitizeExerciseAnswer(type: string | undefined, answer: unknown, ctx: ExerciseAnswerContext): unknown {
  if (!isProofRequiredQuestion(type)) return answer;
  const parsed = parseAnswer(answer);
  if (!parsed || typeof parsed !== 'object' || parsed.passed !== true) return answer;
  if (hasValidExerciseProof(type, parsed, ctx)) return answer;
  return JSON.stringify({
    ...parsed,
    passed: false,
    verificationFailed: true,
  });
}

function shouldAcceptIncomingExerciseAnswer(
  type: string | undefined,
  existing: unknown,
  incoming: unknown,
  ctx: ExerciseAnswerContext,
): boolean {
  const existingParsed = parseAnswer(existing);
  const incomingParsed = parseAnswer(incoming);
  if (!incomingParsed || typeof incomingParsed !== 'object') return false;

  // Once a solution has been viewed or an exercise was skipped, keep that penalty.
  if (existingParsed?.skipped || existingParsed?.solutionViewed) return false;

  // A later correct SQL/Python check should replace an earlier failed check when
  // progress is saved before final submission or before a refresh/new session.
  const existingVerified = hasValidExerciseProof(type, existing, ctx);
  const incomingVerified = hasValidExerciseProof(type, incoming, ctx);
  if (incomingParsed.passed === true) return incomingVerified && !existingVerified;

  // Persist a newly-viewed solution/skipped state unless the stored answer already passed.
  if ((incomingParsed.skipped || incomingParsed.solutionViewed) && !existingVerified) return true;

  return false;
}

async function loadAccessibleCourse(
  supabase: ReturnType<typeof adminClient>,
  courseId: string,
  sessionUser: { id: string; email: string },
  select = 'id, user_id, status, cohort_ids, available_to_everyone, questions',
) {
  const accessSelect = select.includes('available_to_everyone')
    ? select
    : `${select}, available_to_everyone`;
  const [{ data: course, error }, { data: student }] = await Promise.all([
    supabase.from('courses').select(accessSelect).eq('id', courseId).single(),
    supabase.from('students').select('role, cohort_id').eq('id', sessionUser.id).maybeSingle(),
  ]);
  if (error || !course) return { error: NextResponse.json({ error: 'Course not found' }, { status: 404 }) };

  const role = String((student as any)?.role ?? '');
  const cohortIds = Array.isArray((course as any).cohort_ids) ? (course as any).cohort_ids : [];
  const isPrivileged = ['admin', 'instructor', 'staff'].includes(role);
  const isOwner = (course as any).user_id === sessionUser.id;
  const isPublished = (course as any).status === 'published';
  const cohortAllowed = (course as any).available_to_everyone === true
    || (!!(student as any)?.cohort_id && cohortIds.includes((student as any).cohort_id));
  let learningPathAllowed = false;

  // Course SELECT policies also grant access through published learning paths.
  // Mirror that rule here because this service-role client bypasses RLS.
  if (!isPrivileged && !isOwner && isPublished && !cohortAllowed && (student as any)?.cohort_id) {
    const { data: learningPath } = await supabase.from('learning_paths')
      .select('id')
      .eq('status', 'published')
      .contains('item_ids', [courseId])
      .contains('cohort_ids', [(student as any).cohort_id])
      .limit(1)
      .maybeSingle();
    learningPathAllowed = !!learningPath;
  }

  if (!isPrivileged && !isOwner && !(isPublished && (cohortAllowed || learningPathAllowed))) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { course };
}

/**
 * The student's open attempt on this course, creating one if they have none.
 *
 * Needed by any action that must WRITE to an attempt: the LinkedIn claim (whose URL would otherwise
 * be lost when sharing is the student's first action) and complete-attempt (a course can be finishable
 * without a single answer, e.g. one whose only slide is an optional share they skipped). Returns null
 * when the course is already passed, which must never be resurrected.
 */
type AttemptRow = { id: string; answers: Record<string, string> | null; hints_used: string[] | null };

/**
 * Distinct outcomes, because callers must treat them differently. Collapsing these into `null` made a
 * database failure indistinguishable from "already finished", so complete-attempt reported HTTP 200
 * success for a course it had persisted nothing for.
 */
type EnsureAttemptResult =
  | { status: 'existing'; attempt: AttemptRow }
  | { status: 'created'; attempt: AttemptRow }
  | { status: 'already_completed' }
  | { status: 'error' };

async function ensureActiveAttempt(
  supabase: ReturnType<typeof adminClient>,
  courseId: string,
  studentId: string,
): Promise<EnsureAttemptResult> {
  const { data: existing, error: existingError } = await supabase.from('course_attempts')
    .select('id, answers, hints_used')
    .eq('course_id', courseId).eq('student_id', studentId)
    .is('completed_at', null)
    .order('current_question_index', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1).maybeSingle();
  if (existingError) {
    console.error('[course] attempt lookup failed', existingError);
    return { status: 'error' };
  }
  if (existing) return { status: 'existing', attempt: existing as AttemptRow };

  const { data: passed, error: passedError } = await supabase.from('course_attempts')
    .select('id')
    .eq('course_id', courseId).eq('student_id', studentId)
    .eq('passed', true).not('completed_at', 'is', null)
    .limit(1).maybeSingle();
  if (passedError) {
    console.error('[course] passed-attempt lookup failed', passedError);
    return { status: 'error' };
  }
  if (passed) return { status: 'already_completed' };

  // Checked like the two lookups above. There is no unique constraint on attempt_number -- only
  // idx_ca_one_active_per_student on (student_id, course_id) WHERE completed_at IS NULL -- so a
  // swallowed failure here would not raise; the insert would quietly land on attempt_number 1 and
  // /api/course-progress, which picks the current attempt by `attempt_number desc`, could then rank
  // a retake below the attempt it replaced and show the student the wrong one.
  const { data: last, error: lastError } = await supabase.from('course_attempts').select('attempt_number')
    .eq('course_id', courseId).eq('student_id', studentId)
    .order('attempt_number', { ascending: false }).limit(1).maybeSingle();
  if (lastError) {
    console.error('[course] attempt_number lookup failed', lastError);
    return { status: 'error' };
  }

  const { data: created, error } = await supabase.from('course_attempts')
    .insert({
      student_id: studentId,
      course_id: courseId,
      attempt_number: (last?.attempt_number ?? 0) + 1,
      answers: {},
    })
    .select('id, answers, hints_used')
    .single();

  if (error || !created) {
    // A concurrent request may have created it between the lookup and the insert.
    if ((error as { code?: string } | null)?.code === '23505') {
      const { data: race } = await supabase.from('course_attempts')
        .select('id, answers, hints_used')
        .eq('course_id', courseId).eq('student_id', studentId)
        .is('completed_at', null)
        .order('updated_at', { ascending: false })
        .limit(1).maybeSingle();
      if (race) return { status: 'existing', attempt: race as AttemptRow };
    }
    console.error('[course] could not create attempt', error);
    return { status: 'error' };
  }
  return { status: 'created', attempt: created as AttemptRow };
}

async function markSolutionViewed(
  supabase: ReturnType<typeof adminClient>,
  courseId: string,
  studentId: string,
  questionId: string,
  attempts: unknown,
) {
  const answerPatch = {
    passed: false,
    solutionViewed: true,
    attempts: Number.isFinite(Number(attempts)) ? Number(attempts) : 0,
    checkedAt: new Date().toISOString(),
  };

  const { data: existing } = await supabase.from('course_attempts')
    .select('id, answers')
    .eq('course_id', courseId).eq('student_id', studentId)
    .is('completed_at', null)
    .order('current_question_index', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1).maybeSingle();

  if (existing?.id) {
    const answers = existing.answers && typeof existing.answers === 'object' ? existing.answers : {};
    await supabase.from('course_attempts').update({
      answers: { ...answers, [questionId]: mergeAnswerFlag((answers as Record<string, unknown>)[questionId], answerPatch) },
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
    return;
  }

  const { data: completedPass } = await supabase.from('course_attempts')
    .select('id')
    .eq('course_id', courseId).eq('student_id', studentId)
    .eq('passed', true)
    .not('completed_at', 'is', null)
    .limit(1).maybeSingle();
  if (completedPass) return;

  const { data: last } = await supabase.from('course_attempts').select('attempt_number')
    .eq('course_id', courseId).eq('student_id', studentId)
    .order('attempt_number', { ascending: false }).limit(1).maybeSingle();

  await supabase.from('course_attempts').insert({
    student_id: studentId,
    course_id: courseId,
    attempt_number: (last?.attempt_number ?? 0) + 1,
    current_question_index: 0,
    answers: { [questionId]: JSON.stringify(answerPatch) },
    streak: 0,
    hints_used: [],
    points: 0,
    updated_at: new Date().toISOString(),
  });
}

function ensureCourseCertificate(
  supabase: ReturnType<typeof adminClient>,
  { course_id, student_id, student_name }: { course_id: string; student_id: string; student_name: string }
): Promise<{ certId: string; isNew: boolean }> {
  return ensureCertificate(supabase, { column: 'course_id', contentId: course_id, studentId: student_id, studentName: student_name });
}

function runCourseCertificateSideEffects(
  supabase: ReturnType<typeof adminClient>,
  { course_id, student_id, cert_id }: { course_id: string; student_id: string; cert_id: string }
): void {
  (async () => {
    try {
      await updateLearningPathProgress(supabase, student_id, course_id);

      const [{ data: courseRow }, { data: studentRow }, { data: bestAttempt }] = await Promise.all([
        supabase.from('courses').select('title, slug, badge_image_url').eq('id', course_id).single(),
        supabase.from('students').select('full_name, email').eq('id', student_id).single(),
        supabase.from('course_attempts').select('score, points')
          .eq('course_id', course_id).eq('student_id', student_id)
          .eq('passed', true).order('score', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!courseRow || !studentRow?.email) return;

      let badgeName: string | undefined;
      let badgeImageUrl: string | undefined;
      if (courseRow.badge_image_url) {
        await awardContentBadge(supabase, {
          badgeId:     `crs_${course_id}`,
          name:        `${courseRow.title} Badge`,
          description: `Awarded for completing ${courseRow.title}`,
          imageUrl:    courseRow.badge_image_url,
          category:    'course',
          studentId:   student_id,
        });
        badgeName     = `${courseRow.title} Badge`;
        badgeImageUrl = courseRow.badge_image_url;
      }

      if (process.env.RESEND_API_KEY) {
        const t        = await getTenantSettings();
        const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
        const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
        const certUrl  = `${t.appUrl}/certificate/${cert_id}`;
        const formUrl  = courseRow.slug ? `${t.appUrl}/${courseRow.slug}` : `${t.appUrl}/${course_id}`;
        await sendCertificateEmailOnce(supabase, {
          certId:     cert_id,
          dedupeType: 'course-certificate',
          from:       FROM,
          to:         studentRow.email,
          subject:    `Congratulations! Your certificate for ${courseRow.title} is ready`,
          html:       courseResultEmail({
            name:         studentRow.full_name ?? 'there',
            courseTitle:  courseRow.title,
            score:        bestAttempt?.score ?? 100,
            total:        100,
            percentage:   bestAttempt?.score ?? 100,
            passed:       true,
            points:       bestAttempt?.points ?? undefined,
            formUrl,
            certUrl,
            badgeName,
            badgeImageUrl,
            branding,
          }),
        });
      }
    } catch (err) {
      console.error('[runCourseCertificateSideEffects] post-cert tasks failed', err);
    }
  })();
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { action } = body;

  // -- Get all certificates for the logged-in student ---
  if (action === 'get-my-certificates') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    try {
      const { data: certs } = await adminClient()
        .from('certificates')
        .select('id, course_id, ve_id, learning_path_id')
        .eq('student_id', sessionUser.id)
        .eq('revoked', false);
      return NextResponse.json({ certs: certs ?? [] });
    } catch (err: any) {
      console.error('[course/get-my-certificates]', err);
      return NextResponse.json({ error: 'Failed to load certificates.' }, { status: 500 });
    }
  }

  // -- Get current progress + cert + attempt count ---
  if (action === 'get-progress') {
    const { course_id } = body;
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!course_id) return NextResponse.json({ error: 'course_id required' }, { status: 400 });

    try {
      const supabase = adminClient();
      // Access check. These actions use the service-role client, which bypasses RLS, so without
      // this a signed-in user holding any course UUID could create progress on -- or complete --
      // a course they were never assigned, including an unpublished one. loadAccessibleCourse
      // mirrors the course SELECT policy (owner, staff, assigned cohort, or published learning path).
      const access = await loadAccessibleCourse(supabase, course_id, sessionUser, 'id, user_id, status, cohort_ids');
      if (access.error) return access.error;

      const [{ data: cert }, { data: progress }, { count: attemptCount }, { data: passingAttempt }] = await Promise.all([
        supabase.from('certificates').select('id')
          .eq('course_id', course_id).eq('student_id', sessionUser.id).eq('revoked', false)
          .maybeSingle(),
        supabase.from('course_attempts').select('*')
          .eq('course_id', course_id).eq('student_id', sessionUser.id)
          .is('completed_at', null)
          .order('current_question_index', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(1).maybeSingle(),
        supabase.from('course_attempts').select('id', { count: 'exact', head: true })
          .eq('course_id', course_id).eq('student_id', sessionUser.id)
          .not('completed_at', 'is', null),
        // Best passing attempt -- used to restore answers/progress in review mode
        supabase.from('course_attempts')
          .select('answers, current_question_index, score, points, hints_used, streak')
          .eq('course_id', course_id).eq('student_id', sessionUser.id)
          .eq('passed', true).not('completed_at', 'is', null)
          .order('score', { ascending: false }).limit(1).maybeSingle(),
      ]);
      return NextResponse.json({
        cert,
        progress,
        attemptCount: attemptCount ?? 0,
        hasPassed: !!passingAttempt,
        passingAttempt,
      });
    } catch (err: any) {
      console.error('[course/get-progress]', err);
      return NextResponse.json({ error: 'Failed to load progress.' }, { status: 500 });
    }
  }

  // -- Reveal SQL solution after enough failed attempts ---
  if (action === 'get-sql-solution') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { course_id, question_id, attempts } = body;
    if (!course_id) return NextResponse.json({ error: 'course_id required' }, { status: 400 });
    if (!question_id) return NextResponse.json({ error: 'question_id required' }, { status: 400 });

    try {
      const supabase = adminClient();
      const access = await loadAccessibleCourse(supabase, course_id, sessionUser);
      if ('error' in access) return access.error;
      const course = access.course as any;

      const question = (Array.isArray(course?.questions) ? course.questions : [])
        .find((q: any) => q?.id === question_id && q?.type === 'sql_exercise');
      if (!question) return NextResponse.json({ error: 'SQL exercise not found.' }, { status: 404 });
      await markSolutionViewed(supabase, course_id, sessionUser.id, question_id, attempts);

      return NextResponse.json({ solution: String(question.sqlSolution ?? '') });
    } catch (err: any) {
      console.error('[course/get-sql-solution]', err);
      return NextResponse.json({ error: 'Failed to load SQL solution.' }, { status: 500 });
    }
  }

  // -- Server-side SQL pass proof: browser executes SQL; server compares the browser result
  // against the hidden expected result and signs only a legitimate pass for this student.
  if (action === 'check-sql-answer') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { course_id, question_id, query, result } = body;
    if (!course_id) return NextResponse.json({ error: 'course_id required' }, { status: 400 });
    if (!question_id) return NextResponse.json({ error: 'question_id required' }, { status: 400 });
    if (typeof query !== 'string' || !query.trim()) return NextResponse.json({ error: 'query required' }, { status: 400 });
    const actual = coerceSqlResult(result);
    if (!actual) return NextResponse.json({ error: 'Valid SQL result required' }, { status: 400 });

    try {
      const supabase = adminClient();
      const access = await loadAccessibleCourse(supabase, course_id, sessionUser);
      if ('error' in access) return access.error;
      const course = access.course as any;
      const question = (Array.isArray(course?.questions) ? course.questions : [])
        .find((q: any) => q?.id === question_id && q?.type === 'sql_exercise');
      if (!question) return NextResponse.json({ error: 'SQL exercise not found.' }, { status: 404 });

      const expected = question.sqlExpectedResult
        ?? (question.sqlSolution?.trim()
          ? await computeServerSqlResult(question.sqlTables ?? [], question.sqlSolution)
          : null);
      if (!expected) return NextResponse.json({ error: 'SQL expected result is not configured.' }, { status: 400 });

      const patternCheck = checkRequiredSqlPatterns(query, question.sqlRequiredPatterns);
      if (!patternCheck.passed) {
        const feedback = {
          passed: false,
          matchedRows: 0,
          totalRows: 0,
          message: patternCheck.message,
        };
        return NextResponse.json({ passed: false, feedback });
      }

      const feedback = compareResults(actual, expected, {
        ordered: !!question.sqlResultOrdered,
        numericTolerance: Number(question.sqlNumericTolerance ?? 0),
      });
      const safeFeedback = feedback.passed
        ? {
            passed: true,
            matchedRows: 0,
            totalRows: 0,
            message: 'Your result matches the expected output.',
          }
        : {
            passed: false,
            matchedRows: 0,
            totalRows: 0,
            message: "Your result doesn't match the expected output yet. Re-check your columns, row count, and values.",
          };
      return NextResponse.json({
        passed: feedback.passed,
        feedback: safeFeedback,
        proof: feedback.passed ? signSqlProof(course_id, sessionUser.id, question_id, query) : undefined,
      });
    } catch (err: any) {
      console.error('[course/check-sql-answer]', err);
      return NextResponse.json({ error: 'Failed to check SQL answer.' }, { status: 500 });
    }
  }

  // -- Reveal Python solution ---
  if (action === 'get-python-solution') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { course_id, question_id, attempts } = body;
    if (!course_id) return NextResponse.json({ error: 'course_id required' }, { status: 400 });
    if (!question_id) return NextResponse.json({ error: 'question_id required' }, { status: 400 });
    try {
      const supabase = adminClient();
      const access = await loadAccessibleCourse(supabase, course_id, sessionUser);
      if ('error' in access) return access.error;
      const course = access.course as any;
      const question = (Array.isArray(course?.questions) ? course.questions : [])
        .find((q: any) => q?.id === question_id && q?.type === 'python_exercise');
      if (!question) return NextResponse.json({ error: 'Python exercise not found.' }, { status: 404 });
      await markSolutionViewed(supabase, course_id, sessionUser.id, question_id, attempts);
      return NextResponse.json({ solution: String(question.pythonSolution ?? '') });
    } catch (err: any) {
      console.error('[course/get-python-solution]', err);
      return NextResponse.json({ error: 'Failed to load Python solution.' }, { status: 500 });
    }
  }

  // -- Server-side Python answer check: expected output stays private ---
  if (action === 'check-python-answer') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { course_id, question_id, output } = body;
    if (!course_id) return NextResponse.json({ error: 'course_id required' }, { status: 400 });
    if (!question_id) return NextResponse.json({ error: 'question_id required' }, { status: 400 });
    try {
      const supabase = adminClient();
      const access = await loadAccessibleCourse(supabase, course_id, sessionUser);
      if ('error' in access) return access.error;
      const course = access.course as any;
      const question = (Array.isArray(course?.questions) ? course.questions : [])
        .find((q: any) => q?.id === question_id && q?.type === 'python_exercise');
      if (!question) return NextResponse.json({ error: 'Python exercise not found.' }, { status: 404 });

      const expected = normalizePythonOutput(question.pythonExpectedOutput);
      if (!expected) {
        return NextResponse.json({ error: 'Python expected output is not configured.' }, { status: 400 });
      }

      const { data: attempt } = await supabase.from('course_attempts')
        .select('answers')
        .eq('course_id', course_id).eq('student_id', sessionUser.id)
        .is('completed_at', null)
        .order('current_question_index', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1).maybeSingle();
      const stored = parseAnswer((attempt?.answers as Record<string, unknown> | undefined)?.[question_id]);
      if (stored?.solutionViewed || stored?.skipped) {
        return NextResponse.json({
          passed: false,
          message: 'Solution viewed or exercise skipped. This answer cannot be counted as correct.',
        });
      }

      const actual = normalizePythonOutput(output);
      const passed = actual === expected;
      return NextResponse.json({
        passed,
        message: passed ? 'Output matches.' : 'Output does not match the expected result.',
        proof: passed ? signPythonProof(course_id, question_id, actual) : undefined,
      });
    } catch (err: any) {
      console.error('[course/check-python-answer]', err);
      return NextResponse.json({ error: 'Failed to check Python answer.' }, { status: 500 });
    }
  }

  // -- Save in-progress attempt (create if needed) ---
  // -- Claim a LinkedIn post for a share slide ---
  // Synchronous (unlike save-progress) because only the server knows whether the post is already
  // claimed, and the student needs that answer inline. This route is the ONLY writer of a share
  // slide's answer: save-progress lets stored answers win, so the client echoing the URL back is
  // ignored, and linkedin_shares has no client write policy at all.
  if (action === 'claim-linkedin-share') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { course_id, question_id, post_url } = body;
    if (!course_id || !question_id) {
      return NextResponse.json({ error: 'course_id and question_id are required' }, { status: 400 });
    }
    if (typeof post_url !== 'string' || !post_url.trim()) {
      return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
    }

    try {
      const supabase = adminClient();
      const access = await loadAccessibleCourse(supabase, course_id, sessionUser);
      if (access.error) return access.error;

      const questions: any[] = Array.isArray((access.course as any).questions) ? (access.course as any).questions : [];
      const slide = questions.find(q => q?.id === question_id && q?.isLinkedInShare);
      if (!slide) return NextResponse.json({ error: 'Share slide not found' }, { status: 404 });

      // Bonus comes from the stored course config, never from the request body.
      const points = linkedInSharePointsFor(slide);

      // Their own LinkedIn profile, collected at onboarding, is what the post's author is checked
      // against. Read server-side so the client cannot supply whichever profile fits the post.
      const { data: profileRow } = await supabase
        .from('students').select('social_links').eq('id', sessionUser.id).maybeSingle();
      const studentProfileUrl = (profileRow as any)?.social_links?.linkedin ?? null;

      const claim = await claimLinkedInShare(supabase, {
        studentId:   sessionUser.id,
        contentType: 'course',
        contentId:   course_id,
        itemId:      question_id,
        postUrl:     post_url,
        points,
        studentProfileUrl,
      });

      if (!claim.ok) {
        if (claim.code === 'already_claimed') return NextResponse.json({ error: 'already_claimed' }, { status: 409 });
        if (claim.code === 'author_mismatch') return NextResponse.json({ error: 'author_mismatch' }, { status: 403 });
        if (claim.code === 'no_profile')      return NextResponse.json({ error: 'no_profile' }, { status: 422 });
        if (claim.code === 'no_author_in_url') return NextResponse.json({ error: 'no_author_in_url' }, { status: 400 });
        if (claim.code === 'invalid_url')      return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
        return NextResponse.json({ error: 'Failed to save your link.' }, { status: 500 });
      }

      // Mirror the canonical URL into the attempt so the slide reads as completed on reload,
      // CREATING the attempt if the student has none: sharing can be their very first action, and
      // save-progress deliberately strips share answers (only this action may write them), so
      // without this the claim would exist in linkedin_shares while the slide looked unfinished.
      // Returns null for an already-passed course, which must not be resurrected.
      // The claim row is already written and this mirror is a SECOND statement, so the two can
      // disagree if it fails. That ordering is deliberate, not incidental -- do not reverse it:
      //
      //   claim first (here)  the UI under-reports (slide looks unfinished) while the server
      //                       over-reports (the gate reads linkedin_shares, so it passes and the
      //                       bonus is awarded). The student did post, so awarding it is right.
      //   answer first        the UI would say done while completion is refused with
      //                       share_required -- and an answer with no claim behind it is exactly the
      //                       forged state save-progress is written to reject.
      //
      // The window is one statement wide and self-heals: the same slot upserts, so a retry repairs
      // it. Eliminating it entirely needs both writes in one transaction (an RPC, as
      // complete_ve_assignment does); the URL, author and uniqueness checks would stay here in TS.
      const ensured = await ensureActiveAttempt(supabase, course_id, sessionUser.id);
      if (ensured.status === 'error') {
        // No attempt to mirror into. Report it so the student retries rather than silently ending up
        // with a claim whose slide still reads as unfinished.
        return NextResponse.json({ error: 'Failed to save your link.' }, { status: 500 });
      }

      // An already-passed course has no open attempt to mirror into, and must not be resurrected.
      if (ensured.status !== 'already_completed') {
        const existingAnswers = ensured.attempt.answers && typeof ensured.attempt.answers === 'object'
          ? ensured.attempt.answers
          : {};
        const { error: updateError } = await supabase.from('course_attempts')
          .update({ answers: { ...existingAnswers, [question_id]: claim.url }, updated_at: new Date().toISOString() })
          .eq('id', ensured.attempt.id);
        if (updateError) {
          console.error('[course/claim-linkedin-share] attempt update', updateError);
          return NextResponse.json({ error: 'Failed to save your link.' }, { status: 500 });
        }
      }

      return NextResponse.json({ ok: true, url: claim.url, points });
    } catch (err: any) {
      console.error('[course/claim-linkedin-share]', err);
      return NextResponse.json({ error: 'Failed to save your link.' }, { status: 500 });
    }
  }

  if (action === 'save-progress') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // `points` is deliberately NOT destructured from the body: it is computed below, never accepted.
    const { course_id, current_question_index, answers, streak, hints_used } = body;
    if (!course_id) return NextResponse.json({ error: 'course_id required' }, { status: 400 });

    try {
      const supabase = adminClient();

      const POINTS_COLS = 'points_enabled, points_base, points_system';
      const ACCESS_COLS = 'id, user_id, status, cohort_ids';
      // `questions` (not just the lightweight question_types projection) because points are now
      // computed here from the stored answers, and grading needs each question's answer key. Those
      // keys must never reach the browser, which is why this stays a service-role read and why the
      // projection was not widened to carry them.
      // Access check. These actions use the service-role client, which bypasses RLS, so without
      // this a signed-in user holding any course UUID could create progress on -- or complete --
      // a course they were never assigned, including an unpublished one. loadAccessibleCourse
      // mirrors the course SELECT policy (owner, staff, assigned cohort, or published learning path).
      const access = await loadAccessibleCourse(supabase, course_id, sessionUser, `${ACCESS_COLS}, questions, ${POINTS_COLS}`);
      if (access.error) return access.error;
      const course = access.course as any;

      const incomingIndex = Number.isFinite(Number(current_question_index))
        ? Number(current_question_index)
        : 0;
      const incomingAnswers = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
      const incomingHints = Array.isArray(hints_used) ? hints_used : [];
      const incomingStreak = Number.isFinite(Number(streak)) ? Number(streak) : 0;
      const slides: any[] = Array.isArray((course as any).questions) ? (course as any).questions : [];
      const qTypes = questionTypeMap(slides);
      // A share slide's answer is written ONLY by claim-linkedin-share, which validates the URL,
      // its author and its uniqueness. Without this, a client could post any string here and the
      // slide would read as claimed on reload -- Continue enabled, progress inflated -- right up
      // until complete-attempt refused.
      const shareSlideIdSet = new Set(
        slides.filter((s: any) => s?.isLinkedInShare === true).map((s: any) => String(s.id)),
      );
      for (const key of Object.keys(incomingAnswers)) {
        if (shareSlideIdSet.has(key)) delete (incomingAnswers as Record<string, unknown>)[key];
      }

      // `points` from the request body is IGNORED. It used to be stored (bounded by a ceiling), but a
      // ceiling is not proof of work: a student could report the course maximum without answering
      // anything, and course_attempts.points feeds student_xp -- so it showed on the leaderboard.
      // The total is computed from the answers actually stored, by the same function
      // complete-attempt uses, so mid-course XP still counts and still comes from the server.
      const sharePointsSystem = pointsSystemFromCourseRow(course);

      // Share bonuses are part of the total, and are gated on a claim rather than on the URL in
      // `answers`. Loaded once here so the payload builder can run synchronously.
      const claimedShares = shareSlideIdSet.size > 0
        ? await loadClaimedShareItemIds(supabase, { studentId: sessionUser.id, contentId: course_id })
        : new Set<string>();

      // Attempt count carried inside a __review_<id> snapshot; used to decide which review state is newer.
      const reviewCount = (val: unknown): number => {
        if (typeof val !== 'string') return 0;
        try { const r = JSON.parse(val); return typeof r?.count === 'number' ? r.count : 0; } catch { return 0; }
      };

      const buildPayload = (existing?: {
        current_question_index?: number | null;
        answers?: Record<string, string> | null;
        hints_used?: string[] | null;
        points?: number | null;
        streak?: number | null;
      }) => {
        const existingIndex = existing?.current_question_index ?? 0;
        const existingAnswers = existing?.answers && typeof existing.answers === 'object' ? existing.answers : {};
        const existingHints = Array.isArray(existing?.hints_used) ? existing.hints_used : [];

        // Existing answers win on conflicts so an older tab cannot rewrite completed work.
        const mergedAnswers: Record<string, string> = { ...existingAnswers };
        for (const key of Object.keys(incomingAnswers)) {
          if (Object.prototype.hasOwnProperty.call(mergedAnswers, key)) continue;
          mergedAnswers[key] = sanitizeExerciseAnswer(qTypes.get(key), incomingAnswers[key], {
            courseId: course_id,
            studentId: sessionUser.id,
            questionId: key,
          }) as string;
        }
        // Exception: review questions are mutable across attempts. When the incoming __review_<id>
        // snapshot has a higher attempt count than the stored one, the newer attempt wins -- both the
        // snapshot and its paired answer key -- so a 2nd attempt's report/score/pass-fail persists
        // mid-course. Lower/equal counts keep the stored value, preserving the older-tab guard.
        for (const key of Object.keys(incomingAnswers)) {
          if (!key.startsWith('__review_')) continue;
          if (reviewCount(incomingAnswers[key]) > reviewCount((existingAnswers as Record<string, string>)[key])) {
            mergedAnswers[key] = incomingAnswers[key];
            const id = key.slice('__review_'.length);
            if (Object.prototype.hasOwnProperty.call(incomingAnswers, id)) mergedAnswers[id] = incomingAnswers[id];
          }
        }
        for (const key of Object.keys(incomingAnswers)) {
          if (key.startsWith('__review_')) continue;
          const type = qTypes.get(key);
          const ctx = { courseId: course_id, studentId: sessionUser.id, questionId: key };
          if (shouldAcceptIncomingExerciseAnswer(type, (existingAnswers as Record<string, string>)[key], incomingAnswers[key], ctx)) {
            mergedAnswers[key] = sanitizeExerciseAnswer(type, incomingAnswers[key], ctx) as string;
          }
        }

        const mergedHints = [...new Set([...existingHints, ...incomingHints])];
        const computedPoints = computeAttemptPoints({
          questions: slides,
          storedAnswers: mergedAnswers,
          hintsUsed: mergedHints,
          pointsSystem: sharePointsSystem,
          claimedShareItemIds: claimedShares,
          isCorrect: q => gradeQuestion(q, {
            storedAnswers: mergedAnswers,
            persistedAnswers: mergedAnswers,
            verifySqlProof: (questionId, query, proof) => verifySqlProof(course_id, sessionUser.id, questionId, query, proof),
            verifyProof: (questionId, output, proof) => verifyPythonProof(course_id, questionId, output, proof),
          }),
        });

        return {
          current_question_index: Math.max(existingIndex, incomingIndex),
          answers:                mergedAnswers,
          streak:                 Math.max(existing?.streak ?? 0, incomingStreak),
          hints_used:             mergedHints,
          points:                 computedPoints,
          updated_at:             new Date().toISOString(),
        };
      };

      const { data: existing } = await supabase.from('course_attempts')
        .select('id, current_question_index, answers, hints_used, points, streak')
        .eq('course_id', course_id).eq('student_id', sessionUser.id)
        .is('completed_at', null)
        .order('current_question_index', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(1).maybeSingle();

      if (existing) {
        const payload = buildPayload(existing);
        const { error } = await supabase.from('course_attempts').update(payload).eq('id', existing.id);
        if (error) { console.error('[course/save-progress] update', error); return NextResponse.json({ error: 'Failed to save progress.' }, { status: 500 }); }
      } else {
        const { data: completedPass } = await supabase.from('course_attempts')
          .select('id')
          .eq('course_id', course_id).eq('student_id', sessionUser.id)
          .eq('passed', true)
          .not('completed_at', 'is', null)
          .limit(1).maybeSingle();

        if (completedPass) {
          return NextResponse.json({ ok: true, ignored: 'already_completed' });
        }

        const { data: last } = await supabase.from('course_attempts').select('attempt_number')
          .eq('course_id', course_id).eq('student_id', sessionUser.id)
          .order('attempt_number', { ascending: false }).limit(1).maybeSingle();

        const { error } = await supabase.from('course_attempts').insert({
          student_id:     sessionUser.id,
          course_id,
          attempt_number: (last?.attempt_number ?? 0) + 1,
          ...buildPayload(),
        });

        if (error) {
          // Unique constraint violation: another concurrent request already created the attempt.
          // Re-fetch it and update instead.
          if (error.code === '23505') {
            const { data: race } = await supabase.from('course_attempts')
              .select('id, current_question_index, answers, hints_used, points, streak')
              .eq('course_id', course_id).eq('student_id', sessionUser.id)
              .is('completed_at', null)
              .order('current_question_index', { ascending: false })
              .order('updated_at', { ascending: false })
              .limit(1).maybeSingle();
            if (race) {
              await supabase.from('course_attempts').update(buildPayload(race)).eq('id', race.id);
            }
          } else {
            console.error('[course/save-progress] insert', error);
            return NextResponse.json({ error: 'Failed to save progress.' }, { status: 500 });
          }
        }
      }

      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[course/save-progress]', err);
      return NextResponse.json({ error: 'Failed to save progress.' }, { status: 500 });
    }
  }

  // -- Mark active attempt as completed ---
  if (action === 'complete-attempt') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { course_id, current_question_index, final_answers } = body;
    if (!course_id) return NextResponse.json({ error: 'course_id required' }, { status: 400 });

    try {
      const supabase = adminClient();

      // Access check. These actions use the service-role client, which bypasses RLS, so without
      // this a signed-in user holding any course UUID could create progress on -- or complete --
      // a course they were never assigned, including an unpublished one. loadAccessibleCourse
      // mirrors the course SELECT policy (owner, staff, assigned cohort, or published learning path).
      const access = await loadAccessibleCourse(
        supabase, course_id, sessionUser,
        'id, user_id, status, cohort_ids, questions, passmark, points_enabled, points_base, points_system',
      );
      if (access.error) return access.error;
      const courseData = access.course as any;

      const { data: studentRow } = await supabase
        .from('students').select('full_name').eq('id', sessionUser.id).single();

      if (!courseData) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

      // A course can be finishable without the student having answered anything -- the clearest
      // case is a course whose only slide is an OPTIONAL LinkedIn share they skipped, which writes
      // no answer and so never triggers save-progress. Returning ignored:'no_active_attempt' there
      // looked like success to the client while persisting nothing: no attempt, no certificate.
      const ensured = await ensureActiveAttempt(supabase, course_id, sessionUser.id);
      if (ensured.status === 'error') {
        return NextResponse.json({ error: 'Failed to complete attempt.' }, { status: 500 });
      }
      if (ensured.status === 'already_completed') {
        return NextResponse.json({ ok: true, ignored: 'already_completed' });
      }
      const activeAttempt = ensured.attempt;

      if (activeAttempt && courseData) {
        // Server-side scoring - client-supplied score/passed/points are ignored.
        // Merge final_answers (sent by client) over stored answers so that the last
        // lessonOnly 'viewed' entry is always present, regardless of race timing.
        const questions: any[]              = Array.isArray(courseData.questions) ? courseData.questions : [];
        const persistedAnswers: Record<string, string> = activeAttempt.answers ?? {};
        const qTypes = questionTypeMap(questions);
        const storedAnswers: Record<string, string> = { ...persistedAnswers };
        const incomingFinalAnswers = final_answers && typeof final_answers === 'object' ? final_answers : {};
        // Share slides are written only by claim-linkedin-share, so the client must not be able to
        // swap in a different (or junk) URL at completion and corrupt the audit trail. The XP itself
        // is gated on linkedin_shares below, so this protects the record rather than the reward.
        const shareSlideIds = new Set(questions.filter(q => q?.isLinkedInShare).map(q => String(q.id)));
        for (const key of Object.keys(incomingFinalAnswers)) {
          if (shareSlideIds.has(key)) continue;
          const type = qTypes.get(key);
          if (isProofRequiredQuestion(type)) {
            const ctx = { courseId: course_id, studentId: sessionUser.id, questionId: key };
            const persistedVerified = hasValidExerciseProof(type, storedAnswers[key], ctx);
            const incomingVerified = hasValidExerciseProof(type, incomingFinalAnswers[key], ctx);
            if (persistedVerified && !incomingVerified) {
              continue;
            }
            storedAnswers[key] = sanitizeExerciseAnswer(type, incomingFinalAnswers[key], ctx) as string;
            continue;
          }
          storedAnswers[key] = incomingFinalAnswers[key];
        }
        // A required share slide is a SERVER gate, not just a disabled button. The player blocks
        // Continue and the finish dialog, but posting straight to this action would otherwise
        // complete the attempt, grade it, and issue the certificate with nothing shared. Loaded once
        // here and reused for the bonus below.
        const claimedShares = shareSlideIds.size > 0
          ? await loadClaimedShareItemIds(supabase, { studentId: sessionUser.id, contentId: course_id })
          : new Set<string>();
        // `=== true`, not `!== false`: only a share the author deliberately gated can block a
        // submission. An unset flag means optional, so forgetting the toggle cannot leave a student
        // unable to finish the course -- there is no per-student exemption path to rescue them.
        const missingRequiredShares = questions.filter(q =>
          q?.isLinkedInShare && q.linkedInShareRequired === true && !claimedShares.has(String(q.id)));
        if (missingRequiredShares.length > 0) {
          return NextResponse.json({
            error: 'share_required',
            missing: missingRequiredShares.map(q => String(q.id)),
          }, { status: 409 });
        }

        const hintsUsed: string[]           = activeAttempt.hints_used ?? [];
        const passmark                      = courseData.passmark ?? 50;

        // Mirrors isScorableSlide() in components/CourseTaker.tsx -- share slides earn bonus XP but
        // are never graded, so counting them would drag the percentage down.
        const scorable = questions.filter(isScorableQuestion);
        let correct = 0;
        const scoreQuestion = (q: any): boolean => gradeQuestion(q, {
          storedAnswers,
          persistedAnswers,
          verifySqlProof: (questionId, query, proof) => verifySqlProof(course_id, sessionUser.id, questionId, query, proof),
          verifyProof: (questionId, output, proof) => verifyPythonProof(course_id, questionId, output, proof),
        });

        for (const q of scorable) {
          if (scoreQuestion(q)) correct++;
        }

        const total     = scorable.length;
        const scorePct  = total === 0 ? 100 : Math.round((correct / total) * 100);
        const passed    = scorePct >= passmark;
        const pointsSystem: PointsSystem = pointsSystemFromCourseRow(courseData);

        // Same function save-progress uses, so the number never jumps at submission.
        const computed_points = computeAttemptPoints({
          questions,
          storedAnswers,
          hintsUsed,
          pointsSystem,
          claimedShareItemIds: claimedShares,
          isCorrect: scoreQuestion,
        });

        const { error: updateError } = await supabase.from('course_attempts').update({
          completed_at:           new Date().toISOString(),
          passed,
          score:                  scorePct,
          points:                 computed_points,
          current_question_index: Math.max(Number(current_question_index) || 0, questions.length),
          answers:                storedAnswers,
          updated_at:             new Date().toISOString(),
        }).eq('id', activeAttempt.id);

        if (updateError) {
          console.error('[course/complete-attempt] attempt update failed', updateError);
          return NextResponse.json({ error: 'Failed to complete attempt.' }, { status: 500 });
        }

        if (passed) {
          try {
            const studentName = studentRow?.full_name?.trim() || sessionUser.email;
            const { certId, isNew } = await ensureCourseCertificate(supabase, {
              course_id,
              student_id:   sessionUser.id,
              student_name: studentName,
            });
            if (isNew) runCourseCertificateSideEffects(supabase, { course_id, student_id: sessionUser.id, cert_id: certId });
          } catch (certErr) {
            console.error('[course/complete-attempt] certificate creation failed', certErr);
          }
        }

        if (passed) {
          Promise.all([
            supabase.from('students').select('cohort_id, full_name').eq('id', sessionUser.id).single(),
            supabase.from('courses').select('title').eq('id', course_id).single(),
          ]).then(([{ data: stu }, { data: crs }]) => {
            if (!stu?.cohort_id || !crs?.title) return;
            const firstName = (stu.full_name || sessionUser.email).split(' ')[0];
            publishActivity(stu.cohort_id, {
              name:        firstName,
              action:      'completed',
              title:       crs.title,
              contentType: 'course',
              ts:          Date.now(),
            }).catch(() => {});
          }).catch(() => {});
        }

        supabase
          .from('students').select('cohort_id, full_name')
          .eq('id', sessionUser.id).single()
          .then(({ data: student }) => {
            if (!student?.cohort_id) return;
            const lbKey   = leaderboardKey(student.cohort_id);
            const nameKey = studentNameKey(student.cohort_id);
            supabase.from('student_xp').select('total_xp')
              .eq('student_id', sessionUser.id).single()
              .then(({ data: xpRow }) => {
                const totalXp = xpRow?.total_xp ?? 0;
                const redis = getRedis();
                if (!redis) return;
                redis.pipeline()
                  .zadd(lbKey,   { score: totalXp, member: sessionUser.email })
                  .hset(nameKey, { [sessionUser.email]: student.full_name || sessionUser.email })
                  .expire(lbKey,   600)
                  .expire(nameKey, 600)
                  .exec()
                  .catch((err: any) => console.error('[course/complete-attempt] redis sync', err));
              });
          });

        return NextResponse.json({ ok: true, score: scorePct, passed, points: computed_points });
      }

      // Unreachable in practice (early returns above cover !courseData and !attempt),
      // but required so TypeScript sees a return on every code path.
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[course/complete-attempt]', err);
      return NextResponse.json({ error: 'Failed to complete attempt.' }, { status: 500 });
    }
  }

  // -- Delete active in-progress attempt (fresh restart) ---
  if (action === 'clear-progress') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { course_id } = body;
    if (!course_id) return NextResponse.json({ error: 'course_id required' }, { status: 400 });
    try {
      const supabase = adminClient();
      await supabase.from('course_attempts').delete()
        .eq('course_id', course_id).eq('student_id', sessionUser.id).is('completed_at', null);
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[course/clear-progress]', err);
      return NextResponse.json({ error: 'Failed to clear progress.' }, { status: 500 });
    }
  }

  // -- Issue certificate ---
  if (action === 'issue-certificate') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { course_id, student_name } = body;
    if (!course_id || !student_name)
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });

    try {
      const supabase = adminClient();

      // Verify pass -- complete-attempt writes this row; issue-certificate is a
      // fallback/repair path so the passing attempt must already exist.
      const { data: attempt } = await supabase.from('course_attempts')
        .select('id').eq('course_id', course_id).eq('student_id', sessionUser.id)
        .eq('passed', true).maybeSingle();
      if (!attempt) return NextResponse.json({ error: 'No passing attempt found' }, { status: 403 });

      const { certId } = await ensureCourseCertificate(supabase, {
        course_id,
        student_id:   sessionUser.id,
        student_name: student_name.trim(),
      });
      // Always run side effects: badge/LP are idempotent; email is guarded by email_dedup.
      // This repairs cases where complete-attempt created the cert but side effects crashed.
      runCourseCertificateSideEffects(supabase, { course_id, student_id: sessionUser.id, cert_id: certId });

      return NextResponse.json({ certId });
    } catch (err: any) {
      console.error('[course/issue-certificate]', err);
      return NextResponse.json({ error: 'Failed to issue certificate.' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
