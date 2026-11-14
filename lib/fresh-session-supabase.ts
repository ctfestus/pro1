// The browser Supabase session, in the shape postWithFreshSession reads it. Kept apart from
// lib/fresh-session-fetch so that file stays free of the client and can be tested on its own.
import { supabase } from '@/lib/supabase';
import type { FreshSessionDeps } from '@/lib/fresh-session-fetch';

/**
 * `onToken` hears every token read, so a caller that also keeps one in a ref stays current.
 * `fallback` is a token the caller was handed some other way, used when no session is found.
 */
export function supabaseSession(
  onToken?: (token: string) => void,
  fallback?: () => string | null | undefined,
): FreshSessionDeps {
  const note = (token: string | null | undefined) => {
    if (token) onToken?.(token);
    return token ?? null;
  };
  return {
    getToken: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      return note(session?.access_token) ?? fallback?.() ?? null;
    },
    refreshToken: async () => {
      const { data: { session } } = await supabase.auth.refreshSession();
      return note(session?.access_token);
    },
  };
}
