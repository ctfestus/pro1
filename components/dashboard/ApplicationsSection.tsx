'use client';

import { useContext, useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, Briefcase, Check, ChevronDown, Copy, Edit2, FileText, GraduationCap, Link2, Loader2, MoreHorizontal, Pause, Play, Plus, QrCode, Search, Trash2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSessionToken } from '@/lib/use-session-token';
import { IsStaffContext } from '@/components/dashboard/context';
import { ApplicationFormBuilder } from '@/components/dashboard/ApplicationFormBuilder';
import { ApplicationReviewPanel } from '@/components/dashboard/ApplicationReviewPanel';
import { ApplicationInsights } from '@/components/dashboard/ApplicationInsights';
import { ApplicationFormQrDialog } from '@/components/dashboard/ApplicationFormQrDialog';
import { useTenant } from '@/components/TenantProvider';
import { normalizeAbsoluteBaseUrl } from '@/lib/public-url';
import { APPLICATION_STARTER_TEMPLATES, formAvailability, type ApplicationFormRecord, type ApplicationTemplateKey } from '@/lib/application-forms';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { Kpis, PageHeader } from '@/components/dashboard/content/kit';
import { FloatingMenu, menuPosition, type MenuItem, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Card, Pill, btnClass, btnSmClass, btnStyle, dateLabel, palette, type Tone } from '@/components/dashboard/subscriptions/ui';

type StatusFilter = 'all' | ApplicationFormRecord['status'];
const CHIPS: [StatusFilter, string][] = [['all', 'All'], ['published', 'Open'], ['draft', 'Draft'], ['paused', 'Paused'], ['closed', 'Closed']];
const STATUS: Record<ApplicationFormRecord['status'], [string, Tone]> = { published: ['Open', 'good'], draft: ['Draft', 'warn'], paused: ['Paused', 'warn'], closed: ['Closed', 'mute'] };
const TEMPLATES: [ApplicationTemplateKey, string, typeof Award][] = [['bootcamp', 'Bootcamp', GraduationCap], ['scholarship', 'Scholarship', Award], ['internship', 'Internship', Briefcase]];

export function ApplicationsSection({ C: theme }: { C: ThemeColors }) {
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const isStaff = useContext(IsStaffContext);
  // The permanent public address, so links and printed QR codes made while viewing a preview
  // deployment still point at the live site. The address being viewed is the fallback.
  const publicBaseUrl = normalizeAbsoluteBaseUrl(useTenant().appUrl);
  const publicFormUrl = (form: ApplicationFormRecord) => `${publicBaseUrl || window.location.origin}/apply/${form.slug}`;
  const [forms, setForms] = useState<ApplicationFormRecord[]>([]);
  const [submissionCounts, setSubmissionCounts] = useState<Record<string, number> | null>(null);
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [relatedItems, setRelatedItems] = useState<any[]>([]);
  const [cohorts, setCohorts] = useState<any[]>([]);
  // Kept current, so a dashboard left open does not send an expired token (also to the panels below).
  const [loadedToken, setToken] = useState('');
  const token = useSessionToken(loadedToken);
  const [mode, setMode] = useState<{ type: 'edit' | 'review' | 'insights'; form: ApplicationFormRecord } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [copiedFormId, setCopiedFormId] = useState('');
  const [deletingFormId, setDeletingFormId] = useState('');
  const [qrForm, setQrForm] = useState<ApplicationFormRecord | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [newMenu, setNewMenu] = useState<MenuPosition | null>(null);
  const [rowMenu, setRowMenu] = useState<{ form: ApplicationFormRecord; position: MenuPosition } | null>(null);

  async function load() {
    setLoading(true); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Your session has expired.');
      setToken(session.access_token);
      const [formsResponse, reviewersResponse] = await Promise.all([
        fetch('/api/application-forms', { headers: { Authorization: `Bearer ${session.access_token}` } }),
        isStaff ? Promise.resolve(null) : fetch('/api/application-reviewers', { headers: { Authorization: `Bearer ${session.access_token}` } }),
      ]);
      const formsValue = await formsResponse.json();
      if (!formsResponse.ok) throw new Error(formsValue.error || 'Could not load application forms.');
      setForms(formsValue.forms ?? []);
      setSubmissionCounts(formsValue.submissionCounts ?? null);
      if (reviewersResponse) {
        const reviewerValue = await reviewersResponse.json();
        if (reviewersResponse.ok) { setReviewers(reviewerValue.reviewers ?? []); setRelatedItems(reviewerValue.relatedItems ?? []); setCohorts(reviewerValue.cohorts ?? []); }
      }
    } catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  async function create(template: ApplicationTemplateKey) {
    setBusy(template); setError('');
    try {
      const response = await fetch('/api/application-forms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ template }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Could not create form.');
      setForms(previous => [value.form, ...previous]); setMode({ type: 'edit', form: value.form });
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  }

  async function duplicate(form: ApplicationFormRecord) {
    setBusy(form.id); setError('');
    try {
      const response = await fetch('/api/application-forms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ sourceId: form.id }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Could not duplicate form.');
      setForms(previous => [value.form, ...previous]);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  }

  async function status(form: ApplicationFormRecord, nextStatus: ApplicationFormRecord['status']) {
    setBusy(form.id); setError('');
    try {
      const response = await fetch(`/api/application-forms/${form.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ status: nextStatus }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Could not update form status.');
      setForms(previous => previous.map(item => item.id === form.id ? value.form : item));
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(''); }
  }

  async function copyLink(form: ApplicationFormRecord) {
    setError('');
    const url = publicFormUrl(form);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedFormId(form.id);
      window.setTimeout(() => setCopiedFormId(current => current === form.id ? '' : current), 2000);
    } catch {
      setError('Could not copy the registration link. Please copy it from the form editor.');
    }
  }

  async function remove(form: ApplicationFormRecord) {
    setDeletingFormId(form.id); setError('');
    try {
      const impactResponse = await fetch(`/api/application-forms/${form.id}?deleteImpact=1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const impact = await impactResponse.json();
      if (!impactResponse.ok) throw new Error(impact.error || 'Could not check what this form contains.');
      const submissionCount = Number(impact.deletionImpact?.submissionCount ?? 0);
      const fileCount = Number(impact.deletionImpact?.fileCount ?? 0);
      const confirmed = window.confirm(`Permanently delete "${form.config.title}"?\n\nThis form currently contains ${submissionCount} submitted application${submissionCount === 1 ? '' : 's'} and ${fileCount} uploaded file${fileCount === 1 ? '' : 's'}. All will be permanently deleted. This cannot be undone.\n\nChoose Cancel to close the form instead, or export the applications as CSV before deleting.`);
      if (!confirmed) return;
      const response = await fetch(`/api/application-forms/${form.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not delete application form.');
      setForms(previous => previous.filter(item => item.id !== form.id));
      if (value.uploadsRemoved === false) setError('The form and applications were deleted, but some private uploaded files could not be removed. Contact an administrator to complete the cleanup.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setDeletingFormId(''); }
  }

  function replace(updated: ApplicationFormRecord) {
    setForms(previous => previous.map(item => item.id === updated.id ? updated : item));
    setMode(current => current?.form.id === updated.id ? { ...current, form: updated } : current);
  }

  if (mode?.type === 'edit') return <ApplicationFormBuilder initial={mode.form} token={token} relatedItems={relatedItems} cohorts={cohorts} submissionCount={submissionCounts ? submissionCounts[mode.form.id] ?? 0 : null} C={C} onBack={() => setMode(null)} onSaved={replace} />;
  if (mode?.type === 'review') return <ApplicationReviewPanel form={mode.form} token={token} reviewers={reviewers} C={C} onBack={() => setMode(null)} />;
  if (mode?.type === 'insights') return <ApplicationInsights form={mode.form} token={token} C={C} onBack={() => setMode(null)} />;
  if (loading) return <div className="py-20"><Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: C.muted }} /></div>;

  const term = search.trim().toLowerCase();
  const visible = forms.filter(form => (statusFilter === 'all' || form.status === statusFilter)
    && (!term || form.config.title.toLowerCase().includes(term) || form.slug.toLowerCase().includes(term)));
  const drafts = forms.filter(form => form.status === 'draft').length;
  const openNow = forms.filter(form => formAvailability(form) === 'open').length;
  const total = submissionCounts ? Object.values(submissionCounts).reduce((sum, n) => sum + n, 0) : null;
  // `busy` holds a template key while a new form is being created, or a form id while it is changed.
  const creating = Boolean(busy) && !forms.some(form => form.id === busy);

  // Review is the button on the row; every other action is in the row menu.
  const actions = (form: ApplicationFormRecord): (MenuItem | null)[] => {
    const run = (action: () => void) => () => { setRowMenu(null); action(); };
    return [
      { label: 'Insights', sub: 'Daily applications and applicants per stage', icon: BarChart3, onClick: run(() => setMode({ type: 'insights', form })) },
      ...(form.status === 'published' ? [
        { label: 'Copy public link', sub: 'The address applicants open', icon: Link2, onClick: run(() => void copyLink(form)) },
        { label: 'QR code', sub: 'To print or share the form', icon: QrCode, onClick: run(() => setQrForm(form)) },
      ] : []),
      ...(!isStaff ? [
        null,
        { label: 'Edit form', sub: 'Questions, stages, dates and look', icon: Edit2, onClick: run(() => setMode({ type: 'edit', form })) },
        { label: 'Duplicate', sub: 'A copy of this form', icon: Copy, onClick: run(() => void duplicate(form)) },
        ...(form.status === 'published'
          ? [{ label: 'Pause', sub: 'Stop taking applications for now', icon: Pause, onClick: run(() => void status(form, 'paused')) }]
          : form.status === 'paused' || form.status === 'draft'
            ? [{ label: 'Publish', sub: 'Take applications at the public link', icon: Play, onClick: run(() => void status(form, 'published')) }]
            : []),
        ...(form.status !== 'closed' ? [{ label: 'Close form', sub: 'No more applications', icon: XCircle, onClick: run(() => void status(form, 'closed')) }] : []),
        null,
        { label: 'Delete', sub: 'The form, its applications and uploads', icon: Trash2, danger: true, onClick: run(() => void remove(form)) },
      ] : []),
    ];
  };

  return (
    <div className="grid gap-4">
      <PageHeader C={C} title="Applications" sub="Forms people fill in to apply for a bootcamp, scholarship or internship. No account needed."
        actions={!isStaff && (
          <button type="button" disabled={creating} aria-haspopup="menu" aria-expanded={Boolean(newMenu)}
            onClick={e => setNewMenu(newMenu ? null : menuPosition(e.currentTarget, 200))} className={btnClass} style={btnStyle('pri', C)}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            New form
            <ChevronDown className="w-4 h-4" />
          </button>
        )} />

      {error && (
        <div role="alert" className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          <XCircle className="w-4 h-4 flex-shrink-0" />
          <span className="flex-1">{error}</span>
        </div>
      )}
      {qrForm && <ApplicationFormQrDialog title={qrForm.config.title} slug={qrForm.slug} url={publicFormUrl(qrForm)} usingCurrentAddress={!publicBaseUrl} C={C} onClose={() => setQrForm(null)} returnFocus={() => document.querySelector<HTMLElement>(`[data-application-form-card="${qrForm.id}"] button[aria-label="More options"]`)} />}

      <Kpis C={C} items={[
        { label: 'Forms', n: forms.length, sub: drafts ? `${drafts} still in draft` : 'No drafts', color: C.text },
        { label: 'Open now', n: openNow, sub: 'Taking applications today', color: openNow ? P.good : C.text },
        { label: 'Applications', n: total ?? '--', sub: total === null ? 'Counts could not be loaded' : 'Across all forms', color: C.text },
      ]} />

      <div className="flex flex-wrap items-center gap-2">
        <label className="field-shell flex items-center gap-2 h-10 px-3 rounded-xl flex-1 min-w-[220px]" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: C.faint }}>
          <Search className="w-4 h-4 flex-shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search forms" className="bg-transparent outline-none text-sm w-full" style={{ color: C.text }} />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
          {CHIPS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={statusFilter === id} onClick={() => setStatusFilter(id)} className="h-8 px-3 rounded-full text-xs font-semibold"
              style={statusFilter === id ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <Card C={C} className="overflow-hidden">
        {forms.length === 0 ? (
          <div className="py-16 text-center">
            <FileText className="w-8 h-8 mx-auto mb-3" style={{ color: C.faint }} />
            <p className="text-sm font-semibold" style={{ color: C.text }}>{isStaff ? 'No applications are assigned to you.' : 'No application forms yet.'}</p>
            {!isStaff && <p className="text-xs mt-1" style={{ color: C.muted }}>Start with an editable template from New form.</p>}
          </div>
        ) : visible.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>No forms match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>{['Form', 'Status', 'Applications', ''].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {visible.map(form => {
                  const working = busy === form.id || deletingFormId === form.id;
                  const [label, tone] = STATUS[form.status];
                  const menuOpen = rowMenu?.form.id === form.id;
                  return (
                    <tr key={form.id} data-application-form-card={form.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                      <td className="px-4 py-3">
                        <p className="font-semibold truncate max-w-[420px]" style={{ color: C.text }}>{form.config.title}</p>
                        <p className="text-xs truncate max-w-[420px]" style={{ color: C.muted }}>/apply/{form.slug}{form.config.closesAt ? `, closes ${dateLabel(form.config.closesAt)}` : ''}</p>
                      </td>
                      <td className="px-4 py-3"><Pill tone={tone} dot={tone === 'good'} C={C}>{label}</Pill></td>
                      <td className="px-4 py-3 tabular-nums" style={{ color: submissionCounts ? C.text : C.muted }}>{submissionCounts ? submissionCounts[form.id] ?? 0 : '--'}</td>
                      <td className="pl-2 pr-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {copiedFormId === form.id && <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: P.good }}><Check className="w-3.5 h-3.5" /> Link copied</span>}
                          <button type="button" onClick={() => setMode({ type: 'review', form })} className={btnSmClass} style={btnStyle('sec', C)}>Review</button>
                          {working
                            ? <span className="w-8 h-8 rounded-[10px] grid place-items-center" style={{ color: C.muted }} aria-label={deletingFormId === form.id ? 'Deleting' : 'Working'}><Loader2 className="w-4 h-4 animate-spin" /></span>
                            : (
                              <button type="button" aria-label="More options" title="More options"
                                onClick={e => setRowMenu(menuOpen ? null : { form, position: menuPosition(e.currentTarget, isStaff ? 160 : 480) })}
                                className="w-8 h-8 rounded-[10px] grid place-items-center"
                                style={menuOpen ? { background: C.text, color: C.card } : { color: C.muted }}>
                                <MoreHorizontal className="w-4 h-4" />
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {newMenu && (
        <FloatingMenu position={newMenu} label="new form templates" onClose={() => setNewMenu(null)} C={C}
          items={TEMPLATES.map(([key, label, icon]) => ({
            label, sub: APPLICATION_STARTER_TEMPLATES[key].description, icon,
            onClick: () => { setNewMenu(null); void create(key); },
          }))} />
      )}
      {rowMenu && <FloatingMenu position={rowMenu.position} label={`${rowMenu.form.config.title} actions`} items={actions(rowMenu.form)} onClose={() => setRowMenu(null)} C={C} />}
    </div>
  );
}
