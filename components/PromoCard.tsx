'use client';

// Closable promo card pinned to the bottom corner of a page (full width at the bottom on phones).
// Shows the newest live promotion for its placement that this browser has not closed. Closing is
// remembered per browser, so it also works for signed-out visitors on the landing pages.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, useC } from '@/lib/theme';
import { useTenant } from '@/components/TenantProvider';
import { safePromoUrl, isExternalUrl, type ActivePromotion, type PromoPlacement } from '@/lib/promotions';

const DISMISSED_KEY = 'promo-dismissed';
const SHOW_DELAY_MS = 1200;

function readDismissed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberDismissed(id: string) {
  try {
    // Capped so a long-lived browser does not grow this forever; old ids are for expired promos.
    const next = [id, ...readDismissed().filter(x => x !== id)].slice(0, 50);
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
    supabase.rpc('get_active_promotions', { p_placement: placement }).then(({ data, error }) => {
      // A tenant that has not run migration 219 yet simply shows nothing.
      if (cancelled || error || !Array.isArray(data)) return;
      const dismissed = readDismissed();
      const next = (data as ActivePromotion[]).find(p => !dismissed.includes(p.id));
      if (!next) return;
      setPromo(next);
      timer = setTimeout(() => { if (!cancelled) setVisible(true); }, SHOW_DELAY_MS);
    });
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
