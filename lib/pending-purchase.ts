/**
 * Remembers which locked item a visitor was trying to buy, across signing in.
 *
 * Someone who follows a link to paid content and decides to buy is sent to sign in, and the
 * link that named what they wanted is lost on the way. Signing up costs more still: a
 * confirmation email and onboarding sit between the decision and the dashboard, and every one of
 * those hand-offs redirects to a fixed destination. They arrive somewhere generic with no memory
 * of the thing that brought them, and have to find it again from a nav menu.
 *
 * Only the content target is stored, never a destination URL. The path is rebuilt here from the
 * two values, so nothing a caller supplies is ever navigated to and there is no open redirect to
 * get wrong. The table name is checked against the same set the purchase API accepts.
 *
 * Storage can throw outright (private windows, blocked site data), so every access is guarded and
 * a failure just means the visitor lands on the dashboard as they did before.
 */
import type { PurchasableContentTable } from '@/lib/subscription-plan-access';

const KEY = 'pending-purchase-intent';

// Long enough to survive a confirmation email that is not opened straight away, short enough
// that an abandoned intent does not resurface days later as an unexplained redirect.
const TTL_MS = 24 * 60 * 60 * 1000;

// Typed against the canonical union, so adding a purchasable table there fails the build here
// rather than silently dropping intents for it. The import is type-only and erased at build.
const PURCHASABLE: readonly PurchasableContentTable[] = [
  'courses',
  'learning_paths',
  'virtual_experiences',
  'certifications',
];

export interface PurchaseIntent {
  contentTable: PurchasableContentTable;
  contentId: string;
}

function isIntent(value: unknown): value is PurchaseIntent {
  const candidate = value as PurchaseIntent | null;
  return !!candidate
    && typeof candidate.contentId === 'string'
    && candidate.contentId.length > 0
    && PURCHASABLE.includes(candidate.contentTable);
}

/** Reads a content target out of a query string. Returns null when there is not one. */
export function readPurchaseIntent(search: string): PurchaseIntent | null {
  try {
    const params = new URLSearchParams(search);
    const intent = {
      contentTable: params.get('contentTable') as PurchasableContentTable,
      contentId: params.get('contentId') ?? '',
    };
    return isIntent(intent) ? intent : null;
  } catch {
    return null;
  }
}

/** Call before sending a signed-out visitor away, so the target survives the round trip. */
export function rememberPurchaseIntent(search: string): void {
  const intent = readPurchaseIntent(search);
  if (!intent) return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...intent, at: Date.now() }));
  } catch { /* storage unavailable: the visitor simply lands on the dashboard */ }
}

/** Reads and clears the stored target. Single use, so it cannot fire twice. */
export function takePurchaseIntent(): PurchaseIntent | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    window.localStorage.removeItem(KEY);
    const stored = JSON.parse(raw) as PurchaseIntent & { at?: number };
    if (!isIntent(stored)) return null;
    if (typeof stored.at !== 'number' || Date.now() - stored.at > TTL_MS) return null;
    return { contentTable: stored.contentTable, contentId: stored.contentId };
  } catch {
    return null;
  }
}

/** The one place a destination is built, from validated values only. */
export function purchaseIntentHref(intent: PurchaseIntent): string {
  const params = new URLSearchParams({
    contentTable: intent.contentTable,
    contentId: intent.contentId,
  });
  return `/student?${params.toString()}#payments`;
}
