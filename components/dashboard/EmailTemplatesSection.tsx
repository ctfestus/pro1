'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { ArrowCounterClockwise, CaretRight, ClipboardText, CreditCard, Desktop, DeviceMobile, GraduationCap, ListBullets, LockSimple, MagnifyingGlass, PaperPlaneTilt, PencilSimple, TextB, TextItalic, Trophy, UserPlus, type Icon } from '@phosphor-icons/react';
import { useTenant } from '@/components/TenantProvider';
import { MenuSelect } from '@/components/MenuSelect';
import { supabase } from '@/lib/supabase';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { PageHeader } from '@/components/dashboard/content/kit';
import { Card, Pill, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { ConfirmModal } from '@/components/dashboard/cohorts/CohortModals';

type Definition = {
  key: string; label: string; category: string; description: string; schedule: string;
  tags: string[];
};
type Override = { template_key: string; subject_template: string; body_template: string; composition_mode: 'legacy_replace' | 'additive'; updated_at: string; updated_by: string | null };
type HistoryRow = { id: string; template_key: string; action: string; changed_at: string; students?: { full_name?: string; email?: string } | null };

/** The learner journey stages the emails are grouped in: a short name and an icon per category. */
const STAGES: Record<string, { name: string; icon: Icon }> = {
  'Access and onboarding': { name: 'Joining', icon: UserPlus },
  'Learning and engagement': { name: 'Learning', icon: GraduationCap },
  'Assignments and events': { name: 'Assignments and events', icon: ClipboardText },
  'Achievements': { name: 'Achievements', icon: Trophy },
  'Payments and subscriptions': { name: 'Payments', icon: CreditCard },
};
const stageOf = (category: string) => STAGES[category] ?? { name: category, icon: ClipboardText };
const tagLabel = (tag: string) => tag.replace(/_/g, ' ');

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
  const [busy, setBusy] = useState<'save' | 'reset' | 'test' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const tenant = useTenant();
  const [show, setShow] = useState<'all' | 'custom'>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop');
  // The system email as learners get it (no custom message), with its own subject.
  const [system, setSystem] = useState<{ subject: string; html: string } | null>(null);
  const [frameHeight, setFrameHeight] = useState(480);

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
    setMessage(null);
    // Only the stage you are working in is open.
    setOpen(new Set([selected.category]));
  }, [selectedKey, selected, selectedOverride]);

  useEffect(() => {
    if (!selectedKey) return;
    let cancelled = false;
    setSystem(null);
    (async () => {
      try {
        const res = await fetch('/api/email-templates', {
          method: 'POST', headers: await authHeaders(true),
          body: JSON.stringify({ action: 'preview', key: selectedKey, subject: '', body: '' }),
        });
        const json = await res.json();
        if (!cancelled && res.ok) setSystem({ subject: json.subject, html: json.html });
      } catch { /* the email part shows a short note instead */ }
    })();
    return () => { cancelled = true; };
  }, [selectedKey]);

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
    return definitions.filter(item => (!needle || `${item.label} ${item.category} ${item.description}`.toLowerCase().includes(needle))
      && (show === 'all' || overrides.some(row => row.template_key === item.key)));
  }, [definitions, query, show, overrides]);
  const categories = useMemo(() => [...new Set(filtered.map(item => item.category))], [filtered]);

  // A merge tag goes in where the cursor is in the message; with no cursor there, on a new line at the end.
  // onMouseDown on the tag keeps the editor's selection, so the tag lands in place.
  const editorWrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Only when the body changed from outside (another email, Discard, the tag fallback): typing already matches, so the cursor stays put.
    const editor = editorWrap.current;
    if (editor && editor.innerHTML !== body) editor.innerHTML = body;
  }, [body, selectedKey]);
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

  async function request(action: 'test') {
    if (!selected) return;
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch('/api/email-templates', {
        method: 'POST', headers: await authHeaders(true),
        body: JSON.stringify({ action, key: selected.key, subject, body }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not send the test email.');
      setMessage({ ok: true, text: `Test sent to ${json.sentTo}.` });
    } catch (error: any) {
      setMessage({ ok: false, text: error.message || 'Could not send the test email.' });
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
      setMessage({ ok: true, text: 'Saved. The next emails of this kind include it, within a minute.' });
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
      setMessage({ ok: true, text: 'Restored. The next emails of this kind use the system email.' });
      await load(selected.key);
    } catch (error: any) {
      setMessage({ ok: false, text: error.message || 'Could not reset this template.' });
    } finally { setBusy(null); }
  }

  if (loading && !definitions.length) return <div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.muted }}/></div>;

  const selectedHistory = history.filter(item => item.template_key === selectedKey).slice(0, 8);
  const isCustom = (key: string) => overrides.some(row => row.template_key === key);
  const canSave = (dirty || needsSafeComposition) && hasCustomization && busy === null;
  const when = (value: string) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const line = `inset 0 0 0 1px ${C.divider}`;
  const toggleStage = (category: string) => setOpen(current => { const next = new Set(current); if (next.has(category)) next.delete(category); else next.add(category); return next; });
  const searching = Boolean(query.trim()) || show === 'custom';
  const segBtn = (on: boolean) => on ? { background: C.cta, color: '#ffffff' } : { color: C.muted };

  return (
    <div className="grid gap-4 pb-24">
      <PageHeader C={C} title="Email templates" sub="Write straight into the email learners get. Your message sits on top; the rest is always sent."
        actions={
          <label className="field-shell hidden h-10 w-72 items-center gap-2 rounded-xl px-3 lg:flex" style={{ background: C.card, boxShadow: line, color: C.faint }}>
            <MagnifyingGlass className="h-[18px] w-[18px] flex-shrink-0" weight="duotone" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find an email" aria-label="Find an email" className="w-full bg-transparent text-sm outline-none" style={{ color: C.text }} />
          </label>
        } />

      {message && (
        <div role={message.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={message.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          {message.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0"/> : <XCircle className="w-4 h-4 flex-shrink-0"/>}
          <span className="flex-1">{message.text}</span>
        </div>
      )}

      {/* Phones: the emails as one menu instead of the list. */}
      <div className="lg:hidden">
        <MenuSelect label="Email" field searchable C={C} value={selectedKey} onChange={choose}
          options={definitions.map(item => ({ value: item.key, label: `${stageOf(item.category).name}: ${item.label}` }))} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* The emails by learner journey: stages that fold, a row per email with when it is sent. */}
        <Card C={C} className="hidden p-2 lg:block lg:sticky lg:top-4 lg:max-h-[calc(100vh-32px)] lg:overflow-y-auto">
          <div className="mb-1.5 flex rounded-xl p-1" style={{ boxShadow: line }} role="group" aria-label="Show">
            {(['all', 'custom'] as const).map(id => (
              <button key={id} type="button" aria-pressed={show === id} onClick={() => setShow(id)}
                className="flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors" style={segBtn(show === id)}>
                {id === 'all' ? 'All emails' : 'Customised'}
              </button>
            ))}
          </div>
          {categories.length === 0 && <p className="px-3 py-4 text-sm" style={{ color: C.muted }}>{show === 'custom' ? 'No customised emails yet.' : 'No emails match.'}</p>}
          {categories.map(category => {
            const stage = stageOf(category);
            const expanded = searching || open.has(category);
            return (
              <div key={category}>
                <button type="button" onClick={() => toggleStage(category)} aria-expanded={expanded}
                  className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-sm font-bold transition-colors hover:bg-[var(--hov)]"
                  style={{ color: C.text, ['--hov' as string]: C.pill }}>
                  <stage.icon className="h-5 w-5 flex-shrink-0" weight="duotone" />
                  <span className="flex-1">{stage.name}</span>
                  <CaretRight className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} style={{ color: C.faint }} />
                </button>
                {expanded && (
                  <ul className="mb-1.5 pl-7">
                    {filtered.filter(item => item.category === category).map(item => {
                      const active = item.key === selectedKey;
                      return (
                        <li key={item.key}>
                          <button type="button" aria-current={active} onClick={() => choose(item.key)}
                            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-[var(--hov)]"
                            style={{ background: active ? `color-mix(in srgb, ${C.cta} 12%, transparent)` : undefined, ['--hov' as string]: C.pill }}>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold" style={{ color: C.text }}>{item.label}</span>
                              <span className="block truncate text-xs" style={{ color: C.muted }}>{item.schedule}</span>
                            </span>
                            {isCustom(item.key) && <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: P.good }} title="Customised" aria-label="Customised" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
          <p className="flex items-center gap-1.5 px-3 pb-2 pt-1 text-xs" style={{ color: C.muted }}><span className="h-2 w-2 rounded-full" style={{ background: P.good }} />Customised</p>
        </Card>

        {selected && <>
          {/* The email itself, edited in place inside an inbox frame. */}
          <Card C={C} className="min-w-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <h2 className="text-xl font-semibold" style={{ color: C.text }}>{selected.label}</h2>
                <Pill tone={selectedOverride ? 'good' : 'mute'} dot={Boolean(selectedOverride)} C={C}>{selectedOverride ? 'Customised' : 'System email'}</Pill>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="hidden rounded-xl p-1 sm:inline-flex" style={{ boxShadow: line }} role="group" aria-label="View as">
                  {([['desktop', Desktop, 'Desktop'], ['phone', DeviceMobile, 'Phone']] as const).map(([id, Glyph, label]) => (
                    <button key={id} type="button" aria-pressed={device === id} onClick={() => setDevice(id)}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors" style={segBtn(device === id)}>
                      <Glyph className="h-4 w-4" weight="duotone" />{label}
                    </button>
                  ))}
                </div>
                <button type="button" onClick={() => request('test')} disabled={busy !== null} className={btnSmClass} style={btnStyle('sec', C)}>
                  {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin"/> : <PaperPlaneTilt className="h-4 w-4" weight="duotone" />}Send me a test
                </button>
              </div>
            </div>

            {/* Desktop: the email fills the card under the bar. Phone: a phone-width frame on the page colour. */}
            <div className={`flex justify-center ${device === 'phone' ? 'px-3 py-6 sm:px-5 sm:py-7' : 'pt-1'}`} style={{ background: device === 'phone' ? C.page : '#ffffff' }}>
              <div className="w-full transition-[max-width] duration-300" style={{ maxWidth: device === 'phone' ? 380 : 640 }}>
                <div className="rounded-2xl bg-white px-4 pb-6 pt-5 sm:px-6">
                  <p className="mb-4 truncate text-[13px]" style={{ color: '#6B7280' }}>From <b style={{ color: '#111827' }}>{tenant.senderName || tenant.appName}</b>{tenant.supportEmail ? ` <${tenant.supportEmail}>` : ''}</p>
                  <label className="mb-1.5 block text-[13px] font-semibold" style={{ color: '#374151' }} htmlFor="email-subject">Subject</label>
                  <div className="field-shell flex h-11 items-center gap-2 rounded-xl bg-white px-4" style={{ boxShadow: 'inset 0 0 0 1px #D1D9E4' }}>
                    <input id="email-subject" value={subject} maxLength={200} onChange={event => setSubject(event.target.value)}
                      placeholder={system?.subject || 'Subject'}
                      className="min-w-0 flex-1 bg-transparent text-[15px] font-semibold outline-none placeholder:font-normal placeholder:text-[#9CA3AF]" style={{ color: '#111827' }} />
                    <PencilSimple size={16} weight="duotone" color="#9CA3AF" aria-hidden />
                  </div>
                  <p className="mb-5 mt-1.5 text-xs" style={{ color: '#9CA3AF' }}>Leave it empty to send the system subject.</p>
                  {selectedOverride?.composition_mode === 'legacy_replace' && <p className="mb-4 rounded-xl px-3 py-3 text-xs" style={{ background: '#FEF2F2', color: '#B91C1C' }}>This customisation was saved before the system email was protected. Save it again to keep the full system email.</p>}
                  <p className="mb-1.5 text-[13px] font-semibold" style={{ color: '#374151' }}>Your message</p>
                  <div className="field-shell mb-5 rounded-xl bg-white" style={{ boxShadow: 'inset 0 0 0 1px #D1D9E4' }}>
                    <div ref={editorWrap} contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label="Your message"
                      data-placeholder="Add a short note to learners. It appears here, above the email."
                      onInput={event => { const editor = event.currentTarget; setBody(editor.textContent?.trim() ? editor.innerHTML : ''); }}
                      className="min-h-[96px] px-4 py-3 text-[15px] leading-relaxed outline-none empty:before:pointer-events-none empty:before:text-[#9CA3AF] empty:before:content-[attr(data-placeholder)] [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5"
                      style={{ color: '#1F2937' }} />
                    <div className="flex flex-wrap items-center gap-1.5 border-t px-3 py-2" style={{ borderColor: '#E5E7EB' }}>
                      {([['bold', 'Bold', TextB], ['italic', 'Italic', TextItalic], ['insertUnorderedList', 'Bullet list', ListBullets]] as const).map(([command, label, Glyph]) => (
                        <button key={command} type="button" title={label} aria-label={label} onMouseDown={event => event.preventDefault()}
                          onClick={() => { editorWrap.current?.focus(); document.execCommand(command); }}
                          className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[#EEF2F7]" style={{ color: '#374151' }}>
                          <Glyph size={17} weight="duotone" />
                        </button>
                      ))}
                      <span className="mx-1.5 h-4 w-px" style={{ background: '#E5E7EB' }} />
                      <span className="mr-1 text-xs font-semibold" style={{ color: '#6B7280' }}>Insert</span>
                      {selected.tags.map(tag => (
                        <button key={tag} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertTag(tag)}
                          className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold" style={{ color: '#374151', boxShadow: 'inset 0 0 0 1px #DCE3EC' }}>
                          {tagLabel(tag)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <span className="mb-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: '#F3F4F6', color: '#6B7280' }}>
                    <LockSimple className="h-3 w-3" weight="duotone" />Always sent: details, dates and buttons
                  </span>
                  {system ? (
                    <iframe title="The system email" srcDoc={system.html} sandbox="allow-same-origin" className="block w-full border-0" style={{ height: frameHeight }}
                      onLoad={event => {
                        // Follow the email's own height, which changes when Desktop / Phone narrows the frame.
                        const body = event.currentTarget.contentDocument?.body;
                        if (body) new ResizeObserver(() => setFrameHeight(body.scrollHeight + 24)).observe(body);
                      }} />
                  ) : <p className="py-10 text-center text-sm" style={{ color: '#6B7280' }}>Loading the email...</p>}
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-4 lg:col-span-2 xl:col-span-1">
            <Card C={C} className="p-5">
              <h3 className="mb-3 text-base font-semibold" style={{ color: C.text }}>When it sends</h3>
              <ol>
                {[[selected.description, ''], [selected.schedule, '']].map(([text], i) => (
                  <li key={i} className="relative flex items-start gap-3" style={{ paddingBottom: i === 0 ? 16 : 0 }}>
                    {i === 0 && <span aria-hidden className="absolute left-[5px] top-[18px] bottom-0" style={{ borderLeft: `2px dashed ${C.divider}` }} />}
                    <span className="relative mt-1 h-3 w-3 flex-shrink-0 rounded-full" style={i === 0 ? { background: C.cta } : { background: C.card, boxShadow: `inset 0 0 0 2px ${C.cta}` }} />
                    <span className="text-sm" style={{ color: C.text }}>{i === 0 ? text : <><b>Sends</b> <span style={{ color: C.muted }}>{text.charAt(0).toLowerCase() + text.slice(1)}</span></>}</span>
                  </li>
                ))}
              </ol>
            </Card>
            <Card C={C} className="p-5">
              <h3 className="mb-3 text-base font-semibold" style={{ color: C.text }}>Personalise</h3>
              <div className="flex flex-wrap gap-1.5">
                {selected.tags.map(tag => (
                  <button key={tag} type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertTag(tag)}
                    className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: C.pill, color: C.text }}>{tagLabel(tag)}</button>
                ))}
              </div>
              <p className="mt-3 text-xs" style={{ color: C.muted }}>Each field fills in for the learner. Links cannot be added: the email keeps its own buttons.</p>
            </Card>
            <Card C={C} className="p-5">
              <h3 className="mb-3 text-base font-semibold" style={{ color: C.text }}>History</h3>
              {selectedHistory.length ? (
                <ol>
                  {selectedHistory.map((row, i) => {
                    const last = i === selectedHistory.length - 1;
                    return (
                      <li key={row.id} className="relative flex items-start gap-3" style={{ paddingBottom: last ? 0 : 14 }}>
                        {!last && <span aria-hidden className="absolute left-[5px] top-[18px] bottom-0" style={{ borderLeft: `2px dashed ${C.divider}` }} />}
                        <span className="relative mt-1 h-3 w-3 flex-shrink-0 rounded-full" style={{ background: row.action === 'reset' ? C.faint : P.good }} />
                        <span className="text-sm" style={{ color: C.text }}>
                          <b>{row.action === 'reset' ? 'Restored the system email' : row.action === 'created' ? 'Customised' : 'Updated'}</b>
                          <span className="block text-xs" style={{ color: C.muted }}>{row.students?.full_name || row.students?.email || 'Staff'}, {when(row.changed_at)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="text-sm" style={{ color: C.muted }}>No changes yet. Learners get the system email.</p>}
              {selectedOverride && (
                <button type="button" onClick={() => void reset()} disabled={busy !== null} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold disabled:opacity-60" style={{ color: P.bad }}>
                  {busy === 'reset' ? <Loader2 className="h-4 w-4 animate-spin"/> : <ArrowCounterClockwise className="h-4 w-4" weight="duotone" />}Restore the system email
                </button>
              )}
            </Card>
          </div>
        </>}
      </div>

      {/* Save stays in reach: a bar at the bottom once something has changed. */}
      {selected && canSave && (
        <div className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: '0 18px 40px -12px rgba(0,0,0,0.35)' }}>
          <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: P.warn }} />
          <span className="min-w-0 flex-1 text-sm" style={{ color: C.text }}>{needsSafeComposition && !dirty ? 'Save again to protect the system email' : 'You have unsaved changes'}</span>
          {dirty && <button type="button" onClick={() => { setSubject(loadedSubject); setBody(loadedBody); }} className={btnSmClass} style={btnStyle('sec', C)}>Discard</button>}
          <button type="button" onClick={() => void save()} className={btnSmClass} style={btnStyle('pri', C)}>Save changes</button>
        </div>
      )}
      {busy === 'save' && <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-2xl px-4 py-3 text-sm" style={{ background: C.card, color: C.muted, boxShadow: '0 18px 40px -12px rgba(0,0,0,0.35)' }}><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Saving...</div>}

      {ask && <ConfirmModal title={ask.title} body={ask.body} action={ask.action} danger={ask.danger} C={C}
        onClose={() => setAsk(null)} onConfirm={() => { const run = ask.run; setAsk(null); run(); }} />}
    </div>
  );
}
