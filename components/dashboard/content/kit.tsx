'use client';

// Shared by the admin content pages (Courses, Virtual experiences, Certifications, Learning
// paths): the page heading, tiles, status chips, and the card with its status, reach and menu.

import { useEffect, useState, type ElementType, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { supabase } from '@/lib/supabase';
import type { ThemeColors } from '@/lib/theme';
import { FloatingMenu, menuPosition, type MenuItem, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Card, DISPLAY_FONT, palette, plural } from '@/components/dashboard/subscriptions/ui';

export type Status = 'all' | 'published' | 'draft';
const CHIPS: [Status, string][] = [['all', 'All'], ['published', 'Published'], ['draft', 'Draft']];

/** How many subscription plans and learning paths include each item, by id. */
export type Reach = { plans: Record<string, number>; paths: Record<string, number> };

/**
 * Plans (and, for content a path can hold, learning paths) also give learners an item. Null until
 * read, and stays null if reading fails, so nothing is flagged that may well be reachable.
 */
export function useReach(contentTable: 'courses' | 'virtual_experiences' | 'certifications' | 'learning_paths') {
  const [reach, setReach] = useState<Reach | null>(null);
  useEffect(() => {
    let live = true;
    const inPaths = contentTable !== 'learning_paths';
    Promise.all([
      supabase.from('subscription_plan_content').select('content_id').eq('content_table', contentTable),
      inPaths ? supabase.from('learning_paths').select('item_ids') : Promise.resolve({ data: [], error: null }),
    ]).then(([plans, paths]) => {
      if (!live || plans.error || paths.error) return;
      const count = (ids: string[]) => ids.reduce<Record<string, number>>((acc, id) => { acc[id] = (acc[id] ?? 0) + 1; return acc; }, {});
      setReach({
        plans: count((plans.data ?? []).map((r: any) => r.content_id)),
        paths: count((paths.data ?? []).flatMap((r: any) => [...new Set<string>(r.item_ids ?? [])])),
      });
    });
    return () => { live = false; };
  }, [contentTable]);
  return reach;
}

/** Every way learners reach an item: "Free" when open to everyone, else cohorts, plans and paths. */
export function audience(item: any, reach: Reach | null) {
  if (item.available_to_everyone) return 'Free';
  const parts = [
    item.cohort_ids?.length ? plural(item.cohort_ids.length, 'cohort') : '',
    reach?.plans[item.id] ? plural(reach.plans[item.id], 'plan') : '',
    reach?.paths[item.id] ? plural(reach.paths[item.id], 'path') : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Published items nobody can reach. Drafts are never counted: learners never see a draft. */
export function unassignedCount(items: any[], reach: Reach | null) {
  return reach ? items.filter((i) => i.status === 'published' && !audience(i, reach)).length : null;
}

export function PageHeader({ title, sub, actions, C }: { title: string; sub: string; actions: ReactNode; C: ThemeColors }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        {/* The dashboard hides its own section title on these pages, so this is the page heading. */}
        <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h1>
        <p className="text-sm mt-1" style={{ color: C.muted }}>{sub}</p>
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export function Kpis({ items, C }: { items: { label: string; n: ReactNode; sub: string; color: string }[]; C: ThemeColors }) {
  return (
    <div className="grid sm:grid-cols-3 gap-3">
      {items.map((k) => (
        <Card key={k.label} C={C} className="p-4 grid gap-2 content-start">
          <p className="text-2xl sm:text-[28px] leading-8 sm:leading-9 tabular-nums" style={{ color: k.color, fontFamily: DISPLAY_FONT }}>{k.n}</p>
          <p className="text-sm font-semibold" style={{ color: C.text }}>{k.label}</p>
          <p className="text-xs" style={{ color: C.muted }}>{k.sub}</p>
        </Card>
      ))}
    </div>
  );
}

/** The standard three tiles: total, published, and published but not assigned. */
export function contentKpis({ items, reach, noun, totalSub, C }: { items: any[]; reach: Reach | null; noun: [string, string]; totalSub: string; C: ThemeColors }) {
  const P = palette(C);
  const published = items.filter((i) => i.status === 'published').length;
  const drafts = items.filter((i) => i.status === 'draft').length;
  const unassigned = unassignedCount(items, reach);
  return [
    { label: noun[1].charAt(0).toUpperCase() + noun[1].slice(1), n: items.length, sub: totalSub, color: C.text },
    { label: 'Published', n: published, sub: drafts ? `${drafts} still in draft` : 'No drafts', color: published ? P.good : C.text },
    {
      label: 'Not assigned', n: unassigned ?? '--', color: unassigned ? P.warn : C.text,
      sub: unassigned ? 'Published, but no cohort, plan, path or open access' : unassigned === 0 ? `Every published ${noun[0]} reaches learners` : 'Checking plans and paths',
    },
  ];
}

export function StatusChips({ value, onChange, C }: { value: Status; onChange: (s: Status) => void; C: ThemeColors }) {
  const P = palette(C);
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
      {CHIPS.map(([id, label]) => (
        <button key={id} type="button" aria-pressed={value === id} onClick={() => onChange(id)} className="h-8 px-3 rounded-full text-xs font-semibold"
          style={value === id ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function matchesFilters(item: any, status: Status, term: string, fields: (string | null | undefined)[] = [item.title]) {
  return (status === 'all' || item.status === status) && (!term || fields.some((f) => (f ?? '').toLowerCase().includes(term)));
}

/** A heading over a group of cards, with how many it holds. */
export function GroupHeading({ name, count, noun, C }: { name: string; count: number; noun: string; C: ThemeColors }) {
  return (
    <div className="flex items-baseline gap-2 mb-3">
      <h2 className="text-lg font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{name}</h2>
      <span className="text-xs" style={{ color: C.muted }}>{plural(count, noun)}</span>
    </div>
  );
}

/** The menu's height, so it opens right by its button: rows of about 52px, dividers of 9px, 16px padding. */
function menuHeight(items: (MenuItem | null)[]) {
  return items.reduce((h, item) => h + (item ? 52 : 9), 16);
}

export const CARD_GRID = 'grid sm:grid-cols-2 lg:grid-cols-3 gap-4';

/**
 * One item as a card: its cover (or an icon) with the status on it and a menu button, then the
 * title, a detail line and where it is given. `menu` builds the menu items; it gets the menu
 * button's box, for anything that opens by the same button (Share).
 */
export function ContentCard({ item, cover, Icon, detail, reach, onOpen, menu, overlay, children, C }: {
  item: any;
  cover?: string | null;
  Icon: ElementType;
  detail?: string | null;
  reach: Reach | null;
  onOpen: () => void;
  menu: (close: () => void, from: DOMRect | null) => (MenuItem | null)[];
  /** Shown over the cover, top left (a push status). */
  overlay?: ReactNode;
  /** Anything else the card renders, such as a share pop-up. */
  children?: ReactNode;
  C: ThemeColors;
}) {
  const P = palette(C);
  const [coverError, setCoverError] = useState(false);
  const [open, setOpen] = useState<{ position: MenuPosition; from: DOMRect } | null>(null);
  const reachText = audience(item, reach);
  // The status sits on the cover, so it has a solid background to stay readable over any image.
  const tag = (text: string, color: string, dot = false) => (
    <span className="inline-flex items-center gap-2 rounded-full px-2 text-xs font-semibold leading-6 whitespace-nowrap" style={{ background: C.card, color, boxShadow: '0 1px 2px rgba(0,0,0,0.12)' }}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />}
      {text}
    </span>
  );
  const status = item.status === 'draft' ? tag('Draft', P.warn)
    : item.status === 'archived' ? tag('Archived', C.muted)
    : tag('Published', P.good, true);
  const close = () => setOpen(null);

  return (
    <Card C={C} className="overflow-hidden flex flex-col">
      <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} className="relative aspect-video cursor-pointer grid place-items-center" style={{ background: C.pill }}>
        {cover && !coverError
          ? <img src={resolveCoverUrl(cover)} alt="" loading="lazy" onError={() => setCoverError(true)} className="absolute inset-0 w-full h-full object-cover" />
          : <Icon className="w-8 h-8" style={{ color: C.faint }} />}
        {overlay}
        <div className="absolute left-3 bottom-3">{status}</div>
        <button type="button" aria-label={`Actions for ${item.title}`}
          onClick={(e) => { e.stopPropagation(); setOpen(open ? null : { position: menuPosition(e.currentTarget, menuHeight(menu(close, null))), from: e.currentTarget.getBoundingClientRect() }); }}
          className="absolute top-3 right-3 w-8 h-8 rounded-[10px] grid place-items-center"
          style={open ? { background: C.text, color: C.card } : { background: C.card, color: C.muted }}>
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
      <button type="button" onClick={onOpen} className="text-left px-4 pt-3 pb-4 grid gap-1">
        <span className="text-sm font-semibold line-clamp-2" style={{ color: C.text }}>{item.title || 'Untitled'}</span>
        {detail && <span className="text-xs" style={{ color: C.muted }}>{detail}</span>}
        {reachText
          ? <span className="text-xs" style={{ color: C.muted }}>{reachText}</span>
          : reach && item.status === 'published' && <span className="text-xs font-semibold" style={{ color: P.warn }}>Not assigned</span>}
      </button>
      {open && <FloatingMenu position={open.position} label={`${item.title} actions`} items={menu(close, open.from)} onClose={close} C={C} />}
      {children}
    </Card>
  );
}
