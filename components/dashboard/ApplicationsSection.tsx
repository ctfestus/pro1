'use client';

import { useContext, useEffect, useState } from 'react';
import { BarChart3, Check, Copy, Edit2, FileText, Link2, Loader2, Pause, Play, Plus, QrCode, Search, Trash2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { IsStaffContext } from '@/components/dashboard/context';
import { ApplicationFormBuilder } from '@/components/dashboard/ApplicationFormBuilder';
import { ApplicationReviewPanel } from '@/components/dashboard/ApplicationReviewPanel';
import { ApplicationInsights } from '@/components/dashboard/ApplicationInsights';
import { ApplicationFormQrDialog } from '@/components/dashboard/ApplicationFormQrDialog';
import { CardActionsMenu, type CardAction } from '@/components/dashboard/content-cards';
import type { ApplicationFormRecord, ApplicationTemplateKey } from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

export function ApplicationsSection({ C }: { C: ThemeColors }) {
  const isStaff = useContext(IsStaffContext);
  const [forms, setForms] = useState<ApplicationFormRecord[]>([]);
  const [submissionCounts, setSubmissionCounts] = useState<Record<string, number> | null>(null);
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [relatedItems, setRelatedItems] = useState<any[]>([]);
  const [cohorts, setCohorts] = useState<any[]>([]);
  const [token, setToken] = useState('');
  const [mode, setMode] = useState<{ type: 'edit' | 'review' | 'insights'; form: ApplicationFormRecord } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [copiedFormId, setCopiedFormId] = useState('');
  const [deletingFormId, setDeletingFormId] = useState('');
  const [qrForm, setQrForm] = useState<ApplicationFormRecord | null>(null);
  const [error, setError] = useState('');

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
    const url = `${window.location.origin}/apply/${form.slug}`;
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
  if (loading) return <div className="py-20"><Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: C.cta }} /></div>;

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl p-3 text-sm" style={{ background: C.errorBg, color: C.errorText }}>{error}</div>}
      {qrForm && <ApplicationFormQrDialog title={qrForm.config.title} slug={qrForm.slug} url={`${window.location.origin}/apply/${qrForm.slug}`} C={C} onClose={() => setQrForm(null)} />}
      {!isStaff && <div className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold" style={{ color: C.text }}>Create an application form</h2><p className="text-xs mt-1" style={{ color: C.faint }}>Start with an editable template. No applicant account is required.</p></div><div className="flex flex-wrap gap-2">{(['bootcamp', 'scholarship', 'internship'] as ApplicationTemplateKey[]).map(template => <button key={template} disabled={Boolean(busy)} onClick={() => void create(template)} className="px-3 py-2 rounded-xl text-xs font-semibold capitalize flex items-center gap-1.5 disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{busy === template ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{template}</button>)}</div></div></div>}

      {forms.length === 0 ? <div className="rounded-2xl py-20 text-center" style={{ background: C.card }}><FileText className="w-10 h-10 mx-auto mb-3" style={{ color: C.faint }} /><p className="font-semibold" style={{ color: C.text }}>{isStaff ? 'No applications are assigned to you.' : 'No application forms yet.'}</p></div> : (
        <div className="space-y-3">
          {forms.map(form => {
            const count = submissionCounts?.[form.id] ?? 0;
            const working = busy === form.id || deletingFormId === form.id;
            // Every card action lives in the three-dot menu, Review first.
            const actions: CardAction[] = [
              { key: 'review', label: 'Review applications', Icon: Search, onClick: () => setMode({ type: 'review', form }) },
              { key: 'insights', label: 'Insights', Icon: BarChart3, onClick: () => setMode({ type: 'insights', form }) },
              ...(form.status === 'published' ? [
                { key: 'copy', label: 'Copy public link', Icon: Link2, onClick: () => void copyLink(form) },
                { key: 'qr', label: 'QR code', Icon: QrCode, onClick: () => setQrForm(form) },
              ] : []),
              ...(!isStaff ? [
                { key: 'edit', label: 'Edit form', Icon: Edit2, onClick: () => setMode({ type: 'edit', form }) },
                { key: 'duplicate', label: 'Duplicate', Icon: Copy, onClick: () => void duplicate(form) },
                ...(form.status === 'published'
                  ? [{ key: 'pause', label: 'Pause', Icon: Pause, onClick: () => void status(form, 'paused') }]
                  : form.status === 'paused' || form.status === 'draft'
                    ? [{ key: 'publish', label: 'Publish', Icon: Play, onClick: () => void status(form, 'published') }]
                    : []),
                ...(form.status !== 'closed' ? [{ key: 'close', label: 'Close form', Icon: XCircle, onClick: () => void status(form, 'closed') }] : []),
                { key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onClick: () => void remove(form) },
              ] : []),
            ];
            return (
              <div key={form.id} className="rounded-2xl p-4 sm:p-5 flex items-center gap-3 sm:gap-4" style={{ background: C.card }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold truncate" style={{ color: C.text }}>{form.config.title}</h3>
                    <span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded-full" style={{ background: form.status === 'published' ? C.successBg : C.pill, color: form.status === 'published' ? C.successText : C.muted }}>{form.status}</span>
                    {submissionCounts && <span className="text-[10px] font-semibold px-2 py-1 rounded-full tabular-nums" style={{ background: C.pill, color: C.muted }}>{count} application{count === 1 ? '' : 's'}</span>}
                  </div>
                  <p className="text-xs mt-1 truncate" style={{ color: C.faint }}>/apply/{form.slug}{form.config.closesAt ? ` - closes ${new Date(form.config.closesAt).toLocaleDateString()}` : ''}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {copiedFormId === form.id && <span className="hidden sm:flex items-center gap-1 text-[11px] font-semibold" style={{ color: C.successText }}><Check className="w-3.5 h-3.5" /> Link copied</span>}
                  {working
                    ? <span className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: C.pill, color: C.muted }} aria-label={deletingFormId === form.id ? 'Deleting' : 'Working'}><Loader2 className="w-4 h-4 animate-spin" /></span>
                    : <CardActionsMenu form={form} actions={actions} triggerClassName="grid h-9 w-9 place-items-center rounded-xl transition-colors" triggerStyle={{ background: C.pill, color: C.muted }} />}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
