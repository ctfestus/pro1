'use client';

/**
 * The product page's price and actions, shown in the hero under the tags.
 *   signed out, for sale -> Buy now with only an email (GuestBuy), or sign in
 *   signed out, free     -> Get it free with a name and email (the link is emailed), or sign in
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
import { signInHref } from '@/lib/auth-redirect';
import { downloadBook } from '@/lib/books/open-preview';
import { clearBookPage, rememberBookPage } from '@/lib/books/pending-return';
import { formatMoney } from '@/lib/books/format';
import { PriceTag } from '@/components/books/store/PriceTag';
import { GuestBuy } from '@/components/books/store/GuestBuy';
import { GuestReturn } from '@/components/books/store/GuestReturn';
import { FreeClaim } from '@/components/books/store/FreeClaim';
import { PRICE_CHANGED_EVENT, useCurrentPrices } from '@/lib/books/use-current-prices';

export interface BuyPanelBook {
  id: string;
  slug: string;
  format: string;
  free: boolean;
  /** As shown now: the sale price while a sale is on, with the regular price as `original`. */
  prices: { currency: string; amount: number; original?: number; saleEndsAt?: string }[];
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
  const [viewer, setViewer] = useState<Viewer>({ phase: 'loading' });
  const [currency, setCurrency] = useState(book.prices[0]?.currency ?? '');
  const [busy, setBusy] = useState<null | 'buy' | 'download' | 'sample'>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  // Paystack sent a guest buyer back here (lib/paystack.ts paystackGuestBookCallbackUrl).
  const [guestReference, setGuestReference] = useState<string | null>(null);
  const [retryAllowed, setRetryAllowed] = useState(false);
  const allowRetry = useCallback(() => setRetryAllowed(true), []);
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('guest_reference');
    if (ref && ref.startsWith('book-') && ref.length <= 100) setGuestReference(ref);
  }, []);

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

  // Prices as shown now, shared with the phone price bar (lib/books/use-current-prices.ts).
  const prices = useCurrentPrices(book.prices);
  const price = prices.find(p => p.currency === currency) ?? prices[0];
  const backHere = `/products/${book.slug}`;

  async function buy() {
    if (viewer.phase !== 'signedIn' || !price) return;
    setError(''); setNote(''); setBusy('buy');
    try {
      const token = await currentToken();
      if (!token) { setViewer({ phase: 'signedOut' }); setError('Your session ended. Sign in again to buy.'); return; }
      const res = await fetch('/api/books/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bookId: book.id, currency: price.currency, expectedAmount: price.amount }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.authorizationUrl) { window.location.href = d.authorizationUrl; return; }
      if (res.ok && d.status === 'paid') { setViewer({ phase: 'signedIn', owned: true }); setNote('You already paid for this product. It is in My Products.'); return; }
      if (res.ok && d.status) { setNote('A payment for this product is already being checked. See My Products for its status.'); return; }
      if (res.status === 409 && d.priceChanged && d.price && typeof d.price.amount === 'number') {
        window.dispatchEvent(new CustomEvent(PRICE_CHANGED_EVENT, { detail: d.price }));
        setNote('The price has changed. Check the new price and press Buy again.');
        return;
      }
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
      setError(e?.message || 'Could not download the product.');
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

  const primaryBtn = 'inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-2xl text-[15px] font-semibold disabled:opacity-60 transition-transform active:scale-[0.98]';
  const secondaryBtn = 'inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl text-[15px] font-semibold disabled:opacity-60 transition-transform active:scale-[0.98]';
  const secondaryStyle = { background: '#ffffff', color: '#0f172a', boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -12px rgba(15,23,42,0.2)' };
  const owned = viewer.phase === 'signedIn' && viewer.owned;
  const saleEnds = price?.saleEndsAt ? new Date(price.saleEndsAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <div>
      {guestReference && (
        <div className="mb-5"><GuestReturn reference={guestReference} primaryColor={primaryColor} onRetryAllowed={allowRetry} /></div>
      )}
      {book.free ? (
        <p className="text-3xl font-extrabold tracking-tight" style={{ color: '#16a34a' }}>Free</p>
      ) : price ? (
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-2">
          <PriceTag prices={[price]} className="text-3xl font-extrabold tracking-tight" style={{ color: '#0f172a' }} />
          {price.original !== undefined && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#ffffff', color: '#16a34a' }}>
              Save {formatMoney(price.original - price.amount, price.currency)}{saleEnds ? ` until ${saleEnds}` : ''}
            </span>
          )}
          {prices.length > 1 && (
            <select value={currency} onChange={e => setCurrency(e.target.value)} aria-label="Currency"
              className="rounded-xl px-3 py-2 text-sm outline-none" style={{ background: '#ffffff', color: '#334155' }}>
              {prices.map(p => <option key={p.currency} value={p.currency}>{p.currency}</option>)}
            </select>
          )}
        </div>
      ) : null}

      <div className="mt-5 flex flex-col sm:flex-row sm:items-start flex-wrap gap-3">
        {viewer.phase === 'loading' ? (
          <div className={`${primaryBtn} min-w-[200px]`} style={{ background: '#E8EBEF', color: '#94a3b8' }}><Loader2 className="w-4 h-4 animate-spin" /></div>
        ) : owned ? (
          <>
            <button onClick={download} disabled={busy === 'download'} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
              {busy === 'download' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download
            </button>
            <Link href="/student#products" className={secondaryBtn} style={secondaryStyle}>
              <BookOpen className="w-4 h-4" /> Open My Products
            </Link>
          </>
        ) : viewer.phase === 'signedOut' && !book.free && price && guestReference && !retryAllowed ? (
          // Back from Paystack: the return panel above handles it; no second Buy while it confirms.
          null
        ) : viewer.phase === 'signedOut' && !book.free && price ? (
          // No account needed to buy (lib/books/guest-access.ts); signing in stays one click away.
          <GuestBuy bookId={book.id} price={price} primaryColor={primaryColor} primaryBtn={primaryBtn} />
        ) : viewer.phase === 'signedOut' && book.free ? (
          // Free without an account: the link is emailed, so only the owner of the address gets it.
          <FreeClaim bookId={book.id} primaryColor={primaryColor} primaryBtn={primaryBtn} />
        ) : viewer.phase === 'signedOut' ? (
          <Link href={signInHref(backHere)} onClick={() => rememberBookPage(book.slug)} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
            Sign in to buy
          </Link>
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
          <button onClick={openSample} disabled={busy === 'sample'} className={secondaryBtn} style={secondaryStyle}>
            {busy === 'sample' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            {book.format === 'epub' ? 'Download free sample' : 'Read free sample'}
          </button>
        )}
      </div>

      {viewer.phase === 'signedOut' && (book.free || (price && (!guestReference || retryAllowed))) && (
        // Below the buttons, for buyers who would rather keep it in My Products.
        <p className="mt-4 text-sm" style={{ color: '#64748b' }}>
          Have an account?{' '}
          <Link href={signInHref(backHere)} onClick={() => rememberBookPage(book.slug)} className="font-semibold underline underline-offset-2" style={{ color: '#0f172a' }}>
            Sign in
          </Link>
          {book.free ? ' to download it now.' : ''}
        </p>
      )}
      {owned && !book.free && <p className="mt-3 text-sm" style={{ color: '#16a34a' }}>You own this product.</p>}
      {book.hasSample && !owned && book.format === 'epub' && (
        <p className="mt-3 text-xs" style={{ color: '#64748b' }}>Open the sample in an ebook app such as Apple Books or Google Play Books.</p>
      )}
      {note && <p className="mt-3 text-sm" style={{ color: '#475569' }}>{note}</p>}
      {error && <p className="mt-3 text-sm" style={{ color: '#dc2626' }}>{error}</p>}
    </div>
  );
}
