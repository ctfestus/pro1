import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { absolutePath, normalizeAbsoluteBaseUrl } from '@/lib/public-url';

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character] ?? character));
}

async function settings(preferredBaseUrl?: string) {
  const tenant = await getTenantSettings();
  const from = process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`.trim();
  const appUrl = normalizeAbsoluteBaseUrl(preferredBaseUrl, tenant.appUrl, process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL);
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  if (!from || from === '<>') throw new Error('RESEND_FROM_EMAIL or platform sender settings are not configured.');
  if (!appUrl) throw new Error('The platform application URL is not configured.');
  return { tenant, from, appUrl };
}

function frame(tenant: Awaited<ReturnType<typeof getTenantSettings>>, title: string, body: string): string {
  const appName = escapeHtml(tenant.appName || 'the platform');
  const banner = tenant.emailBannerUrl
    ? `<img src="${escapeHtml(tenant.emailBannerUrl)}" alt="${appName}" width="600" style="width:100%;height:auto;display:block">`
    : tenant.logoUrl
      ? `<div style="padding:24px 30px 0"><img src="${escapeHtml(tenant.logoUrl)}" alt="${appName}" style="height:48px;width:auto;display:block;object-fit:contain"></div>`
      : '';
  return `<!doctype html><html><body style="margin:0;background:#f2f5fa;font-family:Arial,sans-serif;color:#111"><div style="max-width:620px;margin:0 auto;padding:32px 18px"><div style="background:#fff;border-radius:18px;overflow:hidden">${banner}<div style="padding:30px"><p style="margin:0 0 18px;font-size:13px;color:#64748b">${appName}</p><h1 style="font-size:22px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}</div></div></div></body></html>`;
}

function linkButton(url: string, label: string, brandColor: string): string {
  const color = /^#[0-9a-f]{6}$/i.test(brandColor) ? brandColor : '#00bf63';
  return `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">${escapeHtml(label)}</a></p><p style="font-size:12px;color:#64748b;word-break:break-all">${escapeHtml(url)}</p>`;
}

export async function sendApplicationConfirmationEmail(input: {
  email: string;
  formTitle: string;
  reference: string;
  token: string;
  confirmationMessage: string;
  baseUrl?: string;
}): Promise<void> {
  const { tenant, from, appUrl } = await settings(input.baseUrl);
  const url = absolutePath(appUrl, `/applications/${encodeURIComponent(input.token)}`);
  const title = `Application received: ${input.formTitle}`;
  const body = `<p style="font-size:15px;line-height:1.65">${escapeHtml(input.confirmationMessage)}</p><p style="font-size:15px"><strong>Reference:</strong> ${escapeHtml(input.reference)}</p>${linkButton(url, 'Check application status', tenant.brandColor)}`;
  const { error } = await resend.emails.send({
    from, to: input.email, subject: title, html: frame(tenant, title, body),
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
  baseUrl?: string;
}): Promise<void> {
  const { tenant, from, appUrl } = await settings(input.baseUrl);
  const url = absolutePath(appUrl, `/applications/${encodeURIComponent(input.token)}`);
  const body = `<p style="font-size:15px;line-height:1.65;white-space:pre-line">${escapeHtml(input.body)}</p>${linkButton(url, 'View application status', tenant.brandColor)}`;
  const { error } = await resend.emails.send(
    { from, to: input.email, subject: input.subject, html: frame(tenant, input.subject, body) },
    { idempotencyKey: `application-message/${input.messageId}` },
  );
  if (error) throw new Error(error.message || 'Could not send application message.');
}
