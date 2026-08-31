/**
 * Remembers what a visitor was trying to buy, across signing in.
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

// A stored id is put back into a URL, so it is matched against the shape the database issues
// rather than merely being non-empty. Anything else is dropped and the visitor lands on the
// dashboard, which is what happened before any of this existed.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PurchaseIntent {
  /** The locked item they were trying to open. */
  contentTable?: PurchasableContentTable;
  contentId?: string;
  /** The plan length they picked on the pricing page, so the choice survives signing up. */
  priceId?: string;
}

function hasContent(value: PurchaseIntent): boolean {
  return typeof value.contentId === 'string'
    && value.contentId.length > 0
    && !!value.contentTable
    && PURCHASABLE.includes(value.contentTable);
}

// Either half stands on its own: someone can arrive from a locked course having chosen nothing,
// or from the pricing page having chosen a length with no particular course in mind.
function isIntent(value: unknown): value is PurchaseIntent {
  const candidate = value as PurchaseIntent | null;
  if (!candidate) return false;
  const priced = typeof candidate.priceId === 'string' && ID.test(candidate.priceId);
  return hasContent(candidate) || priced;
}

/**
 * Keeps only the halves that check out. Every path in and out of storage goes through this, so a
 * valid half is never carried along by an invalid one -- a bad table name beside a good price
 * would otherwise be stored and rebuilt into the URL.
 */
function sanitize(raw: unknown): PurchaseIntent | null {
  if (!isIntent(raw)) return null;
  const intent: PurchaseIntent = {};
  if (hasContent(raw)) { intent.contentTable = raw.contentTable; intent.contentId = raw.contentId; }
  if (raw.priceId && ID.test(raw.priceId)) intent.priceId = raw.priceId;
  return intent;
}

/** Reads a content target out of a query string. Returns null when there is not one. */
export function readPurchaseIntent(search: string): PurchaseIntent | null {
  try {
    const params = new URLSearchParams(search);
    const raw: PurchaseIntent = {
      contentTable: (params.get('contentTable') ?? undefined) as PurchasableContentTable | undefined,
      contentId: params.get('contentId') ?? undefined,
      priceId: params.get('priceId') ?? undefined,
    };
    return sanitize(raw);
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
    if (typeof stored?.at !== 'number' || Date.now() - stored.at > TTL_MS) return null;
    // Rebuilt through the same filter as the way in, so what comes back out of storage carries
    // every validated half and nothing else. Returning a fixed pair dropped the chosen length.
    return sanitize(stored);
  } catch {
    return null;
  }
}

/** The one place a destination is built, from validated values only. */
export function purchaseIntentHref(intent: PurchaseIntent): string {
  const params = new URLSearchParams();
  if (hasContent(intent)) {
    params.set('contentTable', String(intent.contentTable));
    params.set('contentId', String(intent.contentId));
  }
  if (intent.priceId && ID.test(intent.priceId)) params.set('priceId', intent.priceId);
  return `/student?${params.toString()}#payments`;
}
