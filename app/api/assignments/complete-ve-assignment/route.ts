import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { Resend } from 'resend';
import { submissionConfirmEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { sendGroupSubmissionNotifications } from '@/lib/group-submission-notifications';
import { countCompletedRequirements, isVeComplete } from '@/lib/ve-completion';
import { loadClaimedShareItemIds } from '@/lib/linkedin-share';
import { mergeVeProgress, reversibleDeliverableRequirementIds } from '@/lib/ve-progress';

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


export async function POST(req: NextRequest) {
  const authRes = await requireUser(req);
  if (isAuthError(authRes)) return authRes.error;
  const { user } = authRes;

  const body = await req.json().catch(() => ({}));
  const { assignmentId, progress, currentModuleId, currentLessonId, groupId, participants } = body;

  if (!assignmentId) return NextResponse.json({ error: 'assignmentId required' }, { status: 400 });

  const supabase = adminClient();

  // Fetch assignment and student profile in parallel
  const [{ data: assignment }, { data: studentRow }] = await Promise.all([
    supabase.from('assignments')
      .select('id, title, config, cohort_ids, group_ids, status, type')
      .eq('id', assignmentId)
      .single(),
    supabase.from('students')
      .select('id, cohort_id, full_name, email')
      .eq('id', user.id)
      .single(),
  ]);

  if (!assignment || assignment.status !== 'published') {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 });
  }
  if (assignment.type !== 'virtual_experience') {
    return NextResponse.json({ error: 'Not a virtual experience assignment' }, { status: 400 });
  }

  const groupIds: string[] = Array.isArray(assignment.group_ids) ? assignment.group_ids : [];
  const cohortIds: string[] = Array.isArray(assignment.cohort_ids) ? assignment.cohort_ids : [];
  const isGroupAssignment = groupIds.length > 0;

  if (isGroupAssignment) {
    // Must be a leader of a group that is targeted by this assignment
    if (!groupId || !groupIds.includes(groupId)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    const { data: membership } = await supabase
      .from('group_members')
      .select('is_leader')
      .eq('group_id', groupId)
      .eq('student_id', user.id)
      .maybeSingle();
    if (!membership?.is_leader) {
      return NextResponse.json({ error: 'Only the group leader can submit' }, { status: 403 });
    }

    // Validate that all submitted participants are actual members of this group
    if (!Array.isArray(participants) || participants.length === 0) {
      return NextResponse.json({ error: 'At least one participant is required' }, { status: 400 });
    }
    const participantIds = [...new Set(participants as string[])];
    const { data: groupMembers } = await supabase
      .from('group_members')
      .select('student_id')
      .eq('group_id', groupId);
    const validIds = new Set((groupMembers ?? []).map((m: any) => m.student_id as string));
    const invalidIds = participantIds.filter(id => !validIds.has(id));
    if (invalidIds.length > 0) {
      return NextResponse.json({ error: 'Invalid participant IDs' }, { status: 400 });
    }
  } else {
    if (!studentRow?.cohort_id || !cohortIds.includes(studentRow.cohort_id)) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
  }

  const veFormId: string | null = assignment.config?.ve_form_id ?? null;
  if (!veFormId) {
    return NextResponse.json({ error: 'Assignment has no linked virtual experience' }, { status: 400 });
  }

  // Fetch VE and existing attempt for server-side completion validation.
  const [{ data: ve }, { data: existingAttempt }] = await Promise.all([
    supabase.from('virtual_experiences')
      .select('id, modules, status')
      .eq('id', veFormId)
      .single(),
    supabase.from('guided_project_attempts')
      .select('progress, current_module_id, current_lesson_id, completed_at')
      .eq('ve_id', veFormId)
      .eq('student_id', user.id)
      .maybeSingle(),
  ]);

  if (!ve || ve.status !== 'published') {
    return NextResponse.json({ error: 'Virtual experience not found' }, { status: 404 });
  }

  const modules = Array.isArray(ve.modules) ? ve.modules : [];
  const mergedProgress = mergeVeProgress(
    existingAttempt?.progress,
    progress,
    reversibleDeliverableRequirementIds(modules),
    !!existingAttempt?.completed_at,
  );
  const current = chooseCurrentLesson(modules, existingAttempt, currentModuleId, currentLessonId);

  // Server-validate completion through the SHARED rule (lib/ve-completion). This route used to carry
  // its own copy of the loop, which trusted progress[share].completed -- so a direct request could
  // forge a required LinkedIn share -- and counted optional shares as required, rejecting a student
  // who legitimately skipped one. linkedin_share is validated against the claim table only.
  const claimedShareItemIds = await loadClaimedShareItemIds(supabase, {
    studentId: user.id,
    contentId: veFormId,
  });
  const counts = countCompletedRequirements(modules, mergedProgress, claimedShareItemIds);

  if (!isVeComplete(counts)) {
    return NextResponse.json(
      { error: `Not all requirements are complete (${counts.doneReqs} of ${counts.totalReqs} done)` },
      { status: 400 },
    );
  }

  // Single atomic RPC: validates linkage and student access inside the transaction,
  // writes guided_project_attempts.completed_at, then upserts assignment_submissions.
  // Graded rows are not touched (WHERE clause in ON CONFLICT DO UPDATE).
  const rpcParams: any = {
    p_ve_id:             veFormId,
    p_assignment_id:     assignmentId,
    p_student_id:        user.id,
    p_progress:          mergedProgress,
    p_current_module_id: current.moduleId,
    p_current_lesson_id: current.lessonId,
  };
  if (isGroupAssignment && groupId) {
    rpcParams.p_group_id    = groupId;
    rpcParams.p_participants = [...new Set(participants as string[])];
  }
  const { data: rpcResult, error: rpcError } = await supabase.rpc('complete_ve_assignment', rpcParams);

  if (rpcError) {
    console.error('[complete-ve-assignment] rpc error:', rpcError);
    return NextResponse.json({ error: 'Failed to complete assignment.' }, { status: 500 });
  }

  const submission = rpcResult?.submission ?? null;

  if (isGroupAssignment && submission?.id) {
    sendGroupSubmissionNotifications({
      submissionId: submission.id,
      assignmentTitle: assignment.title,
    }).catch(err => console.error('[complete-ve-assignment] group notification error:', err));
  }

  // Exactly-once confirmation email using email_dedup insert-as-lock.
  // Two concurrent calls both writing for the first time will race on the INSERT;
  // only one gets the row, the other hits 23505 and skips.
  if (!isGroupAssignment && process.env.RESEND_API_KEY && studentRow?.email && submission?.id) {
    (async () => {
      try {
        const dedupeKey = submission.id as string;
        const emailType = 've-assignment-submission-confirm';

        // Attempt to acquire the send lock.
        const { error: lockError } = await supabase
          .from('email_dedup')
          .insert({ dedupe_key: dedupeKey, type: emailType, status: 'pending' });

        if (lockError) {
          if (lockError.code !== '23505') {
            console.error('[complete-ve-assignment] unexpected email_dedup lock error:', lockError);
            return;
          }

          // Another process holds or held the lock. Check its status and age.
          const { data: existing } = await supabase
            .from('email_dedup')
            .select('status, sent_at')
            .eq('dedupe_key', dedupeKey)
            .eq('type', emailType)
            .maybeSingle();

          if (existing?.status === 'sent') return; // already sent, done

          // pending + recent = another request is actively sending right now. Skip.
          // pending + stale (>10 min) = prior holder crashed before marking sent. Reclaim.
          const STALE_MS = 10 * 60 * 1000;
          const ageMs = existing?.sent_at ? Date.now() - new Date(existing.sent_at).getTime() : 0;
          if (ageMs < STALE_MS) return;

          // Stale lock: delete and re-acquire once. If another process beats us here, give up.
          await supabase.from('email_dedup')
            .delete()
            .eq('dedupe_key', dedupeKey)
            .eq('type', emailType)
            .eq('status', 'pending');

          const { error: retryError } = await supabase
            .from('email_dedup')
            .insert({ dedupe_key: dedupeKey, type: emailType, status: 'pending' });

          if (retryError) return; // lost the re-acquire race, give up
        }

        // Lock acquired. Send the email.
        const t = await getTenantSettings();
        const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
        const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

        await resend.emails.send({
          from:    FROM,
          to:      studentRow.email,
          subject: `Submission received: ${assignment.title}`,
          html:    submissionConfirmEmail({
            name:            studentRow.full_name || 'there',
            assignmentTitle: assignment.title,
            dashboardUrl:    `${t.appUrl}/student?section=assignments`,
            branding,
          }),
        });

        // Mark as sent so future callers know the email was delivered.
        await supabase.from('email_dedup')
          .update({ status: 'sent' })
          .eq('dedupe_key', dedupeKey)
          .eq('type', emailType);

      } catch (err) {
        console.error('[complete-ve-assignment] email error:', err);
      }
    })();
  }

  return NextResponse.json({ success: true, submission });
}
