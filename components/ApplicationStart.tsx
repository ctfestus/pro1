'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, Clock, CornerDownLeft, ExternalLink, Loader2, Mail, PencilLine, Send, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { ApplicationQuestionFields } from '@/components/ApplicationQuestionFields';
import { ApplicationRelatedCards } from '@/components/ApplicationRelatedCards';
import { ApplicationFramedImage } from '@/components/ApplicationFramedImage';
import { applicationCoverFrame } from '@/lib/application-cover';
import { isApplicationContentBlock, isQuestionVisible, validateApplicationAnswers, type ApplicationAnswer, type ApplicationFormRecord } from '@/lib/application-forms';
import type { ApplicationRelatedItem } from '@/lib/application-related';
import { applicationThemeColors } from '@/lib/application-theme-presets';
import { sanitizeRichText } from '@/lib/sanitize';
import { useC, cardStyle, type ThemeColors } from '@/lib/theme';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// One-page layout: bring the field that needs attention into view.
function scrollToApplicationField(id: string) {
  window.setTimeout(() => document.getElementById(`application-question-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
}

function applicationRichText(value: string): string {
  if (/<\/?(?:p|br|strong|b|em|i|u|s|ul|ol|li|h[1-4]|blockquote|a|code|pre|hr|span|table|thead|tbody|tfoot|tr|th|td|caption)\b/i.test(value)) {
    return sanitizeRichText(value);
  }
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  return sanitizeRichText(escaped.replace(/\r?\n/g, '<br>'));
}

function answerSummary(value: ApplicationAnswer | undefined): string {
  if (value === null || value === undefined || value === '') return 'Not answered';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'Not answered';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return value.name || 'Uploaded file';
  return String(value);
}

type PublicApplicationForm = ApplicationFormRecord & { availability: 'open' | 'not_open' | 'paused' | 'closed' };

function TypewriterPrompt({ text, C }: { text: string; C: ThemeColors }) {
  const [visible, setVisible] = useState('');

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const reducedMotionTimer = window.setTimeout(() => setVisible(text), 0);
      return () => window.clearTimeout(reducedMotionTimer);
    }
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setVisible(text.slice(0, index));
      if (index >= text.length) window.clearInterval(timer);
    }, 22);
    return () => window.clearInterval(timer);
  }, [text]);

  return (
    <h2 className="text-xl font-bold leading-snug sm:text-3xl" style={{ color: C.text }} aria-label={text}>
      <span aria-hidden="true">{visible}</span>
      <motion.span aria-hidden="true" className="ml-0.5 inline-block h-[1em] w-0.5 align-[-0.12em]" style={{ background: C.accent }} animate={{ opacity: [1, 0, 1] }} transition={{ duration: 0.85, repeat: Infinity }} />
    </h2>
  );
}

function ApplicationDeadlineTimer({ closesAt, C }: { closesAt: string; C: ThemeColors }) {
  const [now, setNow] = useState(() => Date.now());
  const deadline = new Date(closesAt).getTime();
  const remaining = Number.isFinite(deadline) ? Math.max(0, deadline - now) : 0;
  const expired = !Number.isFinite(deadline) || remaining === 0;

  useEffect(() => {
    if (!Number.isFinite(deadline) || deadline <= Date.now()) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [deadline]);

  if (expired) {
    return <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5" style={{ background: C.errorBg, color: C.errorText }}><span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: C.card }}><Clock className="h-3.5 w-3.5" /></span><div><p className="text-xs font-bold uppercase tracking-wider">Applications closed</p><p className="text-[10px] opacity-70">The deadline has passed.</p></div></div>;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const units = [
    { label: 'Days', shortLabel: 'D', value: Math.floor(totalSeconds / 86400) },
    { label: 'Hours', shortLabel: 'H', value: Math.floor((totalSeconds % 86400) / 3600) },
    { label: 'Minutes', shortLabel: 'M', value: Math.floor((totalSeconds % 3600) / 60) },
    { label: 'Seconds', shortLabel: 'S', value: totalSeconds % 60 },
  ];
  const closingDate = new Date(closesAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="relative flex items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 sm:px-4"
      style={{ background: C.skeleton }}
      role="timer"
      aria-label={`Applications close in ${units[0].value} days, ${units[1].value} hours, ${units[2].value} minutes, and ${units[3].value} seconds`}
    >
      <motion.span className="pointer-events-none absolute inset-y-0 w-12 -skew-x-12" style={{ background: `linear-gradient(90deg, transparent, color-mix(in srgb, ${C.accent} 14%, transparent), transparent)` }} animate={{ left: ['-20%', '120%'] }} transition={{ duration: 4, repeat: Infinity, repeatDelay: 1.5, ease: 'easeInOut' }} />
      <div className="relative flex min-w-0 items-center gap-2.5">
        <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: C.card, color: C.accent }}>
          <motion.span className="absolute h-1.5 w-1.5 rounded-full" style={{ background: C.accent }} animate={{ opacity: [1, 0.25, 1], scale: [1, 0.75, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
          <Clock className="h-3.5 w-3.5 opacity-0" />
        </span>
        <div className="min-w-0">
          <p className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: C.muted }}>Closes in</p>
          <p className="hidden truncate text-[9px] sm:block" style={{ color: C.faint }}>{closingDate}</p>
        </div>
      </div>
      <div className="relative ml-auto flex items-center" style={{ fontFamily: 'var(--font-mono), ui-monospace, monospace' }} aria-hidden="true">
        {units.map((unit, index) => (
          <div key={unit.label} className="flex items-center">
            <span className="relative inline-flex min-w-[34px] items-baseline justify-center overflow-hidden rounded-lg px-1.5 py-1.5 sm:min-w-[42px]" style={{ background: C.card }}>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span key={unit.value} initial={{ opacity: 0, y: -8, filter: 'blur(3px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: 8, filter: 'blur(3px)' }} transition={{ duration: 0.18, ease: 'easeOut' }} className="text-sm font-bold tabular-nums sm:text-base" style={{ color: unit.label === 'Seconds' ? C.accent : C.text }}>
                  {String(unit.value).padStart(2, '0')}
                </motion.span>
              </AnimatePresence>
              <span className="ml-0.5 text-[7px] font-bold" style={{ color: C.faint }}>{unit.shortLabel}</span>
            </span>
            {index < units.length - 1 && <motion.span className="mx-0.5 text-[10px] font-bold sm:mx-1" style={{ color: C.faint }} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }}>:</motion.span>}
          </div>
        ))}
      </div>
    </motion.div>
  );
}

export function ApplicationStart({ slug = '', previewForm, previewRelatedItems = [] }: {
  slug?: string;
  previewForm?: ApplicationFormRecord;
  previewRelatedItems?: ApplicationRelatedItem[];
}) {
  const baseC = useC();
  const preview = Boolean(previewForm);
  const [form, setForm] = useState<PublicApplicationForm | null>(() => previewForm ? { ...previewForm, availability: 'open' } : null);
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
  const [started, setStarted] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [stepDirection, setStepDirection] = useState(1);

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
    const redirectUrl = form?.config?.postSubmission?.redirectUrl;
    if (preview || !submission || form?.config?.postSubmission?.type !== 'redirect' || !redirectUrl) return;
    try {
      const url = new URL(redirectUrl);
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
      if (form?.config.layout === 'list') scrollToApplicationField('email');
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
    if (!form) {
      setMessage('This application form is temporarily unavailable.');
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    setEmailError('');
    setErrors({});
    setMessage('');
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setEmailError('Enter a valid email address.');
      setReviewing(false);
      setActiveStep(0);
      if (form.config.layout === 'list') scrollToApplicationField('email');
      return;
    }
    const validationErrors = validateApplicationAnswers(form.config, answers);
    if (Object.keys(validationErrors).length) {
      setErrors(validationErrors);
      const firstInvalid = visibleQuestions.findIndex(question => validationErrors[question.id]);
      setReviewing(false);
      setActiveStep(firstInvalid >= 0 ? firstInvalid + 1 : 0);
      if (form.config.layout === 'list' && firstInvalid >= 0) scrollToApplicationField(visibleQuestions[firstInvalid].id);
      return;
    }
    if (preview) {
      setSubmission({ reference: 'PREVIEW-APPLICATION', status: 'Application received' });
      setSessionToken('preview');
      setRelatedItems(previewRelatedItems);
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
        if (value.errors) {
          setErrors(value.errors);
          const firstInvalid = visibleQuestions.findIndex(question => value.errors[question.id]);
          if (firstInvalid >= 0) {
            setReviewing(false);
            setActiveStep(firstInvalid + 1);
            if (form.config.layout === 'list') scrollToApplicationField(visibleQuestions[firstInvalid].id);
          }
        }
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
    return <div className="min-h-screen grid place-items-center" style={{ background: baseC.page }}><Loader2 className="w-6 h-6 animate-spin" style={{ color: baseC.cta }} /></div>;
  }

  if (!form) {
    return <div className="min-h-screen grid place-items-center px-4" style={{ background: baseC.page, color: baseC.errorText }}>{message}</div>;
  }

  const C = applicationThemeColors(baseC, form.config.themeColor, form.config.theme ?? 'platform', form.config.customTheme, form.config.themeMode ?? 'light');
  const themedPageStyle = { background: C.page, '--application-focus-color': C.cta } as CSSProperties;
  const post = form.config.postSubmission;
  const coverImage = form.config.coverImage?.trim();
  const coverAlt = form.config.coverImageAlt?.trim() || `${form.config.title} cover`;
  const coverPlacement = form.config.coverImagePlacement ?? 'header';
  const coverFrame = applicationCoverFrame(form.config);
  const visibleQuestions = form.config.questions.filter(question => isQuestionVisible(question, answers));
  const listLayout = form.config.layout === 'list';
  // The one-page layout has no separate start step: the overview details stay visible above the questions.
  const showOverviewDetails = listLayout || !started;
  const stepCount = visibleQuestions.length + 1;
  const currentStep = Math.min(activeStep, Math.max(0, stepCount - 1));
  const currentQuestion = currentStep === 0 ? null : visibleQuestions[currentStep - 1];
  const emailPrompt = form.config.emailPrompt?.trim() || 'What is your email address?';
  const emailHelpText = form.config.emailHelpText === undefined
    ? 'For confirmation and status updates.'
    : form.config.emailHelpText.trim();
  const currentHelpText = currentQuestion
    ? isApplicationContentBlock(currentQuestion) ? '' : currentQuestion.helpText || 'Take your time. You can review this before submitting.'
    : emailHelpText;
  const flowProgress = reviewing ? 100 : Math.round(((currentStep + 1) / (stepCount + 1)) * 100);
  const enterAdvances = currentStep === 0 || Boolean(currentQuestion && ['short_text', 'email', 'phone', 'number', 'date'].includes(currentQuestion.type));

  function editStep(index: number) {
    setStepDirection(-1);
    setReviewing(false);
    setActiveStep(index);
    window.setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 40);
  }

  function continueFlow() {
    if (!form) return;
    setEmailError('');
    if (currentStep === 0) {
      if (!EMAIL_PATTERN.test(email.trim().toLowerCase())) {
        setEmailError('Enter a valid email address.');
        return;
      }
    } else if (currentQuestion) {
      const validation = validateApplicationAnswers(form.config, answers);
      if (validation[currentQuestion.id]) {
        setErrors(previous => ({ ...previous, [currentQuestion.id]: validation[currentQuestion.id] }));
        return;
      }
      setErrors(previous => ({ ...previous, [currentQuestion.id]: '' }));
    }
    setStepDirection(1);
    if (currentStep >= stepCount - 1) setReviewing(true);
    else setActiveStep(currentStep + 1);
  }

  function previousStep() {
    if (reviewing) {
      setReviewing(false);
      setActiveStep(Math.max(0, stepCount - 1));
      return;
    }
    if (currentStep > 0) {
      setStepDirection(-1);
      setActiveStep(currentStep - 1);
      return;
    }
    setStarted(false);
    window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 40);
  }
  if (submission) {
    const statusUrl = `/applications/${encodeURIComponent(sessionToken)}`;
    return (
      <main className="application-theme-scope platform-font-scope min-h-screen px-4 py-8 sm:py-12" style={themedPageStyle}>
        <div className="relative mx-auto max-w-3xl space-y-4">
          {coverImage && <ApplicationFramedImage src={coverImage} alt={coverAlt} frame={coverFrame} className="h-40 sm:h-56" style={{ ...cardStyle(C), background: C.skeleton, borderRadius: 12 }} />}
          <section className="p-7 text-center sm:p-10" style={{ ...cardStyle(C), borderRadius: 12 }}>
            <span className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-xl" style={{ background: C.successBg, color: C.successText }}><CheckCircle2 className="h-8 w-8" /></span>
            <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: C.successText }}>Successfully submitted</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl" style={{ color: C.text }}>Application received</h1>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-6" style={{ color: C.muted }}>{form.config.confirmationMessage}</p>
            <div className="mt-7 grid gap-3 text-left sm:grid-cols-2">
              <div className="p-4" style={{ background: C.input, borderRadius: 10 }}><p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.faint }}>Reference number</p><p className="mt-1 font-bold" style={{ color: C.text }}>{submission.reference}</p></div>
              <div className="p-4" style={{ background: C.successBg, borderRadius: 10 }}><p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: C.faint }}>Current status</p><p className="mt-1 font-bold" style={{ color: C.successText }}>{submission.status}</p></div>
            </div>
            {preview
              ? <span className="mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: C.pill, color: C.cta }}>Check application status <ArrowRight className="h-4 w-4" /></span>
              : <a href={statusUrl} className="mt-6 inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold" style={{ background: C.pill, color: C.cta }}>Check application status <ArrowRight className="h-4 w-4" /></a>}
            {emailWarning && <p className="mt-4 rounded-xl p-3 text-xs" style={{ background: C.errorBg, color: C.errorText }}>Your application was received, but the confirmation email could not be sent. Keep the reference number and status link shown here.</p>}
          </section>
          {post.type === 'notice' && <section className="p-5 sm:p-6" style={{ ...cardStyle(C), borderRadius: 12 }}><h2 className="font-bold" style={{ color: C.text }}>{post.noticeTitle || 'What happens next'}</h2><p className="mt-2 whitespace-pre-line text-sm leading-6" style={{ color: C.muted }}>{post.noticeBody}</p></section>}
          {post.type === 'button' && post.buttonUrl && <a href={post.buttonUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 p-4 text-sm font-semibold" style={{ background: C.cta, color: C.ctaText, borderRadius: 10 }}>{post.buttonLabel || 'Continue'} <ExternalLink className="h-4 w-4" /></a>}
          {post.type === 'redirect' && <div className="p-4 text-center text-sm" style={{ ...cardStyle(C), color: C.muted, borderRadius: 10 }}>{preview ? 'Participants will be redirected after submission.' : <><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Redirecting in a moment...</>}</div>}
          {post.type === 'events' && relatedItems.length > 0 && <section className="p-5 sm:p-6" style={{ ...cardStyle(C), borderRadius: 12 }}><h2 className="mb-4 font-bold" style={{ color: C.text }}>You might also like</h2><ApplicationRelatedCards items={relatedItems} C={C} /></section>}
        </div>
      </main>
    );
  }

  return (
    <main className="application-theme-scope platform-font-scope min-h-screen px-4 py-6 sm:py-10" style={themedPageStyle}>
      <div className="mx-auto max-w-3xl">
        {coverImage && coverPlacement === 'header' && <ApplicationFramedImage src={coverImage} alt={coverAlt} frame={coverFrame} className="mb-4 h-36 sm:h-56" style={{ ...cardStyle(C), background: C.skeleton, borderRadius: 12 }} />}
        <form onSubmit={submit} className="space-y-4">
          <section className="overflow-hidden" style={{ ...cardStyle(C), borderRadius: 12 }}>
            {coverImage && coverPlacement === 'inside' && <ApplicationFramedImage src={coverImage} alt={coverAlt} frame={coverFrame} className="h-36 sm:h-52" style={{ background: C.skeleton }} />}
            <div className="p-6 sm:p-9">
              <span className="rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em]" style={{ background: C.pill, color: C.muted }}>Programme application</span>
              <h1 className="mt-4 text-2xl font-bold leading-tight sm:text-4xl" style={{ color: C.text }}>{form.config.title}</h1>
              <p className="mt-3 whitespace-pre-line text-sm leading-6" style={{ color: C.muted }}>{form.config.description}</p>
              {showOverviewDetails && form.config.closesAt && <div className="mt-6"><ApplicationDeadlineTimer closesAt={form.config.closesAt} C={C} /></div>}
              {showOverviewDetails && form.config.eligibility && <div className="mt-6 p-4 sm:p-5" style={{ background: C.pill, borderRadius: 12 }}><p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: C.faint }}>Eligibility</p><div className="application-rich-content rich-content compact mt-2" style={{ color: C.text }} dangerouslySetInnerHTML={{ __html: applicationRichText(form.config.eligibility) }} /></div>}
              {form.availability !== 'open' ? <div className="mt-6 p-4 text-sm" style={{ background: C.errorBg, color: C.errorText, borderRadius: 10 }}>{form.availability === 'not_open' ? 'Applications have not opened yet.' : form.availability === 'paused' ? 'Applications are temporarily paused.' : 'Applications are closed.'}</div> : !listLayout && !started && (<div className="mt-7 flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-center sm:justify-between" style={{ borderColor: C.divider }}><div className="flex items-center gap-2 text-[11px]" style={{ color: C.faint }}><ShieldCheck className="h-4 w-4" style={{ color: C.successText }} /> Your information is submitted securely.</div><button type="button" onClick={() => { setStarted(true); setReviewing(false); setActiveStep(0); window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 40); }} className="flex min-h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold" style={{ background: C.cta, color: C.ctaText }}>Start application <ArrowRight className="h-4 w-4" /></button></div>)}
            </div>
          </section>

          {listLayout && form.availability === 'open' && <>
            <section id="application-question-email" className="scroll-mt-4 rounded-xl p-5 sm:p-6" style={{ background: C.card, boxShadow: emailError ? `inset 4px 0 0 ${C.errorText}` : 'none' }}>
              <div className="mb-4 flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-bold" style={{ background: emailError ? C.errorBg : C.pill, color: emailError ? C.errorText : C.muted }}>1</span>
                <div className="min-w-0 flex-1">
                  <label htmlFor="application-email" className="block text-sm font-semibold leading-6 sm:text-base" style={{ color: C.text }}>{emailPrompt}<span className="ml-1" style={{ color: C.errorText }}>*</span></label>
                  {emailHelpText && <p className="mt-1 text-xs leading-5" style={{ color: C.faint }}>{emailHelpText}</p>}
                </div>
              </div>
              <div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: C.faint }} /><input id="application-email" type="email" required value={email} onChange={event => { setEmail(event.target.value); setEmailError(''); }} placeholder="you@example.com" className="w-full py-3.5 pl-11 pr-4 text-sm outline-none" style={{ background: C.input, color: C.text, border: `1px solid ${emailError ? C.errorText : C.inputBorder}`, borderRadius: 10 }} /></div>
              {emailError && <p className="mt-3 text-xs font-medium" style={{ color: C.errorText }}>{emailError}</p>}
            </section>
            <ApplicationQuestionFields questions={form.config.questions} answers={answers} onChange={next => { setErrors(previous => { const cleared = { ...previous }; for (const id of Object.keys(next)) if (next[id] !== answers[id]) delete cleared[id]; return cleared; }); setAnswers(next); }} errors={errors} C={C} uploadToken={sessionToken} ensureUploadToken={ensureUploadToken} previewUploads={preview} startAt={2} />
            {message && <p className="rounded-xl p-3 text-xs" style={{ background: C.errorBg, color: C.errorText }}>{message}</p>}
            <section className="flex flex-col gap-4 rounded-xl p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6" style={{ background: C.card }}>
              <div className="flex items-center gap-2 text-[11px]" style={{ color: C.faint }}><ShieldCheck className="h-4 w-4 shrink-0" style={{ color: C.successText }} /> Your information is submitted securely.</div>
              <button type="submit" disabled={submitting} className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold disabled:opacity-60" style={{ background: C.cta, color: C.ctaText }}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {submitting ? 'Submitting...' : 'Submit application'}</button>
            </section>
          </>}

          {!listLayout && started && form.availability === 'open' ? <section className="rounded-xl" style={{ background: C.card }}>
            <div className={`sticky ${preview ? 'top-16' : 'top-2'} z-20 rounded-t-xl px-5 py-4 sm:px-7`} style={{ background: C.card }} aria-label={`Application progress: ${flowProgress}%`}>
              <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold"><span style={{ color: C.muted }}>{reviewing ? 'Review your application' : `Step ${currentStep + 1} of ${stepCount}`}</span><span className="tabular-nums" style={{ color: C.faint }}>{flowProgress}%</span></div>
              <div className="h-1 overflow-hidden rounded-sm" style={{ background: C.skeleton }}><motion.div className="h-full rounded-sm" animate={{ width: `${flowProgress}%` }} transition={{ duration: 0.35, ease: 'easeOut' }} style={{ background: C.cta }} /></div>
            </div>

            <div className="min-h-[390px] p-6 sm:min-h-[430px] sm:p-9">
              <AnimatePresence mode="wait" custom={stepDirection}>
                {reviewing ? <motion.div key="review" initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }} transition={{ duration: 0.28, ease: 'easeOut' }}>
                  <div className="mb-7 flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: C.input, color: C.cta }}><CheckCircle2 className="h-4.5 w-4.5" /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: C.faint }}>Final check</p><h2 className="text-xl font-bold sm:text-2xl" style={{ color: C.text }}>Everything look right?</h2></div></div>
                  <div className="space-y-2">
                    {[{ id: 'email', label: 'Email address', value: email, step: 0, type: 'email' as const }, ...visibleQuestions.map((question, index) => ({ id: question.id, label: question.label, value: answers[question.id], step: index + 1, type: question.type })).filter(item => item.type !== 'text_block' && item.type !== 'image')].map(item => <button key={item.id} type="button" onClick={() => editStep(item.step)} className="group flex w-full items-center gap-3 rounded-lg border p-3 text-left" style={{ background: C.input, borderColor: C.inputBorder }}><span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-bold uppercase tracking-wide" style={{ color: C.faint }}>{item.label}</span><span className="mt-1 block truncate text-sm font-medium" style={{ color: C.text }}>{answerSummary(item.value)}</span></span><PencilLine className="h-4 w-4 shrink-0 transition-transform group-hover:scale-110" style={{ color: C.cta }} /></button>)}
                  </div>
                  {message && <p className="mt-4 rounded-xl p-3 text-xs" style={{ background: C.errorBg, color: C.errorText }}>{message}</p>}
                  <div className="mt-7 flex items-center justify-between gap-3">
                    <button type="button" onClick={previousStep} className="flex items-center gap-2 rounded-xl px-4 py-3 text-xs font-semibold" style={{ background: C.input, color: C.muted }}><ArrowLeft className="h-4 w-4" /> Back</button>
                    <button type="submit" disabled={submitting} className="flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-sm font-semibold disabled:opacity-60" style={{ background: C.cta, color: C.ctaText }}>{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {submitting ? 'Submitting...' : 'Submit application'}</button>
                  </div>
                </motion.div> : <motion.div key={currentQuestion?.id ?? 'email'} custom={stepDirection} initial={{ opacity: 0, x: stepDirection > 0 ? 34 : -34 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: stepDirection > 0 ? -34 : 34 }} transition={{ duration: 0.28, ease: 'easeOut' }}>
                  <div className="mb-7 flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: C.faint }}><motion.span className="h-2.5 w-2.5 rounded-full" style={{ background: C.cta }} animate={{ scale: [0.8, 1.25, 0.8], opacity: [0.45, 1, 0.45] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }} /> Application assistant</div>
                  <TypewriterPrompt key={currentQuestion?.id ?? 'email-prompt'} text={currentQuestion?.label ?? emailPrompt} C={C} />
                  {(currentHelpText || (currentQuestion && !isApplicationContentBlock(currentQuestion) && !currentQuestion.required)) && <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: C.faint }}>{currentHelpText && <span>{currentHelpText}</span>}{currentQuestion && !isApplicationContentBlock(currentQuestion) && !currentQuestion.required && <span className="shrink-0 rounded-full px-2 py-1 text-[9px] font-bold uppercase" style={{ background: C.input }}>Optional</span>}</div>}
                  <div className="mt-8" onKeyDown={event => { const target = event.target as HTMLInputElement; if (event.key === 'Enter' && !event.shiftKey && target.tagName === 'INPUT' && !['checkbox', 'radio', 'file'].includes(target.type)) { event.preventDefault(); continueFlow(); } }}>
                    {currentStep === 0 ? <div><div className="relative"><Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: C.faint }} /><input autoFocus type="email" required value={email} onChange={event => { setEmail(event.target.value); setEmailError(''); }} placeholder="you@example.com" className="w-full py-4 pl-11 pr-4 text-base outline-none" style={{ background: C.input, color: C.text, border: `1px solid ${emailError ? C.errorText : C.inputBorder}`, borderRadius: 10 }} /></div>{emailError && <p className="mt-3 text-xs font-medium" style={{ color: C.errorText }}>{emailError}</p>}</div> : currentQuestion && <ApplicationQuestionFields questions={[currentQuestion]} answers={answers} onChange={next => { setAnswers(next); setErrors(previous => ({ ...previous, [currentQuestion.id]: '' })); }} errors={errors} C={C} uploadToken={sessionToken} ensureUploadToken={ensureUploadToken} previewUploads={preview} focused autoFocus />}
                  </div>
                  {message && <p className="mt-4 rounded-xl p-3 text-xs" style={{ background: C.errorBg, color: C.errorText }}>{message}</p>}
                  <div className="mt-8 flex items-center justify-between gap-3">
                    <button type="button" onClick={previousStep} className="flex items-center gap-2 rounded-lg border px-4 py-3 text-xs font-semibold" style={{ background: C.input, borderColor: C.inputBorder, color: C.muted }}><ArrowLeft className="h-4 w-4" /> {currentStep === 0 ? 'Overview' : 'Back'}</button>
                    <div className="flex items-center gap-3">{enterAdvances && <span className="hidden items-center gap-1.5 text-[10px] sm:flex" style={{ color: C.faint }}>Press Enter <CornerDownLeft className="h-3 w-3" /></span>}<button type="button" onClick={continueFlow} className="flex min-h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold" style={{ background: C.cta, color: C.ctaText }}>{currentStep >= stepCount - 1 ? 'Review answers' : 'Continue'} <ArrowRight className="h-4 w-4" /></button></div>
                  </div>
                </motion.div>}
              </AnimatePresence>
            </div>
          </section> : null}
        </form>
      </div>
    </main>
  );
}
