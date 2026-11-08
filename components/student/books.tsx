'use client';

// My Books: the books a learner can download (bought, given to them, or assigned to their program)
// and their book payments. It is also where Paystack returns a book buyer
// (/student?book_reference=...#books, lib/paystack.ts) and where the receipt email links, so it
// confirms a returning payment without waiting for the webhook.

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, CheckCircle2, Clock, Download, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { downloadBook } from '@/lib/books/open-preview';
import { EmptyState, Sk } from '@/components/student/shared';
import type { LIGHT_C } from '@/lib/theme';

type LibraryBook = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  coverImage: string | null;
  authors: string[];
  format: string | null;
  fileSize: number | null;
  source: 'purchase' | 'grant' | 'cohort';
  since: string | null;
  available: boolean;
};

type LibraryPurchase = {
  id: string;
  bookId: string | null;
  bookTitle: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
};

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

function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function sizeLabel(bytes: number | null): string {
  if (!bytes) return '';
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function shortDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' });
}

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
      if (!res.ok) throw new Error(d.error || 'Could not load your books.');
      setBooks(d.books ?? []);
      setPurchases(d.purchases ?? []);
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load your books.');
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
        if (d.status === 'paid') {
          setReturned({ phase: 'paid', bookId: d.bookId ?? null });
          window.sessionStorage.removeItem(RETURN_KEY);
          await load();
          return;
        }
        // Refunds happen outside the platform (staff refund in Paystack), so this only reports one.
        if (d.status === 'refunded') {
          setReturned({ phase: 'refunded' });
          window.sessionStorage.removeItem(RETURN_KEY);
          await load();
          return;
        }
        if (d.status === 'needs_review') {
          setReturned({ phase: 'review' });
          window.sessionStorage.removeItem(RETURN_KEY);
          await load();
          return;
        }
        if (d.status === 'failed') {
          setReturned({ phase: 'failed' });
          window.sessionStorage.removeItem(RETURN_KEY);
          await load();
          return;
        }
      }
      setReturned({ phase: 'pending' });
      await load();
    } catch (e: any) {
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

  async function download(bookId: string) {
    setDownloadError(''); setDownloading(bookId);
    try {
      await downloadBook(bookId);
    } catch (e: any) {
      setDownloadError(e?.message || 'Could not download the book.');
    } finally {
      setDownloading(null);
    }
  }

  const card = { background: C.card } as const;
  const paidBook = returned?.phase === 'paid' && returned.bookId ? books?.find(b => b.id === returned.bookId) : null;

  const banner = returned && (() => {
    const box = (tone: 'ok' | 'wait' | 'bad', icon: React.ReactNode, title: string, body: string, action?: React.ReactNode) => (
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3"
        style={tone === 'ok'
          ? { background: '#ffffff', boxShadow: 'inset 0 0 0 1px #bbf7d0' }
          : tone === 'bad' ? { background: C.errorBg } : { background: C.card }}>
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="shrink-0 mt-0.5" style={{ color: tone === 'ok' ? '#16a34a' : tone === 'bad' ? C.errorText : C.muted }}>{icon}</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: tone === 'ok' ? '#15803d' : tone === 'bad' ? C.errorText : C.text }}>{title}</p>
            <p className="text-xs mt-0.5" style={{ color: tone === 'ok' ? '#166534' : tone === 'bad' ? C.errorText : C.muted }}>{body}</p>
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
        return box('ok', <CheckCircle2 className="w-5 h-5" />, 'Payment received. Your book is ready.',
          paidBook ? `${paidBook.title} is in your library below. A receipt is on its way to your email.` : 'It is in your library below. A receipt is on its way to your email.',
          paidBook && paidBook.available ? (
            <button onClick={() => download(paidBook.id)} disabled={downloading === paidBook.id}
              className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
              style={{ background: C.cta, color: C.ctaText }}>
              {downloading === paidBook.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download
            </button>
          ) : undefined);
      case 'review':
        return box('wait', <Clock className="w-5 h-5" />, 'We received your payment and are checking it',
          'Something about this payment needs a person to look at it, for example you already owned the book. The team will sort it out; there is no need to pay again.');
      case 'refunded':
        return box('wait', <Clock className="w-5 h-5" />, 'This payment was refunded',
          'The money for this checkout was returned to you, so it does not include the book. If you have a question about the refund, contact support.');
      case 'pending':
        return box('wait', <Clock className="w-5 h-5" />, 'Your payment is still being processed',
          'Bank transfers and mobile money can take a few minutes. Check again shortly; there is no need to pay again.', again);
      case 'failed':
        return box('bad', <Clock className="w-5 h-5" />, 'The payment was not completed',
          'No charge went through for this checkout. You can try buying the book again.');
      case 'error':
        return box('bad', <Clock className="w-5 h-5" />, 'We could not confirm your payment', returned.message, again);
    }
  })();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold" style={{ color: C.text }}>My Books</h1>
        <p className="text-sm mt-1" style={{ color: C.muted }}>Books you have bought, or that your program gives you. Download them any time.</p>
      </div>

      {banner}
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
      ) : books.length === 0 ? (
        <div className="rounded-2xl" style={card}>
          <EmptyState icon={BookOpen} title="No books yet" body="Books you buy, or that your program gives you, will appear here for download." />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {books.map(book => (
            <div key={book.id} className="rounded-2xl p-3 flex flex-col" style={card}>
              <div className="rounded-xl overflow-hidden flex items-center justify-center" style={{ background: C.pill, aspectRatio: '3 / 4' }}>
                {book.coverImage
                  ? <img src={resolveCoverUrl(book.coverImage)} alt="" className="w-full h-full object-cover" />
                  : <BookOpen className="w-8 h-8" style={{ color: C.faint }} />}
              </div>
              <p className="mt-3 text-sm font-semibold leading-snug line-clamp-2" style={{ color: C.text }}>{book.title}</p>
              {book.authors.length > 0 && <p className="text-xs mt-0.5 truncate" style={{ color: C.muted }}>{book.authors.join(', ')}</p>}
              <p className="text-[11px] mt-1" style={{ color: C.faint }}>
                {[book.format?.toUpperCase(), sizeLabel(book.fileSize), SOURCE_LABEL[book.source]].filter(Boolean).join(' / ')}
              </p>
              <div className="mt-auto pt-3">
                {book.available ? (
                  <button onClick={() => download(book.id)} disabled={readOnly || downloading === book.id}
                    title={readOnly ? 'Downloads are off while viewing as a student' : undefined}
                    className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold disabled:opacity-60"
                    style={{ background: C.cta, color: C.ctaText }}>
                    {downloading === book.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />} Download
                  </button>
                ) : (
                  <p className="text-xs text-center py-2" style={{ color: C.faint }}>No longer available</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {purchases.length > 0 && (
        <div className="rounded-2xl p-4 sm:p-5" style={card}>
          <p className="text-sm font-semibold" style={{ color: C.text }}>Book payments</p>
          <div className="mt-3 divide-y" style={{ borderColor: C.divider }}>
            {purchases.map(p => (
              <div key={p.id} className="py-2.5 flex items-center gap-3 text-sm" style={{ borderColor: C.divider }}>
                <span className="w-24 shrink-0 text-xs" style={{ color: C.faint }}>{shortDate(p.paidAt ?? p.createdAt)}</span>
                <span className="flex-1 min-w-0 truncate" style={{ color: C.text }}>{p.bookTitle}</span>
                <span className="shrink-0 text-xs" style={{ color: C.muted }}>{money(p.amount, p.currency)}</span>
                <span className="shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                  style={p.status === 'paid'
                    ? { background: '#ffffff', color: '#16a34a', boxShadow: 'inset 0 0 0 1px #bbf7d0' }
                    : { background: C.pill, color: C.muted }}>
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
