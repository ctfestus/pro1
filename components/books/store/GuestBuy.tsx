'use client';

/**
 * Buying a product without an account (signed-out visitors). The buyer gives their full name and
 * email, pays on Paystack and comes back to this product's page, where GuestReturn collects the download.
 * The return code for the checkout stays in this browser (lib/books/guest-checkout-store.ts).
 */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { formatMoney } from '@/lib/books/format';
import { latestGuestCheckout, rememberGuestCheckout } from '@/lib/books/guest-checkout-store';
import { PRICE_CHANGED_EVENT } from '@/lib/books/use-current-prices';

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim());

export function GuestBuy({ bookId, price, primaryColor, primaryBtn }: {
  bookId: string;
  price: { currency: string; amount: number };
  primaryColor: string;
  primaryBtn: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setNote('');
    const fullName = name.replace(/\s+/g, ' ').trim();
    const clean = email.trim().toLowerCase();
    if (!fullName) { setError('Enter your full name.'); return; }
    if (!isEmail(clean)) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/books/guest-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookId, name: fullName, email: clean, currency: price.currency, expectedAmount: price.amount,
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
      <button onClick={() => setOpen(true)} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
        Buy now
      </button>
    );
  }

  const field = 'w-full rounded-xl px-4 py-2.5 text-sm outline-none';
  const fieldStyle = { background: '#ffffff', color: '#0f172a', boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -12px rgba(15,23,42,0.2)' };
  return (
    // A full row of its own, so the other buttons wrap below the form instead of stretching beside it.
    <div className="w-full basis-full">
    <form onSubmit={pay} className="w-full max-w-md space-y-3">
      <p className="text-sm" style={{ color: '#475569' }}>No account needed. We will email your download link to you.</p>
      <input type="text" autoComplete="name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" aria-label="Full name" className={field} style={fieldStyle} />
      <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" aria-label="Email address" className={field} style={fieldStyle} />
      <button type="submit" disabled={busy} className={`${primaryBtn} w-full sm:w-auto`} style={{ background: primaryColor, color: '#ffffff' }}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Pay {formatMoney(price.amount, price.currency)}
      </button>
      {note && <p className="text-sm" style={{ color: '#475569' }}>{note}</p>}
      {error && <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>}
    </form>
    </div>
  );
}
