'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, CheckCircle2, Loader2, Mail, RotateCcw, Search, Send, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { RichTextEditor } from '@/components/RichTextEditor';
import { PageHeader } from '@/components/dashboard/content/kit';
import { Card, Pill, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { FIELD, Hint, Label, Sect, inputStyle } from '@/components/create/EditorKit';
import { ConfirmModal } from '@/components/dashboard/cohorts/CohortModals';

type Definition = {
  key: string; label: string; category: string; description: string; schedule: string;
  tags: string[];
};
type Override = { template_key: string; subject_template: string; body_template: string; composition_mode: 'legacy_replace' | 'additive'; updated_at: string; updated_by: string | null };
type HistoryRow = { id: string; template_key: string; action: string; changed_at: string; students?: { full_name?: string; email?: string } | null };

async function authHeaders(json = false) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session expired. Sign in again.');
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${session.access_token}` };
}

export function EmailTemplatesSection({ C: theme }: { C: ThemeColors }) {
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loadedSubject, setLoadedSubject] = useState('');
  const [loadedBody, setLoadedBody] = useState('');
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'save' | 'reset' | 'preview' | 'test' | null>(null);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async (preserveKey?: string) => {
    setLoading(true);
    try {
      const res = await fetch('/api/email-templates', { headers: await authHeaders() });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not load email templates.');
      setDefinitions(json.definitions ?? []);
      setOverrides(json.overrides ?? []);
      setHistory(json.history ?? []);
      const nextKey = preserveKey || selectedKey || json.definitions?.[0]?.key || '';
      setSelectedKey(nextKey);
    } catch (error: any) {
      setMessage({ ok: false, text: error.message || 'Could not load email templates.' });
    } finally {
      setLoading(false);
    }
  }, [selectedKey]);

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = definitions.find(item => item.key === selectedKey) ?? null;
  const selectedOverride = overrides.find(item => item.template_key === selectedKey) ?? null;

  useEffect(() => {
    if (!selected) return;
    const nextSubject = selectedOverride?.subject_template ?? '';
    const nextBody = selectedOverride?.body_template ?? '';
    setSubject(nextSubject);
    setBody(nextBody);
    setLoadedSubject(nextSubject);
    setLoadedBody(nextBody);
    setExpectedUpdatedAt(selectedOverride?.updated_at ?? null);
    setPreview(null);
    setMessage(null);
  }, [selectedKey, selected, selectedOverride]);

  const dirty = subject !== loadedSubject || body !== loadedBody;
  const needsSafeComposition = selectedOverride?.composition_mode === 'legacy_replace';
  const bodyHasVisibleText = Boolean(body
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;|&#x0*a0;/gi, ' ')
    .replace(/[\s\u00a0\u200b\u200c\u200d\ufeff]/g, ''));
  const hasCustomization = Boolean(subject.trim() || bodyHasVisibleText);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return definitions.filter(item => !needle || `${item.label} ${item.category} ${item.description}`.toLowerCase().includes(needle));
  }, [definitions, query]);
  const categories = useMemo(() => [...new Set(filtered.map(item => item.category))], [filtered]);

  // A merge tag goes in where the cursor is in the message; with no cursor there, on a new line at the end.
  // onMouseDown on the tag keeps the editor's selection, so the tag lands in place.
  const editorWrap = useRef<HTMLDivElement>(null);
  function insertTag(tag: string) {
    const selection = window.getSelection();
    const inEditor = selection?.anchorNode && editorWrap.current?.contains(selection.anchorNode);
    if (inEditor && document.execCommand('insertText', false, `{{${tag}}}`)) return;
    setBody(value => `${value}<p>{{${tag}}}</p>`);
  }

  // Questions before an action, in the app's own pop-up.
  const [ask, setAsk] = useState<{ title: string; body: string; action: string; danger?: boolean; run: () => void } | null>(null);

  function choose(key: string) {
    if (key === selectedKey) return;
    if (dirty) {
      setAsk({ title: 'Discard your changes?', body: 'You have unsaved changes to this email. Opening another template drops them.', action: 'Discard changes', danger: true, run: () => setSelectedKey(key) });
      return;
    }
    setSelectedKey(key);
  }

  async function request(action: 'preview' | 'test') {
    if (!selected) return;
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch('/api/email-templates', {
        method: 'POST', headers: await authHeaders(true),
        body: JSON.stringify({ action, key: selected.key, subject, body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Could not ${action} this email.`);
      if (action === 'preview') setPreview({ subject: json.subject, html: json.html });
      else setMessage({ ok: true, text: `Sample email sent to ${json.sentTo}.` });
    } catch (error: any) {
      setMessage({ ok: false, text: error.message || `Could not ${action} this email.` });
    } finally { setBusy(null); }
  }

  async function save(confirmed = false) {
    if (!selected) return;
    if (!selectedOverride && !confirmed) {
      setAsk({ title: 'Save this customisation?', body: 'Future emails of this kind will include it. The complete system email stays in place.', action: 'Save', run: () => void save(true) });
      return;
    }
    setBusy('save');
    setMessage(null);
    try {
      const res = await fetch('/api/email-templates', {
        method: 'PUT', headers: await authHeaders(true),
        body: JSON.stringify({ key: selected.key, subject, body, expectedUpdatedAt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save this template.');
      setMessage({ ok: true, text: 'Saved. Future emails will keep the system content and include this customization within 60 seconds.' });
      await load(selected.key);
    } catch (error: any) {
      setMessage({ ok: false, text: error.message || 'Could not save this template.' });
    } finally { setBusy(null); }
  }

  async function reset(confirmed = false) {
    if (!selected || !selectedOverride) return;
    if (!confirmed) {
      setAsk({ title: 'Restore the system email?', body: 'Your custom subject and message are removed from future emails of this kind.', action: 'Restore system email', danger: true, run: () => void reset(true) });
      return;
    }
    setBusy('reset');
    setMessage(null);
    try {
      const res = await fetch('/api/email-templates', {
        method: 'DELETE', headers: await authHeaders(true),
        body: JSON.stringify({ key: selected.key, expectedUpdatedAt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not reset this template.');
      setMessage({ ok: true, text: 'Customization removed. Future sends will use the system email.' });
      await load(selected.key);
    } catch (error: any) {
      setMessage({ ok: false, text: error.message || 'Could not reset this template.' });
    } finally { setBusy(null); }
  }

  if (loading && !definitions.length) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.muted }}/></div>;

  const selectedHistory = history.filter(item => item.template_key === selectedKey).slice(0, 8);
  const sampleBtn = (action: 'preview' | 'test', Icon: typeof Mail, label: string) => (
    <button type="button" onClick={() => request(action)} disabled={busy !== null} className={btnSmClass} style={btnStyle('sec', C)}>
      {busy === action ? <Loader2 className="w-4 h-4 animate-spin"/> : <Icon className="w-4 h-4"/>}{label}
    </button>
  );
  return (
    <div className="grid gap-4">
      <PageHeader C={C} title="Email templates" sub="Add your own subject or message to the emails learners get. The system content, details and buttons stay."
        actions={selected && (
          <button type="button" onClick={() => void save()} disabled={(!dirty && !needsSafeComposition) || !hasCustomization || busy !== null} className={btnClass} style={btnStyle('pri', C)}>
            {busy === 'save' && <Loader2 className="w-4 h-4 animate-spin"/>}Save changes
          </button>
        )} />

      {message && (
        <div role={message.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={message.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          {message.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0"/> : <XCircle className="w-4 h-4 flex-shrink-0"/>}
          <span className="flex-1">{message.text}</span>
        </div>
      )}

      <div className="grid gap-4 items-start lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card C={C} className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-32px)] lg:overflow-y-auto">
          <Sect C={C} title="Templates" first>
            <label className="field-shell flex items-center gap-2 h-10 px-3 rounded-xl" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: C.faint }}>
              <Search className="w-4 h-4 flex-shrink-0"/>
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search templates" className="w-full bg-transparent text-sm outline-none" style={{ color: C.text }}/>
            </label>
            {categories.length === 0 && <p className="text-xs" style={{ color: C.muted }}>No templates match this search.</p>}
            {categories.map(category => <div key={category}>
              <p className="px-3 mb-1 text-xs font-semibold" style={{ color: C.faint }}>{category}</p>
              <div className="grid gap-0.5">{filtered.filter(item => item.category === category).map(item => {
                const active = item.key === selectedKey;
                const customized = overrides.some(row => row.template_key === item.key);
                return <button key={item.key} type="button" aria-pressed={active} onClick={() => choose(item.key)} className="w-full rounded-[10px] px-3 py-2.5 text-left" style={active ? { background: P.sel, color: P.onSel } : { color: C.text }}>
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{item.label}</span>{customized && <Check className="w-3.5 h-3.5 flex-shrink-0" aria-label="Customised" style={{ color: active ? P.onSel : P.good }}/>}</span>
                  <span className="mt-0.5 block text-xs" style={{ color: active ? 'rgba(255,255,255,0.85)' : C.muted }}>{item.schedule}</span>
                </button>;
              })}</div>
            </div>)}
          </Sect>
        </Card>

        {selected && <Card C={C} className="min-w-0">
          <Sect C={C} title={selected.label} first
            action={<Pill tone={selectedOverride ? 'good' : 'mute'} dot={Boolean(selectedOverride)} C={C}>{selectedOverride ? 'Customisation active' : 'System email active'}</Pill>}>
            <p className="-mt-2 text-xs" style={{ color: C.muted }}>{selected.description}</p>
            <p className="rounded-xl px-3 py-3 text-xs" style={{ background: C.pill, color: C.muted }}>The complete system email always remains in place, including course lists, results, dates, payment details, certificates and real action buttons. A custom message appears above it. Leave the subject blank to keep the system subject.</p>
            {selectedOverride?.composition_mode === 'legacy_replace' && <p className="rounded-xl px-3 py-3 text-xs" style={{ background: C.errorBg, color: C.errorText }}>This customisation was saved before protected composition was introduced. Its subject remains active, but its body is paused to prevent duplicated or missing content. Review it and save again to activate it as an added message.</p>}
            <div>
              <Label C={C}>Custom subject (optional)</Label>
              <input value={subject} maxLength={200} onChange={event => setSubject(event.target.value)} placeholder="Leave blank to keep the system subject" className={FIELD} style={inputStyle(C)}/>
            </div>
            <div>
              <Label C={C}>Custom message (optional)</Label>
              <div ref={editorWrap}><RichTextEditor value={body} onChange={setBody} placeholder="Add a message above the system email" bgOverride={C.input}/></div>
            </div>
            <div>
              <Label C={C}>Merge tags</Label>
              <div className="flex flex-wrap gap-2">{selected.tags.map(tag => <button key={tag} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertTag(tag)} className="rounded-lg px-2 py-1 font-mono text-xs" style={{ background: C.pill, color: C.text }}>{`{{${tag}}}`}</button>)}</div>
              <Hint C={C}>Merge tags are optional in your message because essential learner information stays in the protected system email. Custom links are blocked.</Hint>
            </div>
            {selectedOverride && (
              <div>
                <button type="button" onClick={() => void reset()} disabled={busy !== null} className={btnSmClass} style={btnStyle('sec', C)}>
                  {busy === 'reset' ? <Loader2 className="w-4 h-4 animate-spin"/> : <RotateCcw className="w-4 h-4"/>}Restore system email
                </button>
              </div>
            )}
          </Sect>

          <Sect C={C} title="Preview" action={<div className="flex flex-wrap gap-2">{sampleBtn('preview', Mail, 'Preview full sample')}{sampleBtn('test', Send, 'Send full sample')}</div>}>
            {preview ? <>
              <div className="rounded-xl px-3 py-3" style={{ background: C.pill }}>
                <p className="text-xs" style={{ color: C.muted }}>Subject</p>
                <p className="mt-1 text-sm font-semibold" style={{ color: C.text }}>{preview.subject}</p>
              </div>
              <p className="text-xs" style={{ color: C.muted }}>This is the complete email layout with representative learner data. Buttons look the same but are disabled in previews and samples.</p>
              <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="h-[520px] w-full rounded-xl bg-white"/>
            </> : <p className="text-xs" style={{ color: C.muted }}>Preview the full email with sample learner data, or send it as a test email.</p>}
          </Sect>

          <Sect C={C} title="Recent changes">
            {selectedHistory.length ? <div>{selectedHistory.map((row, i) => <div key={row.id} className="flex items-center justify-between gap-4 py-3 text-xs" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}><span style={{ color: C.text }}>{row.action === 'reset' ? 'Reset to default' : row.action === 'created' ? 'Customised' : 'Updated'} by {row.students?.full_name || row.students?.email || 'a platform user'}</span><time style={{ color: C.muted }}>{new Date(row.changed_at).toLocaleString()}</time></div>)}</div> : <p className="text-xs" style={{ color: C.muted }}>No saved changes for this template.</p>}
          </Sect>
        </Card>}
      </div>
      {ask && <ConfirmModal title={ask.title} body={ask.body} action={ask.action} danger={ask.danger} C={C}
        onClose={() => setAsk(null)} onConfirm={() => { const run = ask.run; setAsk(null); run(); }} />}
    </div>
  );
}
