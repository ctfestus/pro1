/**
 * This browser's guest checkouts: the return code for each one it started (lib/books/guest-access.ts).
 * Kept in localStorage so the page Paystack returns to (often in the same tab, sometimes a new one)
 * can collect the download. Entries older than a week are dropped. Browser storage can be missing or
 * blocked; every call copes, and the buyer still gets the link by email.
 */
const KEY = 'guest-book-checkouts';
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

export interface GuestCheckoutEntry {
  code: string;
  bookId: string;
  email: string;
  at: number;
}

type Store = Record<string, GuestCheckoutEntry>;

function read(): Store {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const now = Date.now();
    const out: Store = {};
    for (const [ref, e] of Object.entries(parsed as Record<string, any>)) {
      if (e && typeof e.code === 'string' && typeof e.bookId === 'string' && typeof e.email === 'string'
        && typeof e.at === 'number' && now - e.at < KEEP_MS) out[ref] = e;
    }
    return out;
  } catch {
    return {};
  }
}

function write(store: Store) {
  try { window.localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* storage blocked: the email still arrives */ }
}

export function rememberGuestCheckout(reference: string, entry: Omit<GuestCheckoutEntry, 'at'>) {
  const store = read();
  store[reference] = { ...entry, at: Date.now() };
  write(store);
}

/** The return code this browser holds for a checkout, if it started it. */
export function guestReturnCode(reference: string): string | null {
  return read()[reference]?.code ?? null;
}

/** This browser's latest checkout for a product with this email, to resume instead of opening another. */
export function latestGuestCheckout(bookId: string, email: string): { reference: string; code: string } | null {
  const mine = Object.entries(read())
    .filter(([, e]) => e.bookId === bookId && e.email === email)
    .sort((a, b) => b[1].at - a[1].at)[0];
  return mine ? { reference: mine[0], code: mine[1].code } : null;
}
