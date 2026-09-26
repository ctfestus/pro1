'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, ExternalLink, Loader2 } from 'lucide-react';
import { ApplicationQuestionFields } from '@/components/ApplicationQuestionFields';
import { validateApplicationAnswers, type ApplicationAnswer, type ApplicationFormRecord } from '@/lib/application-forms';
import type { ApplicationRelatedItem } from '@/lib/application-related';
import { useC, cardStyle } from '@/lib/theme';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type PublicApplicationForm = ApplicationFormRecord & { availability: 'open' | 'not_open' | 'paused' | 'closed' };

export function ApplicationStart({ slug = '', previewForm, previewRelatedItems = [] }: {
  slug?: string;
  previewForm?: ApplicationFormRecord;
  previewRelatedItems?: ApplicationRelatedItem[];
}) {
  const C = useC();
  const preview = Boolean(previewForm);
  const [form, setForm] = useState<any>(() => previewForm ? { ...previewForm, availability: 'open' } : null);
  const [email, setEmail] = useState('');
  const [answers, setAnswers] = useState<Record<string, ApplicationAnswer>>({});
  const [sessionToken, setSessionToken] = useState('');
  const [submission, setSubmission] = useState<any>(null);
  const [relatedItems, setRelatedItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(!previewForm);
  const [submitting, setSubmitting] = useState(false);
  const [emailWarning, setEmailWarning] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [emailError, setEmailError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (previewForm) {
      setForm({ ...previewForm, availability: 'open' });
      setLoading(false);
      return;
    }
    fetch(`/api/public/application-forms/${encodeURIComponent(slug)}`)
      .then(async response => ({ ok: response.ok, data: await response.json() }))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Application form not found.');
        setForm(data.form);
      })
      .catch(error => setMessage(error.message || 'This application form is temporarily unavailable.'))
      .finally(() => setLoading(false));
  }, [previewForm, slug]);

  useEffect(() => {
    if (preview || !submission || form?.config?.postSubmission?.type !== 'redirect') return;
    try {
      const url = new URL(form.config.postSubmission.redirectUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      const timer = window.setTimeout(() => { window.location.href = url.toString(); }, 3000);
      return () => window.clearTimeout(timer);
    } catch { return; }
  }, [form, preview, submission]);

  async function ensureUploadToken(): Promise<string> {
    if (preview) throw new Error('File uploads are not sent in preview.');
    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setEmailError('Enter your email address before uploading a file.');
      throw new Error('Enter your email address before uploading a file.');
    }
    if (sessionToken) return sessionToken;
    const response = await fetch(`/api/public/application-forms/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'session', email: normalizedEmail }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not prepare the file upload.');
    setSessionToken(value.token);
    return value.token;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (preview) {
      const normalizedEmail = email.trim().toLowerCase();
      setEmailError('');
      setErrors({});
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        setEmailError('Enter a valid email address.');
        return;
      }
      const validationErrors = validateApplicationAnswers(form.config, answers);
      if (Object.keys(validationErrors).length) {
        setErrors(validationErrors);
        return;
      }
      setSubmission({ reference: 'PREVIEW-APPLICATION', status: 'Application received' });
      setSessionToken('preview');
      setRelatedItems(previewRelatedItems);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    setEmailError('');
    setErrors({});
    setMessage('');
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/public/application-forms/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit', email: normalizedEmail, answers, sessionToken }),
      });
      const value = await response.json();
      if (!response.ok) {
        if (value.errors) setErrors(value.errors);
        throw new Error(value.error || 'Could not submit this application.');
      }
      setSessionToken(value.token);
      setSubmission(value.submission);
      setRelatedItems(value.relatedItems ?? []);
      setForm((current: PublicApplicationForm | null) => value.postSubmission && current
        ? { ...current, config: { ...current.config, postSubmission: value.postSubmission } }
        : current);
      setEmailWarning(value.emailSent === false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen grid place-items-center" style={{ background: C.page }}><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.cta }} /></div>;
  }

  if (!form) {
    return <div className="min-h-screen grid place-items-center px-4" style={{ background: C.page, color: C.errorText }}>{message}</div>;
  }

  const post = form.config.postSubmission;
  if (submission) {
    const statusUrl = `/applications/${encodeURIComponent(sessionToken)}`;
    return (
      <main className="min-h-screen px-4 py-10" style={{ background: C.page }}>
        <div className="max-w-2xl mx-auto space-y-4">
          <div className="rounded-2xl p-7 sm:p-9 text-center" style={cardStyle(C)}>
            <CheckCircle2 className="w-14 h-14 mx-auto mb-4" style={{ color: C.successText }} />
            <h1 className="text-2xl font-bold" style={{ color: C.text }}>Application received</h1>
            <p className="mt-2 text-sm" style={{ color: C.muted }}>{form.config.confirmationMessage}</p>
            <div className="mt-6 grid sm:grid-cols-2 gap-3 text-left">
              <div className="rounded-xl p-4" style={{ background: C.input }}><p className="text-xs" style={{ color: C.faint }}>Reference number</p><p className="font-bold mt-1" style={{ color: C.text }}>{submission.reference}</p></div>
              <div className="rounded-xl p-4" style={{ background: C.input }}><p className="text-xs" style={{ color: C.faint }}>Current status</p><p className="font-bold mt-1" style={{ color: C.successText }}>{submission.status}</p></div>
            </div>
            {preview
              ? <span className="inline-flex items-center gap-2 mt-5 text-sm font-semibold" style={{ color: C.cta }}>Check application status <ExternalLink className="w-4 h-4" /></span>
              : <a href={statusUrl} className="inline-flex items-center gap-2 mt-5 text-sm font-semibold" style={{ color: C.cta }}>Check application status <ExternalLink className="w-4 h-4" /></a>}
            {emailWarning && <p className="mt-4 text-xs" style={{ color: C.errorText }}>Your application was received, but the confirmation email could not be sent. Keep the reference number and status link shown here.</p>}
          </div>
          {post.type === 'notice' && <div className="rounded-2xl p-5" style={cardStyle(C)}><h2 className="font-bold" style={{ color: C.text }}>{post.noticeTitle || 'What happens next'}</h2><p className="text-sm mt-2 whitespace-pre-line" style={{ color: C.muted }}>{post.noticeBody}</p></div>}
          {post.type === 'button' && post.buttonUrl && <a href={post.buttonUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-xl p-3 font-semibold text-sm" style={{ background: C.cta, color: C.ctaText }}>{post.buttonLabel || 'Continue'} <ExternalLink className="w-4 h-4" /></a>}
          {post.type === 'redirect' && <div className="rounded-xl p-4 text-center text-sm" style={{ ...cardStyle(C), color: C.muted }}>{preview ? 'Participants will be redirected after submission.' : <><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Redirecting in a moment...</>}</div>}
          {post.type === 'events' && relatedItems.length > 0 && <div className="rounded-2xl p-5" style={cardStyle(C)}><h2 className="font-bold mb-3" style={{ color: C.text }}>You might also like</h2><div className="space-y-2">{relatedItems.map(item => <a key={item.id} href={`/${item.slug || item.id}`} className="flex items-center justify-between rounded-xl p-3 text-sm" style={{ background: C.input, color: C.text }}><span>{item.title}</span><ExternalLink className="w-4 h-4" /></a>)}</div></div>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8" style={{ background: C.page }}>
      <form onSubmit={submit} className="max-w-2xl mx-auto rounded-2xl p-6 sm:p-9" style={cardStyle(C)}>
        <div className="mb-7">
          <h1 className="text-2xl sm:text-3xl font-bold" style={{ color: C.text }}>{form.config.title}</h1>
          <p className="mt-3 text-sm leading-6 whitespace-pre-line" style={{ color: C.muted }}>{form.config.description}</p>
          {form.config.eligibility && <div className="mt-5 rounded-xl p-4" style={{ background: C.input }}><p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: C.faint }}>Eligibility</p><p className="text-sm whitespace-pre-line" style={{ color: C.text }}>{form.config.eligibility}</p></div>}
          {form.config.closesAt && <p className="flex items-center gap-2 text-xs mt-4" style={{ color: C.faint }}><Clock className="w-4 h-4" /> Closes {new Date(form.config.closesAt).toLocaleString()}</p>}
        </div>

        {form.availability === 'open' ? <>
          <div className="mb-6">
            <label className="block text-sm font-semibold mb-1.5" style={{ color: C.text }}>Email address *</label>
            <input type="email" required value={email} onChange={event => { setEmail(event.target.value); setEmailError(''); }} placeholder="you@example.com"
              className="w-full px-3 py-3 rounded-xl outline-none" style={{ background: C.input, color: C.text, border: `1px solid ${C.inputBorder}` }} />
            <p className="text-xs mt-1.5" style={{ color: emailError ? C.errorText : C.faint }}>{emailError || 'A confirmation and private status link will be sent after you submit.'}</p>
          </div>
          <ApplicationQuestionFields questions={form.config.questions} answers={answers} onChange={setAnswers} errors={errors} C={C} uploadToken={sessionToken} ensureUploadToken={ensureUploadToken} previewUploads={preview} />
          {message && <p className="mt-5 rounded-xl p-3 text-sm" style={{ background: preview ? C.successBg : C.errorBg, color: preview ? C.successText : C.errorText }}>{message}</p>}
          <button type="submit" disabled={submitting} className="w-full mt-8 px-5 py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: C.cta, color: C.ctaText }}>
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Submit application
          </button>
        </> : <div className="rounded-xl p-4 text-sm" style={{ background: C.errorBg, color: C.errorText }}>{form.availability === 'not_open' ? 'Applications have not opened yet.' : form.availability === 'paused' ? 'Applications are temporarily paused.' : 'Applications are closed.'}</div>}
      </form>
    </main>
  );
}
