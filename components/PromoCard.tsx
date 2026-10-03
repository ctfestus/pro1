'use client';

// Closable promo card pinned to the bottom corner of a page (full width at the bottom on phones).
// Shows the newest live promotion for its placement that this browser has not closed (or closed
// long enough ago, when the promo is set to show again). Closing is remembered per browser, so it
// also works for signed-out visitors on the landing pages.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, useC } from '@/lib/theme';
import { useTenant } from '@/components/TenantProvider';
import { safePromoUrl, isExternalUrl, MAX_PROMO_EXCLUDES, type ActivePromotion, type PromoPlacement } from '@/lib/promotions';

const DISMISSED_KEY = 'promo-dismissed';
const SHOW_DELAY_MS = 1200;

// Newest first. `at` is epoch seconds; null for an entry saved before closings were timed, which
// the server treats as closed for a Never promo and as expired for one that reshows.
type Closed = { id: string; at: number | null };

function readDismissed(): Closed[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x): Closed[] => {
      if (typeof x === 'string') return [{ id: x, at: null }];
      if (x && typeof x.id === 'string') return [{ id: x.id, at: typeof x.at === 'number' ? x.at : null }];
      return [];
    });
  } catch {
    return [];
  }
}

function rememberDismissed(id: string) {
  try {
    // Re-closing a promo that came back restarts its clock. Capped so a long-lived browser does
    // not grow this forever.
    const next = [{ id, at: Math.floor(Date.now() / 1000) }, ...readDismissed().filter(x => x.id !== id)]
      .slice(0, MAX_PROMO_EXCLUDES);
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {}
}

export function PromoCard({ placement, bottomOffset = 0, light = false }: {
  placement: PromoPlacement;
  /** Ignore the viewer's dark mode, for the landing pages, which are always light. */
  light?: boolean;
  /** Extra space below the card, for pages with their own bottom bar. */
  bottomOffset?: number;
}) {
  const themed = useC();
  const { primaryColor } = useTenant();
  const C = light ? { ...LIGHT_C, cta: primaryColor || LIGHT_C.cta } : themed;
  const [promo, setPromo] = useState<ActivePromotion | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      // The token only sharpens targeting (cohort, Student Mode via the page's fetch bridge);
      // signed out, the route returns everyone-audience promos.
      const { data: { session } } = await supabase.auth.getSession();
      const closed = readDismissed().map(c => (c.at === null ? c.id : `${c.id}:${c.at}`)).join(',');
      const params = new URLSearchParams({ placement, closed });
      const res = await fetch(`/api/promotions?${params}`, {
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      if (!res.ok) return;
      const { promotion } = await res.json() as { promotion: ActivePromotion | null };
      if (cancelled || !promotion) return;
      setPromo(promotion);
      timer = setTimeout(() => { if (!cancelled) setVisible(true); }, SHOW_DELAY_MS);
    })().catch(() => { /* a promo is optional; never surface a failure */ });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [placement]);

  if (!promo) return null;

  const imageUrl = safePromoUrl(promo.image_url);
  const ctaUrl = safePromoUrl(promo.cta_url);
  const ctaLabel = promo.cta_label?.trim() || 'Learn more';
  const external = ctaUrl ? isExternalUrl(ctaUrl) : false;

  const close = () => {
    rememberDismissed(promo.id);
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.aside
          role="complementary"
          aria-label={promo.title}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="fixed left-4 right-4 sm:left-auto sm:right-5 sm:w-[380px]"
          style={{
            bottom: 16 + bottomOffset, zIndex: 45,
            background: C.card, color: C.text, borderRadius: 16, padding: 12,
            boxShadow: '0 12px 40px rgba(0,0,0,0.18)',
          }}
        >
          <div className="flex gap-3 items-start">
            {imageUrl && (
              <img src={imageUrl} alt="" className="flex-shrink-0 object-cover"
                style={{ width: 96, height: 96, borderRadius: 10 }}
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
            )}
            <div className="min-w-0 flex-1 pr-6">
              <p className="text-[15px] font-bold leading-snug" style={{ color: C.text }}>{promo.title}</p>
              {promo.body && (
                <p className="text-[13px] leading-snug mt-1 line-clamp-3" style={{ color: C.muted }}>{promo.body}</p>
              )}
              {ctaUrl && (
                <a href={ctaUrl}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                  onClick={() => rememberDismissed(promo.id)}
                  className="inline-block mt-2 text-[13px] font-semibold hover:underline"
                  style={{ color: C.cta }}>
                  {ctaLabel}
                </a>
              )}
            </div>
          </div>
          <button type="button" onClick={close} aria-label="Close"
            className="absolute top-2 right-2 flex items-center justify-center rounded-full transition-opacity hover:opacity-70"
            style={{ width: 28, height: 28, background: C.pill, border: 'none', cursor: 'pointer' }}>
            <X className="w-3.5 h-3.5" style={{ color: C.muted }} />
          </button>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
