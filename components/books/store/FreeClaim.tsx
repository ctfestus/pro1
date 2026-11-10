'use client';

/**
 * "Get it free" for a visitor without an account: their full name and email, and the download link
 * is emailed to them (/api/books/free-claim). Nothing to download is shown on screen, so the file
 * only reaches the owner of the address.
 */
import { useState } from 'react';
import { Loader2, MailCheck } from 'lucide-react';

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v.trim());

export function FreeClaim({ bookId, primaryColor, primaryBtn }: { bookId: string; primaryColor: string; primaryBtn: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState('');
  const [error, setError] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const fullName = name.replace(/\s+/g, ' ').trim();
    const clean = email.trim().toLowerCase();
    if (!fullName) { setError('Enter your full name.'); return; }
    if (!isEmail(clean)) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/books/free-claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId, name: fullName, email: clean }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not send the download link. Try again.');
      setSentTo(clean);
    } catch (err: any) {
      setError(err?.message || 'Could not send the download link. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (sentTo) {
    return (
      <div className="w-full basis-full max-w-md rounded-2xl px-4 py-3 flex items-start gap-3 text-sm"
        style={{ background: '#ffffff', color: '#334155', boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -12px rgba(15,23,42,0.2)' }}>
        <MailCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: '#16a34a' }} />
        <p>Check your email. We sent the download link to <b>{sentTo}</b>. It can take a minute to arrive; look in spam if you do not see it.</p>
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
        Get it free
      </button>
    );
  }

  const field = 'w-full rounded-xl px-4 py-2.5 text-sm outline-none';
  const fieldStyle = { background: '#ffffff', color: '#0f172a', boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -12px rgba(15,23,42,0.2)' };
  return (
    <div className="w-full basis-full">
      <form onSubmit={send} className="w-full max-w-md space-y-3">
        <p className="text-sm" style={{ color: '#475569' }}>No account needed. We will email you the download link.</p>
        <input type="text" autoComplete="name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="Full name" aria-label="Full name" className={field} style={fieldStyle} />
        <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email address" aria-label="Email address" className={field} style={fieldStyle} />
        <button type="submit" disabled={busy} className={`${primaryBtn} w-full sm:w-auto`} style={{ background: primaryColor, color: '#ffffff' }}>
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Email me the link
        </button>
        {error && <p className="text-sm" style={{ color: '#dc2626' }}>{error}</p>}
      </form>
    </div>
  );
}
