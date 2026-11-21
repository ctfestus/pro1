'use client';

// Open credentials: programmes you issue certificates and badges for, to anyone, with or without
// an account. The pop-ups live in components/open-credentials/.

import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Award, BadgeCheck, Check, ChevronLeft, ChevronRight, Copy, Download, ExternalLink,
  Loader2, MoreHorizontal, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSessionToken } from '@/lib/use-session-token';
import { DARK_C, useC } from '@/lib/theme';
import { MenuSelect } from '@/components/MenuSelect';
import { Kpis, PageHeader } from '@/components/dashboard/content/kit';
import { Modal } from '@/components/dashboard/subscriptions/Modal';
import { FloatingMenu, menuPosition, type MenuItem, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Avatar, Card, Empty, IconChip, Pill, btnClass, btnSmClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';
import { ConfirmModal, Tick } from '@/components/dashboard/cohorts/CohortModals';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { ProgramForm } from '@/components/open-credentials/ProgramForm';
import { EditCertForm, IssuePanel } from '@/components/open-credentials/CredentialForms';
import { ISSUE_MODES, fmtDate, stripHtml, type OpenCert, type Program } from '@/components/open-credentials/shared';

const PAGE_SIZE = 20;

function downloadCertsCsv(certs: OpenCert[], programName: string) {
  const rows = [
    ['Name', 'Email', 'Issue Date', 'Certificate URL', 'Status'],
    ...certs.map(c => [
      c.recipient_name, c.recipient_email ?? '', c.issued_date,
      `${window.location.origin}/credential/${c.id}`, c.revoked ? 'Revoked' : 'Active',
    ]),
  ];
  const csv  = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url;
  a.download = `${programName.replace(/\s+/g, '-')}-certificates.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type PanelMode = 'none' | 'new_program' | 'edit_program' | 'issue';
type ActiveTab = 'programs' | 'credentials';
type RowMenu = { position: MenuPosition } & ({ program: Program; cert?: undefined } | { cert: OpenCert; program?: undefined });

export default function OpenCertificatesPage() {
  const theme = useC();
  // As on the dashboard's admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);

  const [token, setToken]                     = useState<string | null>(null);
  const [authChecked, setAuthChecked]         = useState(false);
  const [programs, setPrograms]               = useState<Program[]>([]);
  const [allCerts, setAllCerts]               = useState<OpenCert[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [certsLoading, setCertsLoading]       = useState(false);
  const [activeTab, setActiveTab]             = useState<ActiveTab>('programs');
  const [panel, setPanel]                     = useState<PanelMode>('none');
  const [editingProgram, setEditingProgram]   = useState<Program | null>(null);
  const [issuingForProgram, setIssuingForProgram] = useState<Program | null>(null);

  // Credentials tab filters
  const [credSearch, setCredSearch]           = useState('');
  const [credProgramFilter, setCredProgramFilter] = useState('all');
  const [credStatusFilter, setCredStatusFilter]   = useState<'all' | 'active' | 'revoked'>('all');
  const [credPage, setCredPage]               = useState(1);
  const [selectedCertIds, setSelectedCertIds] = useState<Set<string>>(new Set());

  const [menu, setMenu]                       = useState<RowMenu | null>(null);
  const [copiedId, setCopiedId]               = useState<string | null>(null);
  const [deletingProgram, setDeletingProgram] = useState<Program | null>(null);
  const [deleteBusy, setDeleteBusy]           = useState(false);
  const [editingCert, setEditingCert]         = useState<OpenCert | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
      setAuthChecked(true);
    });
  }, []);

  // `token` says the page has loaded a session; requests send the current one, which Supabase
  // replaces about every hour.
  const liveToken = useSessionToken(token ?? '');
  const headers = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${liveToken}`,
  }), [liveToken]);

  const freshAuthHeader = useCallback(async (): Promise<HeadersInit> => {
    const { data } = await supabase.auth.getSession();
    const t = data.session?.access_token ?? token ?? '';
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    freshAuthHeader().then(h =>
      fetch('/api/programs', { headers: h as any })
        .then(r => r.json())
        .then(d => setPrograms(d.data ?? []))
        .finally(() => setLoading(false))
    );
  }, [token]);

  const loadAllCerts = useCallback(async () => {
    setCertsLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const t = sessionData.session?.access_token;
      if (!t) { setCertsLoading(false); return; }
      const res = await fetch('/api/open-certificates', {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
      });
      const data = await res.json();
      if (!res.ok) { setCertsLoading(false); return; }
      setAllCerts(data.data ?? []);
    } catch { /* non-blocking */ }
    setCertsLoading(false);
  }, []);

  useEffect(() => { if (authChecked) loadAllCerts(); }, [authChecked, loadAllCerts]);

  const certCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of allCerts) {
      if (c.program_id) map[c.program_id] = (map[c.program_id] ?? 0) + 1;
    }
    return map;
  }, [allCerts]);

  const filteredCerts = useMemo(() => {
    let list = allCerts;
    if (credProgramFilter !== 'all') list = list.filter(c => c.program_id === credProgramFilter);
    if (credStatusFilter === 'active')  list = list.filter(c => !c.revoked);
    if (credStatusFilter === 'revoked') list = list.filter(c => c.revoked);
    if (credSearch) {
      const q = credSearch.toLowerCase();
      list = list.filter(c =>
        c.recipient_name.toLowerCase().includes(q) ||
        (c.recipient_email ?? '').toLowerCase().includes(q) ||
        c.id.includes(q)
      );
    }
    return list;
  }, [allCerts, credProgramFilter, credStatusFilter, credSearch]);

  const totalPages = Math.max(1, Math.ceil(filteredCerts.length / PAGE_SIZE));
  const pagedCerts = filteredCerts.slice((credPage - 1) * PAGE_SIZE, credPage * PAGE_SIZE);

  const revoke = async (cert: OpenCert) => {
    const next = !cert.revoked;
    await fetch(`/api/open-certificates/${cert.id}`, { method: 'PATCH', headers: headers() as any, body: JSON.stringify({ revoked: next }) });
    setAllCerts(prev => prev.map(c => c.id === cert.id ? { ...c, revoked: next } : c));
  };

  const copyLink = async (certId: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/credential/${certId}`);
    setCopiedId(certId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const deleteProgram = async (id: string) => {
    setDeleteBusy(true);
    try {
      await fetch('/api/programs', { method: 'DELETE', headers: headers() as any, body: JSON.stringify({ id }) });
      setPrograms(prev => prev.filter(p => p.id !== id));
      setAllCerts(prev => prev.filter(c => c.program_id !== id));
      setDeletingProgram(null);
    } finally { setDeleteBusy(false); }
  };

  const openIssueForProgram = (p: Program | null) => {
    setIssuingForProgram(p);
    setPanel('issue');
    setMenu(null);
  };

  const viewCertsByProgram = (programId: string) => {
    setCredProgramFilter(programId);
    setCredPage(1);
    setActiveTab('credentials');
  };

  if (!authChecked) return (
    <div className="min-h-screen grid place-items-center" style={{ background: C.page }}>
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: C.faint }} />
    </div>
  );

  if (!token) return (
    <div className="min-h-screen grid place-items-center" style={{ background: C.page }}>
      <p style={{ color: C.muted }}>You must be signed in to access this page.</p>
    </div>
  );

  const thisYear = String(new Date().getFullYear());
  const issuedThisYear = allCerts.filter(c => c.issued_date?.startsWith(thisYear)).length;
  const revokedCount = allCerts.filter(c => c.revoked).length;
  const withCredentials = programs.filter(p => certCounts[p.id]).length;
  const kpis = [
    { label: 'Programmes', n: loading ? '--' : programs.length, sub: programs.length ? `${withCredentials} with credentials issued` : 'None yet', color: C.text },
    { label: 'Credentials issued', n: certsLoading ? '--' : allCerts.length, sub: `${issuedThisYear} this year`, color: C.text },
    { label: 'Revoked', n: certsLoading ? '--' : revokedCount, sub: revokedCount ? 'Their links show as revoked' : 'None revoked', color: revokedCount ? P.bad : C.text },
  ];

  const kebab = (key: string, label: string, open: (position: MenuPosition) => void) => {
    const on = menu && (menu.program?.id ?? menu.cert?.id) === key;
    return (
      <button type="button" aria-label={label}
        onClick={e => { e.stopPropagation(); if (on) setMenu(null); else open(menuPosition(e.currentTarget, 280)); }}
        className="w-8 h-8 rounded-[10px] inline-grid place-items-center flex-shrink-0"
        style={on ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}>
        <MoreHorizontal className="w-4 h-4" />
      </button>
    );
  };

  const programThumb = (p: Program) => p.badge_image_url
    ? <img src={p.badge_image_url} alt="" className="w-9 h-9 object-contain rounded-lg flex-shrink-0" />
    : <IconChip color={C.muted} background={C.pill}><Award className="w-4 h-4" /></IconChip>;

  const programLines = (p: Program) => (
    <div className="min-w-0">
      <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{p.name}</p>
      {p.skills?.length > 0 && <p className="text-xs truncate" style={{ color: C.muted }}>Skills: {p.skills.join(', ')}</p>}
      {p.description && <p className="text-xs line-clamp-1" style={{ color: C.muted }}>{stripHtml(p.description)}</p>}
    </div>
  );

  const countLink = (p: Program) => (
    <button type="button" onClick={() => viewCertsByProgram(p.id)} className="inline-flex items-center gap-1.5 text-sm font-semibold hover:underline" style={{ color: C.text }}>
      <BadgeCheck className="w-4 h-4" style={{ color: C.muted }} />{certCounts[p.id] ?? 0}
    </button>
  );

  const issueBtn = (p: Program) => (
    <button type="button" onClick={() => openIssueForProgram(p)} className={btnSmClass} style={btnStyle('sec', C)}>Issue</button>
  );

  const statusPill = (cert: OpenCert) => cert.revoked
    ? <Pill tone="bad" C={C}>Revoked</Pill>
    : <Pill tone="good" dot C={C}>Active</Pill>;

  const openBtn = (cert: OpenCert) => (
    <a href={`/credential/${cert.id}`} target="_blank" rel="noopener noreferrer" className={btnSmClass} style={btnStyle('sec', C)}>Open</a>
  );

  const toggleCert = (id: string) => setSelectedCertIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allPagedSelected = pagedCerts.length > 0 && pagedCerts.every(c => selectedCertIds.has(c.id));

  const programItems = (p: Program): (MenuItem | null)[] => [
    { label: 'Edit', sub: 'Name, description, skills and badge', icon: Pencil, onClick: () => { setEditingProgram(p); setPanel('edit_program'); setMenu(null); } },
    { label: 'View credentials', sub: 'Everyone issued one for this programme', icon: BadgeCheck, onClick: () => { viewCertsByProgram(p.id); setMenu(null); } },
    { label: 'Export CSV', sub: 'Names, emails, dates and links', icon: Download, onClick: () => { downloadCertsCsv(allCerts.filter(c => c.program_id === p.id), p.name); setMenu(null); } },
    null,
    { label: 'Delete', sub: 'Asks first; issued credentials stay', icon: Trash2, danger: true, onClick: () => { setDeletingProgram(p); setMenu(null); } },
  ];

  const certItems = (cert: OpenCert): (MenuItem | null)[] => [
    { label: 'Edit credential', sub: 'Recipient name, email and issue date', icon: Pencil, onClick: () => { setEditingCert(cert); setMenu(null); } },
    { label: copiedId === cert.id ? 'Copied' : 'Copy link', sub: 'The public credential page', icon: Copy, onClick: () => { copyLink(cert.id); setMenu(null); } },
    { label: 'View', sub: 'Opens in a new tab', icon: ExternalLink, onClick: () => { window.open(`/credential/${cert.id}`, '_blank'); setMenu(null); } },
    null,
    cert.revoked
      ? { label: 'Restore', sub: 'The link shows as valid again', icon: Check, onClick: () => { revoke(cert); setMenu(null); } }
      : { label: 'Revoke', sub: 'The link shows as revoked', icon: X, danger: true, onClick: () => { revoke(cert); setMenu(null); } },
  ];

  const pageBtn = (label: ReactNode, onClick: () => void, disabled: boolean, aria: string, on = false) => (
    <button type="button" aria-label={aria} onClick={onClick} disabled={disabled} className={`${btnSmClass} min-w-8`}
      style={on ? { background: P.sel, color: P.onSel } : btnStyle('sec', C)}>
      {label}
    </button>
  );

  return (
    <div className="min-h-screen" style={{ background: C.page, color: C.text }}>
      <div className="max-w-[1140px] mx-auto px-4 sm:px-6 py-8 space-y-5">
        <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm font-semibold no-underline" style={{ color: C.muted }}>
          <ArrowLeft className="w-4 h-4" />
          Dashboard
        </Link>
        <PageHeader
          title="Open credentials"
          sub="Programmes you issue certificates and badges for, to anyone, with or without an account."
          actions={
            <button type="button" onClick={() => { setEditingProgram(null); setPanel('new_program'); }} className={btnClass} style={btnStyle('pri', C)}>
              <Plus className="w-4 h-4" /> New programme
            </button>
          }
          C={C}
        />

        <Kpis items={kpis} C={C} />

        <div role="tablist" aria-label="Open credentials sections" className="inline-flex max-w-full gap-1 p-1 rounded-[14px] overflow-x-auto" style={{ background: C.card }}>
          {([['programs', 'Programmes'], ['credentials', 'Credentials']] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)}
              className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
              style={activeTab === id ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'programs' && (
          loading ? (
            <div className="h-64 rounded-2xl animate-pulse" style={{ background: C.card }} />
          ) : (
            <Card C={C} className="overflow-hidden">
              {programs.length === 0 ? (
                <div className="pb-10 grid justify-items-center">
                  <Empty C={C} title="No programmes yet" sub="Create a programme to start issuing credentials to participants." />
                  <button type="button" onClick={() => { setEditingProgram(null); setPanel('new_program'); }} className={btnClass} style={btnStyle('pri', C)}>
                    <Plus className="w-4 h-4" /> Create programme
                  </button>
                </div>
              ) : (
                <>
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead><tr>{['Programme', 'Issues', 'Credentials', 'Created', ''].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr></thead>
                      <tbody>
                        {programs.map(p => (
                          <tr key={p.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                            <td className="px-4 py-3 max-w-[420px]"><div className="flex items-center gap-3">{programThumb(p)}{programLines(p)}</div></td>
                            <td className="px-4 py-3 whitespace-nowrap" style={{ color: C.text }}>{ISSUE_MODES.find(m => m.value === p.issue_mode)?.label}</td>
                            <td className="px-4 py-3">{countLink(p)}</td>
                            <td className="px-4 py-3 whitespace-nowrap" style={{ color: C.muted }}>{fmtDate(p.created_at)}</td>
                            <td className="pl-2 pr-5 py-3 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-2">{issueBtn(p)}{kebab(p.id, `Actions for ${p.name}`, position => setMenu({ program: p, position }))}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="md:hidden">
                    {programs.map((p, i) => (
                      <div key={p.id} className="grid gap-3 px-4 py-4" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                        <div className="flex items-start gap-3">
                          {programThumb(p)}
                          <div className="flex-1 min-w-0">{programLines(p)}</div>
                          {kebab(p.id, `Actions for ${p.name}`, position => setMenu({ program: p, position }))}
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: C.muted }}>
                          <span>{ISSUE_MODES.find(m => m.value === p.issue_mode)?.label}</span>
                          <span>Created {fmtDate(p.created_at)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-3">{countLink(p)}{issueBtn(p)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          )
        )}

        {activeTab === 'credentials' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <SearchBox value={credSearch} onChange={v => { setCredSearch(v); setCredPage(1); }} placeholder="Search by name, email or ID" C={C} />
              <div className="w-full sm:w-[220px]">
                <MenuSelect searchable fixed label="Filter by programme" value={credProgramFilter} onChange={v => { setCredProgramFilter(v); setCredPage(1); }}
                  options={[{ value: 'all', label: 'All programmes' }, ...programs.map(p => ({ value: p.id, label: p.name }))]} C={C} />
              </div>
              <div className="w-full sm:w-[160px]">
                <MenuSelect fixed label="Filter by status" value={credStatusFilter} onChange={v => { setCredStatusFilter(v); setCredPage(1); }}
                  options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'revoked', label: 'Revoked' }]} C={C} />
              </div>
              <button type="button" className={`${btnClass} hidden sm:inline-flex`} style={btnStyle('sec', C)}
                onClick={() => downloadCertsCsv(filteredCerts, credProgramFilter !== 'all' ? (programs.find(p => p.id === credProgramFilter)?.name ?? 'all') : 'all-credentials')}>
                <Download className="w-4 h-4" /> Export CSV
              </button>
              <button type="button" onClick={() => openIssueForProgram(null)} className={btnClass} style={btnStyle('pri', C)}>
                <Plus className="w-4 h-4" /> Issue credentials
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm" style={{ color: C.muted }}>
                {certsLoading ? 'Loading...' : filteredCerts.length === 0 ? 'No credentials' : `Showing ${(credPage - 1) * PAGE_SIZE + 1} to ${Math.min(credPage * PAGE_SIZE, filteredCerts.length)} of ${plural(filteredCerts.length, 'credential')}`}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: C.muted }}>Page {credPage} of {totalPages}</span>
                  {pageBtn(<ChevronLeft className="w-4 h-4" />, () => setCredPage(p => Math.max(1, p - 1)), credPage === 1, 'Previous page')}
                  {pageBtn(<ChevronRight className="w-4 h-4" />, () => setCredPage(p => Math.min(totalPages, p + 1)), credPage === totalPages, 'Next page')}
                </div>
              )}
            </div>

            {selectedCertIds.size > 0 && (
              <Card C={C} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="text-sm font-semibold" style={{ color: C.text }}>{selectedCertIds.size} selected</span>
                <button type="button" onClick={() => downloadCertsCsv(allCerts.filter(c => selectedCertIds.has(c.id)), 'selected')} className={btnSmClass} style={btnStyle('sec', C)}>
                  <Download className="w-3.5 h-3.5" /> Export selected
                </button>
                <button type="button" onClick={() => setSelectedCertIds(new Set())} className="ml-auto text-xs font-semibold" style={{ color: C.muted }}>Deselect all</button>
              </Card>
            )}

            {certsLoading ? (
              <div className="h-64 rounded-2xl animate-pulse" style={{ background: C.card }} />
            ) : (
              <Card C={C} className="overflow-hidden">
                {filteredCerts.length === 0 ? (
                  <Empty C={C}
                    title={allCerts.length === 0 ? 'No credentials issued yet' : 'No credentials match your filters'}
                    sub={allCerts.length === 0 ? 'Choose Issue credentials to get started.' : undefined} />
                ) : (
                  <>
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full min-w-[820px] text-sm">
                        <thead>
                          <tr>
                            <th className="w-12 pl-5 pr-2 py-3 text-left">
                              <button type="button" role="checkbox" aria-checked={allPagedSelected} aria-label="Select all on this page" className="grid"
                                onClick={() => {
                                  if (!allPagedSelected) setSelectedCertIds(prev => new Set([...prev, ...pagedCerts.map(c => c.id)]));
                                  else setSelectedCertIds(prev => { const next = new Set(prev); pagedCerts.forEach(c => next.delete(c.id)); return next; });
                                }}>
                                <Tick on={allPagedSelected} C={C} />
                              </button>
                            </th>
                            {['Credential ID', 'Recipient', 'Programme', 'Issue date', 'Status', ''].map((h, i) => (
                              <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {pagedCerts.map(cert => (
                            <tr key={cert.id} style={{ borderTop: `1px solid ${C.divider}`, background: selectedCertIds.has(cert.id) ? C.page : undefined }}>
                              <td className="pl-5 pr-2 py-3">
                                <button type="button" role="checkbox" aria-checked={selectedCertIds.has(cert.id)} aria-label={`Select ${cert.recipient_name}`} className="grid" onClick={() => toggleCert(cert.id)}>
                                  <Tick on={selectedCertIds.has(cert.id)} C={C} />
                                </button>
                              </td>
                              <td className="px-4 py-3 font-mono text-[13px] font-semibold" style={{ color: C.text }}>{cert.id.replace(/-/g, '').slice(0, 8).toUpperCase()}</td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <Avatar name={cert.recipient_name} color={C.muted} background={C.pill} />
                                  <div className="min-w-0">
                                    <p className="font-semibold" style={{ color: C.text }}>{cert.recipient_name}</p>
                                    {cert.recipient_email && <p className="text-xs" style={{ color: C.muted }}>{cert.recipient_email}</p>}
                                  </div>
                                </div>
                              </td>
                              <td className="px-4 py-3" style={{ color: C.text }}>{cert.program_name}</td>
                              <td className="px-4 py-3 whitespace-nowrap" style={{ color: C.muted }}>{fmtDate(cert.issued_date)}</td>
                              <td className="px-4 py-3">{statusPill(cert)}</td>
                              <td className="pl-2 pr-5 py-3 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-2">{openBtn(cert)}{kebab(cert.id, `Actions for ${cert.recipient_name}`, position => setMenu({ cert, position }))}</div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="md:hidden">
                      {pagedCerts.map((cert, i) => (
                        <div key={cert.id} className="grid gap-3 px-4 py-4" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                          <div className="flex items-start gap-3">
                            <Avatar name={cert.recipient_name} color={C.muted} background={C.pill} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{cert.recipient_name}</p>
                              {cert.recipient_email && <p className="text-xs truncate" style={{ color: C.muted }}>{cert.recipient_email}</p>}
                            </div>
                            {statusPill(cert)}
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs" style={{ color: C.muted }}>
                            <span>{cert.program_name}</span>
                            <span>{fmtDate(cert.issued_date)}</span>
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            {openBtn(cert)}
                            {kebab(cert.id, `Actions for ${cert.recipient_name}`, position => setMenu({ cert, position }))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </Card>
            )}

            {totalPages > 1 && (
              <div className="flex flex-wrap justify-center gap-2">
                {pageBtn('First', () => setCredPage(1), credPage === 1, 'First page')}
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const pg = Math.max(1, Math.min(totalPages - 4, credPage - 2)) + i;
                  return <span key={pg}>{pageBtn(pg, () => setCredPage(pg), false, `Page ${pg}`, credPage === pg)}</span>;
                })}
                {pageBtn('Last', () => setCredPage(totalPages), credPage === totalPages, 'Last page')}
              </div>
            )}
          </>
        )}
      </div>

      {menu && (
        <FloatingMenu
          position={menu.position}
          label={menu.program ? 'programme actions' : 'credential actions'}
          onClose={() => setMenu(null)}
          C={C}
          items={menu.program ? programItems(menu.program) : certItems(menu.cert!)}
        />
      )}

      {deletingProgram && (
        <ConfirmModal
          title="Delete programme?"
          eyebrow={deletingProgram.name}
          body="Issued credentials remain but will lose their programme link."
          action="Delete programme"
          danger
          busy={deleteBusy}
          onClose={() => setDeletingProgram(null)}
          onConfirm={() => deleteProgram(deletingProgram.id)}
          C={C}
        />
      )}

      {(panel === 'new_program' || panel === 'edit_program') && (
        <Modal title={panel === 'edit_program' ? 'Edit programme' : 'New programme'} onClose={() => setPanel('none')} C={C} wide>
          <ProgramForm
            initial={editingProgram ?? undefined}
            C={C}
            onCancel={() => setPanel('none')}
            onSave={saved => {
              if (panel === 'edit_program') {
                setPrograms(prev => prev.map(p => p.id === saved.id ? saved : p));
              } else {
                setPrograms(prev => [saved, ...prev]);
              }
              setPanel('none');
            }}
          />
        </Modal>
      )}

      {editingCert && (
        <Modal title="Edit credential" onClose={() => setEditingCert(null)} C={C}>
          <EditCertForm
            cert={editingCert}
            C={C}
            hdrs={headers()}
            onCancel={() => setEditingCert(null)}
            onSave={updated => {
              setAllCerts(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c));
              setEditingCert(null);
            }}
          />
        </Modal>
      )}

      {panel === 'issue' && (
        <Modal title="Issue credentials" onClose={() => setPanel('none')} C={C} wide>
          <IssuePanel
            programs={programs}
            initialProgram={issuingForProgram}
            C={C}
            onCancel={() => setPanel('none')}
            onDone={async () => {
              setPanel('none');
              await loadAllCerts().catch(() => {});
            }}
          />
        </Modal>
      )}
    </div>
  );
}
