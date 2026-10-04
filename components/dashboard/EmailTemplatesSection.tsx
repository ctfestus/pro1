'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, History, Loader2, Mail, RotateCcw, Search, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { RichTextEditor } from '@/components/RichTextEditor';

type Definition = {
  key: string; label: string; category: string; description: string; schedule: string;
  defaultSubject: string; defaultBody: string; tags: string[]; requiredTags: string[];
};
type Override = { template_key: string; subject_template: string; body_template: string; updated_at: string; updated_by: string | null };
type HistoryRow = { id: string; template_key: string; action: string; changed_at: string; students?: { full_name?: string; email?: string } | null };

async function authHeaders(json = false) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Your session expired. Sign in again.');
  return { ...(json ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${session.access_token}` };
}

export function EmailTemplatesSection({ C }: { C: typeof LIGHT_C }) {
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
    const nextSubject = selectedOverride?.subject_template ?? selected.defaultSubject;
    const nextBody = selectedOverride?.body_template ?? selected.defaultBody;
    setSubject(nextSubject);
    setBody(nextBody);
    setLoadedSubject(nextSubject);
    setLoadedBody(nextBody);
    setExpectedUpdatedAt(selectedOverride?.updated_at ?? null);
    setPreview(null);
    setMessage(null);
  }, [selectedKey, selected, selectedOverride]);

  const dirty = subject !== loadedSubject || body !== loadedBody;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return definitions.filter(item => !needle || `${item.label} ${item.category} ${item.description}`.toLowerCase().includes(needle));
  }, [definitions, query]);
  const categories = useMemo(() => [...new Set(filtered.map(item => item.category))], [filtered]);

  function choose(key: string) {
    if (dirty && !window.confirm('Discard your unsaved email changes?')) return;
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
      else setMessage({ ok: true, text: `Test email sent to ${json.sentTo}.` });
    } catch (error: any) {
      setMessage({ ok: false, text: error.message || `Could not ${action} this email.` });
    } finally { setBusy(null); }
  }

  async function save() {
    if (!selected) return;
    if (!selectedOverride && !window.confirm('Saving activates this custom subject and body for future sends. Continue?')) return;
    setBusy('save');
    setMessage(null);
    try {
      const res = await fetch('/api/email-templates', {
        method: 'PUT', headers: await authHeaders(true),
        body: JSON.stringify({ key: selected.key, subject, body, expectedUpdatedAt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not save this template.');
      setMessage({ ok: true, text: 'Saved. Future emails will use this version within 60 seconds.' });
      await load(selected.key);
    } catch (error: any) {
      setMessage({ ok: false, text: error.message || 'Could not save this template.' });
    } finally { setBusy(null); }
  }

  async function reset() {
    if (!selected || !selectedOverride) return;
    if (!window.confirm('Remove this customization and restore the system email? The change will affect future sends.')) return;
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

  if (loading && !definitions.length) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.cta }}/></div>;

  const selectedHistory = history.filter(item => item.template_key === selectedKey).slice(0, 8);
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2"><Mail className="w-5 h-5" style={{ color: C.cta }}/><h1 className="text-xl font-bold" style={{ color: C.text }}>Email Templates</h1></div>
        <p className="mt-1 text-sm" style={{ color: C.faint }}>Customize platform-wide emails sent to learners. Every instructor and admin sees the same shared version and change history.</p>
      </div>

      {message && <div role="status" className="rounded-xl px-4 py-3 text-sm" style={{ background: message.ok ? C.lime : C.errorBg, color: message.ok ? C.green : C.errorText }}>{message.text}</div>}

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-2xl p-3 lg:max-h-[calc(100vh-150px)] lg:overflow-y-auto" style={cardStyle(C)}>
          <label className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: C.input }}>
            <Search className="w-4 h-4" style={{ color: C.faint }}/>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search templates" className="w-full bg-transparent text-sm outline-none" style={{ color: C.text }}/>
          </label>
          <div className="mt-3 space-y-4">
            {categories.map(category => <div key={category}>
              <p className="px-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.faint }}>{category}</p>
              <div className="mt-1 space-y-1">{filtered.filter(item => item.category === category).map(item => {
                const active = item.key === selectedKey;
                const customized = overrides.some(row => row.template_key === item.key);
                return <button key={item.key} onClick={() => choose(item.key)} className="w-full rounded-xl px-3 py-2.5 text-left" style={{ background: active ? C.pill : 'transparent' }}>
                  <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold" style={{ color: active ? C.cta : C.text }}>{item.label}</span>{customized && <Check className="w-3.5 h-3.5" style={{ color: C.green }}/>}</span>
                  <span className="mt-0.5 block text-[11px]" style={{ color: C.faint }}>{item.schedule}</span>
                </button>;
              })}</div>
            </div>)}
          </div>
        </aside>

        {selected && <main className="space-y-5">
          <section className="rounded-2xl p-5" style={cardStyle(C)}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-base font-bold" style={{ color: C.text }}>{selected.label}</h2><p className="mt-1 text-xs" style={{ color: C.faint }}>{selected.description}</p></div>
              <span className="rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: selectedOverride ? C.lime : C.pill, color: selectedOverride ? C.green : C.muted }}>{selectedOverride ? 'Custom version active' : 'Custom template starter'}</span>
            </div>
            {!selectedOverride && <p className="mt-4 rounded-xl px-3 py-2.5 text-xs" style={{ background: C.pill, color: C.muted }}>The existing system email remains active until you save. Saving activates the complete custom subject and body shown here. Detailed sections from the system version may be replaced.</p>}
            <div className="mt-5 space-y-4">
              <label className="block"><span className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Subject</span><input value={subject} maxLength={200} onChange={event => setSubject(event.target.value)} className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: C.input, color: C.text }}/></label>
              <div><span className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Email body</span><RichTextEditor value={body} onChange={setBody} placeholder="Write the learner email..." bgOverride={C.input}/></div>
              <div><p className="text-xs font-semibold" style={{ color: C.muted }}>Available merge tags</p><div className="mt-2 flex flex-wrap gap-2">{selected.tags.map(tag => <button key={tag} type="button" onClick={() => setBody(value => `${value}<p>{{${tag}}}</p>`)} className="rounded-lg px-2 py-1 font-mono text-[11px]" style={{ background: C.pill, color: C.muted }}>{`{{${tag}}}`}{selected.requiredTags.includes(tag) ? ' *' : ''}</button>)}</div><p className="mt-2 text-[11px]" style={{ color: C.faint }}>* Required tags must remain visible because they carry essential learner information. Custom links are blocked; the secure action button is added by the platform.</p></div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={save} disabled={!dirty || busy !== null} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>{busy === 'save' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}Save template</button>
              <button onClick={() => request('preview')} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: C.pill, color: C.text }}>{busy === 'preview' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Mail className="w-4 h-4"/>}Preview</button>
              <button onClick={() => request('test')} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: C.pill, color: C.text }}>{busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Send className="w-4 h-4"/>}Send test to me</button>
              {selectedOverride && <button onClick={reset} disabled={busy !== null} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold" style={{ background: C.pill, color: C.muted }}>{busy === 'reset' ? <Loader2 className="w-4 h-4 animate-spin"/> : <RotateCcw className="w-4 h-4"/>}Restore system email</button>}
            </div>
          </section>

          {preview && <section className="rounded-2xl p-5" style={cardStyle(C)}><p className="text-xs font-semibold" style={{ color: C.muted }}>Preview subject</p><p className="mt-1 text-sm font-bold" style={{ color: C.text }}>{preview.subject}</p><iframe title="Email preview" srcDoc={preview.html} sandbox="" className="mt-4 h-[520px] w-full rounded-xl bg-white"/></section>}

          <section className="rounded-2xl p-5" style={cardStyle(C)}>
            <div className="flex items-center gap-2"><History className="w-4 h-4" style={{ color: C.faint }}/><h3 className="text-sm font-bold" style={{ color: C.text }}>Recent changes</h3></div>
            {selectedHistory.length ? <div className="mt-3 divide-y" style={{ borderColor: C.divider }}>{selectedHistory.map(row => <div key={row.id} className="flex items-center justify-between gap-4 py-2.5 text-xs"><span style={{ color: C.muted }}>{row.action === 'reset' ? 'Reset to default' : row.action === 'created' ? 'Customized' : 'Updated'} by {row.students?.full_name || row.students?.email || 'a platform user'}</span><time style={{ color: C.faint }}>{new Date(row.changed_at).toLocaleString()}</time></div>)}</div> : <p className="mt-3 text-xs" style={{ color: C.faint }}>No saved changes for this template.</p>}
          </section>
        </main>}
      </div>
    </div>
  );
}
