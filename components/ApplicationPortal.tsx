'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, Save } from 'lucide-react';
import { ApplicationQuestionFields } from '@/components/ApplicationQuestionFields';
import { isQuestionVisible, type ApplicationAnswer } from '@/lib/application-forms';
import { useC, cardStyle } from '@/lib/theme';

function answerText(value: ApplicationAnswer): string {
  if (value === null || value === undefined || value === '') return 'Not answered';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return value.name;
  return String(value);
}

export function ApplicationPortal({ token }: { token: string }) {
  const C = useC();
  const [data, setData] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, ApplicationAnswer>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [justSubmitted, setJustSubmitted] = useState(false);
  const [emailWarning, setEmailWarning] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch(`/api/public/applications/${encodeURIComponent(token)}`)
      .then(async response => ({ ok: response.ok, value: await response.json() }))
      .then(({ ok, value }) => {
        if (!ok) throw new Error(value.error || 'Application not found.');
        setData(value); setAnswers(value.submission.answers ?? {});
      })
      .catch(error => setMessage(error.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (!justSubmitted || data?.form?.config?.postSubmission?.type !== 'redirect') return;
    const raw = data.form.config.postSubmission.redirectUrl;
    try {
      const url = new URL(raw);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      const timer = window.setTimeout(() => { window.location.href = url.toString(); }, 3000);
      return () => window.clearTimeout(timer);
    } catch { return; }
  }, [data, justSubmitted]);

  const visibleQuestions = useMemo(() => data?.form?.config?.questions?.filter((item: any) => isQuestionVisible(item, answers)) ?? [], [data, answers]);

  async function save() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/public/applications/${encodeURIComponent(token)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not save.');
      setMessage('Draft saved. You can return using this secure link.');
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function submit() {
    setBusy(true); setMessage(''); setErrors({});
    try {
      const response = await fetch(`/api/public/applications/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }),
      });
      const value = await response.json();
      if (!response.ok) {
        if (value.errors) setErrors(value.errors);
        throw new Error(value.error || 'Could not submit.');
      }
      setData((previous: any) => ({ ...previous, submission: value.submission, relatedItems: value.relatedItems ?? [] }));
      setEmailWarning(value.emailSent === false); setJustSubmitted(true); setReview(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) { setMessage((error as Error).message); setReview(false); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="min-h-screen grid place-items-center" style={{ background: C.page }}><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.cta }} /></div>;
  if (!data) return <div className="min-h-screen grid place-items-center px-4" style={{ background: C.page, color: C.errorText }}>{message}</div>;
  const { form, submission } = data;
  const post = form.config.postSubmission;

  if (submission.state === 'submitted') {
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
            {emailWarning && <p className="mt-4 text-xs" style={{ color: C.errorText }}>Your application was saved, but the confirmation email could not be sent. Keep this secure link and reference number.</p>}
          </div>
          {post.type === 'notice' && <div className="rounded-2xl p-5" style={cardStyle(C)}><h2 className="font-bold" style={{ color: C.text }}>{post.noticeTitle || 'What happens next'}</h2><p className="text-sm mt-2 whitespace-pre-line" style={{ color: C.muted }}>{post.noticeBody}</p></div>}
          {post.type === 'button' && post.buttonUrl && <a href={post.buttonUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 rounded-xl p-3 font-semibold text-sm" style={{ background: C.cta, color: C.ctaText }}>{post.buttonLabel || 'Continue'} <ExternalLink className="w-4 h-4" /></a>}
          {post.type === 'redirect' && justSubmitted && <div className="rounded-xl p-4 text-center text-sm" style={{ ...cardStyle(C), color: C.muted }}><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Redirecting in a moment...</div>}
          {post.type === 'events' && data.relatedItems?.length > 0 && <div className="rounded-2xl p-5" style={cardStyle(C)}><h2 className="font-bold mb-3" style={{ color: C.text }}>You might also like</h2><div className="space-y-2">{data.relatedItems.map((item: any) => <a key={item.id} href={`/${item.slug || item.id}`} className="flex items-center justify-between rounded-xl p-3 text-sm" style={{ background: C.input, color: C.text }}><span>{item.title}</span><ExternalLink className="w-4 h-4" /></a>)}</div></div>}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-8" style={{ background: C.page }}>
      <div className="max-w-2xl mx-auto rounded-2xl p-6 sm:p-9" style={cardStyle(C)}>
        <div className="mb-7"><p className="text-xs font-semibold uppercase tracking-wide" style={{ color: C.cta }}>Application {submission.reference}</p><h1 className="text-2xl font-bold mt-2" style={{ color: C.text }}>{review ? 'Review your application' : form.config.title}</h1><p className="text-sm mt-2" style={{ color: C.muted }}>{review ? 'Check your answers before submitting. You cannot edit after submission.' : `Applying as ${submission.email}`}</p></div>
        {review ? (
          <div className="space-y-4">{visibleQuestions.map((question: any) => <div key={question.id} className="rounded-xl p-4" style={{ background: C.input }}><p className="text-xs font-semibold" style={{ color: C.faint }}>{question.label}</p><p className="text-sm mt-1 whitespace-pre-wrap" style={{ color: C.text }}>{answerText(answers[question.id])}</p></div>)}</div>
        ) : <ApplicationQuestionFields questions={form.config.questions} answers={answers} onChange={setAnswers} errors={errors} C={C} uploadToken={token} />}
        {message && <p className="mt-5 rounded-xl p-3 text-sm" style={{ background: message.startsWith('Draft saved') ? C.successBg : C.errorBg, color: message.startsWith('Draft saved') ? C.successText : C.errorText }}>{message}</p>}
        <div className="flex flex-col-reverse sm:flex-row justify-between gap-2 mt-8">
          {review ? <button type="button" onClick={() => setReview(false)} className="px-4 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2" style={{ background: C.pill, color: C.muted }}><ArrowLeft className="w-4 h-4" /> Edit answers</button> : <button type="button" disabled={busy} onClick={save} className="px-4 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2" style={{ background: C.pill, color: C.muted }}><Save className="w-4 h-4" /> Save draft</button>}
          {review ? <button type="button" disabled={busy} onClick={submit} className="px-5 py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60" style={{ background: C.cta, color: C.ctaText }}>{busy && <Loader2 className="w-4 h-4 animate-spin" />} Submit application</button> : <button type="button" onClick={() => { setMessage(''); setReview(true); }} className="px-5 py-3 rounded-xl text-sm font-semibold" style={{ background: C.cta, color: C.ctaText }}>Review application</button>}
        </div>
      </div>
    </main>
  );
}
