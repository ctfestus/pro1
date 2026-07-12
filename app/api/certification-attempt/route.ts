import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { adminClient } from '@/lib/admin-client';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { courseResultEmail } from '@/lib/email-templates';
import { gradeQuestion, normalizePythonOutput, signProof, verifyProof, sanitizeExamQuestions, assembleExamFormIds, withShuffledOptions, seededRng } from '@/lib/grade-question';
import { ensureCertificate, awardContentBadge, sendCertificateEmailOnce } from '@/lib/issue-certificate';
import { retakeReadyAt } from '@/lib/cert-cooldown';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getSessionUser(req: NextRequest): Promise<{ id: string; email: string } | null> {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth) || !auth.user.email) return null;
  return { id: auth.user.id, email: auth.user.email.trim().toLowerCase() };
}


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Service-role load + manual access check (RLS is bypassed by the admin client). `ref` may be a
// certification id (UUID) or slug. Access model:
// - owner (creator) or admin -> full access, including drafts
// - instructor or staff -> published only (preview / proctor), NOT another creator's draft
// - student -> published + assigned cohort
async function loadAccessibleCertification(
  supabase: ReturnType<typeof adminClient>,
  ref: string,
  user: { id: string },
  select = 'id, user_id, status, cohort_ids, questions, passmark, max_attempts, time_limit',
) {
  const [{ data: cert, error }, { data: student }] = await Promise.all([
    supabase.from('certifications').select(select).eq(UUID_RE.test(ref) ? 'id' : 'slug', ref).maybeSingle(),
    supabase.from('students').select('role, cohort_id').eq('id', user.id).maybeSingle(),
  ]);
  if (error || !cert) return { error: NextResponse.json({ error: 'Certification not found' }, { status: 404 }) };

  const role = String((student as any)?.role ?? '');
  const cohortIds = Array.isArray((cert as any).cohort_ids) ? (cert as any).cohort_ids : [];
  const isOwner = (cert as any).user_id === user.id;
  const isAdmin = role === 'admin';
  const isPublished = (cert as any).status === 'published';
  const cohortAllowed = cohortIds.length === 0 || (!!(student as any)?.cohort_id && cohortIds.includes((student as any).cohort_id));
  const elevatedPublished = (role === 'instructor' || role === 'staff') && isPublished;
  if (!(isOwner || isAdmin || elevatedPublished || (isPublished && cohortAllowed))) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { cert };
}

// Build a fn that attaches a case-study scenario (by scenarioId) to a delivered question. Scenarios
// carry no answer key, so it is safe to ship to the client alongside the already-sanitized questions.
function makeScenarioAttacher(scenarios: any): (q: any) => any {
  const map = new Map(
    (Array.isArray(scenarios) ? scenarios : [])
      .filter((s: any) => s?.id)
      .map((s: any) => [String(s.id), { id: String(s.id), title: String(s.title ?? ''), content: String(s.content ?? '') }]),
  );
  return (q: any) => (q?.scenarioId && map.has(q.scenarioId) ? { ...q, scenario: map.get(q.scenarioId) } : q);
}

function runCertificateSideEffects(
  supabase: ReturnType<typeof adminClient>,
  { certification_id, student_id, cert_id, skills, correctQuestions, totalQuestions, passmark }: {
    certification_id: string; student_id: string; cert_id: string;
    skills?: { name: string; correct: number; total: number; pct: number }[];
    correctQuestions?: number; totalQuestions?: number; passmark?: number;
  },
): void {
  (async () => {
    try {
      const [{ data: certRow }, { data: studentRow }, { data: bestAttempt }] = await Promise.all([
        supabase.from('certifications').select('title, slug, badge_image_url').eq('id', certification_id).single(),
        supabase.from('students').select('full_name, email').eq('id', student_id).single(),
        supabase.from('certification_attempts').select('score')
          .eq('certification_id', certification_id).eq('student_id', student_id)
          .eq('passed', true).order('score', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (!certRow || !studentRow?.email) return;

      let badgeName: string | undefined;
      let badgeImageUrl: string | undefined;
      if (certRow.badge_image_url) {
        await awardContentBadge(supabase, {
          badgeId:     `cert_${certification_id}`,
          name:        `${certRow.title} Badge`,
          description: `Awarded for passing ${certRow.title}`,
          imageUrl:    certRow.badge_image_url,
          category:    'certification',
          studentId:   student_id,
        });
        badgeName = `${certRow.title} Badge`;
        badgeImageUrl = certRow.badge_image_url;
      }

      if (process.env.RESEND_API_KEY) {
        const t        = await getTenantSettings();
        const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
        const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
        const certUrl  = `${t.appUrl}/certificate/${cert_id}`;
        const formUrl  = certRow.slug ? `${t.appUrl}/${certRow.slug}` : `${t.appUrl}/${certification_id}`;
        await sendCertificateEmailOnce(supabase, {
          certId:     cert_id,
          dedupeType: 'certification-certificate',
          from:       FROM,
          to:         studentRow.email,
          subject:    `Congratulations! You are now a ${certRow.title}`,
          html:       courseResultEmail({
            name:        studentRow.full_name ?? 'there',
            courseTitle: certRow.title,
            score:       bestAttempt?.score ?? 100,
            total:       100,
            percentage:  bestAttempt?.score ?? 100,
            passed:      true,
            passmark,
            correctQuestions,
            totalQuestions,
            skills,
            formUrl,
            certUrl,
            badgeName,
            badgeImageUrl,
            branding,
          }),
        });
      }
    } catch (err) {
      console.error('[certification-attempt] side effects failed', err);
    }
  })();
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { action, certification_id } = body;

  const sessionUser = await getSessionUser(req);
  if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = adminClient();

  // -- Student catalog: published certifications assigned to the student's cohort (no questions) --
  if (action === 'list') {
    try {
      const { data: student } = await supabase.from('students').select('role, cohort_id').eq('id', sessionUser.id).maybeSingle();
      const role = String((student as any)?.role ?? '');
      const privileged = ['admin', 'instructor', 'staff'].includes(role);
      const cohortId = (student as any)?.cohort_id;
      const { data: rows } = await supabase
        .from('certifications')
        .select('id, title, slug, cert_type, cover_image, badge_image_url, passmark, time_limit, max_attempts, description, cohort_ids')
        .eq('status', 'published');
      // A certification with no assigned cohorts is open to everyone; otherwise the student's cohort
      // must be in the list. Privileged users see all.
      const visible = (rows ?? []).filter((r: any) => {
        if (privileged) return true;
        const cids = Array.isArray(r.cohort_ids) ? r.cohort_ids : [];
        return cids.length === 0 || (cohortId && cids.includes(cohortId));
      });
      // Never leak cohort_ids to the client.
      return NextResponse.json({ certifications: visible.map(({ cohort_ids, ...m }: any) => m) });
    } catch (err: any) {
      console.error('[certification-attempt/list]', err);
      return NextResponse.json({ error: 'Failed to load certifications.' }, { status: 500 });
    }
  }

  // -- Title/cover for the caller's earned-certificate cards. Scoped to certifications the caller
  // actually holds a non-revoked certificate for, so it can't enumerate draft/private metadata. --
  if (action === 'meta') {
    const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: any) => typeof x === 'string').slice(0, 200) : [];
    if (!ids.length) return NextResponse.json({ certifications: [] });
    const { data: owned } = await supabase.from('certificates')
      .select('certification_id')
      .eq('student_id', sessionUser.id).eq('revoked', false).in('certification_id', ids);
    const allowed = [...new Set((owned ?? []).map((r: any) => r.certification_id).filter(Boolean))];
    if (!allowed.length) return NextResponse.json({ certifications: [] });
    const { data } = await supabase.from('certifications').select('id, title, cover_image').in('id', allowed);
    return NextResponse.json({ certifications: data ?? [] });
  }

  // -- Exam METADATA for the intro screen (no questions). Accepts id or slug. Questions are delivered
  // only by start-attempt, which stamps started_at -- so a student cannot read the questions without
  // the clock starting. --
  if (action === 'get-exam') {
    const ref: string | undefined = body.certification_id || body.slug;
    if (!ref) return NextResponse.json({ error: 'certification_id or slug required' }, { status: 400 });
    try {
      const access = await loadAccessibleCertification(supabase, ref, sessionUser, '*');
      if ('error' in access) return access.error;
      const cert = access.cert as any;
      const scorableCount = (Array.isArray(cert.questions) ? cert.questions : [])
        .filter((q: any) => !q?.lessonOnly && !q?.isSection && !q?.isDownloads).length;
      // With pooling, each attempt draws a subset -- surface the drawn count on the overview.
      const poolSize = Number(cert.question_pool_size) || 0;
      const questionCount = poolSize > 0 ? Math.min(poolSize, scorableCount) : scorableCount;
      // Practice mode uses a separate bank; the taker shows the "Practice run" button only when it exists.
      const practiceCount = (Array.isArray(cert.practice_questions) ? cert.practice_questions : [])
        .filter((q: any) => !q?.lessonOnly && !q?.isSection && !q?.isDownloads).length;
      return NextResponse.json({ certification: {
        id: cert.id, slug: cert.slug, user_id: cert.user_id,
        config: {
          title: cert.title, description: cert.description, isCertification: true,
          questionCount, practiceCount,
          passmark: cert.passmark, timeLimit: cert.time_limit,
          maxAttempts: cert.max_attempts, retakeCooldownHours: cert.retake_cooldown_hours ?? 24,
          examProtection: cert.exam_protection,
          coverImage: cert.cover_image, deadline_days: cert.deadline_days,
          theme: cert.theme, mode: cert.mode, font: cert.font, customAccent: cert.custom_accent,
          // Foundation assets shown on the intro screen. Study guide + poster are gated on their
          // publish flags; skill areas + practice-test link are always visible.
          skillAreas: Array.isArray(cert.skill_areas) ? cert.skill_areas : [],
          studyGuide: cert.study_guide_published && cert.study_guide_url
            ? { url: cert.study_guide_url, name: cert.study_guide_name || 'Study guide' } : null,
          poster: cert.poster_published && cert.poster_url ? cert.poster_url : null,
          practiceTestUrl: cert.practice_test_url || null,
          // Courses / learning paths to complete before the exam ("Complete courses" step). Ids only;
          // the client resolves details from the public published_* views, so unpublished items drop out.
          prepItems: Array.isArray(cert.prep_items) ? cert.prep_items : [],
          // Shared runnable-playground data (tables/DataFrames) reused across question playgrounds.
          // No answer keys, so it is safe on the client; merged into each question's playground by the taker.
          playgroundData: cert.playground_data && typeof cert.playground_data === 'object' ? cert.playground_data : {},
          // Distinct exam sections present (Technical / Practical), in canonical order, for the overview.
          sections: ['technical', 'practical'].filter(s =>
            (Array.isArray(cert.questions) ? cert.questions : []).some((q: any) => q?.section === s)),
        },
      } });
    } catch (err: any) {
      console.error('[certification-attempt/get-exam]', err);
      return NextResponse.json({ error: 'Failed to load certification.' }, { status: 500 });
    }
  }

  if (!certification_id) return NextResponse.json({ error: 'certification_id required' }, { status: 400 });

  // -- Resume state + existing cert + completed-attempt count --
  if (action === 'get-progress') {
    try {
      const [{ data: cert }, { data: progress }, { count: attemptCount }, { data: passingAttempt }, { data: certRow }, { data: lastCompleted }] = await Promise.all([
        supabase.from('certificates').select('id')
          .eq('certification_id', certification_id).eq('student_id', sessionUser.id).eq('revoked', false)
          .maybeSingle(),
        supabase.from('certification_attempts').select('*')
          .eq('certification_id', certification_id).eq('student_id', sessionUser.id)
          .is('completed_at', null)
          .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('certification_attempts').select('id', { count: 'exact', head: true })
          .eq('certification_id', certification_id).eq('student_id', sessionUser.id)
          .not('completed_at', 'is', null),
        supabase.from('certification_attempts').select('answers, score')
          .eq('certification_id', certification_id).eq('student_id', sessionUser.id)
          .eq('passed', true).order('score', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('certifications').select('time_limit, retake_cooldown_hours').eq('id', certification_id).maybeSingle(),
        supabase.from('certification_attempts').select('completed_at')
          .eq('certification_id', certification_id).eq('student_id', sessionUser.id)
          .not('completed_at', 'is', null).order('completed_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      // Server-derived remaining time so a refresh/reopen cannot regain time (the clock runs from
      // the attempt's started_at, computed with the server clock).
      let remainingSeconds: number | null = null;
      const timeLimit = Number((certRow as any)?.time_limit) || 0;
      if (progress?.started_at && timeLimit > 0) {
        const elapsed = Math.floor((Date.now() - new Date(progress.started_at).getTime()) / 1000);
        remainingSeconds = Math.max(0, timeLimit * 60 - elapsed);
      }
      // When can a fresh attempt start? Blocked until the retake cooldown elapses after the last
      // completed attempt (only relevant when they haven't passed and one isn't already in progress).
      const cooldownHours = Number((certRow as any)?.retake_cooldown_hours) || 0;
      const retakeAt = (passingAttempt || progress)
        ? null
        : retakeReadyAt((lastCompleted as any)?.completed_at, cooldownHours, Date.now());
      return NextResponse.json({ cert, progress, attemptCount: attemptCount ?? 0, hasPassed: !!passingAttempt, passingAttempt, remainingSeconds, cooldownHours, retakeAt });
    } catch (err: any) {
      console.error('[certification-attempt/get-progress]', err);
      return NextResponse.json({ error: 'Failed to load progress.' }, { status: 500 });
    }
  }

  // -- Server-side Python output check: expected output stays private --
  if (action === 'check-python-answer') {
    const { question_id, output } = body;
    if (!question_id) return NextResponse.json({ error: 'question_id required' }, { status: 400 });
    try {
      const access = await loadAccessibleCertification(supabase, certification_id, sessionUser, 'id, user_id, status, cohort_ids, questions, time_limit');
      if ('error' in access) return access.error;
      const cert = access.cert as any;
      const question = (Array.isArray(cert.questions) ? cert.questions : [])
        .find((q: any) => q?.id === question_id && q?.type === 'python_exercise');
      if (!question) return NextResponse.json({ error: 'Python exercise not found.' }, { status: 404 });
      const expected = normalizePythonOutput(question.pythonExpectedOutput);
      if (!expected) return NextResponse.json({ error: 'Python expected output is not configured.' }, { status: 400 });
      const actual = normalizePythonOutput(output);
      const passed = actual === expected;

      // A proof is only minted inside a live, unexpired attempt and is bound to that attempt.id, so it
      // can't be pre-computed outside the exam window or replayed on a later attempt.
      const { data: attempt } = await supabase.from('certification_attempts')
        .select('id, started_at')
        .eq('certification_id', certification_id).eq('student_id', sessionUser.id)
        .is('completed_at', null)
        .order('updated_at', { ascending: false }).limit(1).maybeSingle();

      if (!attempt) {
        // Privileged preview has no attempt: report pass/fail for the walkthrough, but never a proof.
        const { data: student } = await supabase.from('students').select('role').eq('id', sessionUser.id).maybeSingle();
        const isPreview = cert.user_id === sessionUser.id || ['admin', 'instructor', 'staff'].includes(String((student as any)?.role ?? ''));
        if (isPreview) {
          return NextResponse.json({ passed, message: passed ? 'Output matches.' : 'Output does not match the expected result.' });
        }
        return NextResponse.json({ passed: false, message: 'No active exam attempt. Start the exam first.' });
      }

      const timeLimit = Number(cert.time_limit) || 0;
      if (timeLimit > 0 && attempt.started_at &&
          (Date.now() - new Date(attempt.started_at).getTime()) / 1000 > timeLimit * 60 + 5) {
        return NextResponse.json({ passed: false, message: 'Time is up for this exam.' });
      }

      return NextResponse.json({
        passed,
        message: passed ? 'Output matches.' : 'Output does not match the expected result.',
        proof: passed ? signProof(certification_id, question_id, actual, attempt.id) : undefined,
      });
    } catch (err: any) {
      console.error('[certification-attempt/check-python-answer]', err);
      return NextResponse.json({ error: 'Failed to check Python answer.' }, { status: 500 });
    }
  }

  // -- Start (or resume) the attempt and deliver the questions. This is the ONLY place an attempt is
  // created, so started_at marks the moment questions are handed out -- the timer cannot be deferred
  // by reading questions first. Privileged users (owner/admin/instructor/staff) get a preview with no
  // attempt and no timer. --
  if (action === 'start-attempt') {
    try {
      const access = await loadAccessibleCertification(
        supabase, certification_id, sessionUser,
        'id, user_id, status, cohort_ids, questions, scenarios, max_attempts, time_limit, retake_cooldown_hours, randomize_questions, shuffle_options, question_pool_size',
      );
      if ('error' in access) return access.error;
      const cert = access.cert as any;
      const questions = sanitizeExamQuestions(cert.questions);
      const timeLimit = Number(cert.time_limit) || 0;
      const randomize = cert.randomize_questions === true;
      const shuffleOpts = cert.shuffle_options === true;
      const poolSize = Number(cert.question_pool_size) || 0;
      // Case-study stimulus attached to each question that references it (scenarios carry no answer key).
      const attachScenario = makeScenarioAttacher(cert.scenarios);
      // Build the questions delivered to an attempt: reorder/subset per the attempt's persisted form
      // (empty = full authored order), then shuffle options deterministically per attempt so a resume
      // sees the same layout. Grading in complete-attempt uses the same persisted form.
      const byId = new Map(questions.map((q: any) => [q.id, q]));
      const deliver = (attemptId: string, formIds: string[]) => {
        const base = Array.isArray(formIds) && formIds.length
          ? formIds.map(id => byId.get(id)).filter(Boolean)
          : questions;
        const withOpts = shuffleOpts ? base.map((q: any) => withShuffledOptions(q, seededRng(`${attemptId}:${q.id}`))) : base;
        return withOpts.map(attachScenario);
      };

      const { data: student } = await supabase.from('students').select('role').eq('id', sessionUser.id).maybeSingle();
      const role = String((student as any)?.role ?? '');
      const isPreview = cert.user_id === sessionUser.id || ['admin', 'instructor', 'staff'].includes(role);
      if (isPreview) {
        const previewIds = assembleExamFormIds(questions, { randomize, poolSize }, Math.random);
        return NextResponse.json({ questions: deliver('preview', previewIds), remainingSeconds: timeLimit > 0 ? timeLimit * 60 : null, currentIndex: 0, answers: {}, proctor: {}, preview: true });
      }

      const { data: passedRow } = await supabase.from('certification_attempts').select('id')
        .eq('certification_id', certification_id).eq('student_id', sessionUser.id).eq('passed', true).limit(1).maybeSingle();
      if (passedRow) return NextResponse.json({ error: 'You have already passed this certification.', reason: 'already_passed' }, { status: 409 });

      const sel = 'id, started_at, current_question_index, answers, proctor, question_ids';
      let attempt = (await supabase.from('certification_attempts').select(sel)
        .eq('certification_id', certification_id).eq('student_id', sessionUser.id).is('completed_at', null)
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()).data;

      // "One active certification at a time": a student may be enrolled in only ONE certification they
      // have not yet passed. ANY other certification they have attempted without passing blocks a new
      // start -- not just one that is mid-exam (a failed attempt still counts as an active enrollment).
      // The student can `switch`, which abandons the other enrollment(s); see leaveOtherEnrollments.
      const doSwitch = body.switch === true;
      const otherUnpassed = async (): Promise<{ id: string; title: string } | null> => {
        const { data: rows } = await supabase.from('certification_attempts')
          .select('certification_id, passed').eq('student_id', sessionUser.id).neq('certification_id', certification_id);
        const list = rows ?? [];
        const passedSet = new Set(list.filter(r => r.passed).map(r => r.certification_id));
        const blockingId = list.map(r => r.certification_id).find(cid => !passedSet.has(cid));
        if (!blockingId) return null;
        const { data: c } = await supabase.from('certifications').select('title').eq('id', blockingId).maybeSingle();
        return { id: blockingId, title: (c as any)?.title || 'another certification' };
      };
      // Switch = reset: delete every other not-yet-passed enrollment's attempts, so returning to it
      // later starts fresh. Passing attempts (which back earned certificates) are never touched.
      const leaveOtherEnrollments = async () => {
        const { data: rows } = await supabase.from('certification_attempts')
          .select('certification_id, passed').eq('student_id', sessionUser.id).neq('certification_id', certification_id);
        const list = rows ?? [];
        const passedSet = new Set(list.filter(r => r.passed).map(r => r.certification_id));
        const blockingIds = [...new Set(list.map(r => r.certification_id).filter(cid => !passedSet.has(cid)))];
        if (blockingIds.length) {
          await supabase.from('certification_attempts').delete()
            .eq('student_id', sessionUser.id).in('certification_id', blockingIds);
        }
      };
      const enrollmentGate = async (): Promise<NextResponse | null> => {
        if (doSwitch) { await leaveOtherEnrollments(); return null; }
        const blocker = await otherUnpassed();
        if (blocker) {
          return NextResponse.json({
            error: `You are enrolled in "${blocker.title}", which you have not passed yet. Switch to this certification to leave it.`,
            reason: 'other_unpassed', otherCertId: blocker.id, otherCertTitle: blocker.title,
          }, { status: 409 });
        }
        return null;
      };

      if (!attempt) {
        // Enforce one active (unpassed) enrollment; on `switch`, this abandons the others first.
        // (The unique index below is the atomic guarantee against concurrent in-progress starts.)
        const gate = await enrollmentGate();
        if (gate) return gate;

        const maxAttempts = Number(cert.max_attempts) || 0;
        const [{ count: completedCount }, { data: last }] = await Promise.all([
          supabase.from('certification_attempts').select('id', { count: 'exact', head: true })
            .eq('certification_id', certification_id).eq('student_id', sessionUser.id).not('completed_at', 'is', null),
          supabase.from('certification_attempts').select('attempt_number, completed_at')
            .eq('certification_id', certification_id).eq('student_id', sessionUser.id)
            .order('attempt_number', { ascending: false }).limit(1).maybeSingle(),
        ]);
        if (maxAttempts > 0 && (completedCount ?? 0) >= maxAttempts) {
          return NextResponse.json({ error: 'No attempts remaining.' }, { status: 403 });
        }
        // Retake cooldown: minimum wait after the previous attempt. Passing is already blocked above,
        // so any prior attempt here is a failed one; the most recent is `last` (attempts are serial).
        const cooldownHours = Number(cert.retake_cooldown_hours) || 0;
        const retakeAt = retakeReadyAt(last?.completed_at, cooldownHours, Date.now());
        if (retakeAt) {
          return NextResponse.json({
            error: `You can retake this certification after the ${cooldownHours}-hour wait.`,
            reason: 'cooldown', retakeAt,
          }, { status: 429 });
        }
        // Assemble this attempt's form (order + pool). Persisted so a resume sees the same questions
        // and grading scores only what was delivered. Empty when neither randomize nor pooling is on.
        const formIds = assembleExamFormIds(questions, { randomize, poolSize }, Math.random);
        const ins = await supabase.from('certification_attempts').insert({
          student_id: sessionUser.id, certification_id,
          attempt_number: (last?.attempt_number ?? 0) + 1, question_ids: formIds, updated_at: new Date().toISOString(),
        }).select(sel).single();
        if (ins.error) {
          // Lost a race on the one-active-attempt-per-student unique index. If the winner is THIS
          // certification, resume it; if it's a different certification, enforce the rule.
          attempt = (await supabase.from('certification_attempts').select(sel)
            .eq('certification_id', certification_id).eq('student_id', sessionUser.id).is('completed_at', null)
            .order('updated_at', { ascending: false }).limit(1).maybeSingle()).data;
          if (!attempt) {
            const gate = await enrollmentGate();
            if (gate) return gate;
            return NextResponse.json({ error: 'Could not start the exam.' }, { status: 500 });
          }
        } else {
          attempt = ins.data;
        }
      }
      if (!attempt) return NextResponse.json({ error: 'Could not start the exam.' }, { status: 500 });

      let remainingSeconds: number | null = null;
      if (timeLimit > 0 && attempt.started_at) {
        const elapsed = Math.floor((Date.now() - new Date(attempt.started_at).getTime()) / 1000);
        remainingSeconds = Math.max(0, timeLimit * 60 - elapsed);
      }
      return NextResponse.json({
        questions: deliver(attempt.id, Array.isArray(attempt.question_ids) ? attempt.question_ids : []),
        remainingSeconds,
        currentIndex: attempt.current_question_index ?? 0,
        answers: attempt.answers && typeof attempt.answers === 'object' ? attempt.answers : {},
        proctor: attempt.proctor && typeof attempt.proctor === 'object' ? attempt.proctor : {},
      });
    } catch (err: any) {
      console.error('[certification-attempt/start-attempt]', err);
      return NextResponse.json({ error: 'Failed to start the exam.' }, { status: 500 });
    }
  }

  // -- Save in-progress attempt (UPDATE only; the attempt must already exist via start-attempt) --
  if (action === 'save-progress') {
    const { current_question_index, answers, proctor } = body;
    try {
      const access = await loadAccessibleCertification(supabase, certification_id, sessionUser, 'id, user_id, status, cohort_ids, time_limit');
      if ('error' in access) return access.error;
      const timeLimit = Number((access.cert as any).time_limit) || 0;

      const incomingIndex = Number.isFinite(Number(current_question_index)) ? Number(current_question_index) : 0;
      const incomingAnswers = answers && typeof answers === 'object' && !Array.isArray(answers) ? answers : {};
      const incomingProctor = proctor && typeof proctor === 'object' && !Array.isArray(proctor) ? proctor : {};

      const { data: existing } = await supabase.from('certification_attempts')
        .select('id, current_question_index, answers, proctor, started_at')
        .eq('certification_id', certification_id).eq('student_id', sessionUser.id)
        .is('completed_at', null)
        .order('updated_at', { ascending: false }).limit(1).maybeSingle();

      // Update only: the attempt is created by start-attempt. No active attempt -> nothing to save
      // (and we must NOT create one here, or started_at would be re-stamped and the timer reset).
      if (!existing) return NextResponse.json({ ok: true, ignored: 'no_active_attempt' });

      // Reject writes after the time limit: no answers may be persisted past the deadline.
      if (timeLimit > 0 && existing.started_at &&
          (Date.now() - new Date(existing.started_at).getTime()) / 1000 > timeLimit * 60 + 5) {
        return NextResponse.json({ ok: true, ignored: 'time_expired' });
      }
      const existingAnswers = existing.answers && typeof existing.answers === 'object' ? existing.answers : {};
      await supabase.from('certification_attempts').update({
        current_question_index: Math.max(existing.current_question_index ?? 0, incomingIndex),
        // Existing answers win on conflict so a stale tab cannot overwrite recorded answers.
        answers: { ...incomingAnswers, ...existingAnswers },
        proctor: { ...(existing.proctor ?? {}), ...incomingProctor },
        updated_at: new Date().toISOString(),
      }).eq('id', existing.id);
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[certification-attempt/save-progress]', err);
      return NextResponse.json({ error: 'Failed to save progress.' }, { status: 500 });
    }
  }

  // -- Complete the active attempt: re-score server-side, issue cert on pass --
  if (action === 'complete-attempt') {
    const { current_question_index, final_answers, proctor } = body;
    try {
      const access = await loadAccessibleCertification(
        supabase, certification_id, sessionUser,
        'id, user_id, status, cohort_ids, questions, passmark, max_attempts, time_limit, skill_areas',
      );
      if ('error' in access) return access.error;
      const cert = access.cert as any;

      const attempt = (await supabase.from('certification_attempts')
        .select('id, answers, started_at, question_ids')
        .eq('certification_id', certification_id).eq('student_id', sessionUser.id)
        .is('completed_at', null)
        .order('updated_at', { ascending: false }).limit(1).maybeSingle()).data;

      // No create-if-missing: the attempt must already exist via start-attempt. Completing without an
      // active attempt would mint a fresh started_at and let a client bypass the timer, so refuse.
      if (!attempt) return NextResponse.json({ ok: true, ignored: 'no_active_attempt' });

      const questions: any[] = Array.isArray(cert.questions) ? cert.questions : [];
      const persistedAnswers: Record<string, any> = attempt.answers ?? {};
      // Past the deadline, ignore client-supplied final_answers and score only what was persisted
      // before time ran out -- the timer cannot be beaten by submitting late.
      const timeLimit = Number(cert.time_limit) || 0;
      const expired = timeLimit > 0 && (attempt as any).started_at &&
        (Date.now() - new Date((attempt as any).started_at).getTime()) / 1000 > timeLimit * 60 + 5;
      const storedAnswers: Record<string, any> = expired
        ? { ...persistedAnswers }
        : { ...persistedAnswers, ...(final_answers && typeof final_answers === 'object' ? final_answers : {}) };
      const passmark = cert.passmark ?? 70;

      // Grade only the questions THIS attempt was delivered (pooling-correct). Empty question_ids
      // (legacy attempts, or randomize/pool off) = grade all scorable, as before.
      const formIds: string[] = Array.isArray((attempt as any).question_ids) ? (attempt as any).question_ids : [];
      const formSet = new Set(formIds);
      const scorableAll = questions.filter(q => !q.lessonOnly && !q.isSection && !q.isDownloads);
      const scorable = formIds.length ? scorableAll.filter(q => formSet.has(q.id)) : scorableAll;
      let correct = 0;
      const correctIds = new Set<string>();
      for (const q of scorable) {
        const ok = gradeQuestion(q, {
          storedAnswers,
          persistedAnswers,
          // Proof must have been minted for THIS attempt (bound to attempt.id) -- blocks cross-attempt reuse.
          verifyProof: (questionId, output, proof) => verifyProof(certification_id, questionId, output, proof, attempt.id),
        });
        if (ok) { correct++; correctIds.add(q.id); }
      }
      const total = scorable.length;
      const scorePct = total === 0 ? 100 : Math.round((correct / total) * 100);
      const passed = scorePct >= passmark;

      // Per-skill-area breakdown for the result screen (only skills with mapped questions).
      const skillAreas: { id: string; name: string }[] = Array.isArray(cert.skill_areas) ? cert.skill_areas : [];
      const skills = skillAreas
        .map(sa => {
          const qs = scorable.filter(q => q?.skillAreaId === sa.id);
          const c = qs.filter(q => correctIds.has(q.id)).length;
          return { id: sa.id, name: sa.name, correct: c, total: qs.length, pct: qs.length ? Math.round((c / qs.length) * 100) : 0 };
        })
        .filter(s => s.total > 0);

      const { error: updateError } = await supabase.from('certification_attempts').update({
        completed_at:           new Date().toISOString(),
        passed,
        score:                  scorePct,
        current_question_index: Math.max(Number(current_question_index) || 0, questions.length),
        answers:                storedAnswers,
        proctor:                proctor && typeof proctor === 'object' ? proctor : (attempt as any).proctor,
        updated_at:             new Date().toISOString(),
      }).eq('id', attempt.id);
      if (updateError) {
        console.error('[certification-attempt/complete-attempt] update failed', updateError);
        return NextResponse.json({ error: 'Failed to complete attempt.' }, { status: 500 });
      }

      let certId: string | undefined;
      if (passed) {
        try {
          const { data: studentRow } = await supabase.from('students').select('full_name').eq('id', sessionUser.id).single();
          const studentName = studentRow?.full_name?.trim() || sessionUser.email;
          const result = await ensureCertificate(supabase, {
            column: 'certification_id', contentId: certification_id, studentId: sessionUser.id, studentName,
          });
          certId = result.certId;
          if (result.isNew) runCertificateSideEffects(supabase, {
            certification_id, student_id: sessionUser.id, cert_id: result.certId,
            skills, correctQuestions: correct, totalQuestions: total, passmark,
          });
        } catch (certErr) {
          console.error('[certification-attempt/complete-attempt] certificate creation failed', certErr);
        }
      }

      return NextResponse.json({ ok: true, score: scorePct, passed, certId, passmark, correctQuestions: correct, totalQuestions: total, skills });
    } catch (err: any) {
      console.error('[certification-attempt/complete-attempt]', err);
      return NextResponse.json({ error: 'Failed to complete attempt.' }, { status: 500 });
    }
  }

  // -- Quit an in-progress (unsubmitted) exam: record the active attempt as a completed, failed one so
  // it counts against max_attempts (the student is warned they "lose one attempt"), and clears the
  // active-enrollment lock so they can start over or switch to another certification. --
  if (action === 'abandon-attempt') {
    try {
      const { error } = await supabase.from('certification_attempts')
        .update({ completed_at: new Date().toISOString(), passed: false, score: 0, updated_at: new Date().toISOString() })
        .eq('certification_id', certification_id)
        .eq('student_id', sessionUser.id)
        .is('completed_at', null);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    } catch (err: any) {
      console.error('[certification-attempt/abandon-attempt]', err);
      return NextResponse.json({ error: 'Failed to quit the exam.' }, { status: 500 });
    }
  }

  // -- Instructor analytics: aggregate completed attempts for one certification (owner/admin/instructor/
  // staff only). Returns pass rate, average score, score distribution, per-question correct rates
  // (to spot too-easy / too-hard / broken items) and per-skill performance across the cohort. --
  if (action === 'analytics') {
    try {
      const access = await loadAccessibleCertification(
        supabase, certification_id, sessionUser,
        'id, user_id, status, cohort_ids, questions, passmark, skill_areas',
      );
      if ('error' in access) return access.error;
      const cert = access.cert as any;
      const { data: student } = await supabase.from('students').select('role').eq('id', sessionUser.id).maybeSingle();
      const role = String((student as any)?.role ?? '');
      const privileged = cert.user_id === sessionUser.id || ['admin', 'instructor', 'staff'].includes(role);
      if (!privileged) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

      const { data: rows } = await supabase.from('certification_attempts')
        .select('student_id, score, passed, answers, question_ids, proctor, completed_at')
        .eq('certification_id', certification_id).not('completed_at', 'is', null);
      const attempts = rows ?? [];

      const questions: any[] = Array.isArray(cert.questions) ? cert.questions : [];
      const scorable = questions.filter(q => !q.lessonOnly && !q.isSection && !q.isDownloads);
      const passmark = cert.passmark ?? 70;

      const scorableIds = scorable.map(q => q.id);
      const scorableById = new Map(scorable.map(q => [q.id, q]));

      // Grade every completed attempt once: its score plus the set of questions it got right, over the
      // questions it was actually delivered (pooling-correct). Reused for item stats and discrimination.
      const graded = attempts.map((a: any) => {
        const raw: string[] = Array.isArray(a.question_ids) && a.question_ids.length ? a.question_ids : scorableIds;
        const seen = raw.filter((id: string) => scorableById.has(id));
        const ans = a.answers && typeof a.answers === 'object' ? a.answers : {};
        const correct = new Set<string>();
        for (const id of seen) {
          const q = scorableById.get(id);
          if (q && gradeQuestion(q, { storedAnswers: ans, persistedAnswers: ans, verifyProof: () => true })) correct.add(id);
        }
        return { score: Number(a.score) || 0, passed: !!a.passed, seen: new Set(seen), correct };
      });

      const totalAttempts = graded.length;
      const uniqueStudents = new Set(attempts.map((a: any) => a.student_id)).size;
      const passCount = graded.filter(g => g.passed).length;
      const passRate = totalAttempts ? Math.round((passCount / totalAttempts) * 100) : 0;

      // Summary score statistics.
      const scores = graded.map(g => g.score).sort((x, y) => x - y);
      const sum = scores.reduce((s, v) => s + v, 0);
      const mean = totalAttempts ? sum / totalAttempts : 0;
      const avgScore = Math.round(mean);
      const medianScore = totalAttempts
        ? Math.round(scores.length % 2 ? scores[(scores.length - 1) / 2] : (scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2)
        : 0;
      const minScore = totalAttempts ? scores[0] : 0;
      const maxScore = totalAttempts ? scores[scores.length - 1] : 0;
      const stdDev = totalAttempts ? Math.round(Math.sqrt(scores.reduce((s, v) => s + (v - mean) ** 2, 0) / totalAttempts)) : 0;

      // Score distribution in ten 10-point buckets (0-9, 10-19, ..., 90-100).
      const buckets = Array.from({ length: 10 }, () => 0);
      for (const g of graded) { buckets[Math.min(9, Math.floor(Math.max(0, Math.min(100, g.score)) / 10))]++; }

      // Discrimination (upper-lower index): top vs bottom 27% by total score -- a standard item-analysis
      // measure of how well an item separates strong from weak candidates. Needs >= 2 completed attempts.
      const byScoreDesc = [...graded].sort((x, y) => y.score - x.score);
      const groupSize = Math.max(1, Math.floor(totalAttempts * 0.27));
      const upper = totalAttempts >= 2 ? byScoreDesc.slice(0, groupSize) : [];
      const lower = totalAttempts >= 2 ? byScoreDesc.slice(-groupSize) : [];
      const groupRate = (group: typeof graded, id: string): number | null => {
        const seenN = group.filter(g => g.seen.has(id)).length;
        return seenN ? group.filter(g => g.correct.has(id)).length / seenN : null;
      };

      const perQuestion = scorable.map(q => {
        const seen = graded.filter(g => g.seen.has(q.id)).length;
        const correct = graded.filter(g => g.correct.has(q.id)).length;
        const pu = groupRate(upper, q.id), pl = groupRate(lower, q.id);
        const discrimination = pu != null && pl != null ? Math.round((pu - pl) * 100) / 100 : null;
        const text = String(q.question ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        return { id: q.id, type: q.type ?? 'multiple_choice', skillAreaId: q.skillAreaId ?? null,
          text: text.length > 120 ? `${text.slice(0, 120)}...` : (text || '(no text)'),
          seen, correct, correctRate: seen ? Math.round((correct / seen) * 100) : 0, discrimination };
      });

      const skillAreas: { id: string; name: string }[] = Array.isArray(cert.skill_areas) ? cert.skill_areas : [];
      const perSkill = skillAreas.map(sa => {
        const qs = perQuestion.filter(pq => pq.skillAreaId === sa.id);
        const seen = qs.reduce((s, q) => s + q.seen, 0);
        const correct = qs.reduce((s, q) => s + q.correct, 0);
        return { id: sa.id, name: sa.name, correctRate: seen ? Math.round((correct / seen) * 100) : 0, questions: qs.length };
      }).filter(s => s.questions > 0);

      // Attempts with any proctoring signal (tab hidden / window blur).
      const flagged = attempts.filter((a: any) => { const p = a.proctor || {}; return (Number(p.hidden) || 0) + (Number(p.blur) || 0) > 0; }).length;

      return NextResponse.json({ analytics: {
        totalAttempts, uniqueStudents, passCount, passRate, avgScore, medianScore, minScore, maxScore, stdDev,
        buckets, perQuestion, perSkill, flagged, questionCount: scorable.length, passmark,
      } });
    } catch (err: any) {
      console.error('[certification-attempt/analytics]', err);
      return NextResponse.json({ error: 'Failed to load analytics.' }, { status: 500 });
    }
  }

  // -- Practice questions: an ungraded dry run over the SEPARATE practice-only bank (never the graded
  // exam), so it is safe to reveal feedback later. Creates NO attempt, no timer, no protection. --
  if (action === 'practice-questions') {
    try {
      const access = await loadAccessibleCertification(
        supabase, certification_id, sessionUser,
        'id, user_id, status, cohort_ids, practice_questions, scenarios, randomize_questions, shuffle_options',
      );
      if ('error' in access) return access.error;
      const cert = access.cert as any;
      const questions = sanitizeExamQuestions(cert.practice_questions);
      if (!questions.length) return NextResponse.json({ error: 'No practice questions are available for this certification.' }, { status: 404 });
      const randomize = cert.randomize_questions === true;
      const shuffleOpts = cert.shuffle_options === true;
      const attachScenario = makeScenarioAttacher(cert.scenarios);
      // Practice uses ALL practice questions (no pooling); just apply order/option variety per the settings.
      const formIds = assembleExamFormIds(questions, { randomize, poolSize: 0 }, Math.random);
      const byId = new Map(questions.map((q: any) => [q.id, q]));
      const base = formIds.length ? formIds.map(id => byId.get(id)).filter(Boolean) : questions;
      const seedBase = `practice:${Math.random()}`;
      const withOpts = shuffleOpts ? base.map((q: any) => withShuffledOptions(q, seededRng(`${seedBase}:${q.id}`))) : base;
      return NextResponse.json({ questions: withOpts.map(attachScenario) });
    } catch (err: any) {
      console.error('[certification-attempt/practice-questions]', err);
      return NextResponse.json({ error: 'Failed to load practice questions.' }, { status: 500 });
    }
  }

  // -- Grade a practice run statelessly over the practice bank: returns score + per-skill breakdown AND
  // per-question review (correct answer + explanation). Practice questions are not the real exam, so
  // revealing feedback is safe. Nothing is persisted; exercise proofs are trusted (no stakes). --
  if (action === 'grade-practice') {
    try {
      const access = await loadAccessibleCertification(
        supabase, certification_id, sessionUser,
        'id, user_id, status, cohort_ids, practice_questions, passmark, skill_areas',
      );
      if ('error' in access) return access.error;
      const cert = access.cert as any;
      const answers = body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers) ? body.answers : {};
      const ids: string[] = Array.isArray(body.questionIds) ? body.questionIds.filter((x: any) => typeof x === 'string') : [];
      const idSet = new Set(ids);
      const questions: any[] = Array.isArray(cert.practice_questions) ? cert.practice_questions : [];
      const scorableAll = questions.filter(q => !q.lessonOnly && !q.isSection && !q.isDownloads);
      const scorable = idSet.size ? scorableAll.filter(q => idSet.has(q.id)) : scorableAll;
      let correct = 0;
      const correctIds = new Set<string>();
      const plain = (s: unknown) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      const review = scorable.map(q => {
        const ok = gradeQuestion(q, { storedAnswers: answers, persistedAnswers: answers, verifyProof: () => true });
        if (ok) { correct++; correctIds.add(q.id); }
        // Practice-only questions -- safe to reveal the key + explanation.
        const correctAnswer = plain(String(q.correctAnswer ?? '').split('|||').join(' | '));
        const qtext = plain(q.question);
        return { id: q.id, question: qtext.length > 140 ? `${qtext.slice(0, 140)}...` : qtext,
          correct: ok, correctAnswer, explanation: plain(q.explanation) };
      });
      const total = scorable.length;
      const scorePct = total === 0 ? 0 : Math.round((correct / total) * 100);
      const passmark = cert.passmark ?? 70;
      const skillAreas: { id: string; name: string }[] = Array.isArray(cert.skill_areas) ? cert.skill_areas : [];
      const skills = skillAreas
        .map(sa => {
          const qs = scorable.filter(q => q?.skillAreaId === sa.id);
          const c = qs.filter(q => correctIds.has(q.id)).length;
          return { id: sa.id, name: sa.name, correct: c, total: qs.length, pct: qs.length ? Math.round((c / qs.length) * 100) : 0 };
        })
        .filter(s => s.total > 0);
      return NextResponse.json({ score: scorePct, passed: scorePct >= passmark, passmark, correctQuestions: correct, totalQuestions: total, skills, review, practice: true });
    } catch (err: any) {
      console.error('[certification-attempt/grade-practice]', err);
      return NextResponse.json({ error: 'Failed to grade practice.' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
