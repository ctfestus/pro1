// A POST that carries the learner's current sign-in, not the one the page saw when it loaded.
//
// Pages that hold an access token in a ref keep sending it after it expires: browsers pause the
// background timer that refreshes it, so a learner who leaves a tab open, or puts the laptop to
// sleep, comes back to a token the server rejects. The learner sees a bare "Unauthorized" on
// Submit Answer and guesses at a cause (one class blamed the semicolon in their query).
//
// So the token is read at send time, and a 401 gets one forced refresh and one retry. If that
// still fails, the session is really gone, and the message says what to do about it.

// Worded as what happened rather than why: the server answers 401 for an expired sign-in, but
// also for a Student Mode preview that has ended or an account that is not cleared to use the
// course, and "expired" would be a wrong guess for those.
export const SESSION_EXPIRED_MESSAGE =
  'We could not confirm your sign-in. Copy your answer, refresh the page, sign in again and submit.';

// A course open to everyone can be read without an account, so there may be no sign-in to renew.
export const SIGN_IN_REQUIRED_MESSAGE = 'You are not signed in. Sign in to submit answers and view solutions.';

/**
 * The request never reached the question of whether the answer was right: the learner has to
 * sign in. Callers that count failed attempts use this to leave the count alone.
 */
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignInError';
  }
}

export interface FreshSessionDeps {
  /** The current access token, refreshing it first if it has expired. */
  getToken: () => Promise<string | null>;
  /** Force a refresh and return the new token, or null when the session cannot be renewed. */
  refreshToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

function post(fetchImpl: typeof fetch, url: string, body: unknown, token: string | null) {
  return fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

/**
 * POST JSON with a fresh session and return the parsed body. Throws with the server's error,
 * `fallbackError`, or one of the sign-in messages above when the learner has to sign in.
 */
export async function postWithFreshSession<T = any>(
  url: string,
  body: unknown,
  fallbackError: string,
  deps: FreshSessionDeps,
): Promise<T> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const token = await deps.getToken().catch(() => null);
  let res = await post(fetchImpl, url, body, token);
  if (res.status === 401) {
    const renewed = await deps.refreshToken().catch(() => null);
    if (!renewed) throw new SignInError(token ? SESSION_EXPIRED_MESSAGE : SIGN_IN_REQUIRED_MESSAGE);
    res = await post(fetchImpl, url, body, renewed);
    if (res.status === 401) throw new SignInError(SESSION_EXPIRED_MESSAGE);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || fallbackError);
  return data as T;
}
