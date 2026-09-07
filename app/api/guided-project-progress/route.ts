import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireUser, requireStudentUser, isAuthError } from '@/lib/api-auth';
import { Resend } from 'resend';
import { milestoneEmail, courseResultEmail, badgeEarnedEmail } from '@/lib/email-templates';
import { hasNudgeBeenSent, recordNudge } from '@/lib/nudge-helpers';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { updateLearningPathProgress } from '@/lib/learning-path-progress';
import { claimLinkedInShare, loadClaimedShareItemIds } from '@/lib/linkedin-share';
import { clampLinkedInSharePoints } from '@/lib/course-schema';
import { countCompletedRequirements, isVeComplete } from '@/lib/ve-completion';
import { mergeVeProgress, reversibleDeliverableRequirementIds, shouldCompleteVeAttempt } from '@/lib/ve-progress';

export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY);

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

const adminClient = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

/**
 * Student-side VE access: published, and reachable via the student's cohort, a published learning
 * path, or the assignment that embeds this VE. Shared by the progress save and the LinkedIn share
 * claim so the two can never enforce different rules.
 */
async function authorizeVeStudent(
  supabase: ReturnType<typeof adminClient>,
  req: NextRequest,
  opts: { veId: string; assignmentId?: string },
) {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth)) return { error: auth.error };
  const user = auth.user;

  const [{ data: ve }, { data: studentRow }] = await Promise.all([
    supabase.from('virtual_experiences')
      .select('status, cohort_ids, modules, title, slug')
      .eq('id', opts.veId).single(),
    supabase.from('students').select('cohort_id').eq('id', user.id).single(),
  ]);

  if (!ve || ve.status !== 'published') {
    return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  }

  const hasDirectAccess = !!studentRow?.cohort_id &&
    (ve.cohort_ids as string[] ?? []).includes(studentRow.cohort_id);

  let hasLpAccess = false;
  if (!hasDirectAccess && studentRow?.cohort_id) {
    const { data: lpRow } = await supabase
      .from('learning_paths')
      .select('id')
      .eq('status', 'published')
      .contains('cohort_ids', [studentRow.cohort_id])
      .contains('item_ids', [opts.veId])
      .limit(1)
      .maybeSingle();
    hasLpAccess = !!lpRow;
  }

  let hasAssignmentAccess = false;
  if (!hasDirectAccess && !hasLpAccess && opts.assignmentId) {
    const { data: asgn } = await supabase
      .from('assignments')
      .select('status, config, cohort_ids, group_ids')
      .eq('id', opts.assignmentId)
      .maybeSingle();
    if (asgn?.status === 'published' && asgn.config?.ve_form_id === opts.veId) {
      const cohortIds: string[] = Array.isArray(asgn.cohort_ids) ? asgn.cohort_ids : [];
      const groupIds: string[]  = Array.isArray(asgn.group_ids)  ? asgn.group_ids  : [];
      if (studentRow?.cohort_id && cohortIds.includes(studentRow.cohort_id)) {
        hasAssignmentAccess = true;
      } else if (groupIds.length > 0) {
        const { data: membership } = await supabase
          .from('group_members')
          .select('group_id')
          .eq('student_id', user.id)
          .in('group_id', groupIds)
          .limit(1)
          .maybeSingle();
        hasAssignmentAccess = !!membership;
      }
    }
  }

  if (!hasDirectAccess && !hasLpAccess && !hasAssignmentAccess) {
    return { error: NextResponse.json({ error: 'Access denied' }, { status: 403 }) };
  }

  return { ve, user };
}

/** Find a linkedin_share requirement by id anywhere in a VE's modules. */
function findShareRequirement(modules: any[], requirementId: string) {
  for (const mod of modules ?? []) {
    for (const lesson of mod?.lessons ?? []) {
      for (const req of lesson?.requirements ?? []) {
        if (req?.id === requirementId && req?.type === 'linkedin_share') return req;
      }
    }
  }
  return null;
}


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

  // -- Claim a LinkedIn post for a linkedin_share deliverable --
  // Synchronous so the student learns inline that a post is already claimed. The claim row carries
  // the bonus (migration 160 sums VE claims into student_xp), and separately decides completion via
  // countCompletedRequirements below -- the two are independent: an optional share can pay XP, and a
  // required one with a 0 bonus can gate without paying.
  if (body.action === 'claim-linkedin-share') {
    const shareVeId = body.veId ?? body.formId;
    const { requirementId, post_url } = body;
    if (!shareVeId || !requirementId) {
      return NextResponse.json({ error: 'veId and requirementId are required' }, { status: 400 });
    }
    if (typeof post_url !== 'string' || !post_url.trim()) {
      return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
    }

    const shareAccess = await authorizeVeStudent(supabase, req, { veId: shareVeId, assignmentId: body.assignmentId });
    if (shareAccess.error) return shareAccess.error;

    const shareModules = Array.isArray(shareAccess.ve.modules) ? shareAccess.ve.modules : [];
    const shareReq = findShareRequirement(shareModules, requirementId);
    if (!shareReq) {
      return NextResponse.json({ error: 'Requirement not found' }, { status: 404 });
    }

    // The bonus comes from the STORED VE config, never the request, and is clamped to
    // 0..MAX_LINKEDIN_SHARE_POINTS -- linkedin_shares.points feeds student_xp through
    // recalc_student_xp (migration 160), so an unclamped value taken on trust would mint XP.
    // clampLinkedInSharePoints maps an absent amount to 0 rather than to the course default, which is
    // what grandfathers requirements authored before VE shares paid anything.
    //
    // Snapshotting it onto the claim row is deliberate: the amount a student earned is the amount
    // that was on offer when they posted. An instructor raising the bonus later applies to future
    // claims only, and cannot retroactively revalue work already done.
    const sharePoints = clampLinkedInSharePoints((shareReq as any).sharePoints);

    // Their own LinkedIn profile, collected at onboarding, is what the post's author is checked
    // against. Read server-side so the client cannot supply whichever profile fits the post.
    const { data: shareProfileRow } = await supabase
      .from('students').select('social_links').eq('id', shareAccess.user.id).maybeSingle();

    const claim = await claimLinkedInShare(supabase, {
      studentId:   shareAccess.user.id,
      contentType: 'virtual_experience',
      contentId:   shareVeId,
      itemId:      requirementId,
      postUrl:     post_url,
      points:      sharePoints,
      studentProfileUrl: (shareProfileRow as any)?.social_links?.linkedin ?? null,
    });

    if (!claim.ok) {
      if (claim.code === 'already_claimed') return NextResponse.json({ error: 'already_claimed' }, { status: 409 });
      if (claim.code === 'author_mismatch') return NextResponse.json({ error: 'author_mismatch' }, { status: 403 });
      if (claim.code === 'no_profile')      return NextResponse.json({ error: 'no_profile' }, { status: 422 });
      if (claim.code === 'no_author_in_url') return NextResponse.json({ error: 'no_author_in_url' }, { status: 400 });
      if (claim.code === 'invalid_url')      return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
      return NextResponse.json({ error: 'Failed to save your link.' }, { status: 500 });
    }

    // Record the link in progress too, so the player and the instructor review modal can show it.
    // Completion itself is derived from the claim registry, not from this flag.
    const { data: shareAttempt } = await supabase
      .from('guided_project_attempts')
      .select('progress')
      .eq('ve_id', shareVeId)
      .eq('student_id', shareAccess.user.id)
      .maybeSingle();

    const basedOn = shareAttempt?.progress && typeof shareAttempt.progress === 'object' ? shareAttempt.progress : {};
    const { error: shareUpsertError } = await supabase
      .from('guided_project_attempts')
      .upsert({
        ve_id:      shareVeId,
        student_id: shareAccess.user.id,
        progress:   { ...basedOn, [requirementId]: { ...(basedOn as any)[requirementId], linkUrl: claim.url, completed: true } },
      }, { onConflict: 'student_id,ve_id' });
    if (shareUpsertError) {
      console.error('[guided-project-progress/claim-linkedin-share] upsert', shareUpsertError);
      return NextResponse.json({ error: 'Failed to save your link.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, url: claim.url });
  }

  // -- Student progress save --
  const { veId, formId, assignmentId, studentName, progress, currentModuleId, currentLessonId, completedAt } = body;
  const resolvedVeId = veId ?? formId; // formId kept for backward compat

  if (!resolvedVeId) return NextResponse.json({ error: 'veId required' }, { status: 400 });

  const progressAccess = await authorizeVeStudent(supabase, req, { veId: resolvedVeId, assignmentId });
  if (progressAccess.error) return progressAccess.error;
  const ve = progressAccess.ve;
  const progressUser = progressAccess.user;

  const modules = Array.isArray(ve.modules) ? ve.modules : [];
  const { data: existingAttempt } = await supabase
    .from('guided_project_attempts')
    .select('progress, current_module_id, current_lesson_id, completed_at')
    .eq('ve_id', resolvedVeId)
    .eq('student_id', progressUser.id)
    .maybeSingle();

  const mergedProgress = mergeVeProgress(
    existingAttempt?.progress,
    progress,
    reversibleDeliverableRequirementIds(modules),
    !!existingAttempt?.completed_at,
  );
  const current = chooseCurrentLesson(modules, existingAttempt, currentModuleId, currentLessonId);

  // Completion derived server-side. MCQ requirements are validated against correctAnswer,
  // linkedin_share against a claim in linkedin_shares; honor-system types (task, upload,
  // reflection, etc.) trust the completed flag.
  const claimedShareItemIds = await loadClaimedShareItemIds(supabase, {
    studentId: progressUser.id,
    contentId: resolvedVeId,
  });
  const counts = countCompletedRequirements(modules, mergedProgress, claimedShareItemIds);
  const { totalReqs, doneReqs } = counts;
  // The client may request completion, but the server owns the timestamp and only accepts the
  // request once every requirement is valid. Assignment attempts complete through their atomic
  // submission route instead of an incremental progress save.
  const completionRequested = shouldCompleteVeAttempt({
    assignmentId,
    completedAt,
    requirementsComplete: isVeComplete(counts),
  });
  const resolvedCompletedAt = completionRequested ? new Date().toISOString() : null;

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
