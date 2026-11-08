/**
 * The receipt a book buyer gets once their payment is confirmed. Idempotent per purchase:
 * receipt_email_sent_at is the permanent guard, and the Resend idempotency key covers a crash
 * between sending and stamping (same order as notify-subscription-activated: send, then stamp).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { bookPurchaseEmail } from '@/lib/email-templates';
import { applyEmailTemplate, formatEmailDate } from '@/lib/email-template-service';

const resend = new Resend(process.env.RESEND_API_KEY);

async function stamp(db: SupabaseClient, purchaseId: string) {
  const { error } = await db.from('book_purchases')
    .update({ receipt_email_sent_at: new Date().toISOString() })
    .eq('id', purchaseId)
    .is('receipt_email_sent_at', null);
  if (error) throw error;
}

export async function sendBookPurchaseReceipt(db: SupabaseClient, purchaseId: string): Promise<{ sent: boolean }> {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');

  const { data: purchase, error } = await db
    .from('book_purchases')
    .select('id, student_id, book_title, amount, currency, paystack_reference, status, paid_at, receipt_email_sent_at, students ( email, full_name )')
    .eq('id', purchaseId)
    .maybeSingle();
  if (error) throw error;
  if (!purchase || purchase.status !== 'paid' || purchase.receipt_email_sent_at) return { sent: false };

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
    fallbackSubject: `Your book: ${purchase.book_title}`,
    fallbackHtml: bookPurchaseEmail({
      name, bookTitle: purchase.book_title, amount, currency: purchase.currency, paidAt,
      reference: purchase.paystack_reference, libraryUrl: `${appUrl}/student#books`, branding,
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
