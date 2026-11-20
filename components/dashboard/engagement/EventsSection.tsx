'use client';

// The admin Events page: upcoming events first, soonest at the top, then past ones, as a dated list
// with registrations and one menu per event.

import { useContext, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, Download, ExternalLink, MoreHorizontal, Pencil, Plus, Share2, Trash2 } from 'lucide-react';
import { exportContent } from '@/lib/dashboard-export';
import { getLastScheduledSessionDate, getNextScheduledSessionDate } from '@/lib/event-sessions';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { IsStaffContext } from '@/components/dashboard/context';
import { ShareMenu } from '@/components/dashboard/content-cards';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { Kpis, PageHeader } from '@/components/dashboard/content/kit';
import { FloatingMenu, menuPosition, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Card, DISPLAY_FONT, Pill, btnClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';

type Filter = 'upcoming' | 'past' | 'all';
const CHIPS: [Filter, string][] = [['upcoming', 'Upcoming'], ['past', 'Past'], ['all', 'All']];

/** The date to show (the next session of a repeating event, else its last), and whether it has passed. */
function when(form: any) {
  const ev = form.config?.eventDetails ?? {};
  const schedule = {
    event_date: ev.date ?? null,
    timezone: ev.timezone ?? null,
    recurrence: ev.recurrence ?? 'once',
    recurrence_end_date: ev.recurrenceEndDate ?? null,
    recurrence_days: Array.isArray(ev.recurrenceDays) ? ev.recurrenceDays : [],
  };
  const next = getNextScheduledSessionDate(schedule);
  const shown: string | null = next ?? getLastScheduledSessionDate(schedule) ?? ev.date ?? null;
  const date = shown ? new Date(`${shown}T00:00:00`) : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return { ev, date, past: date ? !next && date < today : false, repeats: !!ev.recurrence && ev.recurrence !== 'once' };
}

function meetingApp(link: string) {
  return link.includes('zoom') ? 'Zoom' : link.includes('teams') ? 'Microsoft Teams' : 'Google Meet';
}

export function EventsSection({ events, setFormToDelete, C: theme }: { events: any[]; setFormToDelete: (id: string) => void; C: ThemeColors }) {
  // As on the other admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const router = useRouter();
  const isStaff = useContext(IsStaffContext);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [menu, setMenu] = useState<{ form: any; position: MenuPosition; from: DOMRect } | null>(null);
  const [share, setShare] = useState<{ form: any; from: DOMRect } | null>(null);

  const rows = events.map((form) => ({ form, ...when(form) }));
  // Upcoming soonest first; past most recent first.
  const upcoming = rows.filter((r) => !r.past).sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity));
  const past = rows.filter((r) => r.past).sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
  const term = search.trim().toLowerCase();
  const list = (filter === 'upcoming' ? upcoming : filter === 'past' ? past : [...upcoming, ...past])
    .filter((r) => !term || `${r.form.title} ${r.ev.location ?? ''}`.toLowerCase().includes(term));
  const registered = upcoming.reduce((n, r) => n + (r.form._response_count ?? 0), 0);
  const next = upcoming[0];

  const kpis = [
    { label: 'Upcoming', n: upcoming.length, sub: next ? `Next: ${next.form.title}${next.date ? `, ${next.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}` : 'Nothing planned', color: C.text },
    { label: 'Registered', n: registered, sub: 'For upcoming events', color: C.text },
    { label: 'Past', n: past.length, sub: 'Insights stay available', color: C.text },
  ];

  const open = (form: any) => router.push(`/dashboard/${form.id}`);

  return (
    <div className="space-y-5 pb-12">
      <PageHeader title="Events" sub="Live sessions and meetups, with registration." C={C} actions={
        <Link href="/create?type=event" className={`${btnClass} no-underline`} style={btnStyle('pri', C)}>
          <Plus className="w-4 h-4" />
          New event
        </Link>
      } />
      {events.length === 0 ? (
        <Card C={C} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>No events yet</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Create your first event to get started.</p>
        </Card>
      ) : (
        <>
          <Kpis items={kpis} C={C} />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search events" C={C} />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter events">
              {CHIPS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className="h-8 px-3 rounded-full text-xs font-semibold"
                  style={filter === id ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Card C={C} className="overflow-hidden">
            {list.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>{term ? 'No events match.' : filter === 'upcoming' ? 'No upcoming events.' : 'No past events.'}</p>
            ) : list.map(({ form, ev, date, past: isPast, repeats }, i) => {
              const virtual = (ev.eventType || '').toLowerCase() === 'virtual';
              const time = [date ? date.toLocaleDateString('en-GB', { weekday: 'short' }) : '', ev.time].filter(Boolean).join(' ');
              const place = virtual ? meetingApp(ev.meetingLink || '') : ev.location || 'In person';
              const count = form._response_count ?? 0;
              return (
                <div key={form.id} onClick={() => open(form)} className="flex flex-wrap sm:flex-nowrap items-center gap-x-4 gap-y-2 px-5 py-4 cursor-pointer" style={{ borderTop: i ? `1px solid ${C.divider}` : undefined, opacity: isPast ? 0.75 : 1 }}>
                  <div className="w-[52px] h-14 rounded-xl grid place-items-center content-center flex-shrink-0 leading-none" style={{ background: C.pill }}>
                    <span className="text-xl" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{date ? date.getDate() : '--'}</span>
                    <span className="text-[11px] font-semibold mt-1" style={{ color: C.muted }}>{date ? date.toLocaleDateString('en-GB', { month: 'short' }) : ''}</span>
                  </div>
                  <div className="min-w-0 flex-1 basis-[200px]">
                    <p className="text-sm font-semibold flex flex-wrap items-center gap-2" style={{ color: C.text }}>
                      <span className="truncate">{form.title}</span>
                      {form.status === 'draft' && <Pill tone="warn" C={C}>Draft</Pill>}
                      {ev.isPrivate && <Pill tone="mute" C={C}>Private</Pill>}
                    </p>
                    <p className="text-xs truncate" style={{ color: C.muted }}>{[repeats && !isPast ? `Repeats, next ${time}` : time, place].filter(Boolean).join(', ')}</p>
                  </div>
                  <Pill tone="mute" C={C}>{virtual ? 'Virtual' : 'In person'}</Pill>
                  <span className="text-xs w-[100px] text-right tabular-nums" style={{ color: C.muted }}>{ev.capacity ? `${count} of ${ev.capacity}` : `${count} registered`}</span>
                  <button type="button" aria-label={`Actions for ${form.title}`}
                    onClick={(e) => { e.stopPropagation(); setMenu(menu?.form.id === form.id ? null : { form, position: menuPosition(e.currentTarget, isStaff ? 270 : 330), from: e.currentTarget.getBoundingClientRect() }); }}
                    className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0"
                    style={menu?.form.id === form.id ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}>
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </Card>
          {list.length > 0 && <p className="text-xs" style={{ color: C.muted }}>{plural(list.length, 'event')}. Click one to see its insights.</p>}
        </>
      )}

      {menu && (
        <FloatingMenu position={menu.position} label="event actions" onClose={() => setMenu(null)} C={C} items={[
          { label: 'Insights', sub: 'Registrations and attendance', icon: BarChart3, onClick: () => { const f = menu.form; setMenu(null); open(f); } },
          { label: 'Edit', sub: 'Date, place, form', icon: Pencil, onClick: () => { const f = menu.form; setMenu(null); router.push(`/dashboard/${f.id}?tab=settings`); } },
          { label: 'Preview', sub: 'The event page', icon: ExternalLink, onClick: () => { const f = menu.form; setMenu(null); window.open(`/${f.slug || f.id}`, '_blank', 'noopener'); } },
          { label: 'Share', sub: 'Link and social posts', icon: Share2, onClick: () => { setShare({ form: menu.form, from: menu.from }); setMenu(null); } },
          { label: 'Export', sub: 'Download as a file', icon: Download, onClick: () => { const f = menu.form; setMenu(null); exportContent(f); } },
          ...(isStaff ? [] : [null, { label: 'Delete', sub: 'Asks first', icon: Trash2, danger: true, onClick: () => { const f = menu.form; setMenu(null); setFormToDelete(f.id); } }]),
        ]} />
      )}
      {share && <ShareMenu form={share.form} triggerRect={share.from} onClose={() => setShare(null)} />}
    </div>
  );
}
