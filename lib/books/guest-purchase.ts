import 'server-only';
import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';
import { GUEST_DOWNLOAD_LIMIT } from '@/lib/books/guest-access';
import { isLicenseExpired } from '@/lib/books/schema';

/**
 * Server helpers for the guest routes (/api/books/guest-checkout, /api/books/guest-access/*).
 * What a guest may do is decided from the purchase row every time: paid (a refund ends it), inside
 * guest_access_expires_at, and with downloads left.
 */

export interface GuestPurchase {
  id: string;
  book_id: string;
  status: string;
  is_guest: boolean;
  guest_access_expires_at: string | null;
  guest_downloads_used: number;
  kind?: string | null;
}

export type GuestAccessState = 'ready' | 'pending' | 'not_paid' | 'expired' | 'used_up';

export const GUEST_PURCHASE_COLUMNS = 'id, book_id, status, is_guest, guest_access_expires_at, guest_downloads_used, kind';

export async function loadGuestPurchase(db: SupabaseClient, purchaseId: string): Promise<GuestPurchase | null> {
  const { data, error } = await db.from('book_purchases').select(GUEST_PURCHASE_COLUMNS).eq('id', purchaseId).maybeSingle();
  if (error) throw error;
  return data && (data as GuestPurchase).is_guest ? (data as GuestPurchase) : null;
}

/** Whether the guest may open the product now (downloads aside: see canDownload). */
export function guestAccessState(p: GuestPurchase, now: number = Date.now()): GuestAccessState {
  if (p.status === 'pending') return 'pending';
  if (p.status !== 'paid') return 'not_paid';
  if (!p.guest_access_expires_at || Date.parse(p.guest_access_expires_at) <= now) return 'expired';
  return 'ready';
}

export function downloadsLeft(p: GuestPurchase): number {
  return Math.max(0, GUEST_DOWNLOAD_LIMIT - (Number(p.guest_downloads_used) || 0));
}

function ipHash(req: NextRequest): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export function emailHash(email: string): string {
  return createHash('sha256').update(`book-guest-email:${email}`).digest('hex').slice(0, 32);
}

/**
 * True when any of the limits is exceeded. Each entry is [name, key part, limit, window seconds];
 * "ip" as the key part uses the caller's address. A Redis outage never blocks a buyer.
 */
export async function guestRateLimited(req: NextRequest, limits: [string, string, number, number][]): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;
  try {
    for (const [name, part, limit, windowSeconds] of limits) {
      const key = `rate:book-guest:${name}:${part === 'ip' ? ipHash(req) : part}`;
      if (await bumpRateLimit(redis, key, limit, windowSeconds)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Whether a guest may still get the product at all, the same rule canReadBook applies to buyers with
 * an account: published or archived (never a draft pulled back), and a licence that has not ended.
 */
export function guestBookAvailable(book: { status?: string | null; license_expires_at?: string | null } | null | undefined): boolean {
  if (!book) return false;
  if (book.status !== 'published' && book.status !== 'archived') return false;
  return !isLicenseExpired(book.license_expires_at ?? null);
}
