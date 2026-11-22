'use client';

// My Products: the products a learner can download (bought, given to them, or assigned to their
// program). It is also where Paystack returns a buyer
// (/student?book_reference=...#products, lib/paystack.ts) and where the receipt email links, so it
// confirms a returning payment without waiting for the webhook.

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Clock, Download, ExternalLink, Loader2, Package, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { downloadBook } from '@/lib/books/open-preview';
import { fileSizeLabel, formatLabel, getItLabel } from '@/lib/books/format';
import { palette } from '@/components/dashboard/subscriptions/ui';
import { FRAMED_CARD } from '@/components/CardMeta';

/** The primary blue, for the download buttons. */
const BLUE = '#3E93FF';
import { EmptyState, Sk } from '@/components/student/shared';
import type { LIGHT_C } from '@/lib/theme';

import type { LibraryBook } from '@/app/api/books/library/route';

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

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// What the checkout said, as the banner to show; 'pending' is retried before it is reported.
const SETTLED: Record<string, ReturnState['phase']> = { paid: 'paid', refunded: 'refunded', needs_review: 'review', failed: 'failed' };

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function BooksSection({ C, readOnly = false }: { C: typeof LIGHT_C; readOnly?: boolean }) {
  const [books, setBooks] = useState<LibraryBook[] | null>(null);
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
              style={{ background: BLUE, color: '#ffffff' }}>
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
          <Link href="/products" className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: BLUE, color: '#ffffff' }}>Open the store</Link>);
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="overflow-hidden rounded-xl" style={card}>
              <Sk h={180} r={0} /><div className="space-y-2 p-4"><Sk w="80%" /><Sk w="50%" h={12} /></div>
            </div>
          ))}
        </div>
      ) : books.length === 0 && loadError ? null : books.length === 0 ? (
        <div className="rounded-2xl" style={card}>
          <EmptyState icon={Package} title="No products yet" body="Digital products you buy, or that your program gives you, will appear here for download." />
        </div>
      ) : (
        // The dashboard's content card, the cover the shape of a course's: edge to edge with how it
        // reached the learner on a tag, then the title, the author, the file, and one action.
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
          {books.map(book => (
            <div key={book.id} className={FRAMED_CARD.replace('cursor-pointer ', '')} style={card}>
              <div className="relative flex aspect-video items-center justify-center overflow-hidden" style={{ background: C.pill }}>
                {book.coverImage
                  ? <img src={resolveCoverUrl(book.coverImage)} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]" />
                  : <Package className="h-10 w-10" style={{ color: C.faint }} />}
                <span className="absolute left-0 top-3 px-3 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>{SOURCE_LABEL[book.source]}</span>
              </div>
              <div className="flex flex-1 flex-col px-3 pt-2.5 pb-3.5 sm:px-4 sm:pt-3.5 sm:pb-[18px]">
                <p className="line-clamp-2 min-h-[40px] text-[15px] leading-5 font-bold" style={{ color: C.text }}>{book.title}</p>
                {book.authors.length > 0 && <p className="mt-1 truncate text-sm" style={{ color: C.muted }}>{book.authors.join(', ')}</p>}
                <p className="mt-1 text-[13px]" style={{ color: C.muted }}>
                  {[formatLabel(book.format), fileSizeLabel(book.fileSize)].filter(Boolean).join(', ')}
                </p>
                <div className="mt-auto pt-4">
                  {book.available ? (
                    <button onClick={() => download(book.id, book.format)} disabled={readOnly || downloading === book.id}
                      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
                      style={{ background: BLUE, color: '#ffffff' }}>
                      {downloading === book.id ? <Loader2 className="h-4 w-4 animate-spin" /> : book.format === 'link' ? <ExternalLink className="h-4 w-4" /> : <Download className="h-4 w-4" />} {getItLabel(book.format)}
                    </button>
                  ) : (
                    <p className="py-2 text-center text-[13px]" style={{ color: C.muted }}>
                      {book.licenseExpiresAt ? <>No longer available since <b style={{ color: C.text }}>{shortDate(book.licenseExpiresAt)}</b></> : 'No longer available'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
