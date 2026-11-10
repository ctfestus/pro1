/**
 * The receipt a book buyer gets once their payment is confirmed. Idempotent per purchase:
 * receipt_email_sent_at is the permanent guard, and the Resend idempotency key covers a crash
 * between sending and stamping (same order as notify-subscription-activated: send, then stamp).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { bookFreeDownloadEmail, bookPurchaseEmail } from '@/lib/email-templates';
import { applyEmailTemplate, formatEmailDate } from '@/lib/email-template-service';
import { guestAccessPath } from '@/lib/books/guest-access';

const resend = new Resend(process.env.RESEND_API_KEY);

async function stamp(db: SupabaseClient, purchaseId: string) {
  const { error } = await db.from('book_purchases')
    .update({ receipt_email_sent_at: new Date().toISOString() })
    .eq('id', purchaseId)
    .is('receipt_email_sent_at', null);
  if (error) throw error;
}

interface GuestPurchaseRow {
  id: string;
  book_title: string;
  amount: number | string;
  currency: string;
  paystack_reference: string;
  paid_at: string | null;
  guest_email: string | null;
  guest_name?: string | null;
  guest_access_expires_at: string | null;
  kind?: string | null;
}

/** The receipt for a guest purchase, sent to the email it was bought with, linking to its download page. */
async function sendGuestEmail(purchase: GuestPurchaseRow, idempotencyKey: string): Promise<void> {
  if (!purchase.guest_email) throw new Error('Guest purchase has no email.');
  const tenant = await getTenantSettings();
  const appUrl = (tenant.appUrl || process.env.APP_URL || '').replace(/\/$/, '');
  if (!appUrl) throw new Error('Platform App URL is not configured.');
  const branding = {
    appName: tenant.appName, appUrl: tenant.appUrl, logoUrl: tenant.logoUrl,
    emailBannerUrl: tenant.emailBannerUrl, teamName: tenant.teamName,
  };
  const name = purchase.guest_name?.trim() || 'there';
  const paidAt = formatEmailDate(purchase.paid_at ?? new Date().toISOString());
  const until = formatEmailDate(purchase.guest_access_expires_at ?? new Date().toISOString());
  const amount = Number(purchase.amount);
  const downloadUrl = `${appUrl}${guestAccessPath(purchase.id)}`;
  const rendered = purchase.kind === 'free_claim'
    ? await applyEmailTemplate({
      key: 'book_free_download',
      fallbackSubject: `Your free download: ${purchase.book_title}`,
      fallbackHtml: bookFreeDownloadEmail({ name, bookTitle: purchase.book_title, downloadUrl, until, branding }),
      variables: { student_name: name, book_title: purchase.book_title },
      branding,
    })
    : await applyEmailTemplate({
    key: 'book_purchase',
    fallbackSubject: `Your purchase: ${purchase.book_title}`,
    fallbackHtml: bookPurchaseEmail({
      name, bookTitle: purchase.book_title, amount, currency: purchase.currency, paidAt,
      reference: purchase.paystack_reference, libraryUrl: downloadUrl, guestUntil: until, branding,
    }),
    variables: {
      student_name: name, book_title: purchase.book_title, currency: purchase.currency,
      amount: amount.toFixed(2), reference: purchase.paystack_reference, payment_date: paidAt,
    },
    branding,
  });
  const { error: sendError } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`,
    to: purchase.guest_email,
    subject: rendered.subject,
    html: rendered.html,
  }, { idempotencyKey });
  if (sendError) throw new Error(sendError.message);
}

/**
 * Send a guest their download link again ("Lost your link?"). Only for a paid purchase still inside
 * its allowance; the link is the same one as before and the allowance is not touched. The caller
 * rate-limits; the idempotency key collapses repeats within the same hour.
 */
export async function resendGuestAccessEmail(db: SupabaseClient, purchaseId: string): Promise<{ sent: boolean }> {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const { data: purchase, error } = await db
    .from('book_purchases')
    .select('id, book_title, amount, currency, paystack_reference, status, paid_at, is_guest, guest_email, guest_name, guest_access_expires_at, kind')
    .eq('id', purchaseId)
    .maybeSingle();
  if (error) throw error;
  if (!purchase || !purchase.is_guest || purchase.status !== 'paid') return { sent: false };
  if (!purchase.guest_access_expires_at || Date.parse(purchase.guest_access_expires_at) <= Date.now()) return { sent: false };
  const hour = Math.floor(Date.now() / 3_600_000);
  await sendGuestEmail(purchase as GuestPurchaseRow, `book-guest-resend/${purchase.id}/${hour}`);
  return { sent: true };
}

export async function sendBookPurchaseReceipt(db: SupabaseClient, purchaseId: string): Promise<{ sent: boolean }> {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');

  const { data: purchase, error } = await db
    .from('book_purchases')
    .select('id, student_id, book_title, amount, currency, paystack_reference, status, paid_at, receipt_email_sent_at, is_guest, guest_email, guest_name, guest_access_expires_at, kind, students ( email, full_name )')
    .eq('id', purchaseId)
    .maybeSingle();
  if (error) throw error;
  if (!purchase || purchase.status !== 'paid' || purchase.receipt_email_sent_at) return { sent: false };
  if (purchase.is_guest) {
    // Same order and idempotency key as below: a send interrupted before the stamp is retried by the
    // sweep with the identical link (guestAccessToken is deterministic), so nothing is invalidated.
    await sendGuestEmail(purchase as GuestPurchaseRow, `book-purchase/${purchase.id}`);
    await stamp(db, purchase.id);
    return { sent: true };
  }

  const student = (Array.isArray(purchase.students) ? purchase.students[0] : purchase.students) as
    { email?: string | null; full_name?: string | null } | null;
  if (!purchase.student_id || !student?.email) {
    await stamp(db, purchase.id);
    return { sent: false };
  }

  const tenant = await getTenantSettings();
  const appUrl = (tenant.appUrl || process.env.APP_URL || '').replace(/\/$/, '');
  if (!appUrl) throw new Error('Platform App URL is not configured.');
  const branding = {
    appName: tenant.appName, appUrl: tenant.appUrl, logoUrl: tenant.logoUrl,
    emailBannerUrl: tenant.emailBannerUrl, teamName: tenant.teamName,
  };
  const name = student.full_name || 'there';
  const paidAt = formatEmailDate(purchase.paid_at ?? new Date().toISOString());
  const amount = Number(purchase.amount);

  const rendered = await applyEmailTemplate({
    key: 'book_purchase',
    fallbackSubject: `Your purchase: ${purchase.book_title}`,
    fallbackHtml: bookPurchaseEmail({
      name, bookTitle: purchase.book_title, amount, currency: purchase.currency, paidAt,
      reference: purchase.paystack_reference, libraryUrl: `${appUrl}/student#products`, branding,
    }),
    variables: {
      student_name: name, book_title: purchase.book_title, currency: purchase.currency,
      amount: amount.toFixed(2), reference: purchase.paystack_reference, payment_date: paidAt,
    },
    branding,
  });

  const { error: sendError } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`,
    to: student.email,
    subject: rendered.subject,
    html: rendered.html,
  }, { idempotencyKey: `book-purchase/${purchase.id}` });
  if (sendError) throw new Error(sendError.message);

  await stamp(db, purchase.id);
  return { sent: true };
}
