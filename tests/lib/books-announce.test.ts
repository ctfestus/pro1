// Product launch emails (migration 241): the audience, and durable, resumable sending.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const sent = vi.hoisted(() => ({ batch: vi.fn() }));
vi.mock('resend', () => ({ Resend: class { batch = { send: sent.batch }; } }));
vi.mock('@/lib/get-tenant-settings', () => ({
  getTenantSettings: async () => ({ appName: 'Tenant', appUrl: 'https://learn.example.test', logoUrl: '', emailBannerUrl: '', teamName: 'Team', senderName: 'Tenant', supportEmail: 'help@learn.example.test' }),
}));
vi.mock('@/lib/email-template-service', () => ({
  applyEmailTemplate: async (i: any) => ({ subject: `${i.fallbackSubject}`, html: i.fallbackHtml, customized: false }),
}));
const store = vi.hoisted(() => ({ live: true as boolean }));
vi.mock('@/lib/books/store', () => ({ loadStoreBook: async () => (store.live ? { free: false, prices: [{ currency: 'GHS', amount: 120 }] } : null) }));

import { announcementAudience, buildAnnouncementEmail, createAnnouncement, runAnnouncement } from '@/lib/books/announce';
import { productAnnouncementEmail } from '@/lib/email-templates';
import { makeSupabaseStub } from '../helpers/supabaseStub';

/**
 * A small in-memory model of the two announcement tables, so sending can be run, interrupted and
 * resumed as it would be against the database.
 */
function fakeDb(recipients: { student_id: string; email: string; name: string | null }[]) {
  const ann: any = {
    id: 'a1', status: 'sending', book_id: 'b1', books: { slug: 'guide-1a2b' }, sent: 0, failed: 0,
    email_from: 'Tenant <help@learn.example.test>', email_subject: 'New: Guide for __ANNOUNCE_STUDENT_NAME__',
    email_html: '<p>Hi __ANNOUNCE_STUDENT_NAME__,</p><p>GHS 120</p>',
  };
  const rows = recipients.map(r => ({ ...r, announcement_id: 'a1', status: 'pending', error: null as string | null, attempted_at: null as string | null }));
  const query = (table: string) => {
    const f: { col: string; op: string; val: any }[] = [];
    let patch: any = null;
    let limit = Infinity;
    let head = false;
    const match = (r: any) => f.every(({ col, op, val }) => (op === 'eq' ? r[col] === val : op === 'in' ? val.includes(r[col]) : true));
    const q: any = {
      select: (_c: string, o?: any) => { head = !!o?.head; return q; },
      update: (p: any) => { patch = p; return q; },
      eq: (col: string, val: any) => { f.push({ col, op: 'eq', val }); return q; },
      in: (col: string, val: any) => { f.push({ col, op: 'in', val }); return q; },
      order: () => q,
      limit: (n: number) => { limit = n; return q; },
      maybeSingle: () => q,
      then: (res: any, rej: any) => Promise.resolve((() => {
        if (table === 'books') return { data: { slug: 'guide-1a2b' }, error: null };
        if (table === 'book_announcements') {
          if (patch) { Object.assign(ann, patch); return { data: null, error: null }; }
          return { data: ann, error: null };
        }
        const hit = rows.filter(match);
        if (patch) { hit.forEach(r => Object.assign(r, patch)); return { data: null, error: null }; }
        if (head) return { data: null, count: hit.length, error: null };
        return { data: hit.slice(0, limit), error: null };
      })()).then(res, rej),
    };
    return q;
  };
  return { db: { from: query } as any, ann, rows };
}

const people = (n: number) => Array.from({ length: n }, (_, i) => ({ student_id: `s${String(i).padStart(4, '0')}`, email: `s${i}@x.test`, name: i ? `S${i}` : null }));

beforeEach(() => {
  store.live = true;
  process.env.RESEND_API_KEY = 're_test';
  sent.batch.mockReset().mockResolvedValue({ data: { data: [], errors: [] }, error: null });
  vi.useRealTimers();
});

describe('who gets a launch email', () => {
  it('admitted, active students with a usable email, once per address', async () => {
    const calls: any[] = [];
    const db = makeSupabaseStub({ students: { data: [
      { id: 'a', email: 'Ama@X.test', full_name: 'Ama' },
      { id: 'b', email: 'ama@x.test', full_name: 'Ama again' },
      { id: 'c', email: 'not-an-email', full_name: 'X' },
      { id: 'd', email: null, full_name: 'No email' },
    ], count: 4 } });
    const wrap = (b: any): any => new Proxy(b, {
      get(target, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return target[prop];
        return (...a: any[]) => { if (prop === 'eq') calls.push(a); return wrap(target[prop](...a)); };
      },
    });
    const out = await announcementAudience({ ...db, from: (t: string) => wrap(db.from(t)) } as any);
    expect(out.recipients).toEqual([{ id: 'a', email: 'ama@x.test', name: 'Ama' }]);
    // Unconfirmed sign-ups and refused applicants have students rows too: never emailed.
    expect(calls).toEqual(expect.arrayContaining([['role', 'student'], ['status', 'active'], ['access_state', 'active']]));
  });
});

describe('starting an announcement', () => {
  const input = { bookId: 'b1', sentBy: 'u1', subject: 'S', message: 'M', recipients: [{ id: 's1', email: 'a@x.test', name: 'A' }], email: { from: 'F', subject: 'S', html: '<p>H</p>' } };

  it('is refused while one is already preparing or sending for the product (the unique index decides)', async () => {
    const db = makeSupabaseStub({ book_announcements: { data: null, error: { code: '23505', message: 'duplicate' } } });
    expect(await createAnnouncement(db as any, input)).toBe('busy');
  });

  it('saves the list while preparing, then starts sending; of two started together only the earliest goes ahead', async () => {
    const calls: { t: string; m: string; a: any[] }[] = [];
    const record = (base: any) => ({ ...base, from: (t: string) => {
      const wrap = (b: any): any => new Proxy(b, { get(target, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return target[prop];
        return (...a: any[]) => { calls.push({ t, m: String(prop), a }); return wrap(target[prop](...a)); };
      } });
      return wrap(base.from(t));
    } });
    // Mine is the earliest: it starts.
    let db = record(makeSupabaseStub({ book_announcements: [{ data: { id: 'mine' } }, { data: [{ id: 'mine' }] }, { data: null }], book_announcement_recipients: { data: null } }));
    expect(await createAnnouncement(db, input)).toEqual({ id: 'mine' });
    expect(calls.find(c => c.m === 'insert' && c.t === 'book_announcements')!.a[0]).toMatchObject({ status: 'preparing', email_from: 'F', email_subject: 'S', email_html: '<p>H</p>' });
    expect(calls.find(c => c.m === 'update' && c.t === 'book_announcements')!.a[0]).toMatchObject({ status: 'sending' });

    // Another started first: mine is withdrawn and nothing is sent.
    calls.length = 0;
    db = record(makeSupabaseStub({ book_announcements: [{ data: { id: 'mine' } }, { data: [{ id: 'theirs' }] }, { data: null }], book_announcement_recipients: { data: null } }));
    expect(await createAnnouncement(db, input)).toBe('busy');
    expect(calls.some(c => c.t === 'book_announcements' && c.m === 'delete')).toBe(true);
    expect(calls.some(c => c.t === 'book_announcements' && c.m === 'update')).toBe(false);
  });

  it('withdraws the announcement if its list could not be saved, so a part-list is never sent', async () => {
    const deletes: string[] = [];
    const base = makeSupabaseStub({ book_announcements: { data: { id: 'mine' } }, book_announcement_recipients: { data: null, error: { message: 'db down' } } });
    const db = { ...base, from: (t: string) => {
      const wrap = (b: any): any => new Proxy(b, { get(target, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') return target[prop];
        return (...a: any[]) => { if (prop === 'delete') deletes.push(t); return wrap(target[prop](...a)); };
      } });
      return wrap(base.from(t));
    } };
    await expect(createAnnouncement(db as any, input)).rejects.toBeTruthy();
    expect(deletes).toEqual(['book_announcements']);
  });
});

describe('sending', () => {
  const run = async (db: any, outOfTime?: () => boolean) => { const p = runAnnouncement(db, 'a1', outOfTime); await vi.runAllTimersAsync(); return p; };
  beforeEach(() => { vi.useFakeTimers(); });

  it('sends everyone once, in batches of 100, from the email frozen at creation', async () => {
    const { db, ann, rows } = fakeDb(people(230));
    expect(await run(db)).toEqual({ sent: 230, done: true });
    expect(sent.batch.mock.calls.map(c => c[0].length)).toEqual([100, 100, 30]);
    expect(rows.every(r => r.status === 'sent')).toBe(true);
    expect(ann).toMatchObject({ status: 'sent', sent: 230, failed: 0 });
    const [first, second] = sent.batch.mock.calls[0][0];
    expect(first).toMatchObject({ from: 'Tenant <help@learn.example.test>', subject: 'New: Guide for there', html: '<p>Hi there,</p><p>GHS 120</p>' });
    expect(second.html).toBe('<p>Hi S1,</p><p>GHS 120</p>');
    expect(sent.batch.mock.calls[0][1]).toMatchObject({ batchValidation: 'permissive' });
  });

  it('escapes the name in the HTML and keeps it on one line in the subject', async () => {
    const { db } = fakeDb([{ student_id: 's1', email: 'a@x.test', name: '<script>x</script>\r\nBcc: y' }]);
    await run(db);
    const [email] = sent.batch.mock.calls[0][0];
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it('a batch handed over before a crash is retried with the same key, and nobody else is resent', async () => {
    const { db, rows } = fakeDb(people(150));
    // The first batch was handed over (marked sending) and then the run died.
    rows.slice(0, 100).forEach(r => { r.status = 'sending'; r.attempted_at = new Date().toISOString(); });
    await run(db);
    const keys = sent.batch.mock.calls.map(c => c[1].idempotencyKey);
    expect(sent.batch.mock.calls[0][0].map((e: any) => e.to)).toEqual(rows.slice(0, 100).map(r => r.email));
    // The retried batch carries exactly the key it would have had originally.
    const { createHash } = await import('crypto');
    expect(keys[0]).toBe(`product-announcement/a1/${createHash('sha256').update(rows.slice(0, 100).map(r => r.student_id).join(',')).digest('hex').slice(0, 32)}`);
    expect(rows.every(r => r.status === 'sent')).toBe(true);
    expect(sent.batch.mock.calls.flatMap(c => c[0]).length).toBe(150);
  });

  it('a batch whose outcome is unknown after the provider window is never resent', async () => {
    const { db, rows } = fakeDb(people(120));
    rows.slice(0, 100).forEach(r => { r.status = 'sending'; r.attempted_at = new Date(Date.now() - 25 * 3_600_000).toISOString(); });
    await run(db);
    expect(rows.slice(0, 100).every(r => r.status === 'failed')).toBe(true);
    expect(sent.batch.mock.calls.flatMap(c => c[0].map((e: any) => e.to))).toEqual(rows.slice(100).map(r => r.email));
  });

  it('"still processing" is never counted as sent: the batch waits and is retried later', async () => {
    sent.batch.mockResolvedValue({ data: null, error: { statusCode: 409, name: 'concurrent_idempotent_requests', message: 'Still processing' } });
    const { db, ann, rows } = fakeDb(people(3));
    expect(await run(db)).toEqual({ sent: 0, done: false });
    expect(rows.every(r => r.status === 'sending')).toBe(true);
    expect(ann.status).toBe('sending');
  });

  it('a payload mismatch for the key stops the send with the reason, nothing counted as sent', async () => {
    sent.batch.mockResolvedValue({ data: null, error: { statusCode: 409, name: 'invalid_idempotent_request', message: 'Same key, different payload' } });
    const { db, ann, rows } = fakeDb(people(3));
    expect(await run(db)).toEqual({ sent: 0, done: true });
    expect(ann).toMatchObject({ status: 'failed', error: 'Same key, different payload' });
    expect(rows.every(r => r.status === 'pending')).toBe(true);
  });

  it('a bad address fails only itself', async () => {
    sent.batch.mockResolvedValueOnce({ data: { data: [], errors: [{ index: 2, message: 'invalid to field' }] }, error: null });
    const { db, ann, rows } = fakeDb(people(5));
    await run(db);
    expect(rows[2]).toMatchObject({ status: 'failed', error: 'invalid to field' });
    expect(rows.filter(r => r.status === 'sent')).toHaveLength(4);
    expect(ann).toMatchObject({ status: 'sent', sent: 4, failed: 1 });
  });

  it('retries a rate limit with the same key, and leaves a batch that keeps failing for the sweep', async () => {
    sent.batch.mockResolvedValueOnce({ data: null, error: { statusCode: 429, name: 'rate_limit_exceeded', message: 'slow down' } });
    const ok = fakeDb(people(3));
    await run(ok.db);
    expect(sent.batch).toHaveBeenCalledTimes(2);
    expect(sent.batch.mock.calls[0][1].idempotencyKey).toBe(sent.batch.mock.calls[1][1].idempotencyKey);
    expect(ok.rows.every(r => r.status === 'sent')).toBe(true);

    sent.batch.mockReset().mockResolvedValue({ data: null, error: { statusCode: 503, name: 'internal_server_error', message: 'down' } });
    const down = fakeDb(people(3));
    expect(await run(down.db)).toEqual({ sent: 0, done: false });
    expect(down.rows.every(r => r.status === 'sending')).toBe(true);
    expect(down.ann.status).toBe('sending');
  });

  it('stops and shows why on a permanent refusal (bad key, unverified sender)', async () => {
    sent.batch.mockResolvedValue({ data: null, error: { statusCode: 403, name: 'invalid_access', message: 'The domain is not verified' } });
    const { db, ann, rows } = fakeDb(people(3));
    expect(await run(db)).toEqual({ sent: 0, done: true });
    expect(ann).toMatchObject({ status: 'failed', error: 'The domain is not verified' });
    expect(sent.batch).toHaveBeenCalledTimes(1);
    expect(rows.every(r => r.status === 'pending')).toBe(true);
  });

  it('taking the product off the store mid-send stops the remaining batches', async () => {
    const { db, ann } = fakeDb(people(300));
    sent.batch.mockImplementation(async () => { store.live = false; return { data: { data: [], errors: [] }, error: null }; });
    await run(db);
    expect(sent.batch).toHaveBeenCalledTimes(1);
    expect(ann).toMatchObject({ status: 'failed', error: 'The product is no longer available in the store.' });
  });

  it('does nothing for an announcement that is no longer sending', async () => {
    const { db, ann } = fakeDb(people(3));
    ann.status = 'sent';
    expect(await run(db)).toEqual({ sent: 0, done: true });
    expect(sent.batch).not.toHaveBeenCalled();
  });
});

describe('the frozen email', () => {
  it('is rendered once with a name placeholder, so later runs need nothing but the saved copy', async () => {
    const email = await buildAnnouncementEmail({ subject: 'New: Guide', message: 'Out now', book: { title: 'Guide', slug: 'guide-1a2b', coverUrl: null, priceLabel: 'GHS 120' } });
    expect(email.from).toBe('Tenant <help@learn.example.test>');
    expect(email.html).toContain('__ANNOUNCE_STUDENT_NAME__');
    expect(email.html).toContain('https://learn.example.test/products/guide-1a2b');
    expect(email.html).toContain('GHS 120');
  });
});

describe('the launch email', () => {
  it('escapes the author message and product title', () => {
    const html = productAnnouncementEmail({
      name: 'Ama', bookTitle: '<b>Guide</b>', priceLabel: 'GHS 120', message: 'Hello <script>x</script>\n\nSecond para',
      productUrl: 'https://learn.example.test/products/g',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;Guide&lt;/b&gt;');
    expect(html).toContain('<p>Second para</p>');
  });
});
