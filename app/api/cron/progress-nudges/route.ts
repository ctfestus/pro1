/**
 * Daily cron -- "We miss you" inactivity nudge.
 * Triggered by QStash at 08:00 every day.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { verifyQStashRequest } from '@/lib/qstash';
import { nudgeEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { fetchAllRows, fetchAllRowsByIds } from '@/lib/fetch-all-rows';
import { loadPathGrantedPairs } from '@/lib/tracking-report';

export const dynamic = 'force-dynamic';

const resend            = new Resend(process.env.RESEND_API_KEY);
const INACTIVITY_DAYS   = Number(process.env.NUDGE_INACTIVITY_DAYS ?? 7);
const RESEND_AFTER_DAYS = Number(process.env.NUDGE_RESEND_AFTER_DAYS ?? 14);
const BATCH_SIZE        = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

export async function POST(req: NextRequest) {
  const { valid } = await verifyQStashRequest(req);
  if (!valid) {
    console.error('[cron/progress-nudges] Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  const supabase = adminClient();
  const cutoff   = new Date(Date.now() - INACTIVITY_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const oldest   = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

  // Fetch stalled attempts: started but not completed, last activity between 7 and 60 days ago.
  // Paged: the API truncates any single response at the project's row cap, and a truncated scan
  // here means the students past the cap are silently never nudged.
  const [courseAttempts, gpAttempts] = await Promise.all([
    fetchAllRows<any>((from, to) => supabase.from('course_attempts')
      .select('student_id, course_id, updated_at', { count: 'exact' })
      .is('completed_at', null)
      .lt('updated_at', cutoff)
      .gt('updated_at', oldest)
      .order('id').range(from, to)),
    fetchAllRows<any>((from, to) => supabase.from('guided_project_attempts')
      .select('student_id, ve_id, updated_at', { count: 'exact' })
      .is('completed_at', null)
      .lt('updated_at', cutoff)
      .gt('updated_at', oldest)
      .order('id').range(from, to)),
  ]);

  // Collect unique IDs
  const courseIds  = [...new Set(courseAttempts.map((a: any) => a.course_id))];
  const veIds      = [...new Set(gpAttempts.map((a: any) => a.ve_id))];
  const studentIds = [...new Set([
    ...courseAttempts.map((a: any) => a.student_id),
    ...gpAttempts.map((a: any) => a.student_id),
  ])];

  if (!studentIds.length) return NextResponse.json({ ok: true, sent: 0, skipped: 0 });

  const [courses, ves, studentRows, cohortAssignments, pathPairs] = await Promise.all([
    fetchAllRowsByIds<any>(courseIds, (idChunk, from, to) => supabase
      .from('courses').select('id, title, slug, cover_image', { count: 'exact' }).in('id', idChunk).order('id').range(from, to)),
    fetchAllRowsByIds<any>(veIds, (idChunk, from, to) => supabase
      .from('virtual_experiences').select('id, title, slug, cover_image', { count: 'exact' }).in('id', idChunk).order('id').range(from, to)),
    fetchAllRowsByIds<any>(studentIds, (idChunk, from, to) => supabase
      .from('students').select('id, email, full_name, cohort_id', { count: 'exact' }).in('id', idChunk).order('id').range(from, to)),
    fetchAllRowsByIds<any>([...courseIds, ...veIds], (idChunk, from, to) => supabase
      .from('cohort_assignments').select('content_id, cohort_id', { count: 'exact' }).in('content_id', idChunk).order('id').range(from, to)),
    loadPathGrantedPairs(supabase),
  ]);

  // Build unified content map
  const contentMap = new Map<string, { id: string; title: string; slug: string; cover_image?: string | null; content_type: string }>();
  for (const c of courses) contentMap.set(c.id, { ...c, content_type: 'course' });
  for (const v of ves)     contentMap.set(v.id, { ...v, content_type: 'virtual_experience' });

  const studentMap = new Map(studentRows.map((s: any) => [s.id, s]));

  // Only nudge students whose cohort can currently reach the stalled content, so learners with no
  // cohort (or in a cohort the content never reached) are never nudged. Reachability is direct
  // assignment OR a published learning path: a path writes no cohort_assignments row, so reading
  // that table alone made every path-taught cohort invisible here and they received nothing.
  const assignedCohortsByContent = new Map<string, Set<string>>();
  const allowReach = (contentId: string, cohortId: string) => {
    const set = assignedCohortsByContent.get(contentId) ?? new Set<string>();
    set.add(cohortId);
    assignedCohortsByContent.set(contentId, set);
  };
  for (const a of cohortAssignments) allowReach(a.content_id, a.cohort_id);
  for (const p of pathPairs) allowReach(p.content_id, p.cohort_id);

  // Fetch related assignments for stalled courses (smart nudge)
  const relatedAssignments = await fetchAllRowsByIds<any>(courseIds, (idChunk, from, to) => supabase
    .from('assignments').select('id, title, related_course', { count: 'exact' })
    .in('related_course', idChunk).eq('status', 'published').order('id').range(from, to));
  const assignmentMap = new Map(relatedAssignments.map((a: any) => [a.related_course, a.title]));

  // Merge and deduplicate stalled attempts
  let excludedUnassigned = 0;
  const seen = new Set<string>();
  const candidates: {
    studentId:   string;
    email:       string;
    name:        string;
    contentId:   string;
    contentType: string;
    title:       string;
    slug:        string;
    coverImage?: string | null;
  }[] = [];

  for (const a of courseAttempts) {
    const key = `${a.student_id}|${a.course_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const content = contentMap.get(a.course_id);
    const student = studentMap.get(a.student_id);
    if (!content || !student?.email) continue;
    if (!student.cohort_id || !assignedCohortsByContent.get(a.course_id)?.has(student.cohort_id)) { excludedUnassigned++; continue; }
    candidates.push({ studentId: a.student_id, email: student.email, name: student.full_name || 'there', contentId: a.course_id, contentType: 'course', title: content.title, slug: content.slug ?? a.course_id, coverImage: content.cover_image });
  }

  for (const a of gpAttempts) {
    const key = `${a.student_id}|${a.ve_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const content = contentMap.get(a.ve_id);
    const student = studentMap.get(a.student_id);
    if (!content || !student?.email) continue;
    if (!student.cohort_id || !assignedCohortsByContent.get(a.ve_id)?.has(student.cohort_id)) { excludedUnassigned++; continue; }
    candidates.push({ studentId: a.student_id, email: student.email, name: student.full_name || 'there', contentId: a.ve_id, contentType: 'virtual_experience', title: content.title, slug: content.slug ?? a.ve_id, coverImage: content.cover_image });
  }

  // Pre-fetch recent inactivity nudges in bulk
  const nudgeCutoff = new Date(Date.now() - RESEND_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const candidateStudentIds = [...new Set(candidates.map(c => c.studentId))];
  const recentNudges = await fetchAllRowsByIds<any>(candidateStudentIds, (idChunk, from, to) => supabase
    .from('sent_nudges').select('student_id, form_id', { count: 'exact' })
    .eq('nudge_type', 'inactivity')
    .in('student_id', idChunk)
    .gte('sent_at', nudgeCutoff)
    .order('id').range(from, to));

  // A truncated read here would resend a nudge someone already had, so this is paged like the rest.
  const nudgedSet = new Set(recentNudges.map((n: any) => `${n.student_id}|${n.form_id}`));

  // Build email batch
  const t        = await getTenantSettings();
  const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

  type EmailPayload = Parameters<typeof resend.batch.send>[0][number];
  const emailBatch:   EmailPayload[] = [];
  const nudgeRecords: { student_id: string; form_id: string }[] = [];
  let skipped = 0;

  for (const c of candidates) {
    if (nudgedSet.has(`${c.studentId}|${c.contentId}`)) { skipped++; continue; }

    const relatedAssignmentTitle = assignmentMap.get(c.contentId);
    emailBatch.push({
      from: FROM,
      to:   c.email,
      subject: `We miss you, ${c.name}! Come back and keep learning 👋`,
      html: nudgeEmail({
        name:                  c.name,
        contentTitle:          c.title,
        contentType:           c.contentType,
        status:                'stalled',
        formUrl:               `${t.appUrl}/${c.slug}`,
        coverImage:            c.coverImage,
        relatedAssignmentTitle,
        branding,
      }),
    });
    nudgeRecords.push({ student_id: c.studentId, form_id: c.contentId });
  }

  if (!emailBatch.length) {
    console.log(`[cron/progress-nudges] sent=0 skipped=${skipped} excludedUnassigned=${excludedUnassigned}`);
    return NextResponse.json({ ok: true, sent: 0, skipped, excludedUnassigned });
  }

  const sentKeys = new Set<string>();
  const batches  = chunk(emailBatch, BATCH_SIZE);
  let sent = 0;

  for (let i = 0; i < batches.length; i++) {
    const batchNudges = nudgeRecords.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    try {
      await resend.batch.send(batches[i]);
      sent += batches[i].length;
      for (const n of batchNudges) sentKeys.add(`${n.student_id}|${n.form_id}`);
    } catch (err) {
      console.error('[cron/progress-nudges] batch send failed:', err);
    }
  }

  if (sentKeys.size) {
    const toInsert = nudgeRecords
      .filter(n => sentKeys.has(`${n.student_id}|${n.form_id}`))
      .map(n => ({ student_id: n.student_id, form_id: n.form_id, nudge_type: 'inactivity' }));
    // Chunked: one oversized insert that fails would lose the whole record of what was just sent,
    // and every one of those students would be nudged again on the next run.
    for (const rows of chunk(toInsert, BATCH_SIZE)) {
      const { error } = await supabase.from('sent_nudges').insert(rows);
      if (error) console.error('[cron/progress-nudges] sent_nudges insert failed:', error.message);
    }
  }

  console.log(`[cron/progress-nudges] sent=${sent} skipped=${skipped} excludedUnassigned=${excludedUnassigned}`);
  return NextResponse.json({ ok: true, sent, skipped, excludedUnassigned });
}
