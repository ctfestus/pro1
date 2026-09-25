'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, Mail } from 'lucide-react';
import { useC, cardStyle } from '@/lib/theme';

export function ApplicationStart({ slug }: { slug: string }) {
  const C = useC();
  const [form, setForm] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`/api/public/application-forms/${encodeURIComponent(slug)}`)
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => { if (!ok) setError(data.error || 'Application form not found.'); else setForm(data.form); })
      .catch(() => setError('This application form is temporarily unavailable.'))
      .finally(() => setLoading(false));
  }, [slug]);

  async function sendLink(event: React.FormEvent) {
    event.preventDefault(); setSending(true); setError('');
    try {
      const response = await fetch(`/api/public/application-forms/${encodeURIComponent(slug)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not send the link.');
      setSent(true);
    } catch (reason) { setError((reason as Error).message); }
    finally { setSending(false); }
  }

  if (loading) return <div className="min-h-screen grid place-items-center" style={{ background: C.page }}><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.cta }} /></div>;
  return (
    <main className="min-h-screen px-4 py-10" style={{ background: C.page }}>
      <div className="max-w-2xl mx-auto rounded-2xl p-6 sm:p-9" style={cardStyle(C)}>
        {form ? <>
          <div className="mb-7">
            <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: C.text }}>{form.config.title}</h1>
            <p className="mt-3 text-sm leading-6 whitespace-pre-line" style={{ color: C.muted }}>{form.config.description}</p>
            {form.config.eligibility && <div className="mt-5 rounded-xl p-4" style={{ background: C.input }}><p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.faint }}>Eligibility</p><p className="text-sm whitespace-pre-line" style={{ color: C.text }}>{form.config.eligibility}</p></div>}
            {form.config.closesAt && <p className="flex items-center gap-2 text-xs mt-4" style={{ color: C.faint }}><Clock className="w-4 h-4" /> Closes {new Date(form.config.closesAt).toLocaleString()}</p>}
          </div>
          {sent ? (
            <div className="text-center py-8"><CheckCircle2 className="w-12 h-12 mx-auto mb-3" style={{ color: C.successText }} /><h2 className="text-lg font-bold" style={{ color: C.text }}>Check your email</h2><p className="text-sm mt-2" style={{ color: C.muted }}>We sent a secure link to {email}. Use it to complete or check your application.</p></div>
          ) : form.availability === 'open' ? (
            <form onSubmit={sendLink}>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: C.text }}>Email address *</label>
              <p className="text-xs mb-3" style={{ color: C.faint }}>No account is required. We will email your private application link.</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input type="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com"
                  className="flex-1 px-3 py-3 rounded-xl outline-none" style={{ background: C.input, color: C.text, border: `1px solid ${C.inputBorder}` }} />
                <button disabled={sending} className="px-5 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: C.cta, color: C.ctaText }}>
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />} Email secure link
                </button>
              </div>
            </form>
          ) : <div className="rounded-xl p-4 text-sm" style={{ background: C.errorBg, color: C.errorText }}>{form.availability === 'not_open' ? 'Applications have not opened yet.' : form.availability === 'paused' ? 'Applications are temporarily paused.' : 'Applications are closed.'}</div>}
        </> : null}
        {error && <p className="mt-4 rounded-xl p-3 text-sm" style={{ background: C.errorBg, color: C.errorText }}>{error}</p>}
      </div>
    </main>
  );
}
