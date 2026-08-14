/**
 * Weekly cron -- Learning digest email.
 * Triggered by QStash every Monday at 08:00.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { verifyQStashRequest } from '@/lib/qstash';
import { weeklyDigestEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { fetchAllRows, fetchAllRowsByIds, fetchAllRowsByIdPairs } from '@/lib/fetch-all-rows';
import { loadPathGrantedPairs } from '@/lib/tracking-report';

export const dynamic = 'force-dynamic';

const resend     = new Resend(process.env.RESEND_API_KEY);
const BATCH_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function POST(req: NextRequest) {
  const { valid } = await verifyQStashRequest(req);
  if (!valid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  const supabase = adminClient();
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  // -- 1. Fetch all cohort assignments (polymorphic), plus what learning paths grant --
  // Paged: this reads the whole table, so past the row cap it silently returned a partial list and
  // the cohorts beyond it received no digest at all. The path grants are appended because a path
  // writes no row here, which made a cohort taught only through one invisible to this job.
  const directAssignments = await fetchAllRows<any>((from, to) => supabase
    .from('cohort_assignments')
    .select('content_id, content_type, cohort_id, assigned_at', { count: 'exact' })
    .order('id').range(from, to));

  const pathPairs = await loadPathGrantedPairs(supabase);
  const seenPair = new Set(directAssignments.map((a: any) => `${a.content_id}|${a.cohort_id}`));
  // assigned_at is null for a path grant: there is no assignment event to count a deadline from,
  // which is why the deadline branch below requires one.
  const cohortAssignments = [
    ...directAssignments,
    ...pathPairs
      .filter(p => !seenPair.has(`${p.content_id}|${p.cohort_id}`))
      .map(p => ({ content_id: p.content_id, content_type: p.content_type, cohort_id: p.cohort_id, assigned_at: null })),
  ];

  if (!cohortAssignments.length) {
    return NextResponse.json({ ok: true, sent: 0, skipped: 0 });
  }

  // -- 2. Fetch published content from all three tables --
  const courseIds = [...new Set(cohortAssignments.filter(a => a.content_type === 'course').map(a => a.content_id))];
  const eventIds  = [...new Set(cohortAssignments.filter(a => a.content_type === 'event').map(a => a.content_id))];
  const veIds     = [...new Set(cohortAssignments.filter(a => a.content_type === 'virtual_experience').map(a => a.content_id))];

  const [courses, events, ves] = await Promise.all([
    fetchAllRowsByIds<any>(courseIds, (idChunk, from, to) => supabase.from('courses')
      .select('id, title, slug, deadline_days', { count: 'exact' }).in('id', idChunk).eq('status', 'published').order('id').range(from, to)),
    fetchAllRowsByIds<any>(eventIds, (idChunk, from, to) => supabase.from('events')
      .select('id, title, slug, deadline_days', { count: 'exact' }).in('id', idChunk).eq('status', 'published').order('id').range(from, to)),
    fetchAllRowsByIds<any>(veIds, (idChunk, from, to) => supabase.from('virtual_experiences')
      .select('id, title, slug, deadline_days', { count: 'exact' }).in('id', idChunk).eq('status', 'published').order('id').range(from, to)),
  ]);

  const contentMap = new Map<string, { id: string; title: string; slug: string; deadline_days: number | null; content_type: string }>();
  for (const c of courses) contentMap.set(c.id, { ...c, content_type: 'course' });
  for (const e of events)  contentMap.set(e.id, { ...e, content_type: 'event' });
  for (const v of ves)     contentMap.set(v.id, { ...v, content_type: 'virtual_experience' });

  // -- 3. Fetch all students in the relevant cohorts --
  const cohortIds = [...new Set(cohortAssignments.map((a: any) => a.cohort_id))];
  const students = await fetchAllRowsByIds<any>(cohortIds, (idChunk, from, to) => supabase
    .from('students').select('id, email, full_name, cohort_id', { count: 'exact' })
    .in('cohort_id', idChunk).order('id').range(from, to));

  if (!students.length) return NextResponse.json({ ok: true, sent: 0, skipped: 0 });

  // -- 4. Fetch all attempts for the relevant content --
  const studentIdsInScope = students.map((s: any) => s.id);
  const [courseAttempts, gpAttempts] = await Promise.all([
    fetchAllRowsByIdPairs<any>(studentIdsInScope, courseIds, (studentChunk, contentChunk, from, to) => supabase
      .from('course_attempts').select('student_id, course_id, completed_at, score, updated_at', { count: 'exact' })
      .in('student_id', studentChunk).in('course_id', contentChunk).order('id').range(from, to)),
    fetchAllRowsByIdPairs<any>(studentIdsInScope, veIds, (studentChunk, contentChunk, from, to) => supabase
      .from('guided_project_attempts').select('student_id, ve_id, completed_at, updated_at', { count: 'exact' })
      .in('student_id', studentChunk).in('ve_id', contentChunk).order('id').range(from, to)),
  ]);

  // Map: `${studentId}|${contentId}` -> attempt
  type AttemptData = { completedAt: string | null; score?: number | null; updatedAt: string };
  const attemptMap = new Map<string, AttemptData>();

  for (const a of courseAttempts) {
    attemptMap.set(`${a.student_id}|${a.course_id}`, { completedAt: a.completed_at, score: a.score, updatedAt: a.updated_at });
  }
  for (const a of gpAttempts) {
    const key = `${a.student_id}|${a.ve_id}`;
    if (!attemptMap.has(key)) {
      attemptMap.set(key, { completedAt: a.completed_at, updatedAt: a.updated_at });
    }
  }

  // -- 5. Build cohort assignments map --
  const assignmentsByCohort = new Map<string, typeof cohortAssignments>();
  for (const a of cohortAssignments) {
    if (!assignmentsByCohort.has(a.cohort_id)) assignmentsByCohort.set(a.cohort_id, []);
    assignmentsByCohort.get(a.cohort_id)!.push(a);
  }

  // -- 6. Pre-fetch recent weekly digest nudges --
  const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString();
  // A truncated read here would resend a digest someone already had this week.
  const recentNudges = await fetchAllRowsByIds<any>(studentIdsInScope, (idChunk, from, to) => supabase
    .from('sent_nudges').select('student_id', { count: 'exact' })
    .eq('nudge_type', 'weekly_digest')
    .in('student_id', idChunk)
    .gte('sent_at', sixDaysAgo)
    .order('id').range(from, to));

  const nudgedStudentIds = new Set(recentNudges.map((n: any) => n.student_id));

  // -- 7. Build email batch --
  const t        = await getTenantSettings();
  const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

  type EmailPayload = Parameters<typeof resend.batch.send>[0][number];
  const emailBatch:   EmailPayload[] = [];
  const nudgeRecords: { student_id: string }[] = [];
  let skipped = 0;

  for (const student of students) {
    const email = ((student.email as string) ?? '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    if (nudgedStudentIds.has(student.id)) { skipped++; continue; }

    const assignments = assignmentsByCohort.get(student.cohort_id) ?? [];

    const completed:       { title: string; contentType: string; score?: number | null }[] = [];
    const inProgress:      { title: string; contentType: string }[] = [];
    const notStarted:      { title: string; contentType: string }[] = [];
    const missedDeadlines: { title: string; contentType: string; daysOverdue: number }[] = [];

    for (const assignment of assignments) {
      const content = contentMap.get(assignment.content_id);
      if (!content) continue;

      const contentType = content.content_type;
      const attempt = attemptMap.get(`${student.id}|${assignment.content_id}`);

      let isOverdue = false;
      let daysOverdue = 0;
      // assigned_at is required, not just deadline_days: a path-granted item has no assignment date,
      // and without this guard it would date from the epoch and report as decades overdue.
      if (content.deadline_days && assignment.assigned_at) {
        const deadline = new Date(assignment.assigned_at).getTime() + Number(content.deadline_days) * 86400000;
        if (now > deadline && !attempt?.completedAt) {
          isOverdue  = true;
          daysOverdue = Math.floor((now - deadline) / 86400000);
        }
      }

      if (!attempt) {
        if (isOverdue) missedDeadlines.push({ title: content.title, contentType, daysOverdue });
        else           notStarted.push({ title: content.title, contentType });
      } else if (attempt.completedAt) {
        if (attempt.completedAt >= sevenDaysAgo) {
          completed.push({ title: content.title, contentType, score: attempt.score });
        }
      } else {
        if (isOverdue) missedDeadlines.push({ title: content.title, contentType, daysOverdue });
        else           inProgress.push({ title: content.title, contentType });
      }
    }

    if (!completed.length && !inProgress.length && !notStarted.length && !missedDeadlines.length) {
      skipped++;
      continue;
    }

    const subject = missedDeadlines.length > 0
      ? `⚠️ ${missedDeadlines.length} overdue item${missedDeadlines.length > 1 ? 's' : ''} in your weekly update`
      : completed.length > 0
        ? `You completed ${completed.length} item${completed.length > 1 ? 's' : ''} this week 🎓`
        : `Your weekly learning update: keep going!`;

    emailBatch.push({
      from: FROM, to: email, subject,
      html: weeklyDigestEmail({
        name: student.full_name || 'there',
        completed,
        inProgress,
        notStarted,
        missedDeadlines,
        dashboardUrl: `${t.appUrl}/student`,
        branding,
      }),
    });
    nudgeRecords.push({ student_id: student.id });
  }

  if (!emailBatch.length) {
    console.log(`[cron/weekly-digest] sent=0 skipped=${skipped}`);
    return NextResponse.json({ ok: true, sent: 0, skipped });
  }

  const sentStudentIds = new Set<string>();
  const batches = chunk(emailBatch, BATCH_SIZE);
  let sent = 0;

  for (let i = 0; i < batches.length; i++) {
    const batchNudges = nudgeRecords.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    try {
      await resend.batch.send(batches[i]);
      sent += batches[i].length;
      for (const n of batchNudges) sentStudentIds.add(n.student_id);
    } catch (err) {
      console.error('[cron/weekly-digest] batch send failed:', err);
    }
  }

  if (sentStudentIds.size) {
    const toInsert = nudgeRecords
      .filter(n => sentStudentIds.has(n.student_id))
      .map(n => ({ student_id: n.student_id, form_id: null, nudge_type: 'weekly_digest' }));
    // Chunked: losing this record to one oversized insert would send every one of them a second
    // digest on the next run.
    for (const rows of chunk(toInsert, BATCH_SIZE)) {
      const { error } = await supabase.from('sent_nudges').insert(rows);
      if (error) console.error('[cron/weekly-digest] sent_nudges insert failed:', error.message);
    }
  }

  console.log(`[cron/weekly-digest] sent=${sent} skipped=${skipped}`);
  return NextResponse.json({ ok: true, sent, skipped });
}
