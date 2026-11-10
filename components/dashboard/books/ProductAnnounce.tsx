'use client';

/**
 * Announce a digital product to every active student (a launch email, migration 241). Shows who
 * it will reach, lets the author write the subject and a formatted message, shows the exact email
 * (Preview) or sends it to the author's own inbox (Send me a test),
 * previews the product card the email carries, and lists past announcements. Data and sending go
 * through /api/books/announce.
 */
import { useEffect, useState } from 'react';
import { Eye, Loader2, Megaphone, Send, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { RichTextEditor } from '@/components/RichTextEditor';

type Info = {
  available: boolean;
  reason?: string;
  recipients: number;
  history: { created_at: string; subject: string; recipients: number; sent: number; failed?: number; status: string; error?: string | null }[];
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export function ProductAnnounce({ book, C }: { book: { id: string; title: string; cover_image: string | null }; C: typeof LIGHT_C }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [subject, setSubject] = useState(`New: ${book.title}`);
  const [message, setMessage] = useState(`<p>We have just released <b>${book.title.replace(/[<>&"]/g, '')}</b>. Take a look and read the free sample.</p>`);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [checking, setChecking] = useState<null | 'preview' | 'test'>(null);
  const [testNote, setTestNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/books/announce?bookId=${encodeURIComponent(book.id)}`, { headers: await authHeaders() });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'Could not load the announcement details.');
        if (!cancelled) setInfo(d as Info);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load the announcement details.');
      }
    })();
    return () => { cancelled = true; };
  }, [book.id]);

  // The exact email (built by the server the same way as a real send), shown here or sent to you.
  async function check(kind: 'preview' | 'test') {
    setChecking(kind); setError(''); setTestNote('');
    try {
      const res = await fetch(`/api/books/announce/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ bookId: book.id, subject, message }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || (kind === 'preview' ? 'Could not build the preview.' : 'Could not send the test email.'));
      if (kind === 'preview') setPreview({ subject: d.subject, html: d.html });
      else setTestNote(`Test sent to ${d.sentTo}. Check your inbox (and spam).`);
    } catch (e: any) {
      setError(e?.message || 'Something went wrong.');
    } finally {
      setChecking(null);
    }
  }

  async function send() {
    if (!info) return;
    if (!window.confirm(`Email ${info.recipients} student${info.recipients === 1 ? '' : 's'} about ${book.title}?`)) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/books/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ bookId: book.id, subject, message }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Could not send the announcement.');
      setDone(`Sending to ${d.recipients} student${d.recipients === 1 ? '' : 's'}. It can take a few minutes to reach everyone.`);
      setInfo(prev => prev && ({ ...prev, history: [{ created_at: new Date().toISOString(), subject, recipients: d.recipients, sent: 0, status: 'sending' }, ...prev.history] }));
    } catch (e: any) {
      setError(e?.message || 'Could not send the announcement.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !info) return <p className="text-xs px-1 py-2" style={{ color: '#f43f5e' }}>{error}</p>;
  if (!info) return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" style={{ color: C.green }} /></div>;

  const field = 'w-full rounded-xl px-3 py-2 text-sm outline-none';
  return (
    <div className="space-y-4">
      {!info.available ? (
        <p className="text-xs" style={{ color: C.faint }}>{info.reason}</p>
      ) : done ? (
        <p className="text-sm" style={{ color: C.green }}>{done}</p>
      ) : (
        <>
          <p className="text-xs" style={{ color: C.faint }}>
            Goes to all {info.recipients} active student{info.recipients === 1 ? '' : 's'}.
          </p>
          <div className="grid gap-3">
            <input className={field} style={{ background: C.input, color: C.text }} value={subject} maxLength={200} onChange={e => setSubject(e.target.value)} aria-label="Subject" placeholder="Subject" />
            <RichTextEditor value={message} onChange={setMessage} placeholder="Your message to students" />
          </div>
          <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: C.pill }}>
            <div className="w-10 h-14 rounded-md overflow-hidden shrink-0" style={{ background: C.card }}>
              {book.cover_image && <img src={resolveCoverUrl(book.cover_image)} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: C.text }}>{book.title}</p>
              <p className="text-[11px]" style={{ color: C.faint }}>The email shows this product with its price and a View product button.</p>
            </div>
          </div>
          {error && <p className="text-xs" style={{ color: '#f43f5e' }}>{error}</p>}
          {testNote && <p className="text-xs" style={{ color: C.green }}>{testNote}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => check('preview')} disabled={checking !== null || !subject.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: C.pill, color: C.text }}>
              {checking === 'preview' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Preview
            </button>
            <button type="button" onClick={() => check('test')} disabled={checking !== null || !subject.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ background: C.pill, color: C.text }}>
              {checking === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Send me a test
            </button>
          </div>
          <button onClick={send} disabled={busy || !subject.trim() || !message.trim() || info.recipients === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: C.cta, color: C.ctaText }}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Megaphone className="w-4 h-4" />} Send to {info.recipients} student{info.recipients === 1 ? '' : 's'}
          </button>
        </>
      )}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" style={{ background: 'rgba(15,23,42,0.6)' }} role="dialog" aria-label="Email preview"
          onClick={e => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div className="w-full max-w-2xl h-[85vh] flex flex-col rounded-2xl overflow-hidden" style={{ background: C.card }}>
            <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: `1px solid ${C.pill}` }}>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: C.faint }}>Subject</p>
                <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{preview.subject}</p>
              </div>
              <button onClick={() => setPreview(null)} aria-label="Close preview" className="p-2 rounded-lg" style={{ color: C.muted }}><X className="w-4 h-4" /></button>
            </div>
            {/* The email as students get it. Sandboxed with nothing allowed: no scripts, no same-origin. */}
            <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="flex-1 w-full" style={{ background: '#ffffff', border: 0 }} />
          </div>
        </div>
      )}
      {info.history.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.faint }}>Past announcements</p>
          <ul className="mt-1 space-y-1">
            {info.history.map(h => (
              <li key={h.created_at} className="text-xs" style={{ color: C.muted }}>
                {new Date(h.created_at).toLocaleDateString()} / {h.subject} / {h.status === 'sending' || h.status === 'preparing' ? `sending to ${h.recipients}` : h.status === 'failed' ? `stopped after ${h.sent} of ${h.recipients}${h.error ? `: ${h.error}` : ''}` : `sent to ${h.sent}${h.failed ? ` (${h.failed} could not be delivered)` : ''}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
