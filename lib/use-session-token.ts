import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * A sign-in token that stays current. Supabase replaces the access token about every hour, so a
 * token read once (on page load, or handed down as a prop) expires on a page left open, and every
 * API call sent with it comes back "Unauthorized". Pass the token you already have; this returns
 * the newest one once Supabase refreshes it.
 */
export function useSessionToken(initial = ''): string {
  const [refreshed, setRefreshed] = useState<string | null>(null);
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) setRefreshed(session.access_token);
    });
    return () => subscription.unsubscribe();
  }, []);
  return refreshed ?? initial;
}
