'use client';

// The admin Cohorts page: the list of bootcamp cohorts, and one cohort's Students, Content,
// Payment terms and Admissions. The sections and pop-ups live in components/dashboard/cohorts/.

import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, CheckCircle2, Eye, MoreHorizontal, Pencil, Plus, Trash2, Users, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetch-all-rows';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { IsStaffContext } from '@/components/dashboard/context';
import { accessToken, getJson, sendJson } from '@/components/dashboard/subscriptions/api';
import { FloatingMenu, menuPosition, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Bar, Card, DISPLAY_FONT, Money, Pill, btnClass, btnStyle, learnerName, palette, plural } from '@/components/dashboard/subscriptions/ui';
import { AdmissionsTab } from '@/components/dashboard/cohorts/AdmissionsTab';
import { CohortFormModal, DeleteCohortModal, type DeleteTarget } from '@/components/dashboard/cohorts/CohortModals';
import { ContentTab, type ContentItem } from '@/components/dashboard/cohorts/ContentTab';
import { PaymentTermsTab } from '@/components/dashboard/cohorts/PaymentTermsTab';
import { SearchBox, StudentsTab } from '@/components/dashboard/cohorts/StudentsTab';
import { CONTENT_TYPES, cohortStatus, dateRange, feeText, termsText, type CohortBucket, type ContentType } from '@/components/dashboard/cohorts/shared';

const STATUS_CHIPS: ['all' | CohortBucket, string][] = [['all', 'All'], ['running', 'Running'], ['upcoming', 'Upcoming'], ['ended', 'Ended']];
type Section = 'students' | 'content' | 'payment' | 'admissions';
const SECTIONS: [Section, string][] = [['students', 'Students'], ['content', 'Content'], ['payment', 'Payment terms'], ['admissions', 'Admissions']];
const SHORT_TYPE: Record<ContentType, [string, string]> = {
  course: ['course', 'courses'], learning_path: ['path', 'paths'], virtual_experience: ['experience', 'experiences'], assignment: ['assignment', 'assignments'],
};

export function CohortsSection({ C: theme }: { C: ThemeColors }) {
  // As on Subscriptions, Payments and Students: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const isStaff = useContext(IsStaffContext);
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [fees, setFees] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CohortBucket>('all');
  const [menu, setMenu] = useState<{ cohort: any; position: MenuPosition } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('students');
  const [form, setForm] = useState<'new' | any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [admissions, setAdmissions] = useState<any[]>([]);
  const [admissionsLoading, setAdmissionsLoading] = useState(false);
  // Bumped when a cohort's payment terms are read, so the form starts again from what was saved.
  const [termsVersion, setTermsVersion] = useState(0);

  const notify = useCallback((ok: boolean, text: string) => setNotice({ ok, text }), []);

  // Paged: PostgREST caps a single response at the project's row limit and truncates SILENTLY,
  // so on a large tenant learners past the cap would simply be missing. Ordered by (full_name, id)
  // because page boundaries need a total order.
  const fetchStudents = () => fetchAllRows<any>((from, to) => supabase
    .from('students')
    .select('id, full_name, email, cohort_id, onboarding_done, account_provisioned_at, setup_email_sent_at, password_setup_started_at, password_set_at, onboarding_completed_at, last_login_at', { count: 'exact' })
    .eq('role', 'student')
    .order('full_name')
    .order('id')
    .range(from, to));

  // A failed refresh keeps the roster on screen rather than blanking it, which would make every
  // cohort look empty, and says so instead.
  const refreshStudents = async () => {
    try { setStudents(await fetchStudents()); return true; } catch (err) { console.error('[CohortsSection] student refresh failed', err); return false; }
  };

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const rows = async (query: PromiseLike<{ data: any[] | null; error: any }>) => {
        const { data, error } = await query;
        if (error) throw error;
        return data ?? [];
      };
      const types = Object.keys(CONTENT_TYPES) as ContentType[];
      const [cohortRows, roster, ...lists] = await Promise.all([
        rows(supabase.from('cohorts').select('*').eq('cohort_kind', 'bootcamp').order('created_at', { ascending: false })),
        fetchStudents(),
        ...types.map(async (type) => {
          const table = CONTENT_TYPES[type].table;
          const list = await rows(supabase.from(table).select(table === 'courses' ? 'id, title, status, cohort_ids, available_to_everyone' : 'id, title, status, cohort_ids').order('created_at', { ascending: false }));
          return list.map((r: any) => ({ ...r, _type: type }));
        }),
      ]);
      setCohorts(cohortRows);
      setStudents(roster);
      setContent(lists.flat().filter((item) => !isStaff || item.status === 'published'));
      if (!isStaff) {
        // Fees only fill in a column, so a failure here leaves it empty rather than failing the page.
        const { data } = await supabase.from('cohort_payment_settings').select('*');
        setFees(Object.fromEntries((data ?? []).map((row: any) => [row.cohort_id, row])));
      }
    } catch (err: any) {
      // Not an empty list: say it failed, so nobody reads it as a school with no cohorts.
      setLoadError(err?.message || 'Could not load the cohorts.');
    } finally {
      setLoading(false);
    }
  }, [isStaff]);
  useEffect(() => { load(); }, [load]);

  const cohort = cohorts.find((c) => c.id === openId) ?? null;

  const loadAdmissions = useCallback(async (cohortId: string) => {
    setAdmissionsLoading(true);
    try {
      const data = await getJson(`/api/admissions?cohortId=${cohortId}`, 'Could not load admissions.');
      setAdmissions(data.admissions ?? data.intakes ?? []);
      setFees((prev) => {
        const next = { ...prev };
        if (data.settings) next[cohortId] = data.settings; else delete next[cohortId];
        return next;
      });
      setTermsVersion((v) => v + 1);
    } catch (err: any) {
      notify(false, err.message);
    } finally {
      setAdmissionsLoading(false);
    }
  }, [notify]);
  useEffect(() => {
    if (!openId || isStaff) return;
    setAdmissions([]);
    loadAdmissions(openId);
  }, [openId, isStaff, loadAdmissions]);

  const open = (c: any) => { setOpenId(c.id); setSection('students'); setMenu(null); setNotice(null); window.scrollTo({ top: 0 }); };

  async function assign(student: any, cohortId: string | null) {
    try {
      await sendJson('/api/admissions', 'POST', { action: 'assign-student', studentId: student.id, cohortId }, 'Failed to update the learner.');
      setStudents((prev) => prev.map((s) => (s.id === student.id ? { ...s, cohort_id: cohortId } : s)));
      return true;
    } catch (err: any) {
      notify(false, `${learnerName(student)}: ${err.message}`);
      return false;
    }
  }

  async function deleteAccount(student: any) {
    try {
      await sendJson('/api/admin/delete-user', 'DELETE', { userId: student.id }, 'Failed to delete the account.');
      setStudents((prev) => prev.filter((s) => s.id !== student.id));
      notify(true, `${learnerName(student)}'s account was deleted`);
      return true;
    } catch (err: any) {
      notify(false, err.message);
      return false;
    }
  }

  // The server answers a first attempt on a cohort with anything attached by listing exactly what
  // would be destroyed, which the Delete pop-up shows. Payment receipts and admission records really
  // are deleted, so the warning is the whole point of the round trip.
  async function deleteCohort(id: string, confirm = false, alsoMembers = false, expect?: string) {
    setDeletingId(id);
    setMenu(null);
    const res = await fetch(`/api/cohorts/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` },
      body: JSON.stringify({ confirm, deleteStudents: alsoMembers, expect }),
    }).catch(() => null);
    const json = res ? await res.json().catch(() => ({})) : {};
    setDeletingId(null);

    if (res?.status === 409 && json.requiresConfirmation) {
      // A re-ask means the cohort changed under us; the pop-up opens fresh, so agreeing to delete
      // three accounts is never carried over to forty.
      setDeleteTarget({
        id,
        name: cohorts.find((c) => c.id === id)?.name ?? 'this cohort',
        losses: json.losses ?? [],
        members: json.members ?? 0,
        held: json.held ?? 0,
        holdWarning: json.holdWarning ?? null,
        fingerprint: json.fingerprint ?? '',
      });
      if (json.stale) notify(false, json.error || 'This cohort changed. Check the numbers again.');
      return;
    }
    if (!res || !res.ok) { notify(false, json.error || 'Failed to delete cohort.'); return; }

    setCohorts((prev) => prev.filter((c) => c.id !== id));
    if (openId === id) setOpenId(null);
    setDeleteTarget(null);
    // Always read the roster back: members lose the cohort, a learner held over a balance moves to
    // no cohort at all, and deleted accounts are gone, none of which can be worked out here.
    const stale = (await refreshStudents()) ? '' : ' The learner list may be out of date; reload the page.';
    // 207: the cohort went but not every account did. A 2xx, but a failure to report.
    if (res.status === 207) { notify(false, (json.error || 'Cohort deleted, but not every learner account was.') + stale); return; }
    const done = json.deletedStudents ? `Cohort deleted, along with ${plural(json.deletedStudents, 'learner account')}` : 'Cohort deleted';
    notify(!stale, done + (stale ? `.${stale}` : ''));
  }

  const studentCount = (id: string) => students.filter((s) => s.cohort_id === id).length;
  const contentIn = (id: string) => content.filter((i) => Array.isArray(i.cohort_ids) && i.cohort_ids.includes(id));
  const term = search.trim().toLowerCase();
  const visible = cohorts.filter((c) => (!term || c.name.toLowerCase().includes(term)) && (statusFilter === 'all' || cohortStatus(c).bucket === statusFilter));

  const banner = notice && (
    <div role={notice.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
      style={notice.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
      {notice.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
      <span className="flex-1">{notice.text}</span>
      <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4" /></button>
    </div>
  );
  const kebab = (c: any) => (
    <button type="button" aria-label={`Actions for ${c.name}`} onClick={(e) => { e.stopPropagation(); setMenu(menu?.cohort.id === c.id ? null : { cohort: c, position: menuPosition(e.currentTarget, isStaff ? 80 : 220) }); }}
      className="w-8 h-8 rounded-[10px] inline-grid place-items-center flex-shrink-0"
      style={menu?.cohort.id === c.id ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}>
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );
  const pageTitle = (title: string, sub: string, actions?: ReactNode) => (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {/* The dashboard hides its own section title here, so this is the page heading. */}
        <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h1>
        <p className="text-sm mt-1" style={{ color: C.muted }}>{sub}</p>
      </div>
      {actions}
    </div>
  );

  // ---------- One cohort ----------
  if (cohort) {
    const members = students.filter((s) => s.cohort_id === cohort.id);
    const signedIn = members.filter((s) => s.last_login_at).length;
    const assigned = contentIn(cohort.id);
    const byType = (Object.keys(SHORT_TYPE) as ContentType[])
      .map((t) => [t, assigned.filter((i) => i._type === t).length] as const)
      .filter(([, n]) => n)
      .map(([t, n]) => `${n} ${SHORT_TYPE[t][n === 1 ? 0 : 1]}`);
    const settings = fees[cohort.id];
    const status = cohortStatus(cohort);
    const unassigned = students.filter((s) => !s.cohort_id).length;
    const kpis = [
      { label: 'Students', n: String(members.length), sub: unassigned ? `${plural(unassigned, 'learner')} not in any cohort` : 'Every learner is in a cohort', color: C.text },
      { label: 'Signed in', n: String(signedIn), sub: members.length ? `${signedIn} of ${members.length} have used their account` : 'No learners yet', color: signedIn ? P.good : C.text, bar: members.length ? (signedIn / members.length) * 100 : 0 },
      { label: 'Content', n: String(assigned.length), sub: byType.length ? byType.join(', ') : 'Nothing assigned yet', color: C.text },
      ...(isStaff ? [] : [{ label: 'Fee', n: feeText(settings) ?? 'Not set', sub: settings ? termsText(settings) : 'Set it in Payment terms', color: C.text }]),
    ];
    const sections = isStaff ? SECTIONS.filter(([id]) => id === 'students' || id === 'content') : SECTIONS;
    const current = sections.some(([id]) => id === section) ? section : 'students';

    return (
      <div className="space-y-5 pb-12">
        <button type="button" onClick={() => { setOpenId(null); setNotice(null); }} className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: C.muted }}>
          <ArrowLeft className="w-4 h-4" />
          All cohorts
        </button>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{cohort.name}</h1>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-2 text-sm" style={{ color: C.muted }}>
              <Pill tone={status.tone} dot={status.bucket !== 'ended'} C={C}>{status.label}</Pill>
              <span>{dateRange(cohort)}</span>
              {cohort.description && <span>{cohort.description}</span>}
            </div>
          </div>
          <button type="button" onClick={() => setForm(cohort)} className={btnClass} style={btnStyle('sec', C)}>
            <Pencil className="w-4 h-4" />
            Edit details
          </button>
        </div>
        {banner}
        <div className={`grid grid-cols-2 ${isStaff ? 'xl:grid-cols-3' : 'xl:grid-cols-4'} gap-3`}>
          {kpis.map((k) => (
            <Card key={k.label} C={C} className="p-4 grid gap-2 content-start">
              <p className="text-2xl sm:text-[28px] leading-8 sm:leading-9 tabular-nums truncate" style={{ color: k.color, fontFamily: DISPLAY_FONT }}>{k.n}</p>
              <p className="text-sm font-semibold" style={{ color: C.text }}>{k.label}</p>
              <p className="text-xs" style={{ color: C.muted }}>{k.sub}</p>
              {'bar' in k && k.bar != null && <Bar parts={[{ pct: k.bar, color: P.good }]} C={C} />}
            </Card>
          ))}
        </div>
        <div role="tablist" aria-label="Cohort sections" className="inline-flex max-w-full overflow-x-auto gap-1 p-1 rounded-2xl" style={{ background: C.card }}>
          {sections.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={current === id} onClick={() => setSection(id)}
              className="inline-flex items-center h-9 px-4 rounded-[10px] text-sm font-semibold whitespace-nowrap"
              style={current === id ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
              {label}
            </button>
          ))}
        </div>

        {current === 'students' && (
          <StudentsTab cohort={cohort} cohorts={cohorts} students={students} isStaff={isStaff} assign={assign} deleteAccount={deleteAccount} notify={notify} C={C} />
        )}
        {current === 'content' && (
          <ContentTab cohort={cohort} items={content} notify={notify} C={C}
            onChanged={(item, patch) => setContent((prev) => prev.map((i) => (i._type === item._type && i.id === item.id ? { ...i, ...patch } : i)))} />
        )}
        {current === 'payment' && (
          admissionsLoading && termsVersion === 0
            ? <Card C={C} className="px-5 py-12 text-center text-sm"><span style={{ color: C.muted }}>Loading payment terms...</span></Card>
            : <PaymentTermsTab key={`${cohort.id}-${termsVersion}`} cohort={cohort} settings={settings} notify={notify} C={C}
                onSaved={(saved, dates) => {
                  setFees((prev) => ({ ...prev, [cohort.id]: saved }));
                  setCohorts((prev) => prev.map((c) => (c.id === cohort.id ? { ...c, ...dates } : c)));
                }} />
        )}
        {current === 'admissions' && (
          <AdmissionsTab cohort={cohort} admissions={admissions} loading={admissionsLoading} settings={settings} notify={notify} C={C}
            reload={async () => { await Promise.all([loadAdmissions(cohort.id), refreshStudents()]); }} />
        )}

        {form && <CohortFormModal cohort={form === 'new' ? null : form} onClose={() => setForm(null)} C={C}
          onSaved={(row) => { setCohorts((prev) => prev.map((c) => (c.id === row.id ? row : c))); setForm(null); notify(true, 'Cohort updated'); }} />}
      </div>
    );
  }

  // ---------- The list ----------
  return (
    <div className="space-y-5 pb-12">
      {pageTitle('Cohorts', 'Bootcamp groups, their dates, content and fees.', !isStaff && (
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/groups" className={`${btnClass} no-underline`} style={btnStyle('sec', C)}>
            <Users className="w-4 h-4" />
            Groups
          </Link>
          <button type="button" onClick={() => setForm('new')} className={btnClass} style={btnStyle('pri', C)}>
            <Plus className="w-4 h-4" />
            New cohort
          </button>
        </div>
      ))}
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
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search cohorts by name" C={C} />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              {STATUS_CHIPS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={statusFilter === id} onClick={() => setStatusFilter(id)} className="h-8 px-3 rounded-full text-xs font-semibold"
                  style={statusFilter === id ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Card C={C} className="overflow-hidden">
            {visible.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <p className="text-sm" style={{ color: C.muted }}>{cohorts.length ? 'No cohorts match these filters.' : 'No cohorts yet.'}</p>
                {!cohorts.length && !isStaff && (
                  <button type="button" onClick={() => setForm('new')} className={`${btnClass} mt-4`} style={btnStyle('pri', C)}><Plus className="w-4 h-4" />New cohort</button>
                )}
              </div>
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full min-w-[820px] text-sm table-fixed">
                    <colgroup>
                      <col style={{ width: isStaff ? '40%' : '30%' }} /><col style={{ width: '20%' }} /><col style={{ width: '13%' }} /><col style={{ width: '9%' }} /><col style={{ width: '9%' }} />
                      {!isStaff && <col style={{ width: '13%' }} />}<col style={{ width: 72 }} />
                    </colgroup>
                    <thead>
                      <tr>{['Cohort', 'Dates', 'Status', 'Students', 'Content', ...(isStaff ? [] : ['Fee']), ''].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {visible.map((c) => {
                        const status = cohortStatus(c);
                        return (
                          <tr key={c.id} onClick={() => open(c)} className="cursor-pointer" style={{ borderTop: `1px solid ${C.divider}` }}>
                            <td className="px-4 py-3">
                              <p className="font-semibold line-clamp-2" style={{ color: C.text }}>{c.name}</p>
                              {c.description && <p className="text-xs truncate" style={{ color: C.muted }}>{c.description}</p>}
                            </td>
                            <td className="px-4 py-3" style={{ color: C.text }}>{dateRange(c)}</td>
                            <td className="px-4 py-3"><Pill tone={status.tone} dot={status.bucket !== 'ended'} C={C}>{status.label}</Pill></td>
                            <td className="px-4 py-3"><Money C={C}>{studentCount(c.id)}</Money></td>
                            <td className="px-4 py-3"><Money C={C}>{contentIn(c.id).length}</Money></td>
                            {!isStaff && <td className="px-4 py-3">{feeText(fees[c.id]) ? <Money C={C}>{feeText(fees[c.id])}</Money> : <span className="text-xs" style={{ color: C.muted }}>Not set</span>}</td>}
                            <td className="pl-2 pr-5 py-3 text-right">{kebab(c)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="md:hidden">
                  {visible.map((c, i) => {
                    const status = cohortStatus(c);
                    return (
                      <div key={c.id} onClick={() => open(c)} className="grid gap-3 px-4 py-4 cursor-pointer" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold" style={{ color: C.text }}>{c.name}</p>
                            <p className="text-xs" style={{ color: C.muted }}>{dateRange(c)}</p>
                          </div>
                          {kebab(c)}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs" style={{ color: C.muted }}>
                          <Pill tone={status.tone} dot={status.bucket !== 'ended'} C={C}>{status.label}</Pill>
                          <span>{plural(studentCount(c.id), 'student')}</span>
                          <span>{plural(contentIn(c.id).length, 'content item')}</span>
                          {!isStaff && feeText(fees[c.id]) && <span>{feeText(fees[c.id])}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Card>
          {visible.length > 0 && (
            <p className="text-xs" style={{ color: C.muted }}>
              {plural(visible.length, 'cohort')}{visible.length !== cohorts.length ? `, filtered from ${cohorts.length}` : ''}. Click a row to open it.
            </p>
          )}
        </>
      )}

      {menu && (
        <FloatingMenu
          position={menu.position}
          label="cohort actions"
          onClose={() => setMenu(null)}
          C={C}
          items={[
            { label: 'Open', sub: isStaff ? 'Students and content' : 'Students, content, payment terms, admissions', icon: Eye, onClick: () => open(menu.cohort) },
            { label: 'Edit details', sub: 'Name, description and dates', icon: Pencil, onClick: () => { setForm(menu.cohort); setMenu(null); } },
            ...(isStaff ? [] : [
              null,
              { label: deletingId === menu.cohort.id ? 'Checking...' : 'Delete cohort', sub: 'Shows what will be lost first', icon: Trash2, danger: true, disabled: deletingId === menu.cohort.id, onClick: () => deleteCohort(menu.cohort.id) },
            ]),
          ]}
        />
      )}
      {form && (
        <CohortFormModal cohort={form === 'new' ? null : form} onClose={() => setForm(null)} C={C}
          onSaved={(row) => {
            setCohorts((prev) => (form === 'new' ? [row, ...prev] : prev.map((c) => (c.id === row.id ? row : c))));
            setForm(null);
            notify(true, form === 'new' ? `${row.name} created` : 'Cohort updated');
          }} />
      )}
      {deleteTarget && (
        <DeleteCohortModal key={deleteTarget.fingerprint} target={deleteTarget} busy={deletingId === deleteTarget.id} onClose={() => setDeleteTarget(null)} C={C}
          onDelete={(alsoMembers) => deleteCohort(deleteTarget.id, true, alsoMembers, deleteTarget.fingerprint)} />
      )}
    </div>
  );
}
