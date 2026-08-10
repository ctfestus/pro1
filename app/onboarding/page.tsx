'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { useC } from '@/lib/theme';
import { sanitizePlainText } from '@/lib/sanitize';
import { LinkedInIcon } from '@/components/LinkedInIcon';

type AnswerKey = 'employment_status' | 'learning_objective' | 'referral_source';

type Answers = Record<AnswerKey, string> & {
  employment_status_other: string;
  referral_source_other: string;
};

type Option = {
  value: string;
  label: string;
  emoji?: string;
  brand?: 'linkedin' | 'facebook' | 'x' | 'whatsapp';
};

const EMPLOYMENT_OPTIONS: Option[] = [
  { value: 'full_time', label: 'Full-time', emoji: '\u{1F4BC}' },
  { value: 'part_time', label: 'Part-time', emoji: '\u{1F552}' },
  { value: 'student', label: 'Student', emoji: '\u{1F393}' },
  { value: 'nss', label: 'National Service (NSS)', emoji: '\u{1F9D1}\u{200D}\u{1F4BC}' },
  { value: 'unemployed', label: 'Unemployed', emoji: '\u{1F50E}' },
  { value: 'other', label: 'Other', emoji: '\u{2728}' },
];

const OBJECTIVE_OPTIONS: Option[] = [
  { value: 'new_career', label: 'Start a new career', emoji: '\u{1F680}' },
  { value: 'level_up', label: 'Level up in my current role', emoji: '\u{1F4C8}' },
  { value: 'transition_to_tech', label: 'Transition into tech', emoji: '\u{1F4BB}' },
  { value: 'explore_skills', label: 'Explore new skills', emoji: '\u{1F9ED}' },
];

const REFERRAL_OPTIONS: Option[] = [
  { value: 'linkedin', label: 'LinkedIn', brand: 'linkedin' },
  { value: 'facebook', label: 'Facebook', brand: 'facebook' },
  { value: 'x', label: 'X', brand: 'x' },
  { value: 'whatsapp', label: 'WhatsApp', brand: 'whatsapp' },
  { value: 'friend', label: 'A friend or colleague', emoji: '\u{1F91D}' },
  { value: 'other', label: 'Other', emoji: '\u{2728}' },
];

const QUESTION_STEPS: Array<{
  key: AnswerKey;
  title: string;
  subtitle: string;
  options: Option[];
}> = [
  {
    key: 'employment_status',
    title: 'What is your current employment status?',
    subtitle: 'This helps us understand where you are in your career journey.',
    options: EMPLOYMENT_OPTIONS,
  },
  {
    key: 'learning_objective',
    title: 'What is your main learning objective?',
    subtitle: 'Choose the outcome that matters most to you right now.',
    options: OBJECTIVE_OPTIONS,
  },
  {
    key: 'referral_source',
    title: 'Where did you hear about us?',
    subtitle: 'Your answer helps us reach more learners like you.',
    options: REFERRAL_OPTIONS,
  },
];

const EMPTY_ANSWERS: Answers = {
  employment_status: '',
  employment_status_other: '',
  learning_objective: '',
  referral_source: '',
  referral_source_other: '',
};

function SocialBrandIcon({ brand }: { brand: NonNullable<Option['brand']> }) {
  if (brand === 'linkedin') {
    return <LinkedInIcon className="h-7 w-7 text-[#0A66C2]" />;
  }

  if (brand === 'facebook') {
    return (
      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true">
        <path d="M24 12.073c0-6.627-5.373-12-12-12S0 5.446 0 12.073c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z" />
      </svg>
    );
  }

  if (brand === 'whatsapp') {
    return (
      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="#25D366" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
      </svg>
    );
  }

  return (
    <svg className="h-7 w-7 text-black" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" />
    </svg>
  );
}

function Logo({ appName }: { appName: string }) {
  const { logoUrl } = useTenant();
  const C = useC();

  return logoUrl
    ? (
      <img src={logoUrl} alt={appName} className="h-11 w-auto" />
    )
    : (
      <span aria-label={appName} className="flex h-11 w-11 items-center justify-center text-sm font-bold" style={{ background: C.cta, color: '#fff' }}>
        {appName.slice(0, 1).toUpperCase()}
      </span>
    );
}

export default function OnboardingPage() {
  const router = useRouter();
  const { appName } = useTenant();
  const C = useC();
  const brand = C.cta;

  const [step, setStep] = useState(0);
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('student');
  const [name, setName] = useState('');
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        router.replace('/auth');
        return;
      }

      const { data: student } = await supabase
        .from('students')
        .select('full_name, onboarding_done, onboarding_responses, role')
        .eq('id', session.user.id)
        .single();

      if (student?.onboarding_done) {
        router.replace(
          student.role === 'student' || student.role === 'staff'
            ? '/student#learning_paths'
            : '/dashboard',
        );
        return;
      }

      const saved = student?.onboarding_responses as Partial<Answers> | null;
      setUserId(session.user.id);
      setRole(student?.role ?? 'student');
      setName(student?.full_name?.trim() ?? '');
      setAnswers({
        employment_status: saved?.employment_status ?? '',
        employment_status_other: saved?.employment_status_other ?? '',
        learning_objective: saved?.learning_objective ?? '',
        referral_source: saved?.referral_source ?? '',
        referral_source_other: saved?.referral_source_other ?? '',
      });
      setLoading(false);
    })();
  }, [router]);

  const responsePayload = (currentAnswers: Answers = answers) => ({
    version: 1,
    employment_status: currentAnswers.employment_status || null,
    employment_status_other: currentAnswers.employment_status === 'other'
      ? currentAnswers.employment_status_other.trim() || null
      : null,
    learning_objective: currentAnswers.learning_objective || null,
    referral_source: currentAnswers.referral_source || null,
    referral_source_other: currentAnswers.referral_source === 'other'
      ? currentAnswers.referral_source_other.trim() || null
      : null,
  });

  const saveDraft = async () => {
    const update = step === 0
      ? { full_name: name.trim(), onboarding_responses: responsePayload() }
      : { onboarding_responses: responsePayload() };

    const { error: updateError } = await supabase
      .from('students')
      .update(update)
      .eq('id', userId);

    if (updateError) throw updateError;
  };

  const completeOnboarding = async () => {
    const cleanName = name.trim();
    const { error: updateError } = await supabase
      .from('students')
      .update({
        full_name: cleanName,
        onboarding_responses: responsePayload(),
        onboarding_done: true,
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (updateError) throw updateError;

    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      fetch('/api/trigger/onboarding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ name: cleanName }),
      }).catch(() => {});
    }

    router.replace(
      role === 'student' || role === 'staff'
        ? '/student#learning_paths'
        : '/dashboard',
    );
  };

  const advance = async () => {
    setSaving(true);
    setError('');
    try {
      if (step === 3) await completeOnboarding();
      else {
        await saveDraft();
        setStep(current => current + 1);
        setSaving(false);
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Please try again.');
      setSaving(false);
    }
  };

  const moveForward = async () => {
    if (step === 0 && name.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }

    await advance();
  };

  const question = step > 0 ? QUESTION_STEPS[step - 1] : null;
  const selectedValue = question ? answers[question.key] : '';
  const needsEmploymentDetails = question?.key === 'employment_status' && selectedValue === 'other';
  const needsReferralDetails = question?.key === 'referral_source' && selectedValue === 'other';
  const needsOtherDetails = needsEmploymentDetails || needsReferralDetails;
  const otherDetails = needsEmploymentDetails
    ? answers.employment_status_other
    : answers.referral_source_other;
  const canContinue = step === 0
    ? name.trim().length >= 2
    : Boolean(selectedValue) && (!needsOtherDetails || otherDetails.trim().length >= 2);
  const isFinalStep = step === 3;

  const otherInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!needsOtherDetails) return;
    // The fixed header/footer bars mean a native focus-scroll can still leave this field
    // partly hidden behind them on a short laptop viewport, so scroll it to the middle first.
    otherInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    otherInputRef.current?.focus({ preventScroll: true });
  }, [needsOtherDetails]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center" style={{ background: C.page }}>
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: brand }} />
      </div>
    );
  }

  return (
    <div className="grid min-h-[100dvh] grid-rows-[auto_1fr_auto]" style={{ background: C.page, color: C.text }}>
      <header className="fixed inset-x-0 top-0 z-20 backdrop-blur-sm" style={{ background: C.nav }}>
        <div className="mx-auto flex w-full max-w-[96rem] items-center gap-4 px-4 pb-7 pt-[calc(1.75rem+env(safe-area-inset-top))] sm:gap-5 sm:px-10 lg:px-16">
          {step > 0 ? (
            <button
              type="button"
              aria-label="Go back"
              onClick={() => {
                setStep(current => current - 1);
                setError('');
              }}
              disabled={saving}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-opacity hover:opacity-70 disabled:opacity-40"
              style={{ color: C.muted }}
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          ) : (
            <span className="h-10 w-10 shrink-0" aria-hidden="true" />
          )}
          <div className="h-3 flex-1 overflow-hidden rounded-full" style={{ background: C.skeleton }}>
            <div
              className="h-full rounded-full transition-[width] duration-300 ease-out"
              style={{ width: `${((step + 1) / 4) * 100}%`, background: brand }}
            />
          </div>
          <div className="shrink-0">
            <Logo appName={appName} />
          </div>
        </div>
      </header>

      <main className="flex items-start justify-center px-4 pb-32 pt-[calc(7rem+env(safe-area-inset-top))] sm:px-8 sm:pb-36">
        <div className="w-full max-w-4xl">
          <div className="mb-10 text-center">
            <h1 className="text-2xl font-bold tracking-[-0.03em] sm:whitespace-nowrap sm:text-3xl">
              {step === 0 ? 'What should we call you?' : question?.title}
            </h1>
            <p className="mx-auto mt-3 max-w-xl text-base leading-7" style={{ color: C.muted }}>
              {step === 0
                ? 'Enter your full name exactly as you want it to appear on your certificates.'
                : question?.subtitle}
            </p>
          </div>

          {step === 0 ? (
            <div>
              <label htmlFor="full-name" className="mb-2 block text-sm font-semibold" style={{ color: C.text }}>
                Full name
              </label>
              <input
                id="full-name"
                value={name}
                onChange={event => {
                  setName(sanitizePlainText(event.target.value));
                  setError('');
                }}
                placeholder="Enter your full name"
                autoFocus={!name}
                autoComplete="name"
                className="h-16 w-full rounded-2xl border px-5 text-base font-medium outline-none transition-all placeholder:font-normal focus:ring-4"
                style={{
                  background: C.input,
                  color: C.text,
                  borderColor: error ? C.errorText : C.inputBorder,
                  '--tw-ring-color': `${brand}20`,
                } as CSSProperties}
              />
            </div>
          ) : (
            <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-2">
              {question?.options.map(option => {
                const selected = selectedValue === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setAnswers(current => ({ ...current, [question.key]: option.value }));
                      setError('');
                    }}
                    aria-pressed={selected}
                    className="flex min-h-18 items-center gap-4 rounded-2xl border px-5 py-3.5 text-left text-base font-medium transition-all hover:shadow-sm"
                    style={selected
                      ? { borderColor: brand, borderWidth: 3, background: `${brand}08` }
                      : { borderColor: C.cardBorder, background: C.card }}
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center text-3xl" aria-hidden="true">
                      {option.brand ? <SocialBrandIcon brand={option.brand} /> : option.emoji}
                    </span>
                    <span className="flex-1">{option.label}</span>
                    {selected && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: brand, color: '#fff' }}>
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {needsOtherDetails && (
            <div className="mx-auto mt-5 w-full max-w-3xl">
              <label htmlFor="other-details" className="mb-2 block text-sm font-semibold" style={{ color: C.text }}>
                Please specify
              </label>
              <input
                id="other-details"
                ref={otherInputRef}
                value={otherDetails}
                onChange={event => {
                  const value = sanitizePlainText(event.target.value);
                  setAnswers(current => needsEmploymentDetails
                    ? { ...current, employment_status_other: value }
                    : { ...current, referral_source_other: value });
                  setError('');
                }}
                placeholder={needsEmploymentDetails ? 'Enter your employment status' : 'Tell us where you heard about us'}
                className="h-14 w-full rounded-xl border px-4 text-sm font-medium outline-none transition-all placeholder:font-normal focus:ring-4"
                style={{
                  background: C.input,
                  color: C.text,
                  borderColor: C.inputBorder,
                  '--tw-ring-color': `${brand}20`,
                } as CSSProperties}
              />
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-xl border px-4 py-3 text-sm" style={{ background: C.errorBg, borderColor: C.errorBorder, color: C.errorText }}>
              {error}
            </p>
          )}
        </div>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur-sm" style={{ background: C.nav, borderColor: C.navBorder }}>
        <div className="mx-auto flex w-full max-w-[96rem] items-center justify-between gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-4 sm:gap-4 sm:px-10 sm:py-6 lg:px-16">
          <div className="min-w-0">
            {step === 0 ? (
              <span className="hidden text-sm sm:inline" style={{ color: C.faint }}>Your profile can be completed later.</span>
            ) : (
              <button
                type="button"
                onClick={advance}
                disabled={saving}
                className="whitespace-nowrap rounded-xl px-2 py-3 text-sm font-semibold transition-opacity hover:opacity-70 disabled:opacity-40"
                style={{ color: C.muted }}
              >
                Skip for now
              </button>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={moveForward}
              disabled={!canContinue || saving}
              className="flex h-14 min-w-32 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-base font-semibold transition-all hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-40 sm:px-7"
              style={{ background: brand, color: '#fff' }}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>{isFinalStep ? 'Start learning' : 'Continue'} <ArrowRight className="h-4 w-4" /></>
              )}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
