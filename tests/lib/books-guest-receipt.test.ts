// Guest receipts (migration 238): the email carries a link the server can always rebuild, so a
// retried or resent email is identical and never adds downloads or resets the seven days.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeSupabaseStub } from '../helpers/supabaseStub';

const sent = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { emails = { send: sent.send }; } }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: async () => ({ appName: 'Tenant', appUrl: 'https://app.test', logoUrl: '', emailBannerUrl: '', teamName: 'Team', senderName: 'Tenant', supportEmail: 'help@app.test' }),
}));
vi.mock('@/lib/email-template-service', () => ({
  applyEmailTemplate: async (i: any) => ({ subject: i.fallbackSubject, html: i.fallbackHtml, customized: false }),
  formatEmailDate: (iso: string) => iso.slice(0, 10),
}));

import { resendGuestAccessEmail, sendBookPurchaseReceipt } from '@/lib/books/receipt-email';
import { guestAccessToken } from '@/lib/books/guest-access';

const PURCHASE = '33333333-3333-4333-8333-333333333333';
const guestRow = (extra: Record<string, unknown> = {}) => ({
  id: PURCHASE, student_id: null, book_title: 'Field Guide', amount: '120.00', currency: 'GHS', paystack_reference: 'book-1',
  status: 'paid', paid_at: '2026-11-10T10:00:00Z', receipt_email_sent_at: null, is_guest: true, guest_email: 'buyer@example.test', guest_name: 'Ama Mensah',
  guest_access_expires_at: new Date(Date.now() + 86_400_000).toISOString(), students: null, ...extra,
});

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.BOOK_GUEST_ACCESS_SECRET = 'guest-test-secret';
  sent.send.mockReset().mockResolvedValue({ error: null });
});

describe('guest receipt', () => {
  it('goes to the email the product was bought with, linking to the download page (never the file)', async () => {
    const db = makeSupabaseStub({ book_purchases: { data: guestRow() } });
    expect(await sendBookPurchaseReceipt(db as any, PURCHASE)).toEqual({ sent: true });
    const [msg, opts] = sent.send.mock.calls[0];
    expect(msg.to).toBe('buyer@example.test');
    expect(msg.html).toContain(`https://app.test/products/download?access=${encodeURIComponent(guestAccessToken(PURCHASE))}`);
    expect(msg.html).not.toContain('storage');
    expect(msg.html).toContain('up to 5 downloads');
    expect(msg.html).toContain('Hi Ama Mensah');
    expect(opts).toEqual({ idempotencyKey: `book-purchase/${PURCHASE}` });
  });

  it('an interrupted send (sent, then the stamp failed) is retried with the identical email', async () => {
    const failingStamp = makeSupabaseStub({ book_purchases: [{ data: guestRow() }, { error: { message: 'db down' } }] });
    await expect(sendBookPurchaseReceipt(failingStamp as any, PURCHASE)).rejects.toBeTruthy();
    const retry = makeSupabaseStub({ book_purchases: { data: guestRow() } });
    await sendBookPurchaseReceipt(retry as any, PURCHASE);
    expect(sent.send).toHaveBeenCalledTimes(2);
    const [first, second] = sent.send.mock.calls;
    expect(second[0].html).toBe(first[0].html);
    expect(second[1]).toEqual(first[1]);
  });

  it('is not sent twice once stamped, nor for a purchase that is not paid', async () => {
    for (const extra of [{ receipt_email_sent_at: '2026-11-10T10:01:00Z' }, { status: 'refunded' }, { status: 'pending' }]) {
      const db = makeSupabaseStub({ book_purchases: { data: guestRow(extra) } });
      expect(await sendBookPurchaseReceipt(db as any, PURCHASE)).toEqual({ sent: false });
    }
    expect(sent.send).not.toHaveBeenCalled();
  });
});

describe('free claim email', () => {
  it('says it is free, carries no price, and links to the download page', async () => {
    const db = makeSupabaseStub({ book_purchases: { data: guestRow({ kind: 'free_claim', amount: 0, currency: 'XXX', paystack_reference: 'free-1' }) } });
    await sendBookPurchaseReceipt(db as any, PURCHASE);
    const [msg] = sent.send.mock.calls[0];
    expect(msg.subject).toBe('Your free download: Field Guide');
    expect(msg.html).toContain('free copy');
    expect(msg.html).not.toContain('XXX');
    expect(msg.html).toContain(`/products/download?access=${encodeURIComponent(guestAccessToken(PURCHASE))}`);
  });
});

describe('resending the link', () => {
  it('sends the same link again and writes nothing (no new downloads, no new seven days)', async () => {
    const db = makeSupabaseStub({ book_purchases: { data: guestRow({ receipt_email_sent_at: '2026-11-10T10:01:00Z' }) } });
    const writes = vi.spyOn(db, 'rpc');
    await resendGuestAccessEmail(db as any, PURCHASE);
    await resendGuestAccessEmail(db as any, PURCHASE);
    expect(sent.send).toHaveBeenCalledTimes(2);
    const [a, b] = sent.send.mock.calls;
    expect(b[0].html).toBe(a[0].html);
    // Repeats within the hour collapse to one email at the provider.
    expect(b[1]).toEqual(a[1]);
    expect(a[1].idempotencyKey).toMatch(new RegExp(`^book-guest-resend/${PURCHASE}/\\d+$`));
    expect(writes).not.toHaveBeenCalled();
  });

  it.each([
    ['refunded', { status: 'refunded' }],
    ['past its seven days', { guest_access_expires_at: new Date(Date.now() - 1000).toISOString() }],
    ['a signed-in purchase', { is_guest: false }],
  ])('sends nothing for a purchase that is %s', async (_label, extra) => {
    const db = makeSupabaseStub({ book_purchases: { data: guestRow(extra) } });
    expect(await resendGuestAccessEmail(db as any, PURCHASE)).toEqual({ sent: false });
    expect(sent.send).not.toHaveBeenCalled();
  });
});
