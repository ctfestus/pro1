'use client';

/**
 * The product page after Paystack sends a guest buyer back (?guest_reference=...). With the return
 * code this browser kept, it confirms the payment and moves on to the download page. Without one
 * (paid on another device, or storage blocked), it points to the email, which always carries the link.
 */
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { guestReturnCode } from '@/lib/books/guest-checkout-store';
import { ResendGuestLink } from '@/components/books/store/ResendGuestLink';

type Phase = 'checking' | 'pending' | 'failed' | 'abandoned' | 'gave-up' | 'review' | 'no-code' | 'error';

export function GuestReturn({ reference, primaryColor, onRetryAllowed }: { reference: string; primaryColor: string; onRetryAllowed?: () => void }) {
  const [phase, setPhase] = useState<Phase>('checking');
  // Buy comes back unless a payment is being confirmed right now or was received. A second checkout
  // is still safe: the server asks Paystack about the earlier one first and refuses while it is
  // still being processed (startGuestBookCheckout).
  useEffect(() => {
    if (phase !== 'checking' && phase !== 'pending' && phase !== 'review') onRetryAllowed?.();
  }, [phase, onRetryAllowed]);

  useEffect(() => {
    const code = guestReturnCode(reference);
    if (!code) { setPhase('no-code'); return; }
    let cancelled = false;
    let timer: number | undefined;
    let tries = 0;
    const check = async () => {
      tries++;
      try {
        const res = await fetch('/api/books/guest-checkout/confirm', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference, code }),
        });
        const d = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && d.status === 'paid' && typeof d.access === 'string') {
          window.location.replace(`/products/download?access=${encodeURIComponent(d.access)}`);
          return;
        }
        if (res.ok && d.status === 'failed') { setPhase('failed'); return; }
        if (res.ok && d.status === 'abandoned') { setPhase('abandoned'); return; }
        if (res.ok && (d.status === 'needs_review' || d.status === 'refunded')) { setPhase('review'); return; }
        if (!res.ok) { setPhase('error'); return; }
        setPhase('pending');
        // A mobile money approval can take a while: back off, then leave it to the email.
        if (tries < 8) timer = window.setTimeout(check, Math.min(15000, 2000 * tries));
        else setPhase('gave-up');
      } catch {
        if (!cancelled) setPhase('error');
      }
    };
    void check();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [reference]);

  const box = 'rounded-2xl px-4 py-3 text-sm';
  const boxStyle = { background: '#ffffff', color: '#334155', boxShadow: '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -12px rgba(15,23,42,0.2)' };
  if (phase === 'checking' || phase === 'pending') {
    return (
      <div className={`${box} inline-flex items-center gap-2`} style={boxStyle}>
        <Loader2 className="w-4 h-4 animate-spin" />
        {phase === 'checking' ? 'Confirming your payment' : 'Waiting for your payment to be confirmed. Your download link will also arrive by email.'}
      </div>
    );
  }
  if (phase === 'failed') return <div className={box} style={boxStyle}>The payment did not go through, and you have not been charged. You can try again.</div>;
  if (phase === 'abandoned') return <div className={box} style={boxStyle}>The payment was not completed. You can try again.</div>;
  if (phase === 'gave-up') {
    return <div className={box} style={boxStyle}>Your payment is taking longer than usual to confirm. If it goes through, your download link will arrive by email.</div>;
  }
  if (phase === 'review') return <div className={box} style={boxStyle}>Your payment was received and needs a check by our team. They will contact you at the email you paid with.</div>;
  return (
    <div className={`${box} space-y-3`} style={boxStyle}>
      <p>If your payment went through, your download link is on its way to your email. Did not get it?</p>
      <ResendGuestLink primaryColor={primaryColor} />
    </div>
  );
}
