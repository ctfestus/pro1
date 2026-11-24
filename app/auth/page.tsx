'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import { AuthCard } from '@/components/AuthCard';

/**
 * The full sign-in page. Most visitors get the same card as a pop-up (AuthPopupHost); this page is
 * for the links that arrive here directly: email links carrying an error code, redirects from a
 * signed-out dashboard, and anyone opening /auth in a new tab.
 */
export default function AuthPage() {
  // Read once. The card only uses it in effects, so the server render (no window) matches.
  const [params] = useState(() => new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search));

  return (
    <main className="flex min-h-screen items-center justify-center p-4" style={{ background: '#f0f2f5' }}>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[380px] overflow-hidden rounded-[24px] bg-white"
        style={{ boxShadow: '0 8px 30px rgba(15,23,42,0.06)' }}
      >
        <AuthCard params={params} />
      </motion.div>
    </main>
  );
}
