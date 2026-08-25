'use client';

import { useState, useEffect } from 'react'; // useRef -- CAPTCHA SUSPENDED
import { toUserFacingError } from '@/lib/user-facing-error';
// CAPTCHA SUSPENDED -- import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { supabase } from '@/lib/supabase';
import { useTenant } from '@/components/TenantProvider';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Mail, Lock, Eye, EyeOff, ArrowRight } from 'lucide-react';

// CAPTCHA SUSPENDED -- const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!;

// ---
// Color utilities
// ---

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function getLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Light-mode theme: white card, brand colors used only for interactive elements
function buildTheme(brand: string, accent: string) {
  const btnLum = getLuminance(brand);
  return {
    backdrop:           '#f0f2f5',
    cardBg:             '#ffffff',
    cardShadow:         'none',
    divider:            '#e5e7eb',
    headingColor:       '#111827',
    subColor:           '#6b7280',
    labelColor:         '#374151',
    inputBg:            '#f9fafb',
    inputBorder:        '#d1d5db',
    inputText:          '#111827',
    inputPlaceholder:   '#9ca3af',
    inputFocusBg:       '#ffffff',
    inputFocusBorder:   brand,
    iconColor:          '#9ca3af',
    forgotColor:        '#6b7280',
    forgotHoverColor:   brand,
    toggleColor:        '#6b7280',
    btnBg:              brand,
    btnText:            btnLum > 0.35 ? '#111827' : '#ffffff',
    accentText:         brand,
  };
}

// ---

// A message decides its own colour. This used to be inferred from the text -- green if it
// contained "Check" -- so rewording a failure into "Check your connection" would have shown
// it as a success. The tone travels with the message instead.
type AuthMessage = { text: string; tone: 'success' | 'info' | 'error' };

export default function AuthPage() {
  const { logoUrl, logoDarkUrl, emailBannerUrl, appName, brandColor, accentColor, publicSignupEnabled } = useTenant();
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error  = params.get('error');
    if (error === 'not_allowed') {
      setMessage({ text: 'You do not have access to this portal. Contact your Learning Advisor.', tone: 'error' });
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
      setMessage({ text: 'We could not find an admission record for that email. Contact your Learning Advisor.', tone: 'error' });
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
      else setMessage({ text: 'If your Learning Advisor has added you, use the setup link in your email, then sign in here.', tone: 'info' });
    }
  }, [publicSignupEnabled]);

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
        if (!student || !student.onboarding_done) window.location.href = '/onboarding';
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

  const brand  = brandColor  || '#2563eb';
  const accent = accentColor || '#f59e0b';
  const t      = buildTheme(brand, accent);

  const msgStyle  = message?.tone === 'success'
    ? { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }
    : message?.tone === 'info'
    ? { background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }
    : { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' };

  return (
    <main
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: t.backdrop }}
    >
      <style>{`
        .auth-input::placeholder { color: ${t.inputPlaceholder} !important; }
        /* These inputs draw their own focus indicator (border + ring) on focus,
           so suppress the global green :focus-visible outline to avoid a double border. */
        .auth-input:focus-visible { outline: none !important; }
      `}</style>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[520px] rounded-2xl overflow-hidden"
        style={{ background: t.cardBg, boxShadow: t.cardShadow }}
      >
        {/* TOP: Email banner image */}
        {emailBannerUrl && (
          <div className="relative w-full overflow-hidden" style={{ height: 180 }}>
            <img
              src={emailBannerUrl}
              alt=""
              className="w-full h-full object-cover object-center"
            />

          </div>
        )}

        {/* Divider */}
        {emailBannerUrl && <div style={{ height: 1, background: t.divider }} />}

        {/* FORM AREA */}
        <div className="px-8 py-8">

          {/* Logo when no banner */}
          {!emailBannerUrl && (logoUrl || logoDarkUrl) && (
            <div className="mb-6">
              <img src={logoUrl || logoDarkUrl || undefined} alt="" className="h-8 w-auto" />
            </div>
          )}

          {/* Heading */}
          <AnimatePresence mode="wait">
            <motion.div
              key={isForgot ? 'forgot-h' : isLogin ? 'login-h' : 'signup-h'}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="mb-7"
            >
              <h1 className="text-[22px] font-bold tracking-tight mb-1" style={{ color: t.headingColor }}>
                {isForgot ? (needsConfirm ? 'Confirm your email' : 'Reset your password') : isLogin ? 'Welcome back' : 'Create your account'}
              </h1>
              <p className="text-sm" style={{ color: t.subColor }}>
                {isForgot
                  ? "Enter your email and we'll send a reset link."
                  : isLogin
                  ? 'Sign in to continue learning.'
                  : 'Level up your Data and AI career with industry-recognized interactive learning - Excel, SQL, Power BI, AI and more.'}
              </p>
            </motion.div>
          </AnimatePresence>

          {/* Form */}
          <form onSubmit={handleAuth} className="space-y-4">

            {/* Email */}
            <div>
              <label className="block text-sm font-semibold mb-1.5 tracking-wide" style={{ color: t.labelColor }}>
                Email address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: t.iconColor }} />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="auth-input w-full rounded-lg pl-9 pr-4 py-2.5 text-base outline-none transition-all"
                  style={{
                    background: t.inputBg,
                    border: `1px solid ${t.inputBorder}`,
                    color: t.inputText,
                  }}
                  onFocus={e => {
                    e.currentTarget.style.background = t.inputFocusBg;
                    e.currentTarget.style.border = `1px solid ${t.inputFocusBorder}`;
                    e.currentTarget.style.boxShadow = `0 0 0 3px ${alpha(brand, 0.12)}`;
                  }}
                  onBlur={e => {
                    e.currentTarget.style.background = t.inputBg;
                    e.currentTarget.style.border = `1px solid ${t.inputBorder}`;
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                />
              </div>
            </div>

            {/* Password */}
            {!isForgot && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-sm font-semibold tracking-wide" style={{ color: t.labelColor }}>
                    Password
                  </label>
                  {isLogin && (
                    <button
                      type="button"
                      onClick={() => { setIsForgot(true); setNeedsConfirm(false); setMessage(null); }}
                      className="text-xs transition-colors"
                      style={{ color: t.forgotColor }}
                      onMouseEnter={e => (e.currentTarget.style.color = t.forgotHoverColor)}
                      onMouseLeave={e => (e.currentTarget.style.color = t.forgotColor)}
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: t.iconColor }} />
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    autoComplete={isLogin ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="auth-input w-full rounded-lg pl-9 pr-10 py-2.5 text-sm outline-none transition-all"
                    style={{
                      background: t.inputBg,
                      border: `1px solid ${t.inputBorder}`,
                      color: t.inputText,
                    }}
                    onFocus={e => {
                      e.currentTarget.style.background = t.inputFocusBg;
                      e.currentTarget.style.border = `1px solid ${t.inputFocusBorder}`;
                      e.currentTarget.style.boxShadow = `0 0 0 3px ${alpha(brand, 0.12)}`;
                    }}
                    onBlur={e => {
                      e.currentTarget.style.background = t.inputBg;
                      e.currentTarget.style.border = `1px solid ${t.inputBorder}`;
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                    style={{ color: t.iconColor }}
                    onMouseEnter={e => (e.currentTarget.style.color = t.headingColor)}
                    onMouseLeave={e => (e.currentTarget.style.color = t.iconColor)}
                  >
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
                  className="text-xs px-3 py-2.5 rounded-lg leading-relaxed"
                  style={msgStyle}
                >
                  {message.text}
                </motion.p>
              )}
            </AnimatePresence>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-60 hover:brightness-95 active:scale-[0.99]"
              style={{ background: t.btnBg, color: t.btnText }}
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <>{isForgot ? (needsConfirm ? 'Resend Confirmation' : 'Send Reset Link') : isLogin ? 'Sign In' : 'Create Account'} <ArrowRight className="w-3.5 h-3.5" /></>}
            </button>

            {canRetrySignup && (
              <button
                type="button"
                onClick={() => { window.location.href = '/auth/callback?retry=1'; }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold border transition-all hover:bg-gray-50"
                style={{ borderColor: t.inputBorder, color: t.headingColor }}
              >
                Retry Account Setup <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </form>

          {/* Mode toggle */}
          <p className="mt-5 text-center text-sm" style={{ color: t.toggleColor }}>
            {isForgot ? (
              <>
                Remember your password?{' '}
                <button
                  onClick={() => { setIsForgot(false); setNeedsConfirm(false); setMessage(null); }}
                  className="font-semibold transition-colors"
                  style={{ color: t.accentText }}
                >
                  Sign in
                </button>
              </>
            ) : publicSignupEnabled ? (
              isLogin ? (
                <>
                  New here?{' '}
                  <button
                    type="button"
                    onClick={() => { setIsLogin(false); setMessage(null); }}
                    className="font-semibold transition-colors"
                    style={{ color: t.accentText }}
                  >
                    Create an account
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => { setIsLogin(true); setMessage(null); }}
                    className="font-semibold transition-colors"
                    style={{ color: t.accentText }}
                  >
                    Sign in
                  </button>
                </>
              )
            ) : (
              <span>Need access? Contact your Learning Advisor.</span>
            )}
          </p>

        </div>
      </motion.div>
    </main>
  );
}
