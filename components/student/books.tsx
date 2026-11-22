'use client';

// My Books: the books a learner can download (bought, given to them, or assigned to their program)
// and their book payments. It is also where Paystack returns a book buyer
// (/student?book_reference=...#products, lib/paystack.ts) and where the receipt email links, so it
// confirms a returning payment without waiting for the webhook.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Clock, Download, ExternalLink, Loader2, Package, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { downloadBook } from '@/lib/books/open-preview';
import { fileSizeLabel, formatLabel, formatMoney, getItLabel } from '@/lib/books/format';
import { Pill, palette } from '@/components/dashboard/subscriptions/ui';
import { EmptyState, Sk } from '@/components/student/shared';
import type { LIGHT_C } from '@/lib/theme';

import type { LibraryBook, LibraryPurchase } from '@/app/api/books/library/route';

type ReturnState =
  | { phase: 'checking' }
  | { phase: 'paid'; bookId: string | null }
  | { phase: 'review' }
  | { phase: 'refunded' }
  | { phase: 'pending' }
  | { phase: 'failed' }
  | { phase: 'error'; message: string };

const RETURN_KEY = 'book-paystack-return';
const SOURCE_LABEL: Record<LibraryBook['source'], string> = {
  purchase: 'Bought',
  grant: 'Given to you',
  cohort: 'From your program',
};
const STATUS_LABEL: Record<string, string> = {
  paid: 'Paid',
  pending: 'Processing',
  needs_review: 'Being checked',
  failed: 'Not completed',
  refunded: 'Refunded',
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// A payment's status as the shared status colours: green paid, amber waiting, red failed.
const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'mute'> = {
  paid: 'good', pending: 'warn', needs_review: 'warn', failed: 'bad', refunded: 'mute',
};

// What the checkout said, as the banner to show; 'pending' is retried before it is reported.
const SETTLED: Record<string, ReturnState['phase']> = { paid: 'paid', refunded: 'refunded', needs_review: 'review', failed: 'failed' };

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function BooksSection({ C, readOnly = false }: { C: typeof LIGHT_C; readOnly?: boolean }) {
  const [books, setBooks] = useState<LibraryBook[] | null>(null);
  const [purchases, setPurchases] = useState<LibraryPurchase[]>([]);
  const [loadError, setLoadError] = useState('');
  const [returned, setReturned] = useState<ReturnState | null>(null);
  const [returnReference, setReturnReference] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const returnStarted = useRef(false);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await fetch('/api/books/library', { headers: await authHeaders() });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not load your products.');
      setBooks(d.books ?? []);
      setPurchases(d.purchases ?? []);
    } catch (e: any) {
      // Not "No products yet": the empty state below only shows when the load worked.
      setLoadError(e?.message || 'Could not load your products.');
      setBooks(prev => prev ?? []);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Ask the server about the payment Paystack sent the buyer back from. Bank transfer and mobile
  // money can take a little while, so "pending" is retried a few times before it is reported.
  const confirm = useCallback(async (reference: string) => {
    setReturned({ phase: 'checking' });
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await wait(2000 * 2 ** (attempt - 1));
        const res = await fetch(`/api/books/checkout?reference=${encodeURIComponent(reference)}`, { headers: await authHeaders() });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'We could not check your payment just now.');
        // Refunds happen outside the platform (staff refund in Paystack), so this only reports one.
        const phase = SETTLED[d.status];
        if (phase) {
          setReturned(phase === 'paid' ? { phase: 'paid', bookId: d.bookId ?? null } : { phase } as ReturnState);
          window.sessionStorage.removeItem(RETURN_KEY);
          await load();
          return;
        }
      }
      setReturned({ phase: 'pending' });
      await load();
    } catch (e: any) {
      // Not kept for the tab: a reference that cannot be checked (for example another account is
      // signed in) showed this red banner on every visit. Check again stays on this one.
      window.sessionStorage.removeItem(RETURN_KEY);
      setReturned({ phase: 'error', message: e?.message || 'We could not check your payment just now.' });
    }
  }, [load]);

  useEffect(() => {
    if (returnStarted.current || readOnly) return;
    const params = new URLSearchParams(window.location.search);
    const reference = params.get('book_reference') || window.sessionStorage.getItem(RETURN_KEY);
    if (!reference || !reference.startsWith('book-')) return;
    returnStarted.current = true;
    setReturnReference(reference);
    window.sessionStorage.setItem(RETURN_KEY, reference);
    // Out of the address bar so a refresh or a shared link does not replay it; kept in state (and
    // for this tab) so the buyer can still ask again.
    const url = new URL(window.location.href);
    for (const key of ['book_reference', 'reference', 'trxref']) url.searchParams.delete(key);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    void confirm(reference);
  }, [readOnly, confirm]);

  async function download(bookId: string, format: string | null) {
    setDownloadError(''); setDownloading(bookId);
    try {
      await downloadBook(bookId, format);
    } catch (e: any) {
      setDownloadError(e?.message || 'Could not download the product.');
    } finally {
      setDownloading(null);
    }
  }

  const card = { background: C.card } as const;
  const P = palette(C);
  const paidBook = returned?.phase === 'paid' && returned.bookId ? books?.find(b => b.id === returned.bookId) : null;

  const banner = returned && (() => {
    const box = (tone: 'ok' | 'wait' | 'bad', icon: React.ReactNode, title: string, body: string, action?: React.ReactNode) => (
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3"
        style={tone === 'ok'
          ? { background: C.card, boxShadow: `inset 0 0 0 1px ${P.goodSoft}` }
          : tone === 'bad' ? { background: C.errorBg } : { background: C.card }}>
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="shrink-0 mt-0.5" style={{ color: tone === 'ok' ? P.good : tone === 'bad' ? C.errorText : C.muted }}>{icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: tone === 'ok' ? P.good : tone === 'bad' ? C.errorText : C.text }}>{title}</p>
            <p className="text-xs mt-0.5" style={{ color: tone === 'bad' ? C.errorText : C.muted }}>{body}</p>
          </div>
        </div>
        {action}
      </div>
    );
    const again = returnReference && (
      <button onClick={() => confirm(returnReference)} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
        style={{ background: C.pill, color: C.muted }}>
        <RefreshCw className="w-3.5 h-3.5" /> Check again
      </button>
    );
    switch (returned.phase) {
      case 'checking':
        return box('wait', <Loader2 className="w-5 h-5 animate-spin" />, 'Confirming your payment', 'This only takes a moment.');
      case 'paid':
        return box('ok', <CheckCircle2 className="w-5 h-5" />, 'Payment received. Your product is ready.',
          paidBook ? `${paidBook.title} is in your library below. A receipt is on its way to your email.` : 'It is in your library below. A receipt is on its way to your email.',
          paidBook && paidBook.available ? (
            <button onClick={() => download(paidBook.id, paidBook.format)} disabled={downloading === paidBook.id}
              className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
              style={{ background: C.cta, color: C.ctaText }}>
              {downloading === paidBook.id ? <Loader2 className="w-4 h-4 animate-spin" /> : paidBook.format === 'link' ? <ExternalLink className="w-4 h-4" /> : <Download className="w-4 h-4" />} {getItLabel(paidBook.format)}
            </button>
          ) : undefined);
      case 'review':
        return box('wait', <Clock className="w-5 h-5" />, 'We received your payment and are checking it',
          'Something about this payment needs a person to look at it, for example you already owned the product. The team will sort it out; there is no need to pay again.');
      case 'refunded':
        return box('wait', <Clock className="w-5 h-5" />, 'This payment was refunded',
          'The money for this checkout was returned to you, so it does not include the product. If you have a question about the refund, contact support.');
      case 'pending':
        return box('wait', <Clock className="w-5 h-5" />, 'Your payment is still being processed',
          'Bank transfers and mobile money can take a few minutes. Check again shortly; there is no need to pay again.', again);
      case 'failed':
        return box('bad', <AlertCircle className="w-5 h-5" />, 'The payment was not completed',
          'No charge went through for this checkout. You can try buying it again.',
          <Link href="/products" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: C.cta, color: C.ctaText }}>Open the store</Link>);
      case 'error':
        return box('bad', <AlertCircle className="w-5 h-5" />, 'We could not confirm your payment', returned.message, again);
    }
  })();

  return (
    <div className="space-y-6">
      {banner}
      {readOnly && <p className="text-sm" style={{ color: C.muted }}>Downloads are off while you view as this learner.</p>}
      {(loadError || downloadError) && (
        <div className="text-sm px-4 py-3 rounded-xl" style={{ background: C.errorBg, color: C.errorText }}>{downloadError || loadError}</div>
      )}

      {books === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="rounded-2xl p-3 space-y-3" style={card}>
              <Sk h={180} r={12} /><Sk w="80%" /><Sk w="50%" h={12} />
            </div>
          ))}
        </div>
      ) : books.length === 0 && loadError ? null : books.length === 0 ? (
        <div className="rounded-2xl" style={card}>
          <EmptyState icon={Package} title="No products yet" body="Digital products you buy, or that your program gives you, will appear here for download." />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {books.map(book => (
            <div key={book.id} className="rounded-2xl p-3 flex flex-col" style={card}>
              <div className="rounded-xl overflow-hidden flex items-center justify-center" style={{ background: C.pill, aspectRatio: '3 / 4' }}>
                {book.coverImage
                  ? <img src={resolveCoverUrl(book.coverImage)} alt="" className="w-full h-full object-cover" />
                  : <Package className="w-8 h-8" style={{ color: C.faint }} />}
              </div>
              <p className="mt-3 text-sm font-semibold leading-snug line-clamp-2" style={{ color: C.text }}>{book.title}</p>
              {book.authors.length > 0 && <p className="text-xs mt-0.5 truncate" style={{ color: C.muted }}>{book.authors.join(', ')}</p>}
              <p className="text-[11px] mt-1" style={{ color: C.faint }}>
                {[formatLabel(book.format), fileSizeLabel(book.fileSize), SOURCE_LABEL[book.source]].filter(Boolean).join(' / ')}
              </p>
              <div className="mt-auto pt-3">
                {book.available ? (
                  <button onClick={() => download(book.id, book.format)} disabled={readOnly || downloading === book.id}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-60"
                    style={{ background: C.cta, color: C.ctaText }}>
                    {downloading === book.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : book.format === 'link' ? <ExternalLink className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />} {getItLabel(book.format)}
                  </button>
                ) : (
                  <p className="text-xs text-center py-2" style={{ color: C.faint }}>
                    {book.licenseExpiresAt ? <>No longer available since <b style={{ color: C.muted }}>{shortDate(book.licenseExpiresAt)}</b></> : 'No longer available'}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {purchases.length > 0 && (
        <div className="rounded-2xl p-4 sm:p-5" style={card}>
          <p className="text-sm font-semibold" style={{ color: C.text }}>Product payments</p>
          <div className="mt-3 divide-y" style={{ borderColor: C.divider }}>
            {purchases.map(p => (
              // On a phone the date sits above the title, so the title keeps its width.
              <div key={p.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm" style={{ borderColor: C.divider }}>
                <span className="w-full sm:w-28 shrink-0 text-xs" style={{ color: C.faint }}>{shortDate(p.paidAt ?? p.createdAt)}</span>
                <span className="flex-1 min-w-0 truncate" style={{ color: C.text }}>{p.bookTitle}</span>
                <span className="shrink-0 text-xs" style={{ color: C.muted }}>{formatMoney(p.amount, p.currency)}</span>
                <Pill tone={STATUS_TONE[p.status] ?? 'mute'} dot={p.status === 'paid'} C={C}>{STATUS_LABEL[p.status] ?? p.status}</Pill>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
