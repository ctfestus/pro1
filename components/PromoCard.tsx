'use client';

// Closable promo card pinned to the bottom corner of a page (full width at the bottom on phones).
// Shows the newest live promotion for its placement that this browser has not closed (or closed
// long enough ago, when the promo is set to show again). Closing is remembered per browser, so it
// also works for signed-out visitors on the landing pages.

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, useC } from '@/lib/theme';
import { useTenant } from '@/components/TenantProvider';
import {
  safePromoUrl, isExternalUrl, upcomingEventItems, eventDateParts, eventFormatLabel, localIsoDate,
  MAX_PROMO_EXCLUDES, MAX_EVENT_ITEMS, type ActivePromotion, type PromoPlacement,
} from '@/lib/promotions';

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

function linkProps(url: string) {
  return isExternalUrl(url) ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

/**
 * The card itself, without positioning. Shared by the live card and the editor preview, so the
 * preview is always exactly what visitors see. onClose omitted = no close button (preview).
 */
export function PromoContent({ promo, C, today, onClose, onAction }: {
  promo: ActivePromotion;
  C: typeof LIGHT_C;
  /** The viewer date ("YYYY-MM-DD") to judge past events by; defaults to now. */
  today?: string;
  onClose?: () => void;
  /** Called when a link in the card is followed. */
  onAction?: () => void;
}) {
  const ctaUrl = safePromoUrl(promo.cta_url);
  const ctaLabel = promo.cta_label?.trim() || 'Learn more';

  const closeButton = onClose && (
    <button type="button" onClick={onClose} aria-label="Close"
      className="absolute top-2 right-2 flex items-center justify-center rounded-full transition-opacity hover:opacity-70"
      style={{ width: 28, height: 28, background: C.pill, border: 'none', cursor: 'pointer' }}>
      <X className="w-3.5 h-3.5" style={{ color: C.muted }} />
    </button>
  );

  if (promo.kind === 'events') {
    const items = upcomingEventItems(promo.event_items, MAX_EVENT_ITEMS, today);
    return (
      <div className="relative" style={{ background: C.card, color: C.text, borderRadius: 16, padding: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
        <div className="pr-8" style={{ padding: '2px 2px 0' }}>
          <p className="text-[15px] font-bold leading-snug" style={{ color: C.text }}>{promo.title}</p>
          {promo.body && <p className="text-[13px] leading-snug mt-0.5" style={{ color: C.muted }}>{promo.body}</p>}
        </div>
        <div className="flex flex-col gap-2 mt-3">
          {items.map((item, i) => {
            const { month, day } = eventDateParts(item.date);
            const url = safePromoUrl(item.url);
            const row = (
              // Date tile as on a printed event card: small spaced month over a large, regular-weight
              // day, solid brand color; details on a light panel beside it.
              <div className="flex items-stretch overflow-hidden" style={{ borderRadius: 6, background: C.input, minHeight: 72 }}>
                <div className="flex flex-col items-center justify-center flex-shrink-0"
                  style={{ width: 76, padding: '10px 0', background: C.cta, color: C.ctaText }}>
                  <span className="text-[12px] font-medium" style={{ letterSpacing: '0.18em', paddingLeft: '0.18em' }}>{month}</span>
                  <span className="text-[34px] font-normal leading-none mt-1" style={{ letterSpacing: '0.02em' }}>{day}</span>
                </div>
                <div className="min-w-0 flex-1 flex flex-col justify-center" style={{ padding: '8px 14px' }}>
                  <p className="text-[10.5px] font-medium uppercase" style={{ color: C.muted, letterSpacing: '0.14em' }}>{eventFormatLabel(item.format)}</p>
                  <p className="text-[15px] font-semibold leading-snug truncate mt-0.5" style={{ color: C.text, letterSpacing: '0.02em' }}>{item.title}</p>
                  {item.note && <p className="text-[13px] leading-snug truncate" style={{ color: C.muted, letterSpacing: '0.01em' }}>{item.note}</p>}
                </div>
              </div>
            );
            return url
              ? <a key={i} href={url} {...linkProps(url)} onClick={onAction} className="block transition-opacity hover:opacity-85">{row}</a>
              : <div key={i}>{row}</div>;
          })}
        </div>
        {ctaUrl && (
          <a href={ctaUrl} {...linkProps(ctaUrl)} onClick={onAction}
            className="inline-block mt-3 text-[13px] font-semibold hover:underline" style={{ color: C.cta }}>
            {ctaLabel}
          </a>
        )}
        {closeButton}
      </div>
    );
  }

  const imageUrl = safePromoUrl(promo.image_url);
  return (
    <div className="relative" style={{ background: C.card, color: C.text, borderRadius: 16, padding: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.18)' }}>
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
            <a href={ctaUrl} {...linkProps(ctaUrl)} onClick={onAction}
              className="inline-block mt-2 text-[13px] font-semibold hover:underline"
              style={{ color: C.cta }}>
              {ctaLabel}
            </a>
          )}
        </div>
      </div>
      {closeButton}
    </div>
  );
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
  // The viewer's date, captured once and used for both the request and the row check, so the two
  // can never straddle midnight. Re-read every minute: when it changes (a page left open
  // overnight, or a device waking from sleep) the promo is fetched again, so yesterday's events
  // drop off and an expired events promo stops blocking the next one.
  const [today, setToday] = useState(() => localIsoDate());
  useEffect(() => {
    const tick = setInterval(() => setToday(localIsoDate()), 60_000);
    return () => clearInterval(tick);
  }, []);
  // The promo currently on screen, so a refresh that returns the same one updates it in place
  // instead of hiding it and sliding it in again.
  const shownId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      // The token only sharpens targeting (cohort, Student Mode via the page's fetch bridge);
      // signed out, the route returns everyone-audience promos.
      const { data: { session } } = await supabase.auth.getSession();
      const closed = readDismissed().map(c => (c.at === null ? c.id : `${c.id}:${c.at}`)).join(',');
      const params = new URLSearchParams({ placement, closed, today });
      const res = await fetch(`/api/promotions?${params}`, {
        headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
      });
      if (!res.ok) return;
      const { promotion } = await res.json() as { promotion: ActivePromotion | null };
      if (cancelled) return;
      // The emptiness check is defensive: the server applies the same row rules with this same
      // date, so it should never drop a promo the server returned.
      const next = promotion && !(promotion.kind === 'events'
        && upcomingEventItems(promotion.event_items, MAX_EVENT_ITEMS, today).length === 0) ? promotion : null;
      if (!next) {
        shownId.current = null;
        setVisible(false);
        setPromo(null);
        return;
      }
      if (shownId.current === next.id) { setPromo(next); return; }
      setVisible(false);
      setPromo(next);
      timer = setTimeout(() => {
        if (cancelled) return;
        shownId.current = next.id;
        setVisible(true);
      }, SHOW_DELAY_MS);
    })().catch(() => { /* a promo is optional; never surface a failure */ });
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [placement, today]);

  if (!promo) return null;

  const close = () => {
    rememberDismissed(promo.id);
    shownId.current = null;
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
            // Six event rows can outgrow a short phone screen; scroll inside the card instead. The
            // cap leaves room for a page's top bar (about 64px), so the heading and close button
            // never slide underneath it.
            maxHeight: `calc(100dvh - ${96 + bottomOffset}px)`, overflowY: 'auto', borderRadius: 16,
          }}
        >
          <PromoContent promo={promo} C={C} today={today} onClose={close} onAction={() => rememberDismissed(promo.id)} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
