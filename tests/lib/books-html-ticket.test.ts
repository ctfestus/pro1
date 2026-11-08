import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HTML_TICKET_TTL_SECONDS, issueHtmlTicket, verifyHtmlTicket } from '@/lib/books/html-ticket';
import { isBookObjectPath, isLicenseExpired } from '@/lib/books/schema';

const ORIGINAL = process.env.BOOK_HTML_TICKET_SECRET;
beforeEach(() => { process.env.BOOK_HTML_TICKET_SECRET = 'test-secret'; });
afterEach(() => { process.env.BOOK_HTML_TICKET_SECRET = ORIGINAL; });

describe('HTML book tickets', () => {
  const now = Date.UTC(2026, 10, 7, 12, 0, 0);

  it('round-trips for the book it was issued for', () => {
    const { ticket } = issueHtmlTicket({ bookId: 'b1', userId: 'u1', variant: 'full' }, now);
    expect(verifyHtmlTicket(ticket, 'b1', now + 1000)).toMatchObject({ bookId: 'b1', userId: 'u1', variant: 'full' });
  });

  it('does not open a different book', () => {
    const { ticket } = issueHtmlTicket({ bookId: 'b1', userId: 'u1', variant: 'full' }, now);
    expect(verifyHtmlTicket(ticket, 'b2', now)).toBeNull();
  });

  it('expires', () => {
    const { ticket } = issueHtmlTicket({ bookId: 'b1', userId: 'u1', variant: 'full' }, now);
    expect(verifyHtmlTicket(ticket, 'b1', now + HTML_TICKET_TTL_SECONDS * 1000)).toBeNull();
  });

  it('rejects an edited payload, such as a sample ticket upgraded to the full book', () => {
    const { ticket } = issueHtmlTicket({ bookId: 'b1', userId: 'u1', variant: 'preview' }, now);
    const [payload, sig] = ticket.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const forged = Buffer.from(JSON.stringify({ ...claims, variant: 'full' })).toString('base64url');
    expect(verifyHtmlTicket(`${forged}.${sig}`, 'b1', now)).toBeNull();
  });

  it('rejects a ticket signed with another secret', () => {
    const { ticket } = issueHtmlTicket({ bookId: 'b1', userId: 'u1', variant: 'full' }, now);
    process.env.BOOK_HTML_TICKET_SECRET = 'rotated';
    expect(verifyHtmlTicket(ticket, 'b1', now)).toBeNull();
  });

  it('rejects junk', () => {
    expect(verifyHtmlTicket(null, 'b1')).toBeNull();
    expect(verifyHtmlTicket('nodot', 'b1')).toBeNull();
    expect(verifyHtmlTicket('a.b', 'b1')).toBeNull();
  });
});

describe('book helpers', () => {
  it('accepts only object paths the upload route issues for that book, kind and format', () => {
    const uuid = '123e4567-e89b-12d3-a456-426614174000';
    const ok = `b1/file-${uuid}.epub`;
    expect(isBookObjectPath('b1', ok, 'file', 'epub')).toBe(true);
    expect(isBookObjectPath('b2', ok, 'file', 'epub')).toBe(false);
    expect(isBookObjectPath('b1', ok, 'preview', 'epub')).toBe(false);
    expect(isBookObjectPath('b1', ok, 'file', 'pdf')).toBe(false);
    expect(isBookObjectPath('b1', ok, 'file', null)).toBe(false);
    expect(isBookObjectPath('b1', `b1/../b2/file-${uuid}.epub`, 'file', 'epub')).toBe(false);
    expect(isBookObjectPath('b1', `b1/file-${uuid}.exe`, 'file', 'epub')).toBe(false);
    expect(isBookObjectPath('b1', `b1/preview-${uuid}.html`, 'preview', 'html')).toBe(true);
  });

  it('treats a missing or future licence end as not expired', () => {
    const now = new Date('2026-11-07T00:00:00Z');
    expect(isLicenseExpired(null, now)).toBe(false);
    expect(isLicenseExpired('2027-01-01T00:00:00Z', now)).toBe(false);
    expect(isLicenseExpired('2026-11-06T00:00:00Z', now)).toBe(true);
    expect(isLicenseExpired('not a date', now)).toBe(false);
  });
});
