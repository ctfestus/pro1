'use client';

import { useRef, useState } from 'react';
import { useTenant } from '@/components/TenantProvider';
import { motion } from 'motion/react';
import { ArrowRight, CircleNotch, ShieldCheck } from '@phosphor-icons/react';

// --- Color utilities (mirror /auth) ---
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

export default function ConfirmForm({ tokenHash, type }: { tokenHash: string; type: string }) {
  const { logoUrl, logoDarkUrl, brandColor } = useTenant();
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  // The second click is blocked with a ref rather than by disabling the button:
  // a submit button that disables itself inside its own submit handler is the
  // classic way to lose the native POST, and this form has no JS fallback.
  // Double submission matters here because the token is single use -- the second
  // POST would burn an already-spent token and bounce to the invalid-link screen.
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    if (submittedRef.current) { e.preventDefault(); return; }
    submittedRef.current = true;
    setSubmitting(true);
  };

  const brand   = brandColor || '#2563eb';
  const btnText = getLuminance(brand) > 0.35 ? '#111827' : '#ffffff';

  // Light theme, identical to the /auth screen
  const t = {
    backdrop: '#f0f2f5',
    cardBg:   '#ffffff',
    heading:  '#111827',
    sub:      '#6b7280',
  };

  const isRecovery = type === 'recovery';

  return (
    <main className="min-h-screen flex items-center justify-center p-4" style={{ background: t.backdrop }}>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[440px] rounded-2xl overflow-hidden"
        style={{ background: t.cardBg, boxShadow: '0 8px 30px rgba(15,23,42,0.06)' }}
      >
        <div className="px-8 py-8">

          {(logoUrl || logoDarkUrl) && (
            <div className="mb-6">
              <img src={logoUrl || logoDarkUrl || undefined} alt="" className="h-8 w-auto" />
            </div>
          )}

          <div className="mb-7">
            <h1 className="text-[22px] font-bold tracking-tight mb-1" style={{ color: t.heading }}>
              {isRecovery ? 'Set your password' : 'Confirm your email'}
            </h1>
            <p className="text-sm" style={{ color: t.sub }}>
              {isRecovery
                ? 'Continue to choose a password for your account.'
                : 'Continue to confirm your email address.'}
            </p>
          </div>

          <form method="post" action="/auth/confirm/verify" onSubmit={handleSubmit}>
            <input type="hidden" name="token_hash" value={tokenHash} />
            <input type="hidden" name="type" value={type} />
            <button
              type="submit"
              aria-busy={submitting}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all hover:brightness-95 active:scale-[0.99]"
              style={{ background: brand, color: btnText, opacity: submitting ? 0.6 : 1 }}
            >
              {submitting
                ? <CircleNotch weight="bold" className="w-4 h-4 animate-spin" />
                : <>Continue <ArrowRight weight="bold" className="w-3.5 h-3.5" /></>}
            </button>
          </form>

          <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed" style={{ color: t.sub }}>
            <ShieldCheck weight="duotone" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            This link can only be used once, so we wait for you to continue before opening it.
          </p>

        </div>
      </motion.div>
    </main>
  );
}
