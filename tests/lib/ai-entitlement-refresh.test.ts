import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  cleanups: [] as Array<(() => void) | undefined>,
  effects: [] as Array<() => void | (() => void)>,
  authCallback: null as (() => void) | null,
}));

vi.mock('react', () => ({
  useState: (initial: unknown) => [initial, vi.fn()],
  useEffect: (effect: () => void | (() => void)) => {
    harness.effects.push(effect);
    const cleanup = effect();
    harness.cleanups.push(typeof cleanup === 'function' ? cleanup : undefined);
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: 'token' } } })),
      onAuthStateChange: vi.fn((callback: () => void) => {
        harness.authCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  },
}));

import {
  refreshAiReviewEntitlement,
  useAiReviewEntitlement,
} from '@/lib/use-ai-review-entitlement';

const listeners = new Map<string, () => void>();
const documentStub = {
  visibilityState: 'visible',
  addEventListener: vi.fn((name: string, listener: () => void) => listeners.set(name, listener)),
  removeEventListener: vi.fn((name: string, listener: () => void) => {
    if (listeners.get(name) === listener) listeners.delete(name);
  }),
};

const response = () => new Response(JSON.stringify({
    tier: 'free',
    features: {
      practiceChecks: { limit: 1, remaining: 1, resetsInSeconds: null, canUpgrade: true },
      writtenReviews: { limit: 1, remaining: 1, resetsInSeconds: null, canUpgrade: true },
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });

const fetchMock = vi.fn(async () => response());

describe('AI reviewer entitlement refresh coordination', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterAll(() => {
    for (const cleanup of harness.cleanups) cleanup?.();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses one request and one timer for every mounted reviewer, then stops at zero subscribers', async () => {
    useAiReviewEntitlement('practiceChecks');
    useAiReviewEntitlement('writtenReviews');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(documentStub.addEventListener).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Multiple invalidations arriving together still publish one shared in-flight request.
    refreshAiReviewEntitlement();
    refreshAiReviewEntitlement();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // A request from the previous account must not be reused after auth changes.
    let resolveOldRequest!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { resolveOldRequest = resolve; }));
    refreshAiReviewEntitlement();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    harness.authCallback?.();
    refreshAiReviewEntitlement();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    resolveOldRequest(response());

    harness.cleanups[0]?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    harness.cleanups[1]?.();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(documentStub.removeEventListener).toHaveBeenCalledTimes(1);

    // Invalidation still marks the cache stale after the final listener has gone away.
    refreshAiReviewEntitlement();
    expect(fetchMock).toHaveBeenCalledTimes(6);
    useAiReviewEntitlement('practiceChecks');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    harness.cleanups[2]?.();
  });
});
