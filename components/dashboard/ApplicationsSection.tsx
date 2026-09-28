'use client';

import { useContext, useEffect, useState } from 'react';
import { Check, Copy, Edit2, FileText, Link2, Loader2, Pause, Play, Plus, Search, Trash2, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { IsStaffContext } from '@/components/dashboard/context';
import { ApplicationFormBuilder } from '@/components/dashboard/ApplicationFormBuilder';
import { ApplicationReviewPanel } from '@/components/dashboard/ApplicationReviewPanel';
import type { ApplicationFormRecord, ApplicationTemplateKey } from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

export function ApplicationsSection({ C }: { C: ThemeColors }) {
  const isStaff = useContext(IsStaffContext);
  const [forms, setForms] = useState<ApplicationFormRecord[]>([]);
  const [reviewers, setReviewers] = useState<any[]>([]);
  const [relatedItems, setRelatedItems] = useState<any[]>([]);
  const [token, setToken] = useState('');
  const [mode, setMode] = useState<{ type: 'edit' | 'review'; form: ApplicationFormRecord } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [copiedFormId, setCopiedFormId] = useState('');
  const [deletingFormId, setDeletingFormId] = useState('');
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
      if (reviewersResponse) {
        const reviewerValue = await reviewersResponse.json();
        if (reviewersResponse.ok) { setReviewers(reviewerValue.reviewers ?? []); setRelatedItems(reviewerValue.relatedItems ?? []); }
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
    const confirmed = window.confirm(`Delete "${form.config.title}"? The form will be removed and its response spreadsheet will be moved to Google Drive trash.`);
    if (!confirmed) return;
    setDeletingFormId(form.id); setError('');
    try {
      const response = await fetch(`/api/application-forms/${form.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not delete application form.');
      setForms(previous => previous.filter(item => item.id !== form.id));
      if (value.spreadsheetTrashed === false) setError('The form was deleted, but its Google response sheet could not be moved to trash.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setDeletingFormId(''); }
  }

  function replace(updated: ApplicationFormRecord) {
    setForms(previous => previous.map(item => item.id === updated.id ? updated : item));
    setMode(current => current?.form.id === updated.id ? { ...current, form: updated } : current);
  }

  if (mode?.type === 'edit') return <ApplicationFormBuilder initial={mode.form} token={token} relatedItems={relatedItems} C={C} onBack={() => setMode(null)} onSaved={replace} />;
  if (mode?.type === 'review') return <ApplicationReviewPanel form={mode.form} token={token} reviewers={reviewers} C={C} onBack={() => setMode(null)} />;
  if (loading) return <div className="py-20"><Loader2 className="w-6 h-6 animate-spin mx-auto" style={{ color: C.cta }} /></div>;

  return (
    <div className="space-y-5">
      {error && <div className="rounded-xl p-3 text-sm" style={{ background: C.errorBg, color: C.errorText }}>{error}</div>}
      {!isStaff && <div className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold" style={{ color: C.text }}>Create an application form</h2><p className="text-xs mt-1" style={{ color: C.faint }}>Start with an editable template. No applicant account is required.</p></div><div className="flex flex-wrap gap-2">{(['bootcamp', 'scholarship', 'internship'] as ApplicationTemplateKey[]).map(template => <button key={template} disabled={Boolean(busy)} onClick={() => void create(template)} className="px-3 py-2 rounded-xl text-xs font-semibold capitalize flex items-center gap-1.5 disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{busy === template ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}{template}</button>)}</div></div></div>}

      {forms.length === 0 ? <div className="rounded-2xl py-20 text-center" style={{ background: C.card }}><FileText className="w-10 h-10 mx-auto mb-3" style={{ color: C.faint }} /><p className="font-semibold" style={{ color: C.text }}>{isStaff ? 'No applications are assigned to you.' : 'No application forms yet.'}</p></div> : <div className="space-y-3">{forms.map(form => <div key={form.id} className="rounded-2xl p-5 flex flex-col lg:flex-row lg:items-center gap-4" style={{ background: C.card }}><div className="flex-1 min-w-0"><div className="flex items-center gap-2 flex-wrap"><h3 className="font-bold truncate" style={{ color: C.text }}>{form.config.title}</h3><span className="text-[10px] uppercase tracking-wide px-2 py-1 rounded-full" style={{ background: form.status === 'published' ? C.successBg : C.pill, color: form.status === 'published' ? C.successText : C.muted }}>{form.status}</span></div><p className="text-xs mt-1" style={{ color: C.faint }}>/apply/{form.slug}{form.config.closesAt ? ` - closes ${new Date(form.config.closesAt).toLocaleDateString()}` : ''}</p></div><div className="flex flex-wrap gap-2">{form.status === 'published' && <button onClick={() => void copyLink(form)} className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5" title={copiedFormId === form.id ? 'Registration link copied' : 'Copy public link'} style={{ background: copiedFormId === form.id ? C.successBg : C.pill, color: copiedFormId === form.id ? C.successText : C.muted }}>{copiedFormId === form.id ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}{copiedFormId === form.id ? 'Copied' : 'Copy link'}</button>}<button onClick={() => setMode({ type: 'review', form })} className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5" style={{ background: C.pill, color: C.text }}><Search className="w-4 h-4" /> Review</button>{!isStaff && <><button onClick={() => setMode({ type: 'edit', form })} className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5" style={{ background: C.pill, color: C.text }}><Edit2 className="w-4 h-4" /> Edit</button><button onClick={() => void duplicate(form)} disabled={busy === form.id || deletingFormId === form.id} className="p-2.5 rounded-xl disabled:opacity-50" title="Duplicate" style={{ background: C.pill, color: C.muted }}>{busy === form.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Copy className="w-4 h-4" />}</button>{form.status === 'published' ? <button onClick={() => void status(form, 'paused')} disabled={deletingFormId === form.id} className="p-2.5 rounded-xl disabled:opacity-50" title="Pause" style={{ background: C.pill, color: C.muted }}><Pause className="w-4 h-4" /></button> : form.status === 'paused' || form.status === 'draft' ? <button onClick={() => void status(form, 'published')} disabled={deletingFormId === form.id} className="p-2.5 rounded-xl disabled:opacity-50" title="Publish" style={{ background: C.successBg, color: C.successText }}><Play className="w-4 h-4" /></button> : null}<button onClick={() => void status(form, 'closed')} disabled={deletingFormId === form.id} className="p-2.5 rounded-xl disabled:opacity-50" title="Close" style={{ background: C.errorBg, color: C.errorText }}><XCircle className="w-4 h-4" /></button><button onClick={() => void remove(form)} disabled={deletingFormId === form.id || busy === form.id} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-50" title="Delete form" style={{ background: C.deleteBg, color: C.deleteText }}>{deletingFormId === form.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}{deletingFormId === form.id ? 'Deleting' : 'Delete'}</button></>}</div></div>)}</div>}
    </div>
  );
}
