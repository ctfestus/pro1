'use client';

/** "Lost your link?": emails a guest buyer's download link again. The answer never says whether the email bought anything. */
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

export function ResendGuestLink({ primaryColor }: { primaryColor: string }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setMessage(''); setBusy(true);
    try {
      const res = await fetch('/api/books/guest-access/resend', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not send the link. Try again.');
      setMessage(d.message || 'If that email has a recent purchase, we have sent the download link to it.');
    } catch (err: any) {
      setError(err?.message || 'Could not send the link. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="flex flex-col sm:flex-row gap-2 max-w-md mx-auto">
      <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="Email you paid with" aria-label="Email you paid with"
        className="flex-1 rounded-2xl px-4 py-3 text-sm outline-none" style={{ background: '#F4F5F7', color: '#0f172a' }} />
      <button type="submit" disabled={busy} className="inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-semibold disabled:opacity-60"
        style={{ background: primaryColor, color: '#ffffff' }}>
        {busy && <Loader2 className="w-4 h-4 animate-spin" />} Send link
      </button>
      {message && <p className="sm:basis-full text-sm" style={{ color: '#16a34a' }}>{message}</p>}
      {error && <p className="sm:basis-full text-sm" style={{ color: '#dc2626' }}>{error}</p>}
    </form>
  );
}
