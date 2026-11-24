'use client';

/**
 * Opens sign-in as a pop-up over the current page instead of sending the visitor to /auth.
 *
 * One listener, mounted once in the root layout, catches a plain click on any link to /auth (the
 * nav's Log in and Sign up, the hero and pricing buttons, "Sign in" on a course or product) and
 * opens the card with that link's own query string, so ?mode=signup and ?next=... behave exactly
 * as they do on the page. It listens in the capture phase and only prevents the default, so a
 * link's own onClick (closing a menu, remembering the product) still runs, and next/link sees the
 * click as handled and does not navigate.
 *
 * Left alone: a new-tab or modified click, a link with a target, links on /auth itself, and every
 * redirect made in code (a signed-out dashboard, an expired session), which still load the page.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

// The form (Supabase calls, messages) loads only when someone opens it.
const AuthCard = dynamic(() => import('@/components/AuthCard').then(m => m.AuthCard), { ssr: false });

export default function AuthPopupHost() {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = (e.target as Element | null)?.closest?.('a');
      if (!link || link.target || window.location.pathname.startsWith('/auth')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/auth') return;
      e.preventDefault();
      setParams(url.searchParams);
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // Escape closes it, and the page behind does not scroll while it is open.
  useEffect(() => {
    if (!params) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setParams(null); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [params]);

  return (
    <AnimatePresence>
      {params && (
        <motion.div
          key="auth-popup"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }}
          className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
          onMouseDown={e => { if (e.target === e.currentTarget) setParams(null); }}
        >
          {/* A sheet from the bottom on a phone, a centred card from sm up. */}
          <motion.div
            role="dialog" aria-modal="true" aria-labelledby="auth-heading"
            initial={reduced ? false : { y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: 40, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="relative max-h-[92vh] w-full overflow-y-auto rounded-t-[24px] bg-white sm:max-w-[380px] sm:rounded-[24px]"
            style={{ boxShadow: '0 30px 80px -20px rgba(15,23,42,0.45)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <span aria-hidden className="absolute left-1/2 top-2.5 h-1 w-10 -translate-x-1/2 rounded-full sm:hidden" style={{ background: '#E5E7EB' }} />
            <AuthCard params={params} onClose={() => setParams(null)} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
