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
import { pointsSystemFromCourseRow, type PointsSystem } from '@/lib/course-schema';
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
  select = 'id, user_id, status, cohort_ids, questions',
) {
  const [{ data: course, error }, { data: student }] = await Promise.all([
    supabase.from('courses').select(select).eq('id', courseId).single(),
    supabase.from('students').select('role, cohort_id').eq('id', sessionUser.id).maybeSingle(),
  ]);
  if (error || !course) return { error: NextResponse.json({ error: 'Course not found' }, { status: 404 }) };

  const role = String((student as any)?.role ?? '');
  const cohortIds = Array.isArray((course as any).cohort_ids) ? (course as any).cohort_ids : [];
  const isPrivileged = ['admin', 'instructor', 'staff'].includes(role);
  const isOwner = (course as any).user_id === sessionUser.id;
  const isPublished = (course as any).status === 'published';
  const cohortAllowed = cohortIds.length === 0 || (!!(student as any)?.cohort_id && cohortIds.includes((student as any).cohort_id));

  if (!isPrivileged && !isOwner && !(isPublished && cohortAllowed)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { course };
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
      return NextResponse.json({ cert, progress, attemptCount: attemptCount ?? 0, hasPassed: !!passingAttempt, passingAttempt });
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
  if (action === 'save-progress') {
    const sessionUser = await getSessionUser(req);
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { course_id, current_question_index, answers, streak, hints_used, points } = body;
    if (!course_id) return NextResponse.json({ error: 'course_id required' }, { status: 400 });

    try {
      const supabase = adminClient();

      let courseResult = await supabase.from('courses').select('id, question_types').eq('id', course_id).single();
      if (courseResult.error && (courseResult.error as any).code !== 'PGRST116') {
        courseResult = await supabase.from('courses').select('id, questions').eq('id', course_id).single();
      }
      const course = courseResult.data;
      if (courseResult.error || !course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

      const incomingIndex = Number.isFinite(Number(current_question_index))
        ? Number(current_question_index)
        : 0;
      const incomingAnswers = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
      const incomingHints = Array.isArray(hints_used) ? hints_used : [];
      const incomingPoints = Number.isFinite(Number(points)) ? Number(points) : 0;
      const incomingStreak = Number.isFinite(Number(streak)) ? Number(streak) : 0;
      const qTypes = questionTypeMap((course as any).question_types ?? (course as any).questions);

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

        return {
          current_question_index: Math.max(existingIndex, incomingIndex),
          answers:                mergedAnswers,
          streak:                 Math.max(existing?.streak ?? 0, incomingStreak),
          hints_used:             [...new Set([...existingHints, ...incomingHints])],
          points:                 Math.max(existing?.points ?? 0, incomingPoints),
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

      const [{ data: courseData }, { data: attempt }, { data: studentRow }] = await Promise.all([
        supabase.from('courses')
          .select('questions, passmark, points_enabled, points_base, points_system')
          .eq('id', course_id).single(),
        supabase.from('course_attempts')
          .select('id, answers, hints_used')
          .eq('course_id', course_id).eq('student_id', sessionUser.id)
          .is('completed_at', null)
          .order('current_question_index', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(1).maybeSingle(),
        supabase.from('students').select('full_name').eq('id', sessionUser.id).single(),
      ]);

      if (!courseData) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      if (!attempt) return NextResponse.json({ ok: true, ignored: 'no_active_attempt' });

      if (attempt && courseData) {
        // Server-side scoring - client-supplied score/passed/points are ignored.
        // Merge final_answers (sent by client) over stored answers so that the last
        // lessonOnly 'viewed' entry is always present, regardless of race timing.
        const questions: any[]              = Array.isArray(courseData.questions) ? courseData.questions : [];
        const persistedAnswers: Record<string, string> = attempt.answers ?? {};
        const qTypes = questionTypeMap(questions);
        const storedAnswers: Record<string, string> = { ...persistedAnswers };
        const incomingFinalAnswers = final_answers && typeof final_answers === 'object' ? final_answers : {};
        for (const key of Object.keys(incomingFinalAnswers)) {
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
        const hintsUsed: string[]           = attempt.hints_used ?? [];
        const passmark                      = courseData.passmark ?? 50;

        const scorable = questions.filter(q => !q.lessonOnly && !q.isSection && !q.isDownloads);
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

        const answerMetaFor = (q: any) => {
          const raw = storedAnswers[q.id];
          const parsed = parseAnswer(raw) ?? {};
          const meta = parseAnswer(storedAnswers[`__meta_${q.id}`]) ?? {};
          const elapsedRaw = meta.elapsedSeconds ?? parsed.elapsedSeconds;
          const elapsed = Number(elapsedRaw);
          const answeredAtRaw = meta.answeredAt ?? parsed.answeredAt ?? parsed.checkedAt;
          const answeredAtMs = answeredAtRaw ? Date.parse(String(answeredAtRaw)) : NaN;
          return {
            parsed,
            elapsedSeconds: Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
            answeredAtMs: Number.isFinite(answeredAtMs) ? answeredAtMs : null,
          };
        };

        const calculateEarned = (q: any, pointStreak: number, elapsedSeconds: number | null) => {
          const withinTimeBonus = pointsSystem.timeBonusEnabled
            && elapsedSeconds != null
            && elapsedSeconds <= pointsSystem.timeBonusSeconds;
          const timeMultiplier = withinTimeBonus ? pointsSystem.timeBonusMultiplier : 1;
          let earned = Math.round(pointsSystem.basePoints * timeMultiplier);
          const isStreak = pointsSystem.streakEnabled && pointStreak >= pointsSystem.streakCount;
          if (isStreak) {
            earned = pointsSystem.streakBonus > 0
              ? earned + pointsSystem.streakBonus
              : Math.round(earned * 1.2);
          }
          if (hintsUsed.includes(q.id)) earned = Math.max(0, earned - pointsSystem.hintPenalty);
          return earned;
        };

        const pointEvents = scorable
          .map((q, index) => {
            const meta = answerMetaFor(q);
            return {
              q,
              index,
              raw: storedAnswers[q.id],
              correct: scoreQuestion(q),
              solutionViewed: !!meta.parsed?.solutionViewed,
              elapsedSeconds: meta.elapsedSeconds,
              answeredAtMs: meta.answeredAtMs,
            };
          })
          .filter(e => e.raw != null)
          .sort((a, b) => (a.answeredAtMs ?? Number.POSITIVE_INFINITY) - (b.answeredAtMs ?? Number.POSITIVE_INFINITY) || a.index - b.index);

        let computed_points = 0;
        if (pointsSystem.enabled) {
          let pointStreak = 0;
          for (const event of pointEvents) {
            if (event.correct) {
              pointStreak += 1;
              computed_points += calculateEarned(event.q, pointStreak, event.elapsedSeconds);
            } else {
              pointStreak = 0;
              if (event.solutionViewed) {
                computed_points = Math.max(0, computed_points - pointsSystem.solutionPenalty);
              }
            }
          }
          computed_points = Math.max(0, Math.round(computed_points));
        }

        const { error: updateError } = await supabase.from('course_attempts').update({
          completed_at:           new Date().toISOString(),
          passed,
          score:                  scorePct,
          points:                 computed_points,
          current_question_index: Math.max(Number(current_question_index) || 0, questions.length),
          answers:                storedAnswers,
          updated_at:             new Date().toISOString(),
        }).eq('id', attempt.id);

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
