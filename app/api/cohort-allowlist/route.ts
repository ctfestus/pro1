/**
 * GET  ?email=EMAIL       -- public, check if email is on any allowlist
 * GET  ?cohortId=UUID     -- admin-auth, list all emails for a cohort
 * POST                    -- admin-auth, add emails to a cohort allowlist
 * DELETE                  -- admin-auth, remove an email entry by id
 */
import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { cohortInviteEmail } from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { applyEmailTemplate } from '@/lib/email-template-service';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const email    = searchParams.get('email');
  const cohortId = searchParams.get('cohortId');

  // --- Public: check if an email is allowed ---
  if (email) {
    const { data } = await adminClient()
      .from('cohort_allowed_emails')
      .select('cohort_id, cohorts(name)')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (!data) return NextResponse.json({ allowed: false });
    return NextResponse.json({
      allowed: true,
      cohortId: data.cohort_id,
      cohortName: (data.cohorts as any)?.name ?? '',
    });
  }

  // --- Admin: list emails for a cohort ---
  if (cohortId) {
    const auth = await requireRole(req, ['admin', 'instructor']);
    if (isAuthError(auth)) return auth.error;

    const { data } = await adminClient()
      .from('cohort_allowed_emails')
      .select('id, email, created_at')
      .eq('cohort_id', cohortId)
      .order('email');

    return NextResponse.json({ emails: data ?? [] });
  }

  return NextResponse.json({ error: 'Missing email or cohortId param' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { user } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { cohortId, emails } = body;
  if (!cohortId || !Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json({ error: 'cohortId and emails[] are required' }, { status: 400 });
  }

  const normalised = emails
    .map((e: string) => e.toLowerCase().trim())
    .filter((e: string) => e.includes('@'));

  if (normalised.length === 0) {
    return NextResponse.json({ error: 'No valid emails provided' }, { status: 400 });
  }

  // Single bulk query -- exclude emails already registered as students
  const { data: existing } = await adminClient()
    .from('students')
    .select('email')
    .in('email', normalised);
  const registeredSet = new Set((existing ?? []).map((s: { email: string }) => s.email));
  const skipped = normalised.filter(e => registeredSet.has(e));

  const rows = normalised
    .filter(e => !registeredSet.has(e))
    .map((email: string) => ({ cohort_id: cohortId, email, added_by: user.id }));

  if (rows.length === 0) {
    return NextResponse.json({
      error: skipped.length
        ? `All emails are already registered students: ${skipped.join(', ')}`
        : 'No valid emails provided',
    }, { status: 400 });
  }

  let data: any, error: any;
  const insert = await adminClient()
    .from('cohort_allowed_emails')
    .insert(rows)
    .select('id, email, created_at');

  if (insert.error) {
    const upsert = await adminClient()
      .from('cohort_allowed_emails')
      .upsert(rows, { onConflict: 'email', ignoreDuplicates: true })
      .select('id, email, created_at');
    data = upsert.data;
    error = upsert.error;
  } else {
    data = insert.data;
    error = insert.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Fire-and-forget invitation emails
  const inserted: { email: string }[] = data ?? [];
  if (inserted.length > 0) {
    (async () => {
      try {
        const [{ data: cohort }, t] = await Promise.all([
          adminClient().from('cohorts').select('name').eq('id', cohortId).maybeSingle(),
          getTenantSettings(),
        ]);
        const cohortName = cohort?.name ?? 'your cohort';
        const signupUrl  = process.env.APP_URL || t.appUrl || '';
        const FROM       = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
        const branding   = { appName: t.appName, appUrl: signupUrl, logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName };

        const messages = await Promise.all(inserted.map(async ({ email }) => {
          const fallbackSubject = `You've been invited to join ${t.appName || cohortName}`;
          const fallbackHtml = cohortInviteEmail({ cohortName, signupUrl, branding });
          const rendered = await applyEmailTemplate({ key: 'cohort_invite', fallbackSubject, fallbackHtml, variables: { student_name: 'there', cohort_name: cohortName, app_name: t.appName }, branding, actionUrl: signupUrl });
          return { from: FROM, to: email, subject: rendered.subject, html: rendered.html };
        }));
        await resend.batch.send(messages);
      } catch {
        // non-blocking -- ignore email errors
      }
    })();
  }

  return NextResponse.json({ inserted, skipped });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { id } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await adminClient()
    .from('cohort_allowed_emails')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
