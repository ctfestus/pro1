'use client';

// The admin Assignments list: tiles, search and status chips, and a table of assignments with a
// menu of actions on each. Clicking a row opens its report.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Download, Eye, MoreHorizontal, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { SYNC_ENABLED } from '@/lib/sync';
import { exportAllAssignments, exportAssignment } from '@/lib/dashboard-export';
import type { ThemeColors } from '@/lib/theme';
import { ImportButton } from '@/components/dashboard/ImportButton';
import { PushAllButton } from '@/components/dashboard/primitives';
import { sendJson } from '@/components/dashboard/subscriptions/api';
import { FloatingMenu, menuPosition, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Card, DISPLAY_FONT, Pill, btnClass, btnStyle, palette, plural, shortDate } from '@/components/dashboard/subscriptions/ui';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { typeLabel } from './shared';

type Filter = 'all' | 'to_grade' | 'published' | 'draft';
const CHIPS: [Filter, string][] = [['all', 'All'], ['to_grade', 'To grade'], ['published', 'Published'], ['draft', 'Draft']];
const DAY = 86_400_000;

function todayKey() {
  return new Date().toLocaleDateString('en-CA');
}
/** Due within the next 14 days, today included. */
function dueSoon(date: string | null | undefined) {
  if (!date) return false;
  const d = String(date).slice(0, 10);
  const today = todayKey();
  return d >= today && new Date(`${d}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime() <= 14 * DAY;
}

export function AssignmentsList({ assignments, onOpen, onDuplicate, onDelete, duplicatingId, notify, C }: {
  assignments: any[];
  onOpen: (a: any) => void;
  onDuplicate: (a: any) => void;
  onDelete: (a: any) => void;
  duplicatingId: string | null;
  notify: (ok: boolean, text: string) => void;
  C: ThemeColors;
}) {
  const P = palette(C);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [menu, setMenu] = useState<{ a: any; position: MenuPosition } | null>(null);
  const [toGrade, setToGrade] = useState<Record<string, number> | null>(null);
  const [cohortNames, setCohortNames] = useState<Record<string, string>>({});

  // Hand-ins waiting to be graded, per assignment, and the cohort names for "Given to". Both only
  // add detail, so a failure leaves them out rather than failing the page.
  useEffect(() => {
    let live = true;
    supabase.from('assignment_submissions').select('assignment_id').eq('status', 'submitted').then(({ data, error }) => {
      if (!live || error) return;
      const counts: Record<string, number> = {};
      for (const row of data ?? []) counts[row.assignment_id] = (counts[row.assignment_id] ?? 0) + 1;
      setToGrade(counts);
    });
    supabase.from('cohorts').select('id, name').then(({ data }) => {
      if (live) setCohortNames(Object.fromEntries((data ?? []).map((c: any) => [c.id, c.name])));
    });
    return () => { live = false; };
  }, []);

  const published = assignments.filter((a) => a.status === 'published').length;
  const waiting = toGrade ? Object.entries(toGrade).filter(([id]) => assignments.some((a) => a.id === id)).reduce((n, [, c]) => n + c, 0) : null;
  const soon = assignments.filter((a) => a.status === 'published' && dueSoon(a.deadline_date));
  const term = search.trim().toLowerCase();
  const shown = assignments.filter((a) => (!term || (a.title ?? '').toLowerCase().includes(term))
    && (filter === 'all' || (filter === 'to_grade' ? (toGrade?.[a.id] ?? 0) > 0 : a.status === filter)));

  const givenTo = (a: any) => {
    const groups = a.group_ids?.length ?? 0;
    const cohorts: string[] = a.cohort_ids ?? [];
    if (groups) return plural(groups, 'group');
    if (cohorts.length === 1) return cohortNames[cohorts[0]] ?? '1 cohort';
    if (cohorts.length) return plural(cohorts.length, 'cohort');
    return null;
  };
  const due = (a: any) => {
    if (!a.deadline_date) return <span className="text-xs" style={{ color: C.muted }}>No due date</span>;
    const d = String(a.deadline_date).slice(0, 10);
    return d < todayKey()
      ? <span className="text-xs" style={{ color: C.muted }}>{shortDate(d)}, passed</span>
      : <span style={{ color: C.text }}>{shortDate(d)}</span>;
  };
  const gradeCell = (a: any) => {
    const n = toGrade?.[a.id] ?? 0;
    return n ? <Pill tone="warn" C={C}>{n} to grade</Pill> : <span className="text-xs" style={{ color: C.muted }}>{toGrade ? 'None' : ''}</span>;
  };
  const status = (a: any) => a.status === 'published' ? <Pill tone="good" dot C={C}>Published</Pill>
    : <Pill tone={a.status === 'draft' ? 'warn' : 'mute'} C={C}>{a.status === 'draft' ? 'Draft' : String(a.status ?? 'Draft').replace(/^./, (x) => x.toUpperCase())}</Pill>;
  const given = (a: any) => givenTo(a) ?? (a.status === 'published'
    ? <span className="text-xs font-semibold" style={{ color: P.warn }}>Not assigned</span>
    : <span className="text-xs" style={{ color: C.muted }}>Not assigned</span>);
  const kebab = (a: any) => (
    <button type="button" aria-label={`Actions for ${a.title}`} onClick={(e) => { e.stopPropagation(); setMenu(menu?.a.id === a.id ? null : { a, position: menuPosition(e.currentTarget, 360) }); }}
      className="w-8 h-8 rounded-[10px] inline-grid place-items-center flex-shrink-0"
      style={menu?.a.id === a.id ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}>
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );

  async function push(a: any) {
    setMenu(null);
    try {
      const result = await sendJson('/api/sync-push', 'POST', { type: 'assignment', id: a.id }, 'Push failed');
      notify(true, `${a.title} ${result.action === 'updated' ? 'updated on' : 'pushed to'} the platform`);
    } catch (err: any) {
      notify(false, `${a.title}: ${err.message}`);
    }
  }

  const kpis = [
    { label: 'Assignments', n: String(assignments.length), sub: `${published} published, ${assignments.length - published} not published`, color: C.text },
    { label: 'Waiting to be graded', n: waiting == null ? '--' : String(waiting), sub: 'Across all assignments', color: waiting ? P.warn : C.text },
    { label: 'Due in the next 14 days', n: String(soon.length), sub: soon.length ? soon.slice(0, 2).map((a) => a.title).join(', ') + (soon.length > 2 ? ` and ${soon.length - 2} more` : '') : 'Nothing due soon', color: C.text },
  ];

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* The dashboard hides its own section title here, so this is the page heading. */}
          <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Assignments</h1>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Briefs, case studies and projects learners hand in.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportButton types={['assignment']} C={C} className={btnClass} style={btnStyle('sec', C)}
            onImported={(r) => { window.location.href = `/create/assignment?edit=${r.id}`; }} onBulkDone={() => window.location.reload()} />
          {assignments.length > 0 && (
            <button type="button" onClick={() => exportAllAssignments(assignments, 'assignments_bulk')} className={btnClass} style={btnStyle('sec', C)}>
              <Download className="w-4 h-4" />
              Export all
            </button>
          )}
          {SYNC_ENABLED && assignments.length > 0 && (
            <PushAllButton items={assignments.map((a) => ({ type: 'assignment', id: a.id }))} C={C} className={btnClass} style={btnStyle('sec', C)} />
          )}
          <Link href="/create/assignment" className={`${btnClass} no-underline`} style={btnStyle('pri', C)}>
            <Plus className="w-4 h-4" />
            New assignment
          </Link>
        </div>
      </div>

      {assignments.length === 0 ? (
        <Card C={C} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>No assignments yet</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Create your first assignment, or import one.</p>
        </Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            {kpis.map((k) => (
              <Card key={k.label} C={C} className="p-4 grid gap-2 content-start">
                <p className="text-2xl sm:text-[28px] leading-8 sm:leading-9 tabular-nums" style={{ color: k.color, fontFamily: DISPLAY_FONT }}>{k.n}</p>
                <p className="text-sm font-semibold" style={{ color: C.text }}>{k.label}</p>
                <p className="text-xs line-clamp-2" style={{ color: C.muted }}>{k.sub}</p>
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search assignments" C={C} />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter assignments">
              {CHIPS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className="h-8 px-3 rounded-full text-xs font-semibold"
                  style={filter === id ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Card C={C} className="overflow-hidden">
            {shown.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>No assignments match these filters.</p>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full min-w-[760px] text-sm table-fixed">
                    <colgroup><col style={{ width: '32%' }} /><col style={{ width: '24%' }} /><col style={{ width: '14%' }} /><col style={{ width: '13%' }} /><col style={{ width: '12%' }} /><col style={{ width: 72 }} /></colgroup>
                    <thead><tr>{['Assignment', 'Given to', 'Due', 'To grade', 'Status', ''].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {shown.map((a) => (
                        <tr key={a.id} onClick={() => onOpen(a)} className="cursor-pointer" style={{ borderTop: `1px solid ${C.divider}` }}>
                          <td className="px-4 py-3">
                            <p className="font-semibold truncate" style={{ color: C.text }}>{a.title}</p>
                            <p className="text-xs" style={{ color: C.muted }}>{typeLabel(a)}</p>
                          </td>
                          <td className="px-4 py-3"><span className="line-clamp-2" style={{ color: C.text }}>{given(a)}</span></td>
                          <td className="px-4 py-3">{due(a)}</td>
                          <td className="px-4 py-3">{gradeCell(a)}</td>
                          <td className="px-4 py-3">{status(a)}</td>
                          <td className="pl-2 pr-5 py-3 text-right">{kebab(a)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden">
                  {shown.map((a, i) => (
                    <div key={a.id} onClick={() => onOpen(a)} className="grid gap-2 px-4 py-4 cursor-pointer" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold" style={{ color: C.text }}>{a.title}</p>
                          <p className="text-xs" style={{ color: C.muted }}>{typeLabel(a)}, {givenTo(a) ?? 'not assigned'}</p>
                        </div>
                        {kebab(a)}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">{status(a)}{gradeCell(a)}<span className="text-xs">{due(a)}</span></div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
          {shown.length > 0 && <p className="text-xs" style={{ color: C.muted }}>{plural(shown.length, 'assignment')}. Click a row to open its report.</p>}
        </>
      )}

      {menu && (
        <FloatingMenu
          position={menu.position}
          label="assignment actions"
          onClose={() => setMenu(null)}
          C={C}
          items={[
            { label: 'Open report', sub: 'Responses, scores and grading', icon: Eye, onClick: () => { setMenu(null); onOpen(menu.a); } },
            { label: 'Edit', sub: 'Brief, tasks, cohorts and due date', icon: Pencil, onClick: () => { window.location.href = `/create/assignment?edit=${menu.a.id}`; } },
            { label: duplicatingId === menu.a.id ? 'Duplicating...' : 'Duplicate', sub: 'A draft copy with its files and keys', icon: Copy, disabled: duplicatingId === menu.a.id, onClick: () => { setMenu(null); onDuplicate(menu.a); } },
            { label: 'Export', sub: 'Download as a file', icon: Download, onClick: () => { setMenu(null); exportAssignment(menu.a); } },
            ...(SYNC_ENABLED ? [{ label: 'Push to platform', sub: 'Send the latest version', icon: Send, onClick: () => push(menu.a) }] : []),
            null,
            { label: 'Delete', sub: 'Asks first', icon: Trash2, danger: true, onClick: () => { setMenu(null); onDelete(menu.a); } },
          ]}
        />
      )}
    </div>
  );
}
