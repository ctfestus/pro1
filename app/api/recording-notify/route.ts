import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { Resend } from 'resend';
import { recordingPublishedEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';

const resend = new Resend(process.env.RESEND_API_KEY);
const BATCH_SIZE = 100;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}


export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;

  const { recordingId, newWeeks } = await req.json();
  if (!recordingId) return NextResponse.json({ error: 'recordingId required' }, { status: 400 });
  if (!Array.isArray(newWeeks) || newWeeks.length === 0) return NextResponse.json({ error: 'newWeeks required' }, { status: 400 });

  const db = adminClient();

  const { data: recording } = await db
    .from('recordings').select('id, title, cohort_ids').eq('id', recordingId).single();

  if (!recording) return NextResponse.json({ error: 'Recording not found' }, { status: 404 });

  const cohortIds: string[] = recording.cohort_ids ?? [];
  if (!cohortIds.length) return NextResponse.json({ ok: true, count: 0, reason: 'No cohorts assigned' });

  const weeks: number[] = [...newWeeks].sort((a, b) => a - b);

  // Fetch all students in the cohorts
  const { data: students } = await db
    .from('students')
    .select('full_name, email')
    .in('cohort_id', cohortIds)
    .eq('role', 'student');

  const recipients = (students ?? []).filter((s: any) => s.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email));
  if (!recipients.length) return NextResponse.json({ ok: true, count: 0, reason: 'No recipients' });

  const t = await getTenantSettings();
  const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
  const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
  const dashboardUrl = `${t.appUrl || process.env.APP_URL || ''}/student`;

  const subject = `New recordings available: ${recording.title}`;

  const batch = recipients.map((s: any) => ({
    from: FROM,
    to: s.email,
    subject,
    html: recordingPublishedEmail({
      name: s.full_name || 'there',
      recordingTitle: recording.title,
      newWeeks: weeks,
      dashboardUrl,
      branding,
    }),
  }));

  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    await resend.batch.send(batch.slice(i, i + BATCH_SIZE));
  }

  return NextResponse.json({ ok: true, count: recipients.length });
}
