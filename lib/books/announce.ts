import 'server-only';
import { createHash } from 'crypto';
import { Resend } from 'resend';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAllRows } from '@/lib/fetch-all-rows';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { productAnnouncementEmail } from '@/lib/email-templates';
import { applyEmailTemplate } from '@/lib/email-template-service';
import { loadStoreBook } from '@/lib/books/store';

/**
 * Product launch emails (migration 241): one announcement of a digital product to every admitted,
 * active student.
 *
 * Sending is durable: the audience is saved with the announcement, and runAnnouncement works
 * through it, so an interrupted send resumes without emailing anyone twice.
 */

const BATCH = 100;

export interface Recipient { id: string; email: string; name: string }

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

/**
 * Every admitted, active student with a usable email. Admitted means access_state = 'active': an unconfirmed sign-up or a refused
 * applicant also has a students row, and is never emailed. Paged past the API row cap; duplicate
 * addresses are sent once.
 */
export async function announcementAudience(db: SupabaseClient): Promise<{ recipients: Recipient[] }> {
  const rows = await fetchAllRows<{ id: string; email: string | null; full_name: string | null }>(
    (from, to) => db.from('students')
      .select('id, email, full_name', { count: 'exact' })
      .eq('role', 'student').eq('status', 'active').eq('access_state', 'active')
      .order('id').range(from, to) as any,
  );
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const r of rows) {
    const email = (r.email ?? '').trim().toLowerCase();
    if (!EMAIL.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    recipients.push({ id: r.id, email, name: (r.full_name ?? '').trim() });
  }
  return { recipients };
}

/** Stands in for each student's name in the frozen email; replaced per recipient when sending. */
const NAME_TOKEN = '__ANNOUNCE_STUDENT_NAME__';

const escHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export interface FrozenEmail { from: string; subject: string; html: string }

/**
 * The announcement email, rendered once (tenant branding, the admin's template override, the
 * product's title, price line, cover and link as they are now) with a placeholder for the name.
 * Saved with the announcement, so every batch, and any resumed later, sends exactly this.
 */
export async function buildAnnouncementEmail(input: {
  subject: string; message: string; book: { title: string; slug: string; coverUrl: string | null; priceLabel: string };
}): Promise<FrozenEmail> {
  const tenant = await getTenantSettings();
  const appUrl = (tenant.appUrl || process.env.APP_URL || '').replace(/\/$/, '');
  if (!appUrl) throw new Error('Platform App URL is not configured.');
  const branding = {
    appName: tenant.appName, appUrl: tenant.appUrl, logoUrl: tenant.logoUrl,
    emailBannerUrl: tenant.emailBannerUrl, teamName: tenant.teamName,
  };
  const rendered = await applyEmailTemplate({
    key: 'product_announcement',
    fallbackSubject: input.subject,
    fallbackHtml: productAnnouncementEmail({
      name: NAME_TOKEN, bookTitle: input.book.title, priceLabel: input.book.priceLabel, message: input.message,
      coverUrl: input.book.coverUrl ?? undefined, productUrl: `${appUrl}/products/${encodeURIComponent(input.book.slug)}`, branding,
    }),
    variables: { student_name: NAME_TOKEN, book_title: input.book.title },
    branding,
  });
  return {
    from: process.env.RESEND_FROM_EMAIL || `${tenant.senderName} <${tenant.supportEmail}>`,
    subject: rendered.subject,
    html: rendered.html,
  };
}

/** One recipient's copy of the frozen email: only the name differs. */
function personalise(email: FrozenEmail, name: string) {
  return {
    subject: email.subject.split(NAME_TOKEN).join(name.replace(/[\r\n]+/g, ' ')),
    html: email.html.split(NAME_TOKEN).join(escHtml(name)),
  };
}

/**
 * Record an announcement, its frozen email and the people it goes to. It starts as 'preparing' and
 * becomes 'sending' only once its whole list is saved, so a part-saved list is never sent.
 *
 * 'busy' when one is already preparing or sending for the product (a unique index decides), or
 * when another was started in the same ten minutes (the earliest of those goes ahead, the rest are
 * withdrawn, so near-simultaneous requests never both send).
 */
export async function createAnnouncement(
  db: SupabaseClient,
  input: { bookId: string; sentBy: string; subject: string; message: string; recipients: Recipient[]; email: FrozenEmail },
): Promise<{ id: string } | 'busy'> {
  const { data: row, error } = await db.from('book_announcements')
    .insert({
      book_id: input.bookId, sent_by: input.sentBy, subject: input.subject, message: input.message,
      recipients: input.recipients.length, status: 'preparing',
      email_from: input.email.from, email_subject: input.email.subject, email_html: input.email.html,
    })
    .select('id').single();
  if (error) {
    if ((error as any).code === '23505') return 'busy';
    throw error;
  }
  const withdraw = async () => {
    const { error: delError } = await db.from('book_announcements').delete().eq('id', row.id);
    if (delError) console.error('[books/announce] could not withdraw', row.id, delError.message);
  };
  try {
    for (let i = 0; i < input.recipients.length; i += 1000) {
      const { error: listError } = await db.from('book_announcement_recipients').insert(
        input.recipients.slice(i, i + 1000).map(r => ({ announcement_id: row.id, student_id: r.id, email: r.email, name: r.name || null })),
      );
      if (listError) throw listError;
    }
    // Earliest wins among announcements of this product in the last ten minutes.
    const { data: recent, error: recentError } = await db.from('book_announcements').select('id')
      .eq('book_id', input.bookId).gt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
      .order('created_at', { ascending: true }).order('id', { ascending: true }).limit(1);
    if (recentError) throw recentError;
    if (recent?.[0] && recent[0].id !== row.id) { await withdraw(); return 'busy'; }
    const { error: startError } = await db.from('book_announcements').update({ status: 'sending', last_progress_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', 'preparing');
    if (startError) throw startError;
  } catch (e) {
    // Without its full list it must not send; free the product for another try.
    await withdraw();
    throw e;
  }
  return { id: row.id };
}

const RETRIES = 4;
/** The provider keeps an idempotency key for 24 hours; an uncertain batch is only retried inside it. */
const RETRY_WINDOW_MS = 23 * 60 * 60 * 1000;
const isRetryable = (error: any) => {
  const code = Number(error?.statusCode ?? 0);
  return code === 429 || code >= 500 || /rate|timeout|internal/i.test(String(error?.name ?? error?.message ?? ''));
};
// No response at all (a network failure): worth retrying later, not a refusal.
const isNetworkError = (error: any) => error?.statusCode == null && /application_error|fetch|network/i.test(String(error?.name ?? error?.message ?? ''));
// The same key is still being processed by the provider: wait and try again later.
const isStillProcessing = (error: any) => /concurrent_idempotent/i.test(String(error?.name ?? ''));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function failAnnouncement(db: SupabaseClient, announcementId: string, reason: string) {
  await db.from('book_announcements').update({ status: 'failed', error: reason.slice(0, 300) }).eq('id', announcementId);
}

type Row = { student_id: string; email: string; name: string | null; attempted_at?: string | null };

/**
 * Work through an announcement's recipients in batches of 100 until none are left or time runs
 * out. Safe to run again at any point (the hourly sweep resumes a stalled one):
 *   - a batch is marked 'sending' before it is handed over, and its idempotency key is a hash of
 *     exactly who is in it; a batch left 'sending' by a crash is retried with the same key, so the
 *     provider does not deliver it twice, but only inside the provider's 24-hour window: after
 *     that it is marked failed rather than risk a second copy;
 *   - every batch sends the email frozen at creation, and the product is checked before each one,
 *     so taking it off the store stops the rest;
 *   - one bad address fails only itself (permissive batches); rate limits and provider errors are
 *     retried, and a batch that still fails waits for the next run; a refusal stops the send.
 */
export async function runAnnouncement(
  db: SupabaseClient,
  announcementId: string,
  outOfTime: () => boolean = () => false,
): Promise<{ sent: number; done: boolean }> {
  const { data: ann, error: annError } = await db.from('book_announcements')
    .select('id, status, email_from, email_subject, email_html, book_id, books ( slug )')
    .eq('id', announcementId).maybeSingle();
  if (annError) throw annError;
  if (!ann || ann.status !== 'sending') return { sent: 0, done: true };
  const frozen: FrozenEmail = { from: (ann as any).email_from, subject: (ann as any).email_subject, html: (ann as any).email_html };
  if (!frozen.from || !frozen.subject || !frozen.html) {
    await failAnnouncement(db, announcementId, 'The email was not saved with the announcement.');
    return { sent: 0, done: true };
  }
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not configured.');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const mark = async (ids: string[], patch: Record<string, unknown>) => {
    if (!ids.length) return;
    const { error } = await db.from('book_announcement_recipients').update({ ...patch, updated_at: new Date().toISOString() })
      .eq('announcement_id', announcementId).in('student_id', ids);
    if (error) throw error;
  };

  let sent = 0;
  for (;;) {
    if (outOfTime()) return { sent, done: false };

    // Taken off the store since the last batch: its link would no longer work, so stop.
    const slugRow = (Array.isArray((ann as any).books) ? (ann as any).books[0] : (ann as any).books) as { slug: string } | null;
    const { data: current, error: currentError } = await db.from('books').select('slug').eq('id', ann.book_id).maybeSingle();
    if (currentError) throw currentError;
    const slug = (current as any)?.slug ?? slugRow?.slug;
    if (!slug || !(await loadStoreBook(slug, db))) {
      await failAnnouncement(db, announcementId, 'The product is no longer available in the store.');
      return { sent, done: true };
    }

    // A batch handed over before a crash, outcome unknown: retried with the same key inside the
    // provider's window, otherwise marked failed so it is never delivered twice.
    const { data: inflight, error: inflightError } = await db.from('book_announcement_recipients')
      .select('student_id, email, name, attempted_at').eq('announcement_id', announcementId).eq('status', 'sending')
      .order('student_id').limit(BATCH);
    if (inflightError) throw inflightError;
    let batch: Row[];
    if (inflight?.length) {
      const expired = (inflight as Row[]).filter(r => !r.attempted_at || Date.now() - Date.parse(r.attempted_at) > RETRY_WINDOW_MS);
      if (expired.length) {
        await mark(expired.map(r => r.student_id), { status: 'failed', error: 'Not confirmed by the email provider in time; not sent again.' });
        continue;
      }
      batch = inflight as Row[];
    } else {
      const { data: pending, error: pendingError } = await db.from('book_announcement_recipients')
        .select('student_id, email, name').eq('announcement_id', announcementId).eq('status', 'pending')
        .order('student_id').limit(BATCH);
      if (pendingError) throw pendingError;
      if (!pending?.length) break;
      batch = pending as Row[];
      await mark(batch.map(r => r.student_id), { status: 'sending', attempted_at: new Date().toISOString() });
    }

    const emails = batch.map(r => ({ from: frozen.from, to: r.email, ...personalise(frozen, r.name?.trim() || 'there') }));
    const key = `product-announcement/${announcementId}/${createHash('sha256').update(batch.map(r => r.student_id).join(',')).digest('hex').slice(0, 32)}`;
    let result: any = null;
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      result = await resend.batch.send(emails, { idempotencyKey: key, batchValidation: 'permissive' });
      if (!result?.error || !(isRetryable(result.error) || isStillProcessing(result.error)) || attempt === RETRIES) break;
      await sleep(1000 * 2 ** attempt);
    }
    if (result?.error) {
      const e = result.error;
      if (isRetryable(e) || isNetworkError(e) || isStillProcessing(e)) {
        // Outcome unknown or still processing: the batch stays 'sending' and is retried with the
        // same key on the next run (the hourly sweep), inside the provider's window.
        console.error('[books/announce] batch not confirmed, will retry', announcementId, e?.message ?? e);
        return { sent, done: false };
      }
      // A refusal (bad key, unverified sender, the same key with different content): nothing in
      // this batch was sent. Put it back and stop, showing why.
      await mark(batch.map(r => r.student_id), { status: 'pending' });
      await failAnnouncement(db, announcementId, String(e?.message ?? 'The email provider refused the send.'));
      return { sent, done: true };
    }

    const bad = new Map<number, string>(((result.data?.errors ?? []) as { index: number; message: string }[]).map(x => [x.index, x.message]));
    const okIds = batch.filter((_, i) => !bad.has(i)).map(r => r.student_id);
    await mark(okIds, { status: 'sent' });
    for (const [i, message] of bad) {
      const { error: markError } = await db.from('book_announcement_recipients')
        .update({ status: 'failed', error: message.slice(0, 300), updated_at: new Date().toISOString() })
        .eq('announcement_id', announcementId).eq('student_id', batch[i].student_id);
      if (markError) throw markError;
    }
    sent += okIds.length;
    await refreshCounts(db, announcementId, false);
    await sleep(600); // stay under the provider's request rate
  }
  await refreshCounts(db, announcementId, true);
  return { sent, done: true };
}

/** The announcement's sent and failed counts from its recipients; finished when nothing is left. */
async function refreshCounts(db: SupabaseClient, announcementId: string, finished: boolean) {
  const count = async (status: string) => {
    const { count: n, error } = await db.from('book_announcement_recipients').select('student_id', { count: 'exact', head: true })
      .eq('announcement_id', announcementId).eq('status', status);
    if (error) throw error;
    return n ?? 0;
  };
  const [sentCount, failedCount] = await Promise.all([count('sent'), count('failed')]);
  await db.from('book_announcements').update({
    sent: sentCount, failed: failedCount, last_progress_at: new Date().toISOString(),
    ...(finished ? { status: 'sent' } : {}),
  }).eq('id', announcementId);
}

/**
 * Hourly: resume announcements that stopped making progress (a send cut off by a time limit, a
 * crash, or a provider outage). Recipients never handed over are always safe to send; a batch whose
 * outcome is unknown is retried only inside the provider's 24-hour window (runAnnouncement). One
 * older than two days is given up and marked failed.
 */
export async function resumeStalledAnnouncements(db: SupabaseClient, outOfTime: () => boolean): Promise<{ resumed: number }> {
  const { data, error } = await db.from('book_announcements').select('id, created_at')
    .eq('status', 'sending').lt('last_progress_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
    .order('last_progress_at').limit(5);
  if (error) throw error;
  // A list that never finished saving (a crash while preparing): withdrawn, so the product is free.
  await db.from('book_announcements').delete().eq('status', 'preparing')
    .lt('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
  let resumed = 0;
  for (const row of (data ?? []) as { id: string; created_at: string }[]) {
    if (outOfTime()) break;
    if (Date.now() - Date.parse(row.created_at) > 2 * 86_400_000) {
      await failAnnouncement(db, row.id, 'Stopped after two days without finishing.');
      continue;
    }
    try {
      await runAnnouncement(db, row.id, outOfTime);
      resumed++;
    } catch (e: any) {
      console.error('[books/announce] resume failed', row.id, e?.message ?? e);
    }
  }
  return { resumed };
}
