'use client';

/**
 * Buying a product without an account (signed-out visitors). The buyer types their email twice,
 * pays on Paystack and comes back to this product's page, where GuestReturn collects the download.
 * The return code for the checkout stays in this browser (lib/books/guest-checkout-store.ts).
 */
import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { formatMoney } from '@/lib/books/format';
import { latestGuestCheckout, rememberGuestCheckout } from '@/lib/books/guest-checkout-store';
import { PRICE_CHANGED_EVENT } from '@/lib/books/use-current-prices';

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim());

export function GuestBuy({ bookId, price, signInLink, onSignIn, primaryColor, primaryBtn }: {
  bookId: string;
  price: { currency: string; amount: number };
  signInLink: string;
  onSignIn: () => void;
  primaryColor: string;
  primaryBtn: string;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setNote('');
    const clean = email.trim().toLowerCase();
    if (!isEmail(clean)) { setError('Enter a valid email address.'); return; }
    if (clean !== again.trim().toLowerCase()) { setError('The two email addresses do not match.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/books/guest-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId, email: clean, currency: price.currency, expectedAmount: price.amount,
          resume: latestGuestCheckout(bookId, clean),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.reference && d.returnCode) {
        rememberGuestCheckout(d.reference, { code: d.returnCode, bookId, email: clean });
        if (d.authorizationUrl) { window.location.href = d.authorizationUrl; return; }
        // Already paid on an earlier attempt from this browser: collect it here.
        window.location.href = `${window.location.pathname}?guest_reference=${encodeURIComponent(d.reference)}`;
        return;
      }
      if (res.status === 409 && d.priceChanged && d.price && typeof d.price.amount === 'number') {
        window.dispatchEvent(new CustomEvent(PRICE_CHANGED_EVENT, { detail: d.price }));
        setNote('The price has changed. Check the new price and press Pay again.');
        return;
      }
      throw new Error(d.error || 'Could not start the checkout.');
    } catch (err: any) {
      setError(err?.message || 'Could not start the checkout.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <button onClick={() => setOpen(true)} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
          Buy now
        </button>
        <Link href={signInLink} onClick={onSignIn} className="text-sm font-semibold text-center sm:text-left px-2" style={{ color: '#334155' }}>
          Have an account? Sign in
        </Link>
      </div>
    );
  }

  const field = 'w-full rounded-2xl px-4 py-3 text-[15px] outline-none';
  const fieldStyle = { background: '#ffffff', color: '#0f172a', boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -12px rgba(15,23,42,0.2)' };
  return (
    <form onSubmit={pay} className="w-full max-w-md space-y-3">
      <p className="text-sm" style={{ color: '#475569' }}>No account needed. We will email your download link here.</p>
      <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Your email" aria-label="Your email" className={field} style={fieldStyle} />
      <input type="email" autoComplete="off" required value={again} onChange={e => setAgain(e.target.value)} placeholder="Type your email again" aria-label="Confirm your email" className={field} style={fieldStyle} />
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
        <button type="submit" disabled={busy} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Pay {formatMoney(price.amount, price.currency)}
        </button>
        <Link href={signInLink} onClick={onSignIn} className="text-sm font-semibold text-center sm:text-left px-2" style={{ color: '#334155' }}>
          Have an account? Sign in
        </Link>
      </div>
      {note && <p className="text-sm" style={{ color: '#475569' }}>{note}</p>}
      {error && <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>}
    </form>
  );
}
