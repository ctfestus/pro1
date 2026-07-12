import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser, requireStudentUser, isAuthError } from '@/lib/api-auth';
import { Resend } from 'resend';
import { milestoneEmail, courseResultEmail, badgeEarnedEmail } from '@/lib/email-templates';
import { hasNudgeBeenSent, recordNudge } from '@/lib/nudge-helpers';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { updateLearningPathProgress } from '@/lib/learning-path-progress';

export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY);

function mergeProgress(existing: any, incoming: any) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const next = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {};
  const merged: Record<string, any> = { ...base };

  for (const [reqId, incomingEntry] of Object.entries(next)) {
    const existingEntry = merged[reqId];
    if (existingEntry?.completed && !(incomingEntry as any)?.completed) continue;
    merged[reqId] = {
      ...(existingEntry && typeof existingEntry === 'object' ? existingEntry : {}),
      ...(incomingEntry && typeof incomingEntry === 'object' ? incomingEntry : {}),
      completed: Boolean(existingEntry?.completed || (incomingEntry as any)?.completed),
    };
  }

  return merged;
}

function lessonIndexMap(modules: any[]) {
  const map = new Map<string, number>();
  let idx = 0;
  for (const mod of modules) {
    for (const lesson of mod.lessons ?? []) map.set(lesson.id, idx++);
  }
  return map;
}

function chooseCurrentLesson(modules: any[], existing: any, incomingModuleId?: string, incomingLessonId?: string) {
  const indexes = lessonIndexMap(modules);
  const existingIdx = existing?.current_lesson_id ? indexes.get(existing.current_lesson_id) : undefined;
  const incomingIdx = incomingLessonId ? indexes.get(incomingLessonId) : undefined;

  if (incomingIdx == null) {
    return {
      moduleId: existing?.current_module_id ?? incomingModuleId ?? null,
      lessonId: existing?.current_lesson_id ?? incomingLessonId ?? null,
    };
  }

  if (existingIdx != null && existingIdx > incomingIdx) {
    return { moduleId: existing.current_module_id ?? null, lessonId: existing.current_lesson_id ?? null };
  }

  return { moduleId: incomingModuleId || null, lessonId: incomingLessonId || null };
}

function countCompletedRequirements(modules: any[], progress: any) {
  let totalReqs = 0;
  let doneReqs  = 0;
  for (const mod of modules) {
    for (const lesson of mod.lessons ?? []) {
      for (const req of lesson.requirements ?? []) {
        totalReqs++;
        const entry = (progress ?? {})[req.id];
        if (!entry) continue;
        if (req.type === 'mcq') {
          if (entry.selectedAnswer === req.correctAnswer) doneReqs++;
        } else {
          if (entry.completed) doneReqs++;
        }
      }
    }
  }
  return { totalReqs, doneReqs };
}

const adminClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);


// -- GET /api/guided-project-progress?veId= ---
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const veId         = searchParams.get('veId') ?? searchParams.get('formId'); // formId kept for backward compat
  const studentId    = searchParams.get('studentId');
  const groupId      = searchParams.get('groupId');
  const assignmentId = searchParams.get('assignmentId');

  if (!veId) return NextResponse.json({ error: 'veId required' }, { status: 400 });

  const supabase = adminClient();

  // Group member reviewing a graded group submission: return the submitter's attempt
  // (the actual graded work lives in the submitter's guided_project_attempts row).
  if (groupId && assignmentId) {
    const authRes = await requireUser(req);
    if (isAuthError(authRes)) return authRes.error;
    const { user } = authRes;

    // Requester must be a member of the group.
    const { data: membership } = await supabase
      .from('group_members')
      .select('student_id')
      .eq('group_id', groupId)
      .eq('student_id', user.id)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Review is only available once the group submission has been graded.
    const { data: submission } = await supabase
      .from('assignment_submissions')
      .select('submitted_by, status')
      .eq('assignment_id', assignmentId)
      .eq('group_id', groupId)
      .maybeSingle();
    if (!submission || submission.status !== 'graded' || !submission.submitted_by) {
      return NextResponse.json({ error: 'Not available' }, { status: 403 });
    }

    const { data: attempt } = await supabase
      .from('guided_project_attempts')
      .select('*')
      .eq('ve_id', veId)
      .eq('student_id', submission.submitted_by)
      .maybeSingle();

    return NextResponse.json({ attempt: attempt ?? null });
  }

  // Creator/admin view -- return all attempts for a VE
  if (!studentId) {
    const authRes = await requireUser(req);
    if (isAuthError(authRes)) return authRes.error;
    const { user } = authRes;

    const [{ data: ve }, { data: profile }] = await Promise.all([
      supabase.from('virtual_experiences').select('user_id').eq('id', veId).single(),
      supabase.from('students').select('role').eq('id', user.id).single(),
    ]);
    const isAdmin = profile?.role === 'admin';
    if (!ve || (ve.user_id !== user.id && !isAdmin)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch VE cohort_ids, all enrolled students, and all attempts in parallel
    const [{ data: veData }, { data: attempts }] = await Promise.all([
      supabase.from('virtual_experiences').select('cohort_ids').eq('id', veId).single(),
      supabase
        .from('guided_project_attempts')
        .select('id, student_id, progress, completed_at, started_at, updated_at, review')
        .eq('ve_id', veId),
    ]);

    const cohortIds: string[] = veData?.cohort_ids ?? [];

    // Get all students enrolled in this VE's cohorts
    const { data: enrolledStudents } = cohortIds.length > 0
      ? await supabase
          .from('students')
          .select('id, full_name, email, cohort_id')
          .in('cohort_id', cohortIds)
          .eq('role', 'student')
          .order('full_name', { ascending: true })
      : { data: [] };

    // Merge: every enrolled student gets a row; attempt fields are null if not started
    const attemptsMap = new Map((attempts ?? []).map((a: any) => [a.student_id, a]));
    const merged = (enrolledStudents ?? []).map((s: any) => {
      const attempt = attemptsMap.get(s.id) as any;
      return {
        id:            attempt?.id            ?? null,
        student_id:    s.id,
        student_name:  s.full_name            ?? null,
        student_email: s.email                ?? null,
        cohort_id:     s.cohort_id            ?? null,
        progress:      attempt?.progress      ?? null,
        completed_at:  attempt?.completed_at  ?? null,
        started_at:    attempt?.started_at    ?? null,
        updated_at:    attempt?.updated_at    ?? null,
        review:        attempt?.review        ?? null,
      };
    });

    return NextResponse.json({ attempts: merged });
  }

  // Student view -- Student Mode lets a validated instructor/admin load the selected student.
  const authRes = await requireStudentUser(req);
  if (isAuthError(authRes)) return authRes.error;
  const { user } = authRes;
  if (user.id !== studentId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: attempt } = await supabase
    .from('guided_project_attempts')
    .select('*')
    .eq('ve_id', veId)
    .eq('student_id', user.id)
    .maybeSingle();

  return NextResponse.json({ attempt: attempt ?? null });
}

// -- POST /api/guided-project-progress ---
export async function POST(req: NextRequest) {
  const body = await req.json();
  const supabase = adminClient();

  // -- Instructor review --
  if (body.action === 'review') {
    const authRes = await requireUser(req);
    if (isAuthError(authRes)) return authRes.error;
    const { user } = authRes;

    const { attemptId, score, feedback } = body;
    if (!attemptId) return NextResponse.json({ error: 'attemptId required' }, { status: 400 });

    const { data: attempt } = await supabase
      .from('guided_project_attempts')
      .select('ve_id')
      .eq('id', attemptId)
      .single();

    if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });

    const [{ data: ve }, { data: reviewProfile }] = await Promise.all([
      supabase.from('virtual_experiences').select('user_id').eq('id', attempt.ve_id).single(),
      supabase.from('students').select('role').eq('id', user.id).single(),
    ]);
    const isAdmin = reviewProfile?.role === 'admin';
    if (!ve || (ve.user_id !== user.id && !isAdmin)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabase
      .from('guided_project_attempts')
      .update({
        review: {
          score:       Number(score) || 0,
          feedback:    String(feedback || '').slice(0, 2000),
          reviewed_at: new Date().toISOString(),
          reviewed_by: user.id,
        },
      })
      .eq('id', attemptId);

    if (error) { console.error('[guided-project-progress]', error); return NextResponse.json({ error: 'Failed to save. Please try again.' }, { status: 500 }); }
    return NextResponse.json({ success: true });
  }

  // -- Issue certificate --
  if (body.action === 'issue-certificate') {
    const { veId, studentName } = body;
    // Accept veId or formId (backward compat)
    const resolvedVeId = veId ?? body.formId;
    if (!resolvedVeId) return NextResponse.json({ error: 'veId required' }, { status: 400 });

    const certAuth = await requireStudentUser(req);
    if (isAuthError(certAuth)) return certAuth.error;
    const certUser = certAuth.user;

    // Verify VE access before certificate issuance
    const [{ data: certVe }, { data: certStudentRow }] = await Promise.all([
      supabase.from('virtual_experiences')
        .select('status, cohort_ids')
        .eq('id', resolvedVeId).single(),
      supabase.from('students').select('cohort_id').eq('id', certUser.id).single(),
    ]);

    if (!certVe || certVe.status !== 'published') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const certHasDirectAccess = !!certStudentRow?.cohort_id &&
      (certVe.cohort_ids as string[] ?? []).includes(certStudentRow.cohort_id);

    let certHasLpAccess = false;
    if (!certHasDirectAccess && certStudentRow?.cohort_id) {
      const { data: certLpRow } = await supabase
        .from('learning_paths')
        .select('id')
        .eq('status', 'published')
        .contains('cohort_ids', [certStudentRow.cohort_id])
        .contains('item_ids', [resolvedVeId])
        .limit(1)
        .maybeSingle();
      certHasLpAccess = !!certLpRow;
    }

    if (!certHasDirectAccess && !certHasLpAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { data: attempt } = await supabase
      .from('guided_project_attempts')
      .select('id, completed_at')
      .eq('ve_id', resolvedVeId)
      .eq('student_id', certUser.id)
      .not('completed_at', 'is', null)
      .maybeSingle();

    if (!attempt) return NextResponse.json({ error: 'Project not completed' }, { status: 403 });

    const { data: existing } = await supabase
      .from('certificates')
      .select('id')
      .eq('ve_id', resolvedVeId)
      .eq('student_id', certUser.id)
      .eq('revoked', false)
      .maybeSingle();

    if (existing?.id) return NextResponse.json({ certId: existing.id });

    const { data: cert, error: certErr } = await supabase
      .from('certificates')
      .insert({
        ve_id:        resolvedVeId,
        student_name: studentName || certUser.email,
        student_id:   certUser.id,
      })
      .select('id')
      .single();

    if (certErr) { console.error('[guided-project-progress] certificate error:', certErr); return NextResponse.json({ error: 'Failed to issue certificate.' }, { status: 500 }); }

    // Fire-and-forget certificate + badge email
    if (process.env.RESEND_API_KEY) {
      (async () => {
        try {
          const [{ data: ve }, { data: student }] = await Promise.all([
            supabase.from('virtual_experiences').select('title, slug, badge_image_url').eq('id', resolvedVeId).single(),
            supabase.from('students').select('email, full_name').eq('id', certUser.id).single(),
          ]);
          if (!student?.email || !ve) return;

          const t        = await getTenantSettings();
          const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
          const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
          const certUrl  = `${t.appUrl}/certificate/${cert.id}`;
          const formUrl  = `${t.appUrl}/${ve.slug ?? resolvedVeId}`;

          // Award badge if VE has one
          let earnedBadgeName: string | undefined;
          if (ve.badge_image_url) {
            const badgeId = `ve_${resolvedVeId}`;
            await supabase.from('badges').upsert({
              id:          badgeId,
              name:        `${ve.title} Badge`,
              description: `Awarded for completing ${ve.title}`,
              icon:        'briefcase',
              color:       '#6366f1',
              image_url:   ve.badge_image_url,
              category:    'virtual_experience',
            }, { onConflict: 'id' });
            await supabase.from('student_badges').upsert({
              student_id: certUser.id,
              badge_id:   badgeId,
            }, { onConflict: 'student_id,badge_id', ignoreDuplicates: true });
            earnedBadgeName = `${ve.title} Badge`;
          }

          await resend.emails.send({
            from:    FROM,
            to:      student.email,
            subject: `Your certificate is ready: ${ve.title}`,
            html:    courseResultEmail({
              name:         studentName || student.full_name || 'there',
              courseTitle:  ve.title,
              score:        0,
              total:        0,
              percentage:   100,
              passed:       true,
              certUrl,
              formUrl,
              badgeName:     earnedBadgeName,
              badgeImageUrl: ve.badge_image_url ?? undefined,
              branding,
            }),
          });
        } catch (emailErr) {
          console.error('[guided-project-progress] certificate email failed', emailErr);
        }
      })();
    }

    return NextResponse.json({ certId: cert.id });
  }

  // -- Student progress save --
  const { veId, formId, assignmentId, studentName, progress, currentModuleId, currentLessonId } = body;
  // completedAt is intentionally excluded - completion is always computed server-side
  const resolvedVeId = veId ?? formId; // formId kept for backward compat

  if (!resolvedVeId) return NextResponse.json({ error: 'veId required' }, { status: 400 });

  const progressAuth = await requireStudentUser(req);
  if (isAuthError(progressAuth)) return progressAuth.error;
  const progressUser = progressAuth.user;

  // Verify VE access before saving progress
  const [{ data: ve }, { data: progressStudentRow }] = await Promise.all([
    supabase.from('virtual_experiences')
      .select('status, cohort_ids, modules, title, slug')
      .eq('id', resolvedVeId).single(),
    supabase.from('students').select('cohort_id').eq('id', progressUser.id).single(),
  ]);

  if (!ve || ve.status !== 'published') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const hasDirectAccess = !!progressStudentRow?.cohort_id &&
    (ve.cohort_ids as string[] ?? []).includes(progressStudentRow.cohort_id);

  let hasLpAccess = false;
  if (!hasDirectAccess && progressStudentRow?.cohort_id) {
    const { data: lpRow } = await supabase
      .from('learning_paths')
      .select('id')
      .eq('status', 'published')
      .contains('cohort_ids', [progressStudentRow.cohort_id])
      .contains('item_ids', [resolvedVeId])
      .limit(1)
      .maybeSingle();
    hasLpAccess = !!lpRow;
  }

  let hasAssignmentAccess = false;
  if (!hasDirectAccess && !hasLpAccess && assignmentId) {
    const { data: asgn } = await supabase
      .from('assignments')
      .select('status, config, cohort_ids, group_ids')
      .eq('id', assignmentId)
      .maybeSingle();
    if (asgn?.status === 'published' && asgn.config?.ve_form_id === resolvedVeId) {
      const cohortIds: string[] = Array.isArray(asgn.cohort_ids) ? asgn.cohort_ids : [];
      const groupIds: string[]  = Array.isArray(asgn.group_ids)  ? asgn.group_ids  : [];
      if (progressStudentRow?.cohort_id && cohortIds.includes(progressStudentRow.cohort_id)) {
        hasAssignmentAccess = true;
      } else if (groupIds.length > 0) {
        const { data: membership } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('student_id', progressUser.id)
          .in('group_id', groupIds)
          .limit(1)
          .maybeSingle();
        hasAssignmentAccess = !!membership;
      }
    }
  }

  if (!hasDirectAccess && !hasLpAccess && !hasAssignmentAccess) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const modules = Array.isArray(ve.modules) ? ve.modules : [];
  const { data: existingAttempt } = await supabase
    .from('guided_project_attempts')
    .select('progress, current_module_id, current_lesson_id, completed_at')
    .eq('ve_id', resolvedVeId)
    .eq('student_id', progressUser.id)
    .maybeSingle();

  const mergedProgress = mergeProgress(existingAttempt?.progress, progress);
  const current = chooseCurrentLesson(modules, existingAttempt, currentModuleId, currentLessonId);

  // Completion derived server-side. MCQ requirements are validated against correctAnswer;
  // honor-system types (task, upload, reflection, etc.) trust the completed flag.
  const { totalReqs, doneReqs } = countCompletedRequirements(modules, mergedProgress);
  const resolvedCompletedAt = (totalReqs > 0 && doneReqs >= totalReqs) ? new Date().toISOString() : null;

  const { error } = await supabase
    .from('guided_project_attempts')
    .upsert(
      {
        ve_id:             resolvedVeId,
        student_id:        progressUser.id,
        progress:          mergedProgress,
        current_module_id: current.moduleId,
        current_lesson_id: current.lessonId,
        completed_at:      existingAttempt?.completed_at ?? resolvedCompletedAt,
      },
      { onConflict: 'student_id,ve_id' },
    );

  if (error) { console.error('[guided-project-progress] upsert error:', error); return NextResponse.json({ error: 'Failed to save progress.' }, { status: 500 }); }

  // Update learning path progress when VE is completed (fire-and-forget)
  if (resolvedCompletedAt) {
    updateLearningPathProgress(supabase, progressUser.id, resolvedVeId)
      .catch((err) => console.error('[guided-project-progress] LP update failed', err));
  }

  // -- 80% milestone check (fire-and-forget) -- skip if already completed
  if (progress && !resolvedCompletedAt && process.env.RESEND_API_KEY) {
    (async () => {
      try {
        if (totalReqs === 0) return;
        const pct = Math.round((doneReqs / totalReqs) * 100);
        if (pct < 80) return;

        const alreadySent = await hasNudgeBeenSent(supabase, progressUser.id, resolvedVeId, 'milestone_80');
        if (alreadySent) return;

        const { data: studentProfile } = await supabase
          .from('students')
          .select('email, full_name')
          .eq('id', progressUser.id)
          .single();

        if (!studentProfile?.email) return;

        const t        = await getTenantSettings();
        const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
        const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

        const html = milestoneEmail({
          name:         studentName || studentProfile.full_name || 'there',
          contentTitle: ve.title,
          contentType:  'virtual_experience',
          formUrl:      `${t.appUrl}/${ve.slug ?? resolvedVeId}`,
          branding,
        });

        await resend.emails.send({
          from: FROM,
          to:   studentProfile.email,
          subject: `You are 80% done. Finish strong! 🎯`,
          html,
        });
        await recordNudge(supabase, progressUser.id, resolvedVeId, 'milestone_80');
      } catch (err) {
        console.error('[guided-project-progress] milestone check failed', err);
      }
    })();
  }

  return NextResponse.json({ success: true });
}
