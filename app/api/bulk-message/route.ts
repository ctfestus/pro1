/**
 * /api/bulk-message
 *
 * GET  - how many distinct students each segment holds, plus the content in scope. The dashboard's
 *        compose panel reads its counts from here rather than from /api/tracking so the number on
 *        the button is produced by the same scoping and the same status classification as the send.
 *        When those were two implementations they disagreed: completed virtual experiences were
 *        counted as Completed and emailed as Failed.
 * POST - sends a custom email to one segment.
 *
 * Sending stays owner-scoped even for admins (ownerScoped: true). The tracking table is a
 * read-only report and shows admins all published content; this route puts mail in inboxes, so it
 * keeps the narrower scope -- and GET applies the same one, so a count never promises recipients
 * the send would refuse.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { blastEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import {
  buildStatusRows, loadStudents, loadTrackedContent, type StatusRow, type TrackedItem,
} from '@/lib/tracking-report';

export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY);

const SEGMENTS = ['not_started', 'in_progress', 'stalled', 'failed', 'completed'] as const;

const zeroCounts = () => ({
  all: 0, not_started: 0, in_progress: 0, stalled: 0, failed: 0, completed: 0,
});

/** Content this caller may message, and the rows behind the requested cohort/content selection. */
async function loadSegmentData(
  supabase: any,
  userId: string,
  role: string,
  cohortId: string | undefined,
  formId: string | undefined,
): Promise<{ items: TrackedItem[]; activeCohortIds: string[]; rows: StatusRow[] }> {
  // publishedOnly as well as ownerScoped: a draft is invisible to students, so counting them
  // against it or mailing them about it is wrong however it was reached.
  const items = await loadTrackedContent(supabase, { userId, role, ownerScoped: true, publishedOnly: true });
  if (!items.length) return { items, activeCohortIds: [], rows: [] };

  const allCohortIds = [...new Set(items.flatMap(i => i.cohortIds))];
  const activeCohortIds = cohortId && cohortId !== 'all'
    ? allCohortIds.filter(id => id === cohortId)
    : allCohortIds;
  if (!activeCohortIds.length) return { items, activeCohortIds, rows: [] };

  const students = await loadStudents(supabase, activeCohortIds);
  if (!students.length) return { items, activeCohortIds, rows: [] };

  // Narrowing to one piece of content narrows the rows, never the content list the panel offers.
  const scoped = formId && formId !== 'all' ? items.filter(i => i.id === formId) : items;
  const rows = scoped.length
    ? await buildStatusRows(supabase, { items: scoped, students, cohortNames: new Map(), activeCohortIds })
    : [];
  return { items, activeCohortIds, rows };
}

const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** Distinct, deliverable recipients in one segment. A student appears once however many rows they hold. */
function recipientsFor(rows: StatusRow[], segment: string) {
  const seen = new Set<string>();
  const out: { email: string; name: string }[] = [];
  for (const row of rows) {
    if (segment !== 'all' && row.status !== segment) continue;
    const email = (row.studentEmail ?? '').trim().toLowerCase();
    if (!email || !validEmail(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: row.studentName || 'there' });
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase, role } = auth;

  const url = new URL(req.url);
  const cohortId = url.searchParams.get('cohortId') ?? 'all';
  const formId   = url.searchParams.get('formId') ?? 'all';

  const { items, activeCohortIds, rows } = await loadSegmentData(supabase, user.id, role, cohortId, formId);

  const counts = zeroCounts();
  for (const segment of [...SEGMENTS, 'all'] as const) {
    (counts as any)[segment] = recipientsFor(rows, segment).length;
  }

  const inScope = new Set(activeCohortIds);
  const forms = items
    .filter(i => i.cohortIds.some(id => inScope.has(id)))
    .map(i => ({ id: i.id, title: i.title }))
    .sort((a, b) => a.title.localeCompare(b.title));

  return NextResponse.json({ counts, forms });
}

export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  // Staff have view-only tracking -- they cannot send bulk messages. Students never could
  // send to anyone (recipients are scoped to content the caller owns), so only
  // instructors and admins are allowed through.
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase, role } = auth;

  const t = await getTenantSettings();
  const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { segment, cohortId, formId, subject, messageBody } = body;

  if (!subject?.trim())     return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
  if (!messageBody?.trim()) return NextResponse.json({ error: 'Message body is required' }, { status: 400 });
  if (!segment)             return NextResponse.json({ error: 'Segment is required' }, { status: 400 });
  if (subject.length > 200)      return NextResponse.json({ error: 'Subject must be 200 characters or fewer' }, { status: 400 });
  if (messageBody.length > 5000) return NextResponse.json({ error: 'Message body must be 5 000 characters or fewer' }, { status: 400 });
  if (segment !== 'all' && !SEGMENTS.includes(segment)) {
    return NextResponse.json({ error: 'Unknown segment' }, { status: 400 });
  }

  const { items, activeCohortIds, rows } = await loadSegmentData(supabase, user.id, role, cohortId, formId);
  if (!items.length)          return NextResponse.json({ error: 'No content found' }, { status: 404 });
  if (!activeCohortIds.length) return NextResponse.json({ error: 'No cohorts assigned' }, { status: 404 });

  const recipients = recipientsFor(rows, segment);
  if (!recipients.length) {
    return NextResponse.json({ error: 'No recipients match this segment', sent: 0 }, { status: 200 });
  }

  // Send in batches of 100
  let sent = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const batch = recipients.slice(i, i + 100).map(({ email, name }) => {
      const personalBody = messageBody.replace(/\{\{name\}\}/gi, name);
      const html = blastEmail({
        subject,
        body:       personalBody,
        formTitle:  t.appName,
        formUrl:    `${t.appUrl}/student`,
        senderName: t.senderName || t.teamName || t.appName,
        branding:   { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl },
      });
      return { from: FROM, to: email, subject, html };
    });
    await resend.batch.send(batch);
    sent += batch.length;
  }

  return NextResponse.json({ ok: true, sent });
}
