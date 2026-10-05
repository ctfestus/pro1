import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { openCertificateEmail } from '@/lib/email-templates';
import { applyEmailTemplate } from '@/lib/email-template-service';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { absolutePath, normalizeAbsoluteBaseUrl } from '@/lib/public-url';

export const dynamic = 'force-dynamic';

const resend = new Resend(process.env.RESEND_API_KEY);

function isMissingOpenCertificatesMigration(error: any) {
  return error?.code === 'PGRST205' && typeof error?.message === 'string' && error.message.includes("public.open_certificates");
}

function missingMigrationResponse() {
  return NextResponse.json(
    { error: 'Database setup incomplete. Apply migrations/089_open_certificates.sql to create the programs and open_certificates tables.' },
    { status: 500 },
  );
}

async function resolveUser(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  return isAuthError(auth) ? null : auth.user;
}

export async function GET(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: 'Only instructors and admins can manage certificates.' }, { status: 403 });

  const programId = new URL(req.url).searchParams.get('program_id');

  let query = adminClient()
    .from('open_certificates')
    .select('id, program_id, program_name, recipient_name, recipient_email, issued_date, revoked, revoked_at, created_at')
    .eq('issued_by', user.id)
    .order('created_at', { ascending: false });

  if (programId) query = query.eq('program_id', programId);

  const { data, error } = await query;
  if (error) {
    console.error('[open-certificates GET]', error);
    if (isMissingOpenCertificatesMigration(error)) return missingMigrationResponse();
    return NextResponse.json({ error: 'Failed to fetch certificates.' }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const user = await resolveUser(req);
  if (!user) return NextResponse.json({ error: 'Only instructors and admins can issue certificates.' }, { status: 403 });

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const programName: string = body.program_name?.trim();
  if (!programName) return NextResponse.json({ error: 'program_name is required' }, { status: 400 });

  const recipients: { name: string; email?: string; issued_date?: string }[] = body.recipients ?? [];
  if (!recipients.length) return NextResponse.json({ error: 'No recipients provided' }, { status: 400 });
  if (recipients.length > 500) return NextResponse.json({ error: 'Max 500 recipients per batch' }, { status: 400 });

  const today = new Date().toISOString().split('T')[0];
  const programId = body.program_id ?? null;
  const emailCounts = new Map<string, number>();
  recipients.forEach(r => {
    const email = r.email?.trim().toLowerCase();
    if (!email) return;
    emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
  });

  const duplicateRequestEmails = [...emailCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([email]) => email);
  if (duplicateRequestEmails.length) {
    return NextResponse.json(
      { error: `Duplicate recipient email for this program: ${duplicateRequestEmails.join(', ')}` },
      { status: 400 },
    );
  }

  const recipientEmails = [...emailCounts.keys()];
  if (recipientEmails.length) {
    let duplicateQuery = adminClient()
      .from('open_certificates')
      .select('recipient_email')
      .eq('issued_by', user.id)
      .eq('revoked', false)
      .in('recipient_email', recipientEmails);

    duplicateQuery = programId
      ? duplicateQuery.eq('program_id', programId)
      : duplicateQuery.eq('program_name', programName);

    const { data: existing, error: duplicateErr } = await duplicateQuery;
    if (duplicateErr) {
      console.error('[open-certificates duplicate check]', duplicateErr);
      return NextResponse.json({ error: 'Failed to check existing certificates.' }, { status: 500 });
    }

    if (existing?.length) {
      const existingEmails = existing.map(r => r.recipient_email).filter(Boolean).join(', ');
      return NextResponse.json(
        { error: `Certificate already issued for this program: ${existingEmails}` },
        { status: 409 },
      );
    }
  }

  const rows = recipients.map(r => ({
    program_id:      programId,
    program_name:    programName,
    recipient_name:  r.name?.trim() || 'Recipient',
    recipient_email: r.email?.trim().toLowerCase() || null,
    issued_date:     r.issued_date ?? today,
    issued_by:       user.id,
  }));

  const { data: inserted, error } = await adminClient()
    .from('open_certificates')
    .insert(rows)
    .select('id, recipient_name, recipient_email, program_name, issued_date');

  if (error) {
    console.error('[open-certificates POST]', error);
    if (isMissingOpenCertificatesMigration(error)) return missingMigrationResponse();
    if (error.code === '23505') {
      return NextResponse.json(
        { error: 'One or more recipients already have an active certificate for this program.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to issue certificates.' }, { status: 500 });
  }

  let emailResult: { attempted: boolean; sent: number; error?: string } = { attempted: false, sent: 0 };

  if (body.send_email && !process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: 'Certificates were issued, but email service is not configured.' },
      { status: 503 },
    );
  }

  if (body.send_email && inserted?.length) {
    const t   = await getTenantSettings();
    const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
    const requestOrigin = new URL(req.url).origin;
    const appUrl = normalizeAbsoluteBaseUrl(t.appUrl, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL, requestOrigin);

    const emailRows = (inserted as { id: string; recipient_name: string; recipient_email: string | null; program_name: string; issued_date: string }[])
      .filter(r => r.recipient_email);

    emailResult = { attempted: true, sent: 0 };

    if (!emailRows.length) {
      return NextResponse.json({
        ok: true,
        count: inserted?.length ?? 0,
        data: inserted,
        email: { ...emailResult, error: 'No recipient email addresses were provided.' },
      });
    }

    const batches: typeof emailRows[] = [];
    for (let i = 0; i < emailRows.length; i += 100) batches.push(emailRows.slice(i, i + 100));

    try {
      for (const batch of batches) {
        const messages = await Promise.all(batch.map(async r => {
          const certUrl = absolutePath(appUrl, `/credential/${r.id}`);
          const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl };
          const fallbackSubject = `Your ${r.program_name} Certificate`;
          const fallbackHtml = openCertificateEmail({
            recipientName: r.recipient_name,
            programName:   r.program_name,
            issuedDate:    r.issued_date,
            certUrl,
            branding,
          });
          const rendered = await applyEmailTemplate({ key: 'open_certificate', fallbackSubject, fallbackHtml, variables: { student_name: r.recipient_name, program_name: r.program_name }, branding, actionUrl: certUrl });
          return { from: FROM, to: r.recipient_email!, subject: rendered.subject, html: rendered.html };
        }));
        await resend.batch.send(messages);
        emailResult.sent += batch.length;
      }
    } catch (e: any) {
      console.error('[open-certificates email]', e);
      return NextResponse.json(
        {
          error: `Certificates were issued, but email sending failed: ${e?.message ?? 'Unknown email error'}`,
          count: inserted?.length ?? 0,
          data: inserted,
          email: { ...emailResult, error: e?.message ?? 'Unknown email error' },
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: true, count: inserted?.length ?? 0, data: inserted, email: emailResult });
}
