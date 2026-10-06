import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { Resend } from 'resend';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { EMAIL_TEMPLATE_DEFINITIONS, getEmailTemplateDefinition, type EmailTemplateKey } from '@/lib/email-template-registry';
import { getEmailTemplateOverrides, renderEmailTemplatePreview, validateEmailTemplateDraft } from '@/lib/email-template-service';
import { buildEmailTemplateSample } from '@/lib/email-template-preview';

export const dynamic = 'force-dynamic';

async function staff(req: NextRequest) {
  return requireRole(req, ['admin', 'instructor']);
}

export async function GET(req: NextRequest) {
  const auth = await staff(req);
  if (isAuthError(auth)) return auth.error;
  const [overrides, historyResult] = await Promise.all([
    getEmailTemplateOverrides(),
    auth.serviceDb.from('email_template_history')
      .select('id, template_key, subject_template, body_template, action, changed_at, changed_by, students!email_template_history_changed_by_fkey(full_name, email)')
      .order('changed_at', { ascending: false })
      .limit(100),
  ]);
  if (historyResult.error) console.error('[email-templates] history read failed', historyResult.error);
  return NextResponse.json({ definitions: EMAIL_TEMPLATE_DEFINITIONS, overrides, history: historyResult.data ?? [] });
}

export async function PUT(req: NextRequest) {
  const auth = await staff(req);
  if (isAuthError(auth)) return auth.error;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const key = String(body.key || '');
  const checked = validateEmailTemplateDraft(key, body.subject, body.body);
  if ('error' in checked) return NextResponse.json({ error: checked.error }, { status: 400 });

  const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null;
  const { data: result, error: saveError } = await auth.serviceDb.rpc('save_email_template_override', {
    p_template_key: key, p_subject_template: checked.subject, p_body_template: checked.body,
    p_actor_id: auth.actor.id, p_expected_updated_at: expected, p_reset: false,
  });
  if (saveError) {
    console.error('[email-templates] save failed', saveError);
    return NextResponse.json({ error: 'Could not save the email template.' }, { status: 500 });
  }
  if ((result as any)?.status === 'conflict') return NextResponse.json({ error: 'This template was changed by someone else. Reload it before saving.' }, { status: 409 });
  revalidateTag('email-template-overrides');
  return NextResponse.json({ ok: true, template: (result as any)?.template });
}

export async function DELETE(req: NextRequest) {
  const auth = await staff(req);
  if (isAuthError(auth)) return auth.error;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const key = String(body.key || '');
  const definition = getEmailTemplateDefinition(key);
  if (!definition) return NextResponse.json({ error: 'Unknown email template.' }, { status: 400 });
  const expected = typeof body.expectedUpdatedAt === 'string' ? body.expectedUpdatedAt : null;
  const { data: result, error } = await auth.serviceDb.rpc('save_email_template_override', {
    p_template_key: key, p_subject_template: '', p_body_template: '',
    p_actor_id: auth.actor.id, p_expected_updated_at: expected, p_reset: true,
  });
  if (error) return NextResponse.json({ error: 'Could not reset the email template.' }, { status: 500 });
  if ((result as any)?.status === 'conflict') return NextResponse.json({ error: 'This template was changed by someone else. Reload it before resetting.' }, { status: 409 });
  revalidateTag('email-template-overrides');
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const auth = await staff(req);
  if (isAuthError(auth)) return auth.error;
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }
  const settings = await getTenantSettings();
  const key = String(body.key || '');
  if (!getEmailTemplateDefinition(key)) return NextResponse.json({ error: 'Unknown email template.' }, { status: 400 });
  const sample = buildEmailTemplateSample(key as EmailTemplateKey, settings);
  const rendered = renderEmailTemplatePreview({
    key, subject: body.subject, body: body.body,
    fallbackSubject: sample.subject, fallbackHtml: sample.html,
    variables: sample.variables,
    branding: settings,
  });
  if (!('html' in rendered)) return NextResponse.json({ error: rendered.error }, { status: 400 });
  if (body.action === 'preview') return NextResponse.json(rendered);
  if (body.action !== 'test') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (!auth.actor.email) return NextResponse.json({ error: 'Your account does not have an email address.' }, { status: 400 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email service is not configured.' }, { status: 503 });
  const from = process.env.RESEND_FROM_EMAIL || `${settings.senderName} <${settings.supportEmail}>`;
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from, to: auth.actor.email, subject: `[Email sample] ${rendered.subject}`, html: rendered.html,
  });
  if (error) return NextResponse.json({ error: 'The test email could not be sent.' }, { status: 502 });
  return NextResponse.json({ ok: true, sentTo: auth.actor.email });
}
