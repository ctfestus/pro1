'use client';

// One admin list page as a table: heading with a New button, search (and optional chips), rows that
// open the editor, and Edit and Delete in a menu. Used by Announcements, Promotions, Community and
// Schedule, which differ only in their table, their columns and how a row is deleted.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, MoreHorizontal, Pencil, Plus, Trash2, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { ConfirmModal } from '@/components/dashboard/cohorts/CohortModals';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { PageHeader } from '@/components/dashboard/content/kit';
import { FloatingMenu, menuPosition, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Card, btnClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';
import { SectionSkeleton } from '@/components/dashboard/content/SectionSkeleton';

export type Column = { label: string; width: string; cell: (item: any) => ReactNode };

export function ListPage({ table, title, sub, noun, createHref, createLabel, columns, nameOf, searchText, chips, beforeDelete, deleteBody, C: theme }: {
  table: string;
  title: string;
  sub: string;
  /** Singular and plural, for counts and messages: ['announcement', 'announcements']. */
  noun: [string, string];
  createHref: string;
  createLabel: string;
  columns: Column[];
  /** The item's name, for menus and the delete pop-up. */
  nameOf: (item: any) => string;
  /** What the search box looks in. */
  searchText: (item: any) => string;
  /** Optional filter chips after All, each with its test. */
  chips?: { label: string; test: (item: any) => boolean }[];
  /** Runs before the row is deleted (cleaning up a cover image, say). */
  beforeDelete?: (item: any) => Promise<void>;
  deleteBody?: string;
  C: ThemeColors;
}) {
  // As on the other admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const router = useRouter();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState('All');
  const [menu, setMenu] = useState<{ item: any; position: MenuPosition } | null>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const editHref = (item: any) => `${createHref}?edit=${item.id}`;

  const nounPlural = noun[1];
  useEffect(() => {
    let live = true;
    supabase.from(table).select('*').order('created_at', { ascending: false }).then(({ data, error }) => {
      if (!live) return;
      // Not an empty list: say it failed, so nobody reads it as having none.
      if (error) setLoadError(error.message || `Could not load the ${nounPlural}.`);
      else setItems(data ?? []);
      setLoading(false);
    });
    return () => { live = false; };
  }, [table, nounPlural]);

  async function remove() {
    const item = deleting;
    setBusy(true);
    try {
      await beforeDelete?.(item);
      const { error } = await supabase.from(table).delete().eq('id', item.id);
      if (error) throw error;
      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setNotice({ ok: true, text: `${nameOf(item)} deleted` });
    } catch (err: any) {
      setNotice({ ok: false, text: err?.message || `Failed to delete the ${noun[0]}.` });
    } finally {
      setBusy(false);
      setDeleting(null);
    }
  }

  const term = search.trim().toLowerCase();
  const chipTest = chips?.find((c) => c.label === chip)?.test;
  const visible = items.filter((i) => (!chipTest || chipTest(i)) && (!term || searchText(i).toLowerCase().includes(term)));
  const kebab = (item: any) => (
    <button type="button" aria-label={`Actions for ${nameOf(item)}`}
      onClick={(e) => { e.stopPropagation(); setMenu(menu?.item.id === item.id ? null : { item, position: menuPosition(e.currentTarget, 150) }); }}
      className="w-8 h-8 rounded-[10px] inline-grid place-items-center flex-shrink-0"
      style={menu?.item.id === item.id ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}>
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );

  return (
    <div className="space-y-5 pb-12">
      <PageHeader title={title} sub={sub} C={C} actions={
        <Link href={createHref} className={`${btnClass} no-underline`} style={btnStyle('pri', C)}>
          <Plus className="w-4 h-4" />
          {createLabel}
        </Link>
      } />
      {(notice || loadError) && (
        <div role={notice?.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={notice?.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          {notice?.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          <span className="flex-1">{notice?.text ?? loadError}</span>
          {notice && <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4" /></button>}
        </div>
      )}
      {loading ? (
        <SectionSkeleton C={C} shape="rows" header={false} stats={0} />
      ) : loadError ? null : items.length === 0 ? (
        <Card C={C} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>No {noun[1]} yet</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Create your first {noun[0]} to get started.</p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder={`Search ${noun[1]}`} C={C} />
            {chips && (
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Filter ${noun[1]}`}>
                {['All', ...chips.map((c) => c.label)].map((label) => (
                  <button key={label} type="button" aria-pressed={chip === label} onClick={() => setChip(label)} className="h-8 px-3 rounded-full text-xs font-semibold"
                    style={chip === label ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Card C={C} className="overflow-hidden">
            {visible.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>No {noun[1]} match.</p>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full min-w-[600px] text-sm table-fixed">
                    <colgroup>{columns.map((c) => <col key={c.label} style={{ width: c.width }} />)}<col style={{ width: 72 }} /></colgroup>
                    <thead><tr>{[...columns.map((c) => c.label), ''].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr></thead>
                    <tbody>
                      {visible.map((item) => (
                        <tr key={item.id} onClick={() => router.push(editHref(item))} className="cursor-pointer" style={{ borderTop: `1px solid ${C.divider}` }}>
                          {columns.map((c) => <td key={c.label} className="px-4 py-3" style={{ color: C.text }}>{c.cell(item)}</td>)}
                          <td className="pl-2 pr-5 py-3 text-right">{kebab(item)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden">
                  {visible.map((item, i) => (
                    <div key={item.id} onClick={() => router.push(editHref(item))} className="flex items-start gap-3 px-4 py-4 cursor-pointer" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                      <div className="min-w-0 flex-1 grid gap-2 text-sm" style={{ color: C.text }}>
                        {columns[0].cell(item)}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: C.muted }}>
                          {columns.slice(1).map((c) => <span key={c.label}>{c.cell(item)}</span>)}
                        </div>
                      </div>
                      {kebab(item)}
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
          {visible.length > 0 && <p className="text-xs" style={{ color: C.muted }}>{plural(visible.length, noun[0])}. Click a row to edit it.</p>}
        </>
      )}

      {menu && (
        <FloatingMenu position={menu.position} label={`${noun[0]} actions`} onClose={() => setMenu(null)} C={C} items={[
          { label: 'Edit', sub: `Open the ${noun[0]}`, icon: Pencil, onClick: () => { const item = menu.item; setMenu(null); router.push(editHref(item)); } },
          null,
          { label: 'Delete', sub: 'Asks first', icon: Trash2, danger: true, onClick: () => { setDeleting(menu.item); setMenu(null); } },
        ]} />
      )}
      {deleting && (
        <ConfirmModal title={`Delete ${noun[0]}?`} eyebrow={nameOf(deleting)} body={deleteBody ?? 'This cannot be undone.'} action={`Delete ${noun[0]}`}
          danger busy={busy} onClose={() => setDeleting(null)} onConfirm={remove} C={C} />
      )}
    </div>
  );
}
