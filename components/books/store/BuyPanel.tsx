'use client';

/**
 * The book page's buy box: the price, and what the visitor can do from where they stand.
 *   signed out          -> Sign in to buy / Create an account (the book is remembered across sign-up)
 *   owns it             -> Download, and a link to My Books
 *   signed in, for sale -> Buy, through /api/books/checkout and Paystack
 *   free book           -> Download once signed in
 * The free sample opens for everyone, signed in or not (/api/books/[id]/sample).
 *
 * Checked in the browser, never rendered on the server: the page is cached and shared.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { BookOpen, Download, Eye, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { signInHref } from '@/lib/auth-redirect';
import { downloadBook } from '@/lib/books/open-preview';
import { clearBookPage, rememberBookPage } from '@/lib/books/pending-return';
import { formatMoney } from '@/lib/books/format';

export interface BuyPanelBook {
  id: string;
  slug: string;
  format: string;
  free: boolean;
  prices: { currency: string; amount: number }[];
  hasSample: boolean;
}

// No token is kept here: Supabase refreshes the session while the page is open, so every request
// asks for the current one (currentToken) instead of reusing the one the page opened with.
type Viewer = { phase: 'loading' } | { phase: 'signedOut' } | { phase: 'signedIn'; owned: boolean };

async function currentToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function BuyPanel({ book, primaryColor }: { book: BuyPanelBook; primaryColor: string }) {
  const { publicSignupEnabled } = useTenant();
  const [viewer, setViewer] = useState<Viewer>({ phase: 'loading' });
  const [currency, setCurrency] = useState(book.prices[0]?.currency ?? '');
  const [busy, setBusy] = useState<null | 'buy' | 'download' | 'sample'>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const checkOwned = useCallback(async (token: string) => {
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(book.id)}/access`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await res.json().catch(() => ({}));
      setViewer({ phase: 'signedIn', owned: res.ok && d.owned === true });
    } catch {
      setViewer({ phase: 'signedIn', owned: false });
    }
  }, [book.id]);

  // Follows the session for as long as the page is open: signing in or out in another tab, or the
  // session ending, updates the buttons. A token refresh changes nothing visible, so it is ignored.
  useEffect(() => {
    let cancelled = false;
    const apply = (token: string | null) => {
      if (cancelled) return;
      if (!token) { setViewer({ phase: 'signedOut' }); return; }
      clearBookPage(); // they made it back to the book: nothing left to restore after sign-up
      void checkOwned(token);
    };
    currentToken().then(apply);
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') apply(session?.access_token ?? null);
    });
    return () => { cancelled = true; subscription.unsubscribe(); };
  }, [checkOwned]);

  const price = book.prices.find(p => p.currency === currency) ?? book.prices[0];
  const backHere = `/books/${book.slug}`;

  async function buy() {
    if (viewer.phase !== 'signedIn' || !price) return;
    setError(''); setNote(''); setBusy('buy');
    try {
      const token = await currentToken();
      if (!token) { setViewer({ phase: 'signedOut' }); setError('Your session ended. Sign in again to buy.'); return; }
      const res = await fetch('/api/books/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookId: book.id, currency: price.currency }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.authorizationUrl) { window.location.href = d.authorizationUrl; return; }
      if (res.ok && d.status === 'paid') { setViewer({ phase: 'signedIn', owned: true }); setNote('You already paid for this book. It is in My Books.'); return; }
      if (res.ok && d.status) { setNote('A payment for this book is already being checked. See My Books for its status.'); return; }
      if (res.status === 409 && /already have/i.test(d.error ?? '')) { setViewer({ phase: 'signedIn', owned: true }); return; }
      if (res.status === 401) { setViewer({ phase: 'signedOut' }); throw new Error('Your session ended. Sign in again to buy.'); }
      throw new Error(d.error || 'Could not start the checkout.');
    } catch (e: any) {
      setError(e?.message || 'Could not start the checkout.');
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setError(''); setBusy('download');
    try {
      await downloadBook(book.id);
    } catch (e: any) {
      setError(e?.message || 'Could not download the book.');
    } finally {
      setBusy(null);
    }
  }

  async function openSample() {
    setError(''); setBusy('sample');
    // PDF and HTML open in a new tab, opened inside the click so a popup blocker allows it.
    const tab = book.format === 'epub' ? null : window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const res = await fetch(`/api/books/${encodeURIComponent(book.id)}/sample`);
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d.error || 'Could not open the sample.');
      if (tab) tab.location.href = d.url;
      else window.location.href = d.url;
    } catch (e: any) {
      tab?.close();
      setError(e?.message || 'Could not open the sample.');
    } finally {
      setBusy(null);
    }
  }

  const primaryBtn = 'w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl text-sm font-semibold disabled:opacity-60';
  const secondaryBtn = 'w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold disabled:opacity-60';
  const owned = viewer.phase === 'signedIn' && viewer.owned;

  return (
    <div className="rounded-3xl bg-white p-5 sm:p-6 space-y-4">
      {book.free ? (
        <p className="text-2xl font-bold" style={{ color: '#16a34a' }}>Free</p>
      ) : price ? (
        <div className="flex items-end justify-between gap-3">
          <p className="text-2xl font-bold" style={{ color: '#0f172a' }}>{formatMoney(price.amount, price.currency)}</p>
          {book.prices.length > 1 && (
            <select value={currency} onChange={e => setCurrency(e.target.value)} aria-label="Currency"
              className="rounded-xl px-3 py-2 text-sm outline-none" style={{ background: '#F3F6F5', color: '#334155' }}>
              {book.prices.map(p => <option key={p.currency} value={p.currency}>{p.currency}</option>)}
            </select>
          )}
        </div>
      ) : null}

      {viewer.phase === 'loading' ? (
        <div className={primaryBtn} style={{ background: '#F3F6F5', color: '#94a3b8' }}><Loader2 className="w-4 h-4 animate-spin" /></div>
      ) : owned ? (
        <>
          <button onClick={download} disabled={busy === 'download'} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
            {busy === 'download' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download
          </button>
          <Link href="/student#books" className={secondaryBtn} style={{ background: '#F3F6F5', color: '#334155' }}>
            <BookOpen className="w-4 h-4" /> Open My Books
          </Link>
          {!book.free && <p className="text-xs text-center" style={{ color: '#16a34a' }}>You own this book.</p>}
        </>
      ) : viewer.phase === 'signedOut' ? (
        <>
          <Link href={signInHref(backHere)} onClick={() => rememberBookPage(book.slug)} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
            {book.free ? 'Sign in to download' : 'Sign in to buy'}
          </Link>
          {publicSignupEnabled && (
            <Link href="/auth?mode=signup" onClick={() => rememberBookPage(book.slug)} className={secondaryBtn} style={{ background: '#F3F6F5', color: '#334155' }}>
              New here? Create an account
            </Link>
          )}
        </>
      ) : book.free ? (
        // Free for everyone signed in; the access check said otherwise only if it failed.
        <button onClick={download} disabled={busy === 'download'} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
          {busy === 'download' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download
        </button>
      ) : price ? (
        <button onClick={buy} disabled={busy === 'buy'} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
          {busy === 'buy' && <Loader2 className="w-4 h-4 animate-spin" />} Buy for {formatMoney(price.amount, price.currency)}
        </button>
      ) : null}

      {book.hasSample && !owned && (
        <button onClick={openSample} disabled={busy === 'sample'} className={secondaryBtn} style={{ background: '#F3F6F5', color: '#334155' }}>
          {busy === 'sample' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          {book.format === 'epub' ? 'Download free sample' : 'Read free sample'}
        </button>
      )}
      {book.hasSample && !owned && book.format === 'epub' && (
        <p className="text-xs text-center" style={{ color: '#94a3b8' }}>Open the sample in an ebook app such as Apple Books or Google Play Books.</p>
      )}

      {note && <p className="text-xs text-center" style={{ color: '#475569' }}>{note}</p>}
      {error && <p className="text-xs text-center" style={{ color: '#dc2626' }}>{error}</p>}
      {!book.free && !owned && viewer.phase !== 'loading' && (
        <p className="text-[11px] text-center" style={{ color: '#94a3b8' }}>Secure payment with Paystack. Download straight after paying.</p>
      )}
    </div>
  );
}
