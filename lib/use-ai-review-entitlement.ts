'use client';

// What a learner may do with a given AI reviewer, read once and shared.
//
// A course can render several reviewer activities, and each player mounts on its own. The answer
// covers every reviewer, so the request is cached at module scope rather than fired once per
// activity, and each surface asks for the one feature it renders.

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { AI_REVIEW_UPGRADE_URL, aiReviewPriceLabel } from '@/lib/ai-review-upgrade';
import type { AiFeatureKey } from '@/lib/ai-limits';

interface FeatureBudget {
  limit: number;
  remaining: number | null;
  resetsInSeconds: number | null;
  /** Whether upgrading would get them more of THIS feature. Decided per feature, not per learner. */
  canUpgrade: boolean;
}

interface Verdict {
  tier: 'free' | 'paid' | 'staff' | null;
  features: Partial<Record<AiFeatureKey, FeatureBudget>>;
  planName: string | null;
  upgradeUrl: string;
  priceLabel: string | null;
}

export interface AiReviewEntitlement {
  loading: boolean;
  /** This plan does not include this reviewer at all. The surface locks. */
  locked: boolean;
  /** Included, but none left in the current window. The surface warns. */
  exhausted: boolean;
  limit: number | null;
  remaining: number | null;
  resetsInSeconds: number | null;
  /**
   * Whether to offer an upgrade for THIS reviewer. False for subscribers and bootcamp learners,
   * and false for a free learner whose paid allowance is no better than what they already have.
   */
  canUpgrade: boolean;
  planName: string | null;
  upgradeUrl: string;
  priceLabel: string | null;
}

const UNKNOWN: Verdict = {
  tier: null,
  features: {},
  planName: null,
  upgradeUrl: AI_REVIEW_UPGRADE_URL,
  priceLabel: null,
};

// Cached with an expiry that matches what the settings page promises. Holding one promise forever
// meant a reviewer an admin turned back on stayed locked until a full page reload, which is not
// what "applies within 60 seconds" means to the person who read it.
const CACHE_MS = 60_000;
let cached: { at: number; value: Promise<Verdict> } | null = null;
let inFlight: Promise<Verdict> | null = null;
let authGeneration = 0;

async function load(): Promise<Verdict> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return UNKNOWN;
    const res = await fetch('/api/ai-review-entitlement', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return UNKNOWN;
    const json = await res.json();
    return {
      tier: json.tier ?? null,
      features: json.features ?? {},
      planName: json.planName ?? null,
      upgradeUrl: String(json.upgradeUrl || AI_REVIEW_UPGRADE_URL),
      priceLabel: aiReviewPriceLabel(json.priceAmount, json.priceCurrency, json.priceMonths),
    };
  } catch {
    // Never lock on a failure to ask. The route itself already refuses to guess, and the server
    // gate is what actually enforces the limit.
    return UNKNOWN;
  }
}

// The cache is module scope, so it outlives a sign-out that does not reload the page. Dropping it
// whenever the session changes stops one account's verdict being shown to the next one.
let watchingAuth = false;
function watchAuth() {
  if (watchingAuth) return;
  watchingAuth = true;
  supabase.auth.onAuthStateChange(() => {
    authGeneration += 1;
    cached = null;
    inFlight = null;
    broadcasting = null;
  });
}

type Listener = (verdict: Verdict) => void;

const listeners = new Set<Listener>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let broadcasting: Promise<Verdict> | null = null;

function beginLoad(): Promise<Verdict> {
  const generation = authGeneration;
  // If the account changes while this request is running, every caller waiting on it receives a
  // fresh answer for the new session instead of the old account's verdict.
  const request = load().then(verdict => generation === authGeneration ? verdict : read());
  inFlight = request;
  cached = { at: Date.now(), value: request };
  void request.then(
    () => { if (inFlight === request) inFlight = null; },
    () => { if (inFlight === request) inFlight = null; },
  );
  return request;
}

function read(): Promise<Verdict> {
  watchAuth();
  if (inFlight) return inFlight;
  if (!cached || Date.now() - cached.at >= CACHE_MS) return beginLoad();
  return cached.value;
}

/** Mark the current answer stale without discarding an in-flight request shared by subscribers. */
function markStale() {
  if (cached) cached.at = 0;
}

function refreshSubscribers() {
  // Invalidation still matters with no mounted surface: the next reviewer must not receive a
  // count from before the review that was just spent.
  markStale();
  if (listeners.size === 0) return;
  const request = read();
  // A timer, visibility event and completed review can arrive together. They all share the same
  // request and, just as importantly, publish its answer only once.
  if (broadcasting === request) return;
  broadcasting = request;
  void request.then(
    verdict => {
      // Auth changes clear broadcasting. An old request may still resolve, but it must never
      // publish into the new account's mounted reviewers.
      if (broadcasting !== request) return;
      broadcasting = null;
      for (const listener of listeners) listener(verdict);
    },
    () => { if (broadcasting === request) broadcasting = null; },
  );
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') refreshSubscribers();
}

function startRefreshLoop() {
  if (refreshTimer !== null) return;
  refreshTimer = setInterval(refreshSubscribers, CACHE_MS);
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function stopRefreshLoop() {
  if (refreshTimer !== null) clearInterval(refreshTimer);
  refreshTimer = null;
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (listeners.size === 1) startRefreshLoop();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stopRefreshLoop();
  };
}

/**
 * Forget the cached answer so the next read asks again.
 *
 * Call after a review is spent. The counts are part of this answer, so a surface that kept the
 * first reply would keep telling a learner they have one left after they have used it.
 */
export function refreshAiReviewEntitlement() {
  refreshSubscribers();
}

export function useAiReviewEntitlement(feature: AiFeatureKey): AiReviewEntitlement {
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const budget = verdict?.features?.[feature];
  const limit = budget?.limit ?? null;
  const remaining = budget?.remaining ?? null;

  useEffect(() => {
    let active = true;
    const apply = (v: Verdict) => { if (active) setVerdict(v); };
    const unsubscribe = subscribe(apply);
    read().then(apply);

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {
    loading: verdict === null,
    // Zero on this plan, whichever plan that is. A subscriber can be locked out too, if an admin
    // turned the feature off for paid -- they just are not offered an upgrade for it.
    locked: !!budget && budget.limit <= 0,
    // A real zero only. An unread counter leaves remaining null, and must not put an exhausted
    // message in front of a learner who still has their allowance.
    exhausted: !!budget && budget.limit > 0 && budget.remaining === 0,
    limit,
    remaining,
    resetsInSeconds: budget?.resetsInSeconds ?? null,
    canUpgrade: !!budget?.canUpgrade,
    planName: verdict?.planName ?? null,
    upgradeUrl: verdict?.upgradeUrl ?? AI_REVIEW_UPGRADE_URL,
    priceLabel: verdict?.priceLabel ?? null,
  };
}
