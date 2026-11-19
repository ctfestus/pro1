// Where an AI review's grading settings come from: the saved step, never the request.
//
// A review request names its step (a course question, an assignment or one of its tasks, or a
// virtual experience requirement); the server loads that step and grades with the rubric, pass mark
// and instructor context stored on it. A student therefore cannot swap in an easier rubric or drop
// the pass mark. Only staff may send settings without a step, which is how editor previews of
// unsaved content are reviewed.

import { NextResponse } from 'next/server';
import type { AuthedUser } from '@/lib/api-auth';
import { canAccessAssignedVirtualExperience, parseExcelReviewTarget, type ExcelReviewTarget } from '@/lib/excel-review-config';
import { toPlainText } from '@/lib/plain-text';
import { lessonPlainText } from '@/lib/lesson-doc';

export type ReviewTarget = ExcelReviewTarget;
export type ReviewType = 'code_review' | 'excel_review' | 'document_review' | 'dashboard_critique' | 'written_response';

export const parseReviewTarget = parseExcelReviewTarget;

/** The review step of `type` that a target names inside a loaded course, assignment or experience. */
export function findReviewItem(target: ReviewTarget, stored: any, type: ReviewType): any | null {
  if (target.source === 'course') {
    return (Array.isArray(stored?.questions) ? stored.questions : [])
      .find((question: any) => question?.id === target.itemId && question?.type === type) ?? null;
  }

  if (target.source === 'virtual_experience') {
    for (const experienceModule of (Array.isArray(stored?.modules) ? stored.modules : [])) {
      for (const lesson of (Array.isArray(experienceModule?.lessons) ? experienceModule.lessons : [])) {
        const requirement = (Array.isArray(lesson?.requirements) ? lesson.requirements : [])
          .find((item: any) => item?.id === target.itemId && item?.type === type);
        if (requirement) return requirement;
      }
    }
    return null;
  }

  if (!target.itemId) return stored?.type === type ? stored?.config ?? null : null;
  for (const scenario of (Array.isArray(stored?.config?.scenarios) ? stored.config.scenarios : [])) {
    const task = (Array.isArray(scenario?.tasks) ? scenario.tasks : [])
      .find((item: any) => item?.id === target.itemId && item?.type === type);
    if (task) return task;
  }
  return null;
}

// A virtual experience is read under the caller's own access first. Failing that, it is reachable
// through a published assignment that embeds it and targets the caller.
async function loadVirtualExperience(auth: AuthedUser, target: Extract<ReviewTarget, { source: 'virtual_experience' }>): Promise<any | null> {
  const direct = await auth.getActorDb()
    .from('virtual_experiences')
    .select('modules')
    .eq('id', target.contentId)
    .maybeSingle();
  if (direct.data) return direct.data;
  if (!target.assignmentId) return null;

  const svc = auth.serviceDb;
  const [{ data: ve }, { data: assignment }, { data: caller }, { data: memberships }] = await Promise.all([
    svc.from('virtual_experiences').select('id, user_id, modules').eq('id', target.contentId).maybeSingle(),
    svc.from('assignments').select('id, created_by, status, config, cohort_ids, group_ids').eq('id', target.assignmentId).maybeSingle(),
    svc.from('students').select('role, cohort_id').eq('id', auth.user.id).maybeSingle(),
    svc.from('group_members').select('group_id').eq('student_id', auth.user.id),
  ]);
  if (!ve || !assignment || assignment.status !== 'published' || assignment.config?.ve_form_id !== target.contentId) return null;

  const allowed = canAccessAssignedVirtualExperience({
    userId: auth.user.id,
    callerRole: caller?.role,
    callerCohortId: caller?.cohort_id,
    callerGroupIds: (memberships ?? []).map((membership: any) => membership.group_id as string),
    experienceOwnerId: ve.user_id,
    assignmentOwnerId: assignment.created_by,
    assignmentCohortIds: assignment.cohort_ids,
    assignmentGroupIds: assignment.group_ids,
  });
  return allowed ? ve : null;
}

/** The saved review step a target names, or null when it does not exist or the caller cannot read it. */
export async function loadReviewItem(auth: AuthedUser, target: ReviewTarget, type: ReviewType): Promise<any | null> {
  let stored: any = null;
  if (target.source === 'course') {
    stored = (await auth.getActorDb().from('courses').select('questions').eq('id', target.contentId).maybeSingle()).data;
  } else if (target.source === 'assignment') {
    stored = (await auth.getActorDb().from('assignments').select('type, config').eq('id', target.contentId).maybeSingle()).data;
  } else {
    stored = await loadVirtualExperience(auth, target);
  }
  return stored ? findReviewItem(target, stored, type) : null;
}

/**
 * The step whose settings grade this review: the saved step the target names. When there is no
 * saved step (no target, or one not found), the settings the request sent, but only for staff
 * previewing unsaved content; a student gets 400 or 404.
 */
export async function resolveReviewItem(
  auth: AuthedUser,
  rawTarget: unknown,
  type: ReviewType,
  previewSettings: Record<string, unknown>,
): Promise<{ item: any } | { response: NextResponse }> {
  const target = parseReviewTarget(rawTarget);
  if (target) {
    const item = await loadReviewItem(auth, target, type);
    if (item) return { item };
  }
  // No saved step: an editor preview of content not saved yet, which only staff can be looking at.
  const { data: caller } = await auth.serviceDb.from('students').select('role').eq('id', auth.user.id).maybeSingle();
  if (caller?.role === 'admin' || caller?.role === 'instructor') return { item: previewSettings };
  return target
    ? { response: NextResponse.json({ error: 'Review activity not found.' }, { status: 404 }) }
    : { response: NextResponse.json({ error: 'A saved review activity is required.' }, { status: 400 }) };
}

/** The rubric criteria stored on a step: trimmed text, blanks dropped. */
export function reviewRubric(item: any): string[] {
  return Array.isArray(item?.rubric)
    ? item.rubric.filter((c: unknown): c is string => typeof c === 'string').map((c: string) => c.trim()).filter(Boolean)
    : [];
}

/** The pass mark stored on a step, 0-100, or undefined when it has none. */
export function reviewMinScore(item: any): number | undefined {
  if (item?.minScore === undefined || item?.minScore === null || item?.minScore === '') return undefined;
  const n = Number(item.minScore);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
}

/**
 * The task the student was set, as plain text: the step's question or title, then its instructions
 * (a course question's text, an assignment task's description, or a VE step's email or brief).
 */
export function reviewTask(item: any): string {
  const instructions = item?.emailBody || item?.description
    ? toPlainText(item.emailBody || item.description)
    : lessonPlainText(item?.descriptionDoc ?? item?.doc, 4000);
  return [toPlainText(item?.question || item?.title || item?.label || ''), instructions]
    .filter(Boolean).join('\n\n').slice(0, 4000);
}

/** A text setting stored on a step (context, schema), trimmed and capped. */
export function reviewText(item: any, key: string, max = 4000): string {
  return typeof item?.[key] === 'string' ? item[key].trim().slice(0, max) : '';
}
