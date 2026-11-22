'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;
const WARNING_WINDOW_MS = 30 * 60 * 1000;
const ACTIVITY_KEY = 'ai-skills:last-activity-at';
const WARNING_KEY = 'ai-skills:idle-warning-started-at';
const LOGOUT_KEY = 'ai-skills:idle-logout-at';
const ACTIVITY_THROTTLE_MS = 15 * 1000;

export default function SessionInactivityGuard() {
  const [signedIn, setSignedIn] = useState(false);
  const [warningStartedAt, setWarningStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const lastActivityWriteRef = useRef(0);
  const signingOutRef = useRef(false);

  const clearWarning = useCallback(() => {
    setWarningStartedAt(null);
    localStorage.removeItem(WARNING_KEY);
  }, []);

  const markActivity = useCallback((force = false) => {
    if (!signedIn) return;
    const next = Date.now();
    if (!force && next - lastActivityWriteRef.current < ACTIVITY_THROTTLE_MS) return;
    lastActivityWriteRef.current = next;
    localStorage.setItem(ACTIVITY_KEY, String(next));
    clearWarning();
  }, [clearWarning, signedIn]);

  const signOutEverywhere = useCallback(async () => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    localStorage.setItem(LOGOUT_KEY, String(Date.now()));
    clearWarning();
    // This browser only: an idle tab or phone must not sign the learner out of a laptop they are
    // using. (signOut's default scope is 'global', which ends every session on every device.)
    await supabase.auth.signOut({ scope: 'local' });
    window.location.href = '/auth';
  }, [clearWarning]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(!!session);
      if (session && !localStorage.getItem(ACTIVITY_KEY)) {
        localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      if (session) markActivity(true);
      else clearWarning();
    });

    return () => subscription.unsubscribe();
  }, [clearWarning, markActivity]);

  useEffect(() => {
    if (!signedIn) return;

    const events: Array<keyof WindowEventMap> = ['click', 'keydown', 'scroll', 'mousemove', 'touchstart'];
    const handleActivity = () => markActivity();
    events.forEach(event => window.addEventListener(event, handleActivity, { passive: true }));

    return () => {
      events.forEach(event => window.removeEventListener(event, handleActivity));
    };
  }, [markActivity, signedIn]);

  useEffect(() => {
    if (!signedIn) return;

    const handleStorage = (event: StorageEvent) => {
      if (event.key === LOGOUT_KEY && event.newValue) {
        signOutEverywhere();
      }
      if (event.key === WARNING_KEY) {
        setWarningStartedAt(event.newValue ? Number(event.newValue) : null);
      }
      if (event.key === ACTIVITY_KEY && event.newValue) {
        setWarningStartedAt(null);
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [signOutEverywhere, signedIn]);

  useEffect(() => {
    if (!signedIn) return;

    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);

      const lastActivity = Number(localStorage.getItem(ACTIVITY_KEY) || current);
      const existingWarning = Number(localStorage.getItem(WARNING_KEY) || 0);

      if (!existingWarning && current - lastActivity >= INACTIVITY_LIMIT_MS) {
        localStorage.setItem(WARNING_KEY, String(current));
        setWarningStartedAt(current);
        return;
      }

      if (existingWarning) {
        setWarningStartedAt(existingWarning);
        if (current - existingWarning >= WARNING_WINDOW_MS) {
          signOutEverywhere();
        }
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [signOutEverywhere, signedIn]);

  if (!signedIn || !warningStartedAt) return null;

  const remainingMs = Math.max(0, WARNING_WINDOW_MS - (now - warningStartedAt));
  const remainingMinutes = Math.ceil(remainingMs / 60000);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-session-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 16,
          background: 'white',
          color: '#111827',
          boxShadow: '0 24px 70px rgba(0,0,0,0.28)',
          padding: 24,
          fontFamily: 'var(--font-sans, Inter, sans-serif)',
        }}
      >
        <h2 id="idle-session-title" style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 800 }}>
          Are you still there?
        </h2>
        <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, color: '#4b5563' }}>
          You have been inactive for a while. For your security, you will be signed out in about {remainingMinutes} minute{remainingMinutes === 1 ? '' : 's'} unless you continue.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={signOutEverywhere}
            style={{
              border: '1px solid #e5e7eb',
              background: 'white',
              color: '#374151',
              borderRadius: 10,
              padding: '10px 14px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
          <button
            type="button"
            onClick={() => markActivity(true)}
            autoFocus
            style={{
              border: 'none',
              background: '#0e09dd',
              color: 'white',
              borderRadius: 10,
              padding: '10px 16px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
