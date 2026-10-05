import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { Resend } from 'resend';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { EMAIL_TEMPLATE_DEFINITIONS, getEmailTemplateDefinition } from '@/lib/email-template-registry';
import { getEmailTemplateOverrides, renderEmailTemplatePreview, validateEmailTemplateDraft } from '@/lib/email-template-service';

export const dynamic = 'force-dynamic';

const SAMPLE_VALUES: Record<string, string | number> = {
  student_name: 'Ama Mensah', app_name: 'Learning Platform', cohort_name: 'October Cohort',
  group_name: 'Team Horizon', plan_name: 'Professional Plan', period_start: 'October 4, 2026',
  period_end: 'November 4, 2026', content_title: 'Data Analytics Foundations', content_type: 'course',
  path_title: 'Data Analyst Path', completed_count: 2, in_progress_count: 1, not_started_count: 3,
  overdue_count: 0, days_left: 3, score: 86, feedback: 'Strong work. Your reasoning is clear.',
  assignment_title: 'Customer Churn Analysis', due_text: 'tomorrow', due_date: 'October 5, 2026',
  submitted_by: 'Kofi Boateng', event_title: 'Career Coaching Session', event_date: 'October 8, 2026',
  event_time: '10:00 AM', event_location: 'Online', recording_title: 'Week 4 Live Session', weeks: 'Week 4',
  event_time_display: 'October 8, 2026 at 10:00 AM UTC', reminder_timing: 'tomorrow',
  program_name: 'Data Analytics Programme', currency: 'GHS', amount: '450.00', reference: 'PAY-1024',
  admin_notes: 'The receipt was verified.', duration_months: 3, duration: '3 months', grace_end_date: 'October 11, 2026',
};

const SAMPLE_OVERRIDES: Record<string, Record<string, string | number>> = {
  course_result: { score: 42 },
  payment_confirmation_rejected: { admin_notes: 'Please upload a clearer receipt that shows the reference and amount.' },
};

function sampleFixedDetails(key: string) {
  const details: Record<string, Array<{ label: string; value: string }>> = {
    assignment_due: [{ label: 'Assignment', value: 'Customer Churn Analysis' }, { label: 'Due', value: '5 October 2026' }],
    assignment_graded: [{ label: 'Assignment', value: 'Customer Churn Analysis' }, { label: 'Result', value: 'Passed' }, { label: 'Score', value: '86/100' }],
    inactivity_nudge: [{ label: 'Learning item', value: 'Data Analytics Foundations' }, { label: 'Status', value: 'In progress' }],
    event_confirmation: [{ label: 'When', value: '8 October 2026 at 10:00 AM UTC' }, { label: 'Where', value: 'Online' }],
    event_reminder: [{ label: 'When', value: '8 October 2026 at 10:00 AM UTC' }, { label: 'Where', value: 'Online' }],
    payment_receipt: [{ label: 'Amount', value: 'GHS 450.00' }, { label: 'Reference', value: 'PAY-1024' }],
    payment_request: [{ label: 'Plan', value: 'Professional Plan' }, { label: 'Amount', value: 'GHS 450.00' }, { label: 'Due', value: '5 October 2026' }],
    subscription_activated: [{ label: 'Plan', value: 'Professional Plan' }, { label: 'Access ends', value: '4 November 2026' }],
    subscription_expiring: [{ label: 'Plan', value: 'Professional Plan' }, { label: 'Access ends', value: '4 November 2026' }],
    individual_learner_welcome: [{ label: 'Plan', value: 'Professional Plan' }, { label: 'Payment due', value: 'GHS 450.00 by 5 October 2026' }],
  };
  return details[key] ?? [];
}

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
  const rendered = renderEmailTemplatePreview({
    key: String(body.key || ''), subject: body.subject, body: body.body,
    variables: { ...SAMPLE_VALUES, ...(SAMPLE_OVERRIDES[String(body.key || '')] ?? {}), app_name: settings.appName || SAMPLE_VALUES.app_name },
    branding: settings,
    fixedDetails: sampleFixedDetails(String(body.key || '')),
  });
  if (!('html' in rendered)) return NextResponse.json({ error: rendered.error }, { status: 400 });
  if (body.action === 'preview') return NextResponse.json(rendered);
  if (body.action !== 'test') return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  if (!auth.actor.email) return NextResponse.json({ error: 'Your account does not have an email address.' }, { status: 400 });
  if (!process.env.RESEND_API_KEY) return NextResponse.json({ error: 'Email service is not configured.' }, { status: 503 });
  const from = process.env.RESEND_FROM_EMAIL || `${settings.senderName} <${settings.supportEmail}>`;
  const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
    from, to: auth.actor.email, subject: `[Custom message sample] ${rendered.subject}`, html: rendered.html,
  });
  if (error) return NextResponse.json({ error: 'The test email could not be sent.' }, { status: 502 });
  return NextResponse.json({ ok: true, sentTo: auth.actor.email });
}
