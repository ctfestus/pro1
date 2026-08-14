/**
 * Daily cron -- Deadline reminder emails.
 * Triggered by QStash at 08:00 every day.
 * Sends a reminder to students whose deadline is within DEADLINE_REMINDER_DAYS days
 * (including overdue, up to 1 day past).
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { verifyQStashRequest } from '@/lib/qstash';
import { deadlineReminderEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { fetchAllRows, fetchAllRowsByIds, fetchAllRowsByIdPairs } from '@/lib/fetch-all-rows';

export const dynamic = 'force-dynamic';

const BATCH_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: NextRequest) {
  const REMINDER_DAYS_BEFORE = Number(process.env.DEADLINE_REMINDER_DAYS ?? 3);

  const { valid } = await verifyQStashRequest(req);
  if (!valid) {
    console.error('[cron/deadline-reminders] Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  const supabase  = adminClient();
  const now       = Date.now();
  const since1Day = new Date(now - 86400000).toISOString();

  const t        = await getTenantSettings();
  const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

  type EmailPayload = Parameters<typeof resend.batch.send>[0][number];
  const emailBatch:   EmailPayload[] = [];
  const nudgeRecords: { student_id: string; form_id: string; nudge_type: string }[] = [];
  let skipped = 0;

  // -- 1. Courses / Events / VEs via cohort_assignments ---
  // Paged: this reads the whole table, so past the row cap the assignments beyond it silently
  // never produced a reminder. Learning-path grants are deliberately not folded in here -- a
  // deadline is counted from the date content was assigned to a cohort, and granting access
  // through a path creates no such date, so path-taught content has no deadline to remind about.
  const cohortAssignments = await fetchAllRows<any>((from, to) => supabase
    .from('cohort_assignments')
    .select('content_id, content_type, cohort_id, assigned_at', { count: 'exact' })
    .order('id').range(from, to));

  if (cohortAssignments.length) {
    const courseIds = [...new Set(cohortAssignments.filter(a => a.content_type === 'course').map(a => a.content_id))];
    const eventIds  = [...new Set(cohortAssignments.filter(a => a.content_type === 'event').map(a => a.content_id))];
    const veIds     = [...new Set(cohortAssignments.filter(a => a.content_type === 'virtual_experience').map(a => a.content_id))];

    const [courses, events, ves] = await Promise.all([
      fetchAllRowsByIds<any>(courseIds, (idChunk, from, to) => supabase.from('courses')
        .select('id, title, slug, deadline_days', { count: 'exact' }).in('id', idChunk).order('id').range(from, to)),
      fetchAllRowsByIds<any>(eventIds, (idChunk, from, to) => supabase.from('events')
        .select('id, title, slug, deadline_days', { count: 'exact' }).in('id', idChunk).order('id').range(from, to)),
      fetchAllRowsByIds<any>(veIds, (idChunk, from, to) => supabase.from('virtual_experiences')
        .select('id, title, slug, deadline_days', { count: 'exact' }).in('id', idChunk).order('id').range(from, to)),
    ]);

    const contentMap = new Map<string, { id: string; title: string; slug: string; deadline_days: number | null; content_type: string }>();
    for (const c of courses) contentMap.set(c.id, { ...c, content_type: 'course' });
    for (const e of events)  contentMap.set(e.id, { ...e, content_type: 'event' });
    for (const v of ves)     contentMap.set(v.id, { ...v, content_type: 'virtual_experience' });

    const candidates: { contentId: string; cohortId: string; daysLeft: number; content: any }[] = [];
    for (const assignment of cohortAssignments) {
      const content = contentMap.get(assignment.content_id);
      if (!content?.deadline_days) continue;
      const deadline = new Date(assignment.assigned_at).getTime() + Number(content.deadline_days) * 86400000;
      const daysLeft = Math.ceil((deadline - now) / 86400000);
      if (daysLeft > REMINDER_DAYS_BEFORE || daysLeft < -1) continue;
      candidates.push({ contentId: assignment.content_id, cohortId: assignment.cohort_id, daysLeft, content });
    }

    if (candidates.length) {
      const candidateContentIds = [...new Set(candidates.map(c => c.contentId))];
      const candidateCohortIds  = [...new Set(candidates.map(c => c.cohortId))];
      const candidateCourseIds  = candidateContentIds.filter(id => contentMap.get(id)?.content_type === 'course');
      const candidateVeIds      = candidateContentIds.filter(id => contentMap.get(id)?.content_type === 'virtual_experience');

      const students = await fetchAllRowsByIds<any>(candidateCohortIds, (idChunk, from, to) => supabase
        .from('students').select('id, email, full_name, cohort_id', { count: 'exact' })
        .in('cohort_id', idChunk).order('id').range(from, to));
      const studentIdsInScope = students.map((s: any) => s.id);

      const [courseAttempts, gpAttempts, recentNudges] = await Promise.all([
        fetchAllRowsByIdPairs<any>(studentIdsInScope, candidateCourseIds, (studentChunk, contentChunk, from, to) => supabase
          .from('course_attempts').select('student_id, course_id', { count: 'exact' })
          .in('student_id', studentChunk).in('course_id', contentChunk).not('completed_at', 'is', null).order('id').range(from, to)),
        fetchAllRowsByIdPairs<any>(studentIdsInScope, candidateVeIds, (studentChunk, contentChunk, from, to) => supabase
          .from('guided_project_attempts').select('student_id, ve_id', { count: 'exact' })
          .in('student_id', studentChunk).in('ve_id', contentChunk).not('completed_at', 'is', null).order('id').range(from, to)),
        // A truncated read here would resend a reminder someone already had today.
        fetchAllRowsByIds<any>(candidateContentIds, (idChunk, from, to) => supabase
          .from('sent_nudges').select('student_id, form_id', { count: 'exact' })
          .eq('nudge_type', 'deadline_reminder')
          .in('form_id', idChunk)
          .gte('sent_at', since1Day)
          .order('id').range(from, to)),
      ]);

      const completedSet = new Set<string>();
      for (const a of courseAttempts) completedSet.add(`${a.student_id}|${a.course_id}`);
      for (const a of gpAttempts)     completedSet.add(`${a.student_id}|${a.ve_id}`);

      const nudgedSet = new Set<string>();
      for (const n of recentNudges) nudgedSet.add(`${n.student_id}|${n.form_id}`);

      const studentsByCohort = new Map<string, any[]>();
      for (const student of students) {
        if (!studentsByCohort.has(student.cohort_id)) studentsByCohort.set(student.cohort_id, []);
        studentsByCohort.get(student.cohort_id)!.push(student);
      }

      for (const { contentId, cohortId, daysLeft, content } of candidates) {
        const cohortStudents = studentsByCohort.get(cohortId) ?? [];
        const slug = content.slug ?? contentId;
        for (const student of cohortStudents) {
          const email = (student.email ?? '').trim().toLowerCase();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
          if (completedSet.has(`${student.id}|${contentId}`)) { skipped++; continue; }
          if (nudgedSet.has(`${student.id}|${contentId}`))    { skipped++; continue; }

          const subject = daysLeft <= 0
            ? `⚠ Deadline passed: ${content.title}`
            : daysLeft === 1
              ? `Last chance! Your deadline is tomorrow: ${content.title}`
              : `Reminder: ${daysLeft} days left to complete "${content.title}"`;

          emailBatch.push({
            from: FROM, to: email, subject,
            html: deadlineReminderEmail({ name: student.full_name || 'there', contentTitle: content.title, contentType: content.content_type, formUrl: `${t.appUrl}/${slug}`, daysLeft, branding }),
          });
          nudgeRecords.push({ student_id: student.id, form_id: contentId, nudge_type: 'deadline_reminder' });
        }
      }
    }
  }

  // -- 2. Assignments (deadline_date, cohort_ids array) ---
  const windowStart = new Date(now - 86400000).toISOString().slice(0, 10);
  const windowEnd   = new Date(now + REMINDER_DAYS_BEFORE * 86400000).toISOString().slice(0, 10);

  const asmRows = await fetchAllRows<any>((from, to) => supabase
    .from('assignments')
    .select('id, title, cohort_ids, deadline_date', { count: 'exact' })
    .eq('status', 'published')
    .not('deadline_date', 'is', null)
    .gte('deadline_date', windowStart)
    .lte('deadline_date', windowEnd)
    .order('id').range(from, to));

  if (asmRows.length) {
    const allCohortIds  = [...new Set(asmRows.flatMap((a: any) => a.cohort_ids ?? []))] as string[];
    const asmContentIds = asmRows.map((a: any) => a.id);

    const asmStudents = await fetchAllRowsByIds<any>(allCohortIds, (idChunk, from, to) => supabase
      .from('students').select('id, email, full_name, cohort_id', { count: 'exact' })
      .in('cohort_id', idChunk).order('id').range(from, to));
    const asmStudentIds = asmStudents.map((s: any) => s.id);

    const [asmSubs, asmNudges] = await Promise.all([
      fetchAllRowsByIdPairs<any>(asmStudentIds, asmContentIds, (studentChunk, contentChunk, from, to) => supabase
        .from('assignment_submissions').select('student_id, assignment_id', { count: 'exact' })
        .in('student_id', studentChunk).in('assignment_id', contentChunk)
        .in('status', ['submitted', 'graded']).order('id').range(from, to)),
      fetchAllRowsByIds<any>(asmContentIds, (idChunk, from, to) => supabase
        .from('sent_nudges').select('student_id, form_id', { count: 'exact' })
        .eq('nudge_type', 'deadline_reminder')
        .in('form_id', idChunk)
        .gte('sent_at', since1Day)
        .order('id').range(from, to)),
    ]);

    const submittedSet   = new Set(asmSubs.map((s: any) => `${s.student_id}|${s.assignment_id}`));
    const asmNudgedSet   = new Set(asmNudges.map((n: any) => `${n.student_id}|${n.form_id}`));
    const studentsByCohort2 = new Map<string, any[]>();
    for (const s of asmStudents) {
      if (!studentsByCohort2.has(s.cohort_id)) studentsByCohort2.set(s.cohort_id, []);
      studentsByCohort2.get(s.cohort_id)!.push(s);
    }

    for (const asm of asmRows) {
      const daysLeft = Math.ceil((new Date(asm.deadline_date).getTime() - now) / 86400000);
      for (const cohortId of (asm.cohort_ids ?? [])) {
        for (const student of studentsByCohort2.get(cohortId) ?? []) {
          const email = (student.email ?? '').trim().toLowerCase();
          if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
          if (submittedSet.has(`${student.id}|${asm.id}`)) { skipped++; continue; }
          if (asmNudgedSet.has(`${student.id}|${asm.id}`)) { skipped++; continue; }

          const subject = daysLeft <= 0
            ? `⚠ Assignment deadline passed: ${asm.title}`
            : daysLeft === 1
              ? `Last chance! Assignment due tomorrow: ${asm.title}`
              : `Reminder: ${daysLeft} days left to submit "${asm.title}"`;

          emailBatch.push({
            from: FROM, to: email, subject,
            html: deadlineReminderEmail({ name: student.full_name || 'there', contentTitle: asm.title, contentType: 'assignment', formUrl: `${t.appUrl}/student#assignments`, daysLeft, branding }),
          });
          nudgeRecords.push({ student_id: student.id, form_id: asm.id, nudge_type: 'deadline_reminder' });
        }
      }
    }
  }

  // -- 3. Send ---
  if (!emailBatch.length) {
    console.log(`[cron/deadline-reminders] sent=0 skipped=${skipped}`);
    return NextResponse.json({ ok: true, sent: 0, skipped });
  }

  const sentKeySet = new Set<string>();
  const batches    = chunk(emailBatch, BATCH_SIZE);
  let sent = 0;

  for (let i = 0; i < batches.length; i++) {
    const batchNudges = nudgeRecords.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    try {
      await resend.batch.send(batches[i]);
      sent += batches[i].length;
      for (const n of batchNudges) sentKeySet.add(`${n.student_id}|${n.form_id}`);
    } catch (err) {
      console.error('[cron/deadline-reminders] batch send failed:', err);
    }
  }

  if (sentKeySet.size) {
    const toInsert = nudgeRecords.filter(n => sentKeySet.has(`${n.student_id}|${n.form_id}`));
    // Chunked: losing this record would send every one of those reminders again tomorrow.
    for (const rows of chunk(toInsert, BATCH_SIZE)) {
      const { error } = await supabase.from('sent_nudges').insert(rows);
      if (error) console.error('[cron/deadline-reminders] sent_nudges insert failed:', error.message);
    }
  }

  console.log(`[cron/deadline-reminders] sent=${sent} skipped=${skipped}`);
  return NextResponse.json({ ok: true, sent, skipped });
}
