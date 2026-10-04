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
// A soft wide shadow plus a tight one, so a white card still has a clear edge on a white page.
const PROMO_CARD_SHADOW = '0 12px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10)';
const SHOW_DELAY_MS = 1200;
// A failed lookup (offline, server error) is retried with backoff -- 30s, 1m, 2m, 4m, 5m -- then
// left until the date changes or the page reloads, so a dead connection is not polled forever.
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 300_000;
const MAX_FETCH_ATTEMPTS = 6;

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

/** A link in the card; in the editor preview, the same element without an href, so a click there
 * cannot navigate away from unsaved work. */
function PromoLink({ url, preview, onAction, className, style, children }: {
  url: string;
  preview?: boolean;
  onAction?: () => void;
  className: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (preview) return <span className={className} style={style}>{children}</span>;
  return <a href={url} {...linkProps(url)} onClick={onAction} className={className} style={style}>{children}</a>;
}

/**
 * The card itself, without positioning. Shared by the live card and the editor preview, so the
 * preview is always exactly what visitors see. onClose omitted = no close button (preview).
 */
export function PromoContent({ promo, C, today, preview, onClose, onAction }: {
  promo: ActivePromotion;
  C: typeof LIGHT_C;
  /** The date ("YYYY-MM-DD") to judge past events by; defaults to the viewer's today. */
  today?: string;
  /** Editor preview: links look the same but do not navigate. */
  preview?: boolean;
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
    // One card per event, each built exactly like the standard promo card -- same frame, padding
    // and shadow -- with the date tile where the standard card has its image. The close button
    // sits on the first card. The promo title is only a dashboard name and screen reader label.
    return (
      <div className="flex flex-col gap-2.5">
        {items.map((item, i) => {
          const { month, day } = eventDateParts(item.date);
          const url = safePromoUrl(item.url);
          const body = (
            <div className="flex gap-3 items-center">
              <div className="flex flex-col items-center justify-center flex-shrink-0"
                style={{ width: 96, height: 96, borderRadius: 10, background: C.cta, color: C.ctaText }}>
                <span className="text-[12px] font-medium" style={{ letterSpacing: '0.18em', paddingLeft: '0.18em' }}>{month}</span>
                <span className="text-[38px] font-normal leading-none mt-1">{day}</span>
              </div>
              <div className={`min-w-0 flex-1 ${i === 0 && onClose ? 'pr-6' : ''}`}>
                <p className="text-[11px] font-semibold uppercase" style={{ color: C.muted, letterSpacing: '0.12em' }}>{eventFormatLabel(item.format)}</p>
                <p className="text-[15px] font-bold leading-snug mt-0.5 line-clamp-2" style={{ color: C.text }}>{item.title}</p>
                {item.note && <p className="text-[13px] leading-snug mt-1" style={{ color: C.muted }}>{item.note}</p>}
              </div>
            </div>
          );
          return (
            <div key={i} className="relative" style={{ background: C.card, color: C.text, borderRadius: 16, padding: 12, boxShadow: PROMO_CARD_SHADOW }}>
              {url
                ? <PromoLink url={url} preview={preview} onAction={onAction} className="block transition-opacity hover:opacity-85">{body}</PromoLink>
                : body}
              {i === 0 && closeButton}
            </div>
          );
        })}
      </div>
    );
  }

  const imageUrl = safePromoUrl(promo.image_url);
  return (
    <div className="relative" style={{ background: C.card, color: C.text, borderRadius: 16, padding: 12, boxShadow: PROMO_CARD_SHADOW }}>
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
            <PromoLink url={ctaUrl} preview={preview} onAction={onAction}
              className="inline-block mt-2 text-[13px] font-semibold hover:underline"
              style={{ color: C.cta }}>
              {ctaLabel}
            </PromoLink>
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
  // Set when the server judged event rows by a different date than ours -- it ignores a device
  // clock that is days off and uses its own. The card then judges by that same date, or it would
  // drop a promo the server picked and leave nothing on screen.
  const [serverDate, setServerDate] = useState<string | null>(null);
  const judgeDate = serverDate ?? today;
  // The promo currently on screen, so a refresh that returns the same one updates it in place
  // instead of hiding it and sliding it in again.
  const shownId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const load = async (attempt: number) => {
      let promotion: ActivePromotion | null;
      let judgedOn: string | undefined;
      try {
        // The token only sharpens targeting (cohort, Student Mode via the page's fetch bridge);
        // signed out, the route returns everyone-audience promos.
        const { data: { session } } = await supabase.auth.getSession();
        const closed = readDismissed().map(c => (c.at === null ? c.id : `${c.id}:${c.at}`)).join(',');
        const params = new URLSearchParams({ placement, closed, today });
        const res = await fetch(`/api/promotions?${params}`, {
          headers: session ? { Authorization: `Bearer ${session.access_token}` } : undefined,
        });
        if (!res.ok) {
          // A 4xx will not fix itself; only a server error or rate limit is worth retrying.
          if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`);
          return;
        }
        ({ promotion, today: judgedOn } = await res.json() as { promotion: ActivePromotion | null; today?: string });
      } catch {
        if (!cancelled && attempt + 1 < MAX_FETCH_ATTEMPTS) {
          retryTimer = setTimeout(() => { void load(attempt + 1); }, Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS));
        }
        return;
      }
      if (cancelled) return;
      const date = judgedOn ?? today;
      setServerDate(date !== today ? date : null);
      // The emptiness check is defensive: the server applies the same row rules with this same
      // date, so it should never drop a promo the server returned.
      const next = promotion && !(promotion.kind === 'events'
        && upcomingEventItems(promotion.event_items, MAX_EVENT_ITEMS, date).length === 0) ? promotion : null;
      if (!next) {
        shownId.current = null;
        setVisible(false);
        setPromo(null);
        return;
      }
      if (shownId.current === next.id) { setPromo(next); return; }
      setVisible(false);
      setPromo(next);
      showTimer = setTimeout(() => {
        if (cancelled) return;
        shownId.current = next.id;
        setVisible(true);
      }, SHOW_DELAY_MS);
    };

    void load(0);
    return () => { cancelled = true; clearTimeout(showTimer); clearTimeout(retryTimer); };
  }, [placement, today]);

  if (!promo) return null;

  // An events promo whose rows have all passed under the current date is hidden at once, without
  // waiting for the refresh -- which may be slow, or fail -- so a heading with no events never
  // sits on screen.
  const expired = promo.kind === 'events' && upcomingEventItems(promo.event_items, MAX_EVENT_ITEMS, judgeDate).length === 0;

  const close = () => {
    rememberDismissed(promo.id);
    shownId.current = null;
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && !expired && (
        <motion.aside
          role="complementary"
          aria-label={promo.title}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="fixed left-4 right-4 sm:left-auto sm:right-5 sm:w-[404px]"
          style={{
            bottom: 16 + bottomOffset, zIndex: 45,
            // Six event cards can outgrow a short phone screen; scroll inside instead. The cap leaves
            // room for a page's top bar (about 64px), so the close button never slides under it.
            maxHeight: `calc(100dvh - ${96 + bottomOffset}px)`, overflowY: 'auto',
            // Room for the card shadows inside the scroll area (which would otherwise clip them),
            // cancelled by the negative margin so the cards sit where they did.
            padding: 12, margin: -12,
          }}
        >
          <PromoContent promo={promo} C={C} today={judgeDate} onClose={close} onAction={() => rememberDismissed(promo.id)} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
