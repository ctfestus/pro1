// GET /api/student/program -- everything a bootcamp student needs to see where they are in their
// program: the cohort's dates, every piece of content assigned to the cohort with this student's
// status on it, and their group.
//
// Course and virtual-experience status, deadlines and progress come from lib/tracking-report, the
// same engine behind Student Tracking, so a student and their instructor see the same picture.
// Assignments are classified here because a group assignment is submitted once for the whole
// group, and the tracking engine only looks at a student's own submission.
//
// Date-dependent statuses (overdue, current week) are decided in the browser by
// lib/student-program from the student's local date.

import { NextRequest, NextResponse } from 'next/server';
import { requireStudentUser, isAuthError } from '@/lib/api-auth';
import { COHORT_KIND_BOOTCAMP } from '@/lib/cohort-kind';
import { passMarkOf } from '@/lib/assignment-scenarios';
import { attachProgress, buildStatusRows, type TrackedItem } from '@/lib/tracking-report';
import type { ProgramBaseStatus, ProgramGroup, ProgramItem, ProgramPayload } from '@/lib/student-program';

export const dynamic = 'force-dynamic';

const EMPTY: ProgramPayload = { cohort: null, items: [], group: null };

export async function GET(req: NextRequest) {
  const auth = await requireStudentUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: db } = auth;

  const { data: student, error: studentError } = await db
    .from('students').select('id, email, full_name, cohort_id').eq('id', user.id).maybeSingle();
  if (studentError) return NextResponse.json({ error: 'Could not load your program' }, { status: 500 });
  if (!student?.cohort_id) return NextResponse.json(EMPTY);

  const cohortId: string = student.cohort_id;
  const [{ data: cohort, error: cohortError }, { data: membership }] = await Promise.all([
    db.from('cohorts').select('id, name, start_date, end_date, classes_end_date, cohort_kind').eq('id', cohortId).maybeSingle(),
    db.from('group_members').select('group_id').eq('student_id', student.id).maybeSingle(),
  ]);
  if (cohortError) return NextResponse.json({ error: 'Could not load your program' }, { status: 500 });
  // Subscription and individual students have no program, only a catalogue.
  if (!cohort || cohort.cohort_kind !== COHORT_KIND_BOOTCAMP) return NextResponse.json(EMPTY);

  const groupId: string | null = membership?.group_id ?? null;

  // The same audience rules the student's own sections use: content tagged with the cohort, items
  // inside a learning path tagged with the cohort, and assignments aimed at the cohort or the group.
  const [coursesRes, vesRes, pathsRes, assignmentsRes, eventsRes] = await Promise.all([
    db.from('courses').select('id, title, slug, deadline_days')
      .contains('cohort_ids', [cohortId]).eq('status', 'published'),
    db.from('virtual_experiences').select('id, title, slug, deadline_days')
      .contains('cohort_ids', [cohortId]).eq('status', 'published'),
    db.from('learning_paths').select('item_ids')
      .contains('cohort_ids', [cohortId]).eq('status', 'published'),
    db.from('assignments').select('id, title, deadline_date, type, config, group_ids')
      .eq('status', 'published')
      .or(groupId ? `cohort_ids.cs.{${cohortId}},group_ids.cs.{${groupId}}` : `cohort_ids.cs.{${cohortId}}`),
    db.from('events').select('id, title, slug, event_date, recurrence, recurrence_end_date')
      .contains('cohort_ids', [cohortId]).eq('status', 'published').not('event_date', 'is', null),
  ]);
  const firstError = [coursesRes, vesRes, pathsRes, assignmentsRes, eventsRes].find(r => r.error)?.error;
  if (firstError) {
    console.error('[student/program]', firstError.message);
    return NextResponse.json({ error: 'Could not load your program' }, { status: 500 });
  }

  const courses = [...(coursesRes.data ?? [])];
  const ves = [...(vesRes.data ?? [])];
  const known = new Set([...courses, ...ves].map(c => c.id));
  const pathItemIds = [...new Set((pathsRes.data ?? []).flatMap((p: any) => p.item_ids ?? []))]
    .filter((id: string) => !known.has(id));
  if (pathItemIds.length) {
    // A path grants only its published items; certifications inside a path are not tracked here.
    const [pathCourses, pathVes] = await Promise.all([
      db.from('courses').select('id, title, slug, deadline_days').in('id', pathItemIds).eq('status', 'published'),
      db.from('virtual_experiences').select('id, title, slug, deadline_days').in('id', pathItemIds).eq('status', 'published'),
    ]);
    // Dropping path content silently would shrink the program and inflate the student's %.
    const pathError = pathCourses.error ?? pathVes.error;
    if (pathError) {
      console.error('[student/program]', pathError.message);
      return NextResponse.json({ error: 'Could not load your program' }, { status: 500 });
    }
    courses.push(...(pathCourses.data ?? []));
    ves.push(...(pathVes.data ?? []));
  }

  const assignments = assignmentsRes.data ?? [];
  const events = eventsRes.data ?? [];

  const tracked: TrackedItem[] = [
    ...courses.map((c: any): TrackedItem => ({
      id: c.id, title: c.title, slug: c.slug, contentType: 'course', status: 'published',
      cohortIds: [cohortId], availableToEveryone: false, deadlineDays: c.deadline_days ?? null,
    })),
    ...ves.map((v: any): TrackedItem => ({
      id: v.id, title: v.title, slug: v.slug, contentType: 'virtual_experience', status: 'published',
      cohortIds: [cohortId], availableToEveryone: false, deadlineDays: v.deadline_days ?? null,
    })),
    ...assignments.map((a: any): TrackedItem => ({
      id: a.id, title: a.title, contentType: 'assignment', status: 'published',
      cohortIds: [cohortId], availableToEveryone: false, deadlineDate: a.deadline_date ?? null,
      veFormId: a.type === 'virtual_experience' ? (a.config?.ve_form_id ?? null) : null,
    })),
  ];

  const assignmentIds = assignments.map((a: any) => a.id);
  const eventIds = events.map((e: any) => e.id);
  const [rows, submissionsRes, attendanceRes, group] = await Promise.all([
    tracked.length
      ? buildStatusRows(db, {
          items: tracked,
          students: [{ id: student.id, email: student.email, full_name: student.full_name, cohort_id: cohortId }],
          cohortNames: new Map([[cohortId, cohort.name]]),
          activeCohortIds: [cohortId],
        }).then(async r => { await attachProgress(db, r, tracked); return r; })
      : Promise.resolve([]),
    assignmentIds.length
      ? db.from('assignment_submissions').select('assignment_id, status, score, group_id, participants')
          .in('assignment_id', assignmentIds)
          .or(groupId ? `student_id.eq.${student.id},group_id.eq.${groupId}` : `student_id.eq.${student.id}`)
      : Promise.resolve({ data: [] as any[], error: null }),
    eventIds.length
      ? db.from('live_attendance').select('event_id').eq('student_id', student.id).in('event_id', eventIds)
      : Promise.resolve({ data: [] as any[], error: null }),
    groupId ? loadGroup(db, groupId, student.id) : Promise.resolve(null),
  ]);

  // Without submissions every handed-in assignment would read as not started or overdue.
  const statusError = submissionsRes.error ?? attendanceRes.error;
  if (statusError) {
    console.error('[student/program]', (statusError as any).message);
    return NextResponse.json({ error: 'Could not load your program' }, { status: 500 });
  }

  // Own or group submission, whichever is furthest along. A submitted group answer belongs only to
  // the members the leader listed as participants -- the rule the Assignments tab and grading use --
  // while a group draft is shared work in progress for everyone in the group.
  const rank: Record<string, number> = { draft: 1, submitted: 2, graded: 3 };
  const submissionFor = new Map<string, { status: string; score: number | null }>();
  for (const s of submissionsRes.data ?? []) {
    const isParticipant = !s.group_id || s.status === 'draft'
      || (Array.isArray(s.participants) && s.participants.includes(student.id));
    if (!isParticipant) continue;
    const current = submissionFor.get(s.assignment_id);
    if (!current || (rank[s.status] ?? 0) > (rank[current.status] ?? 0)) {
      submissionFor.set(s.assignment_id, { status: s.status, score: s.score ?? null });
    }
  }
  const passMarkById = new Map(assignments.map((a: any) => [a.id, passMarkOf(a.config)]));
  const attended = new Set((attendanceRes.data ?? []).map((a: any) => a.event_id));

  const slugById = new Map<string, string>([...courses, ...ves].map((c: any) => [c.id, c.slug || c.id]));
  const trackedById = new Map(tracked.map(t => [t.id, t]));
  const items: ProgramItem[] = rows.map(row => {
    const isAssignment = row.contentType === 'assignment';
    const item = trackedById.get(row.formId);
    let baseStatus: ProgramBaseStatus =
      row.status === 'completed' ? 'done'
      : row.status === 'failed' ? 'failed'
      : row.status === 'in_progress' || row.status === 'stalled' ? 'in_progress'
      : 'not_started';
    if (isAssignment) {
      // Ignore the engine's own-submission view: a group member's work lives on the group row.
      baseStatus = row.status === 'in_progress' || row.status === 'stalled' ? 'in_progress' : 'not_started';
      const sub = submissionFor.get(row.formId);
      if (sub?.status === 'graded') {
        // Graded below the pass mark is a fail the student must resubmit, as the Assignments tab says.
        baseStatus = sub.score !== null && sub.score < (passMarkById.get(row.formId) ?? 0) ? 'failed' : 'done';
      } else if (sub?.status === 'submitted') baseStatus = 'awaiting_grade';
      else if (sub?.status === 'draft') baseStatus = 'in_progress';
    }
    // A plain assignment draft has no measurable progress; only course and VE work does.
    const hasMeasuredProgress = !isAssignment || !!item?.veFormId;
    return {
      id: row.formId,
      title: row.formTitle,
      type: row.contentType,
      href: isAssignment ? `/student/assignments/${row.formId}` : `/${slugById.get(row.formId)}`,
      baseStatus,
      progressPct: baseStatus === 'in_progress' && hasMeasuredProgress ? row.progressPct : 0,
      // Assignment deadlines are calendar dates. Course and VE deadlines are exact moments
      // (assigned_at + deadline_days); they go out whole so the browser resolves the student's
      // local date, matching the deadline the Courses tab shows.
      dueDate: isAssignment ? (item?.deadlineDate?.slice(0, 10) ?? null) : row.deadline,
    };
  });

  for (const e of events as any[]) {
    items.push({
      id: e.id,
      title: e.title,
      type: 'event',
      href: `/${e.slug || e.id}`,
      baseStatus: attended.has(e.id) ? 'attended' : 'not_attended',
      progressPct: 0,
      dueDate: String(e.event_date).slice(0, 10),
      recurring: !!e.recurrence && e.recurrence !== 'once',
      lastDate: e.recurrence_end_date ? String(e.recurrence_end_date).slice(0, 10) : null,
    });
  }

  const payload: ProgramPayload = {
    cohort: {
      id: cohort.id, name: cohort.name, startDate: cohort.start_date ?? null, endDate: cohort.end_date ?? null,
      classesEndDate: cohort.classes_end_date ?? null,
    },
    items,
    group,
  };
  return NextResponse.json(payload);
}

/** The student's own group. Names and photos only -- no contact details. */
async function loadGroup(db: any, groupId: string, studentId: string): Promise<ProgramGroup | null> {
  const [{ data: group }, { data: memberRows }] = await Promise.all([
    db.from('groups').select('id, name, description').eq('id', groupId).maybeSingle(),
    db.from('group_members').select('student_id, is_leader, joined_at').eq('group_id', groupId)
      .order('is_leader', { ascending: false }).order('joined_at', { ascending: true }),
  ]);
  if (!group) return null;
  const ids = (memberRows ?? []).map((m: any) => m.student_id);
  const { data: profiles } = ids.length
    ? await db.from('students').select('id, full_name, avatar_url').in('id', ids)
    : { data: [] as any[] };
  const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  return {
    id: group.id,
    name: group.name,
    description: group.description ?? null,
    members: (memberRows ?? []).map((m: any) => {
      const p: any = byId.get(m.student_id) ?? {};
      return {
        id: m.student_id,
        name: p.full_name || 'Group member',
        avatarUrl: p.avatar_url ?? null,
        isLeader: !!m.is_leader,
        isYou: m.student_id === studentId,
      };
    }),
  };
}
