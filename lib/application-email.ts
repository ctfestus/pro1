import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character] ?? character));
}

async function settings() {
  const tenant = await getTenantSettings();
  const from = process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`.trim();
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  if (!from || from === '<>') throw new Error('RESEND_FROM_EMAIL or platform sender settings are not configured.');
  if (!tenant.appUrl) throw new Error('The platform application URL is not configured.');
  return { tenant, from };
}

function frame(appName: string, title: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f2f5fa;font-family:Arial,sans-serif;color:#111"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border-radius:18px;padding:30px"><p style="margin:0 0 18px;font-size:13px;color:#64748b">${escapeHtml(appName)}</p><h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}</div></div></body></html>`;
}

function linkButton(url: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:#00bf63;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">${escapeHtml(label)}</a></p><p style="font-size:12px;color:#64748b;word-break:break-all">${escapeHtml(url)}</p>`;
}

export async function sendApplicationAccessEmail(input: {
  email: string;
  formTitle: string;
  token: string;
  existing: boolean;
}): Promise<void> {
  const { tenant, from } = await settings();
  const url = `${tenant.appUrl}/applications/${encodeURIComponent(input.token)}`;
  const title = input.existing ? `Continue: ${input.formTitle}` : `Your application link: ${input.formTitle}`;
  const body = `<p style="font-size:15px;line-height:1.65">Use the secure link below to complete, save, submit, or check this application. Keep this link private.</p>${linkButton(url, input.existing ? 'Open application' : 'Start application')}`;
  const { error } = await resend.emails.send({ from, to: input.email, subject: title, html: frame(tenant.appName, title, body) });
  if (error) throw new Error(error.message || 'Could not send application access email.');
}

export async function sendApplicationConfirmationEmail(input: {
  email: string;
  formTitle: string;
  reference: string;
  token: string;
  confirmationMessage: string;
}): Promise<void> {
  const { tenant, from } = await settings();
  const url = `${tenant.appUrl}/applications/${encodeURIComponent(input.token)}`;
  const title = `Application received: ${input.formTitle}`;
  const body = `<p style="font-size:15px;line-height:1.65">${escapeHtml(input.confirmationMessage)}</p><p style="font-size:15px"><strong>Reference:</strong> ${escapeHtml(input.reference)}</p>${linkButton(url, 'Check application status')}`;
  const { error } = await resend.emails.send({
    from, to: input.email, subject: title, html: frame(tenant.appName, title, body),
    headers: { 'X-Entity-Ref-ID': input.reference },
  });
  if (error) throw new Error(error.message || 'Could not send application confirmation email.');
}

export async function sendApplicationDecisionEmail(input: {
  email: string;
  subject: string;
  body: string;
  token: string;
  messageId: string;
}): Promise<void> {
  const { tenant, from } = await settings();
  const url = `${tenant.appUrl}/applications/${encodeURIComponent(input.token)}`;
  const body = `<p style="font-size:15px;line-height:1.65;white-space:pre-line">${escapeHtml(input.body)}</p>${linkButton(url, 'View application status')}`;
  const { error } = await resend.emails.send(
    { from, to: input.email, subject: input.subject, html: frame(tenant.appName, input.subject, body) },
    { idempotencyKey: `application-message/${input.messageId}` },
  );
  if (error) throw new Error(error.message || 'Could not send application message.');
}
