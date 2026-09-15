'use client';

// Whether this learner may use the upload-based AI reviewers, read once and shared.
//
// A course can render several reviewer activities, and each player mounts on its own. The
// answer is the same for all of them, so the request is cached at module scope rather than
// fired once per activity.

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AI_REVIEW_UPGRADE_URL, aiReviewPriceLabel } from '@/lib/ai-review-upgrade';

export interface AiReviewEntitlement {
  loading: boolean;
  locked: boolean;
  planName: string | null;
  upgradeUrl: string;
  /** Free tier only. Null for anyone with no shared daily cap, or if the counter was unreadable. */
  dailyLimit: number | null;
  dailyRemaining: number | null;
  /** Seconds until the free allowance rolls over. The window runs from first use, not midnight. */
  resetsInSeconds: number | null;
  /** True only when we positively know the allowance is spent -- never on a missing answer. */
  dailyExhausted: boolean;
  /** The cheapest way onto the recommended plan, already worded. Null when unknown. */
  priceLabel: string | null;
}

type Verdict = Omit<AiReviewEntitlement, 'loading'>;

const UNLOCKED: Verdict = {
  locked: false,
  planName: null,
  upgradeUrl: AI_REVIEW_UPGRADE_URL,
  dailyLimit: null,
  dailyRemaining: null,
  resetsInSeconds: null,
  dailyExhausted: false,
  priceLabel: null,
};

let cached: Promise<Verdict> | null = null;
let lastLocked = false;

async function load(): Promise<Verdict> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return UNLOCKED;
    const res = await fetch('/api/ai-review-entitlement', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return UNLOCKED;
    const json = await res.json();
    const dailyRemaining = typeof json.dailyRemaining === 'number' ? json.dailyRemaining : null;
    return {
      locked: !!json.locked,
      planName: json.planName ?? null,
      upgradeUrl: String(json.upgradeUrl || AI_REVIEW_UPGRADE_URL),
      dailyLimit: typeof json.dailyLimit === 'number' ? json.dailyLimit : null,
      dailyRemaining,
      resetsInSeconds: typeof json.resetsInSeconds === 'number' ? json.resetsInSeconds : null,
      // Only a real zero counts. An unreadable counter must not put an exhausted message in front
      // of a learner who still has their review.
      dailyExhausted: !!json.locked && dailyRemaining === 0,
      priceLabel: aiReviewPriceLabel(json.priceAmount, json.priceCurrency, json.priceMonths),
    };
  } catch {
    // Never lock on a failure to ask. The route itself already refuses to guess, and the server
    // gate is what actually enforces the limit.
    return UNLOCKED;
  }
}

// The cache is module scope, so it outlives a sign-out that does not reload the page. Dropping it
// whenever the session changes stops one account's verdict being shown to the next one.
let watchingAuth = false;
function watchAuth() {
  if (watchingAuth) return;
  watchingAuth = true;
  supabase.auth.onAuthStateChange(() => { cached = null; lastLocked = false; });
}

const listeners = new Set<() => void>();

/**
 * Forget the cached answer so the next read asks again.
 *
 * Call after a review is spent. The count is part of this answer now, so a surface that kept the
 * first reply would keep telling a learner they have one review left after they have used it.
 */
export function refreshAiReviewEntitlement() {
  cached = null;
  for (const listener of listeners) listener();
}

function read(): Promise<Verdict> {
  watchAuth();
  cached ??= load().then(verdict => { lastLocked = verdict.locked; return verdict; });
  return cached;
}

export function useAiReviewEntitlement(): AiReviewEntitlement {
  const [state, setState] = useState<AiReviewEntitlement>({ ...UNLOCKED, loading: true });

  useEffect(() => {
    let active = true;
    const apply = (verdict: Verdict) => { if (active) setState({ ...verdict, loading: false }); };
    read().then(apply);

    // Upgrading opens in a new tab, so this tab has to notice when they come back having bought.
    // Without this the lock outlives the purchase until the learner thinks to reload. Only worth
    // re-asking for someone who was locked -- an unlocked learner has nothing to re-check.
    //
    // The reviewer surfaces disable their submit while dailyExhausted, so this is what re-enables
    // it after an upgrade. Removing it does not just leave a stale count: it strands a learner who
    // has paid in front of a dead button.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible' || !lastLocked) return;
      cached = null;
      read().then(apply);
    };
    document.addEventListener('visibilitychange', onVisibility);

    // A review spent in one surface changes the count every other mounted surface is showing.
    const onRefresh = () => { read().then(apply); };
    listeners.add(onRefresh);

    return () => {
      active = false;
      listeners.delete(onRefresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return state;
}
