'use client';

// Admin Groups: project teams inside each bootcamp cohort. The details panel and pop-ups live in
// components/groups/.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Eye, Mail, MoreHorizontal, Pencil, Plus, Trash2, Wand2, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetch-all-rows';
import { DARK_C, useC } from '@/lib/theme';
import { MenuSelect } from '@/components/MenuSelect';
import { getJson, sendJson } from '@/components/dashboard/subscriptions/api';
import { FloatingMenu, menuPosition, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Card, DISPLAY_FONT, Money, Pill, btnClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';
import { ConfirmModal } from '@/components/dashboard/cohorts/CohortModals';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { GroupDrawer } from '@/components/groups/GroupDrawer';
import { AutoGenerateModal, EditGroupModal, NewGroupModal, type Cohort } from '@/components/groups/GroupModals';

export default function AdminGroupsPage() {
  const theme = useC();
  // As on the dashboard's admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const router = useRouter();
  const [groups, setGroups] = useState<any[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [learners, setLearners] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState('');
  // A link from a cohort can open this page on that cohort with ?cohortId=.
  const [cohortFilter, setCohortFilter] = useState(() => (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('cohortId') ?? 'all' : 'all'));
  const [menu, setMenu] = useState<{ group: any; position: MenuPosition } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const notify = useCallback((ok: boolean, text: string) => setNotice({ ok, text }), []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/auth'); return; }
      supabase.from('students').select('role').eq('id', session.user.id).single()
        .then(({ data }) => { if (!data || !['admin', 'instructor'].includes(data.role)) router.replace('/dashboard'); });
    });
  }, [router]);

  const loadGroups = useCallback(async () => {
    const data = await getJson('/api/groups', 'Could not load the groups.');
    setGroups(data.groups ?? []);
  }, []);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const { data: cohortRows, error } = await supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name');
      if (error) throw error;
      setCohorts(cohortRows ?? []);
      await loadGroups();
      // Only for the "without a group" count, so a failure leaves that tile out rather than the page.
      const ids = (cohortRows ?? []).map((c) => c.id);
      try {
        setLearners(ids.length ? await fetchAllRows<any>((from, to) => supabase
          .from('students').select('id, cohort_id', { count: 'exact' })
          .eq('role', 'student').eq('status', 'active').in('cohort_id', ids)
          .order('id').range(from, to)) : []);
      } catch { setLearners(null); }
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load the groups.');
    } finally {
      setLoading(false);
    }
  }, [loadGroups]);
  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    try { await loadGroups(); } catch (err: any) { notify(false, err.message); }
  };

  async function emailMembers(group: any) {
    setMenu(null);
    try {
      const data = await sendJson('/api/groups/notify', 'POST', { group_id: group.id }, 'Failed to email the members.');
      notify(true, `Emailed ${plural(data.sent ?? 0, 'member')} of ${group.name}`);
    } catch (err: any) {
      notify(false, err.message);
    }
  }

  async function deleteGroup() {
    setBusy(true);
    try {
      await sendJson(`/api/groups/${deleting.id}`, 'DELETE', {}, 'Failed to delete the group.');
      if (openId === deleting.id) setOpenId(null);
      notify(true, `${deleting.name} deleted`);
      setDeleting(null);
      await refresh();
    } catch (err: any) {
      notify(false, err.message);
      setDeleting(null);
    } finally {
      setBusy(false);
    }
  }

  const term = search.trim().toLowerCase();
  const inCohort = groups.filter((g) => cohortFilter === 'all' || g.cohort_id === cohortFilter);
  const visible = inCohort.filter((g) => !term || [g.name, ...(g.group_members ?? []).map((m: any) => m.students?.full_name)].some((v) => (v ?? '').toLowerCase().includes(term)));
  const memberCount = inCohort.reduce((n, g) => n + (g.group_members?.length ?? 0), 0);
  const grouped = new Set(groups.flatMap((g) => (g.group_members ?? []).map((m: any) => m.student_id)));
  const ungrouped = learners?.filter((s) => (cohortFilter === 'all' || s.cohort_id === cohortFilter) && !grouped.has(s.id)).length;
  const cohortCount = new Set(inCohort.map((g) => g.cohort_id)).size;
  const leaderOf = (g: any) => g.group_members?.find((m: any) => m.is_leader)?.students?.full_name;
  const pickCohort = cohortFilter === 'all' ? '' : cohortFilter;

  const banner = notice && (
    <div role={notice.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
      style={notice.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
      {notice.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
      <span className="flex-1">{notice.text}</span>
      <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4" /></button>
    </div>
  );
  const kebab = (g: any) => (
    <button type="button" aria-label={`Actions for ${g.name}`} onClick={(e) => { e.stopPropagation(); setMenu(menu?.group.id === g.id ? null : { group: g, position: menuPosition(e.currentTarget, 260) }); }}
      className="w-8 h-8 rounded-[10px] inline-grid place-items-center flex-shrink-0"
      style={menu?.group.id === g.id ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}>
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );
  const leaderCell = (g: any) => leaderOf(g) ?? <Pill tone="warn" C={C}>{g.group_members?.length ? 'No leader' : 'No members yet'}</Pill>;
  const kpis = [
    { label: 'Groups', n: inCohort.length, sub: `In ${plural(cohortCount, 'cohort')}`, color: C.text },
    { label: 'Learners in a group', n: memberCount, sub: inCohort.length ? `Average of ${Math.round(memberCount / inCohort.length)} per group` : 'No groups yet', color: C.text },
    ...(ungrouped == null ? [] : [{ label: 'Without a group', n: ungrouped, sub: ungrouped ? 'Auto-generate can place them' : 'Everyone is in a group', color: ungrouped ? P.warn : C.text }]),
  ];

  return (
    <div className="min-h-screen" style={{ background: C.page, color: C.text }}>
      <div className="max-w-[1140px] mx-auto px-4 sm:px-6 py-8 space-y-5">
        <Link href="/dashboard#cohorts" className="inline-flex items-center gap-2 text-sm font-semibold no-underline" style={{ color: C.muted }}>
          <ArrowLeft className="w-4 h-4" />
          Cohorts
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Groups</h1>
            <p className="text-sm mt-1" style={{ color: C.muted }}>Project teams inside each cohort, with a leader.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setGenerating(true)} className={btnClass} style={btnStyle('sec', C)}><Wand2 className="w-4 h-4" />Auto-generate</button>
            <button type="button" onClick={() => setCreating(true)} className={btnClass} style={btnStyle('pri', C)}><Plus className="w-4 h-4" />New group</button>
          </div>
        </div>
        {banner}
        {loadError && !loading && (
          <div role="alert" className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
            <XCircle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1">{loadError}</span>
            <button type="button" onClick={() => { setLoading(true); load(); }} className="text-xs font-semibold underline underline-offset-2">Try again</button>
          </div>
        )}

        {loading ? (
          <div className="h-64 rounded-2xl animate-pulse" style={{ background: C.card }} />
        ) : loadError ? null : (
          <>
            <div className={`grid gap-3 ${kpis.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              {kpis.map((k) => (
                <Card key={k.label} C={C} className="p-4 grid gap-2 content-start">
                  <p className="text-2xl sm:text-[28px] leading-8 sm:leading-9 font-semibold tabular-nums" style={{ color: k.color, fontFamily: DISPLAY_FONT }}>{k.n}</p>
                  <p className="text-sm font-semibold" style={{ color: C.text }}>{k.label}</p>
                  <p className="text-xs" style={{ color: C.muted }}>{k.sub}</p>
                </Card>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={search} onChange={setSearch} placeholder="Search groups or members" C={C} />
              <MenuSelect searchable fixed label="Filter by cohort" value={cohortFilter} onChange={(v) => { setCohortFilter(v); setOpenId(null); }}
                options={[{ value: 'all', label: 'All cohorts' }, ...cohorts.map((c) => ({ value: c.id, label: c.name }))]} C={C} />
            </div>
            <Card C={C} className="overflow-hidden">
              {visible.length === 0 ? (
                <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>
                  {inCohort.length ? 'No groups match.' : 'No groups yet. Create one, or auto-generate them for a cohort.'}
                </p>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm table-fixed">
                      <colgroup><col style={{ width: '30%' }} /><col style={{ width: '30%' }} /><col style={{ width: '12%' }} /><col style={{ width: '20%' }} /><col style={{ width: 72 }} /></colgroup>
                      <thead><tr>{['Group', 'Cohort', 'Members', 'Leader', ''].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {visible.map((g) => (
                          <tr key={g.id} onClick={() => setOpenId(g.id)} className="cursor-pointer" style={{ borderTop: `1px solid ${C.divider}` }}>
                            <td className="px-4 py-3">
                              <p className="font-semibold truncate" style={{ color: C.text }}>{g.name}</p>
                              {g.description && <p className="text-xs truncate" style={{ color: C.muted }}>{g.description}</p>}
                            </td>
                            <td className="px-4 py-3"><span className="line-clamp-2" style={{ color: C.text }}>{g.cohorts?.name}</span></td>
                            <td className="px-4 py-3"><Money C={C}>{g.group_members?.length ?? 0}</Money></td>
                            <td className="px-4 py-3" style={{ color: C.text }}>{leaderCell(g)}</td>
                            <td className="pl-2 pr-5 py-3 text-right">{kebab(g)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="md:hidden">
                    {visible.map((g, i) => (
                      <div key={g.id} onClick={() => setOpenId(g.id)} className="grid gap-2 px-4 py-4 cursor-pointer" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold" style={{ color: C.text }}>{g.name}</p>
                            <p className="text-xs" style={{ color: C.muted }}>{g.cohorts?.name}</p>
                          </div>
                          {kebab(g)}
                        </div>
                        <p className="text-xs" style={{ color: C.muted }}>{plural(g.group_members?.length ?? 0, 'member')}{leaderOf(g) ? `, led by ${leaderOf(g)}` : ''}</p>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
            {visible.length > 0 && (
              <p className="text-xs" style={{ color: C.muted }}>{plural(visible.length, 'group')}. Click a row to see its members.</p>
            )}
          </>
        )}
      </div>

      {menu && (
        <FloatingMenu
          position={menu.position}
          label="group actions"
          onClose={() => setMenu(null)}
          C={C}
          items={[
            { label: 'Open', sub: 'Members, leader and email', icon: Eye, onClick: () => { setOpenId(menu.group.id); setMenu(null); } },
            { label: 'Edit details', sub: 'Name and description', icon: Pencil, onClick: () => { setEditing(menu.group); setMenu(null); } },
            { label: 'Email members', sub: 'Tells them who is in their group', icon: Mail, disabled: !menu.group.group_members?.length, onClick: () => emailMembers(menu.group) },
            null,
            { label: 'Delete group', sub: 'Asks first; members stay in the cohort', icon: Trash2, danger: true, onClick: () => { setDeleting(menu.group); setMenu(null); } },
          ]}
        />
      )}
      {openId && (
        <GroupDrawer key={openId} groupId={openId} banner={banner} onClose={() => setOpenId(null)} onChanged={refresh} onEmail={emailMembers} onDelete={setDeleting} notify={notify} C={C} />
      )}
      {creating && (
        <NewGroupModal cohorts={cohorts} initialCohort={pickCohort} onClose={() => setCreating(false)} C={C}
          onCreated={async (groupId, text, ok) => { setCreating(false); notify(ok, text); await refresh(); setOpenId(groupId); }} />
      )}
      {generating && (
        <AutoGenerateModal cohorts={cohorts} initialCohort={pickCohort} onClose={() => setGenerating(false)} C={C}
          onDone={async (text) => { setGenerating(false); notify(true, text); await refresh(); }} />
      )}
      {editing && <EditGroupModal group={editing} onClose={() => setEditing(null)} C={C} onSaved={async () => { notify(true, 'Group updated'); await refresh(); }} />}
      {deleting && (
        <ConfirmModal
          title="Delete group?"
          eyebrow={deleting.name}
          body={`Its ${plural(deleting.group_members?.length ?? 0, 'member')} stay in ${deleting.cohorts?.name ?? 'their cohort'} and go back to having no group. Assignments given to this group are no longer given to it.`}
          action="Delete group"
          danger
          busy={busy}
          onClose={() => setDeleting(null)}
          onConfirm={deleteGroup}
          C={C}
        />
      )}
    </div>
  );
}
