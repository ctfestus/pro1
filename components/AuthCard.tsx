'use client';

/**
 * The sign-in / sign-up card. The /auth page shows it centred; AuthPopupHost shows it as a pop-up
 * over whatever public page the visitor clicked Log in or Sign up on.
 *
 * Everything it needs from the address comes in through `params`: the /auth page passes its own
 * query string (mode, next, and the error codes email links arrive with), and the pop-up passes the
 * query string of the /auth link that was clicked.
 */

import { useState, useEffect } from 'react'; // useRef -- CAPTCHA SUSPENDED
import { toUserFacingError } from '@/lib/user-facing-error';
// CAPTCHA SUSPENDED -- import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { supabase } from '@/lib/supabase';
import { rememberNext, safeNextPath } from '@/lib/auth-redirect';
import { useTenant } from '@/components/TenantProvider';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowRight, CircleNotch, EnvelopeSimple, Eye, EyeSlash, LockSimple, X } from '@phosphor-icons/react';

// CAPTCHA SUSPENDED -- const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!;

const BLUE = '#3E93FF';
const INK = '#111827';
const SUB = '#6B7280';
const LABEL = '#374151';
const FAINT = '#9CA3AF';
const FIELD = 'inset 0 0 0 1px #D1D9E4';

// A message decides its own colour. This used to be inferred from the text -- green if it
// contained "Check" -- so rewording a failure into "Check your connection" would have shown
// it as a success. The tone travels with the message instead.
type AuthMessage = { text: string; tone: 'success' | 'info' | 'error' };

const MESSAGE_STYLE: Record<AuthMessage['tone'], React.CSSProperties> = {
  success: { background: '#f0fdf4', color: '#166534' },
  info: { background: '#eff6ff', color: '#1d4ed8' },
  error: { background: '#fef2f2', color: '#991b1b' },
};

export function AuthCard({ params, onClose }: { params: URLSearchParams; onClose?: () => void }) {
  const { publicSignupEnabled } = useTenant();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin]   = useState(true);
  const [isForgot, setIsForgot] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [message, setMessage]   = useState<AuthMessage | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [canRetrySignup, setCanRetrySignup] = useState(false);
  // Arrived here because the email was never confirmed. The form looks like the password-reset
  // form, but it must send a SIGNUP confirmation, not a recovery link -- resend({type:'signup'})
  // is the API built for exactly this, and it does not depend on recovery working for an
  // unconfirmed address.
  const [needsConfirm, setNeedsConfirm] = useState(false);
  // CAPTCHA SUSPENDED -- const [captchaToken, setCaptchaToken] = useState('');
  // CAPTCHA SUSPENDED -- const turnstileRef = useRef<TurnstileInstance>(null);

  const next = safeNextPath(params.get('next'));

  // A new account reaches the page it came from only after confirming its email and onboarding,
  // which drop the query string, so the page is kept in this browser until onboarding ends.
  useEffect(() => { rememberNext(next); }, [next]);

  useEffect(() => {
    const error  = params.get('error');
    if (error === 'not_allowed') {
      setMessage({ text: 'You do not have access to this portal. Contact your learning advisor.', tone: 'error' });
    }
    if (error === 'invalid_link') {
      // Setup and reset links work once and then expire. Drop straight into the
      // request form so a fresh link is one step away instead of a dead end.
      setIsForgot(true);
      setMessage({ text: 'That setup link has already been used or has expired. Enter your email below and we will send you a new one.', tone: 'info' });
    }
    if (error === 'confirm_email') {
      // Same escape hatch as an expired setup link: the forgot form sends a fresh one, and
      // clicking a recovery link also confirms the address. Sending someone to their Learning
      // Advisor because an email link timed out is a dead end for a problem they can fix.
      setIsForgot(true);
      setNeedsConfirm(true);
      setMessage({ text: 'Your email address is not confirmed yet, so the account is not active. Enter your email below and we will send you a fresh confirmation link.', tone: 'error' });
    }
    if (error === 'email_not_supported') {
      setMessage({ text: 'That email provider is not supported. Please sign up with a permanent email address.', tone: 'error' });
    }
    if (error === 'no_admission_record') {
      setMessage({ text: 'We could not find an admission record for that email. Contact your learning advisor.', tone: 'error' });
    }
    if (error === 'try_again') {
      // The original PKCE code was consumed already, but the callback deliberately
      // retained its restricted session. Retry through that session instead of telling
      // the student to click a one-use email link again.
      setCanRetrySignup(true);
      setMessage({ text: 'We could not finish setting up your account just now. Please try again in a few minutes.', tone: 'error' });
    }
    if (params.get('mode') === 'signup') {
      // With signups open this is a real destination -- landing pages and invite emails link
      // straight here. Invite-only keeps the explanation, because there is no form to open.
      if (publicSignupEnabled) setIsLogin(false);
      else setMessage({ text: 'If your learning advisor has added you, use the setup link in your email, then sign in here.', tone: 'info' });
    }
  }, [params, publicSignupEnabled]);

  // CAPTCHA SUSPENDED -- const resetCaptcha = () => { turnstileRef.current?.reset(); setCaptchaToken(''); };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      if (isForgot && needsConfirm) {
        // An unconfirmed account needs its confirmation link again, not a password reset. Both
        // Supabase calls are rate-limited server-side, so this cannot be used to mail-bomb anyone.
        const { error } = await supabase.auth.resend({
          type: 'signup',
          email,
          options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
        });
        if (error) throw error;
        setMessage({ text: 'Check your email for a new confirmation link. If you do not see it, please check your spam folder.', tone: 'success' });
        return;
      }
      if (isForgot) {
        // Supabase sends and rate-limits the recovery email. The exact destination must
        // be listed under Authentication -> URL Configuration -> Redirect URLs.
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/recover`,
        });
        if (error) throw error;
        setMessage({ text: 'Check your email for the password reset link.', tone: 'success' });
        return;
      }
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const { data: student } = await supabase
          .from('students')
          .select('role, onboarding_done')
          .eq('id', data.session!.user.id)
          .single();
        // Someone who came here from a course, experience or certification goes back to it
        // rather than to their dashboard, so signing in does not cost them the thing they
        // clicked. Onboarding still wins: an account that is not set up cannot use the content.
        if (!student || !student.onboarding_done) window.location.href = '/onboarding';
        else if (next) window.location.href = next;
        else if (student.role === 'student' || student.role === 'staff') window.location.href = '/student';
        else window.location.href = '/dashboard';
      } else {
        // Invite-only mode checks eligibility BEFORE creating anything, so an uninvited person
        // gets a plain answer instead of an account that is created and then denied when they
        // click the confirmation link. With public signup on there is nothing to pre-check --
        // /auth/callback decides server-side -- and calling this endpoint would only broadcast
        // whether a given address happens to be on an allowlist.
        if (!publicSignupEnabled) {
          const res = await fetch(`/api/cohort-allowlist?email=${encodeURIComponent(email)}`);
          const { allowed } = await res.json();
          if (!allowed) {
            throw new Error('This email is not eligible for a new signup. If you already have an account, please use the sign in option below. If you are a new student, contact your Learning Advisor.');
          }
        }
        const { data: signUpData, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/confirm`,
          },
        });
        if (error) throw error;
        if (signUpData.user && signUpData.user.identities?.length === 0) {
          setMessage({ text: 'An account with this email already exists. Please sign in instead. You will be directed to the sign in page.', tone: 'info' });
          setTimeout(() => { setIsLogin(true); setMessage(null); }, 3000);
          return;
        }
        // With email confirmation disabled Supabase returns a session immediately and
        // sends no confirmation message. Resolve that still-pending signup through the
        // same server-side checks the email callback uses.
        if (signUpData.session) {
          window.location.href = '/auth/callback?retry=1';
          return;
        }
        setMessage({ text: 'Check your email for the confirmation link. If you do not see it in your inbox, please check your spam.', tone: 'success' });
      }
    } catch (err: any) {
      setMessage({ text: toUserFacingError(err), tone: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const heading = isForgot ? (needsConfirm ? 'Confirm your email' : 'Reset your password') : isLogin ? 'Welcome back' : 'Create your account';

  return (
    <div className="relative w-full px-5 pb-6 pt-7 sm:px-8 sm:pb-7 sm:pt-10" style={{ color: INK }}>
      <style>{`.auth-input::placeholder { color: ${FAINT} !important; } .auth-input:focus-visible { outline: none !important; }`}</style>

      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close"
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full transition-colors hover:brightness-95"
          style={{ background: '#F3F4F6', color: '#4B5563' }}>
          <X weight="bold" className="h-4 w-4" />
        </button>
      )}

      {/* Heading */}
      <AnimatePresence mode="wait">
        <motion.div
          key={isForgot ? 'forgot-h' : isLogin ? 'login-h' : 'signup-h'}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18 }}
          className="mb-6 pr-10"
        >
          <h1 id="auth-heading" className="text-[26px] font-bold leading-[34px]" style={{ fontFamily: 'var(--font-display), sans-serif' }}>{heading}</h1>
          <p className="mt-1.5 text-sm" style={{ color: SUB }}>
            {isForgot
              ? "Enter your email and we'll send a reset link."
              : isLogin
              ? 'Sign in to continue learning.'
              : 'Start learning in a few minutes. It is free to join.'}
          </p>
        </motion.div>
      </AnimatePresence>

      {/* With sign-up open, both ways in sit above the form where a new visitor sees them first. */}
      {isForgot ? (
        <button type="button" onClick={() => { setIsForgot(false); setNeedsConfirm(false); setMessage(null); }}
          className="mb-5 inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: INK }}>
          <ArrowLeft weight="bold" className="h-3.5 w-3.5" /> Back to sign in
        </button>
      ) : publicSignupEnabled && (
        <div role="tablist" aria-label="Sign in or create an account" className="mb-6 flex gap-1 rounded-xl p-1" style={{ background: '#F3F4F6' }}>
          {([[true, 'Sign in'], [false, 'Create account']] as const).map(([login, label]) => (
            <button key={label} type="button" role="tab" aria-selected={isLogin === login}
              onClick={() => { setIsLogin(login); setMessage(null); }}
              className="h-9 flex-1 rounded-[9px] text-[13px] font-bold transition-colors"
              style={isLogin === login ? { background: BLUE, color: '#ffffff' } : { color: SUB }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleAuth} className="space-y-4">

        {/* Email */}
        <div>
          <label htmlFor="auth-email" className="mb-1.5 block text-[13px] font-semibold" style={{ color: LABEL }}>Email address</label>
          <div className="field-shell flex h-12 items-center gap-2.5 rounded-xl px-3.5" style={{ boxShadow: FIELD }}>
            <EnvelopeSimple weight="duotone" className="h-[18px] w-[18px] flex-shrink-0" style={{ color: FAINT }} />
            <input
              id="auth-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="auth-input min-w-0 flex-1 bg-transparent text-base outline-none"
              style={{ color: INK }}
            />
          </div>
        </div>

        {/* Password */}
        {!isForgot && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="auth-password" className="text-[13px] font-semibold" style={{ color: LABEL }}>Password</label>
              {isLogin && (
                <button
                  type="button"
                  onClick={() => { setIsForgot(true); setNeedsConfirm(false); setMessage(null); }}
                  className="text-[13px] transition-colors hover:text-[#111827]"
                  style={{ color: SUB }}
                >
                  Forgot password?
                </button>
              )}
            </div>
            <div className="field-shell flex h-12 items-center gap-2.5 rounded-xl px-3.5" style={{ boxShadow: FIELD }}>
              <LockSimple weight="duotone" className="h-[18px] w-[18px] flex-shrink-0" style={{ color: FAINT }} />
              <input
                id="auth-password"
                type={showPass ? 'text' : 'password'}
                required
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder={isLogin ? 'Your password' : 'Choose a password'}
                className="auth-input min-w-0 flex-1 bg-transparent text-base outline-none"
                style={{ color: INK }}
              />
              <button
                type="button"
                onClick={() => setShowPass(v => !v)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
                className="flex-shrink-0 transition-colors hover:text-[#111827]"
                style={{ color: FAINT }}
              >
                {showPass ? <EyeSlash weight="bold" className="h-4 w-4" /> : <Eye weight="bold" className="h-4 w-4" />}
              </button>
            </div>
          </div>
        )}

        {/* CAPTCHA SUSPENDED <Turnstile ref={turnstileRef} siteKey={TURNSTILE_SITE_KEY} onSuccess={setCaptchaToken} onExpire={resetCaptcha} onError={resetCaptcha} options={{ theme: 'light', size: 'flexible' }} /> */}

        {/* Message */}
        <AnimatePresence>
          {message && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-xl px-3.5 py-3 text-[13px] leading-relaxed"
              style={MESSAGE_STYLE[message.tone]}
            >
              {message.text}
            </motion.p>
          )}
        </AnimatePresence>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="!mt-6 flex h-[50px] w-full items-center justify-center gap-2 rounded-xl text-[15px] font-bold transition-all hover:brightness-95 active:scale-[0.99] disabled:opacity-60"
          style={{ background: BLUE, color: '#ffffff' }}
        >
          {loading
            ? <CircleNotch weight="bold" className="h-4 w-4 animate-spin" />
            : <>{isForgot ? (needsConfirm ? 'Resend confirmation' : 'Send reset link') : isLogin ? 'Sign in' : 'Create account'} <ArrowRight weight="bold" className="h-4 w-4" /></>}
        </button>

        {canRetrySignup && (
          <button
            type="button"
            onClick={() => { window.location.href = '/auth/callback?retry=1'; }}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all hover:bg-gray-50"
            style={{ boxShadow: FIELD, color: INK }}
          >
            Retry account setup <ArrowRight weight="bold" className="h-3.5 w-3.5" />
          </button>
        )}
      </form>

      {!isForgot && !publicSignupEnabled && (
        <p className="mt-5 text-center text-sm" style={{ color: SUB }}>Need access? Contact your learning advisor.</p>
      )}

      {/* The terms say that using the platform is agreement to them, so the screen where that
          starts has to say so and link them. "Continuing" covers signing in, signing up and a
          reset alike, so the line does not have to change with the mode. New tab, or a
          half-filled form is lost. */}
      <p className="mt-5 text-center text-xs leading-relaxed" style={{ color: FAINT }}>
        By continuing, you agree to our{' '}
        <a href="/terms" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: LABEL }}>Terms of use</a>
        {' '}and{' '}
        <a href="/privacy" target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color: LABEL }}>Privacy policy</a>.
      </p>
    </div>
  );
}
