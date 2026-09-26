'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, Loader2, Plus, Trash2, X } from 'lucide-react';
import { ApplicationQuestionFields } from '@/components/ApplicationQuestionFields';
import {
  APPLICATION_QUESTION_TYPES,
  type ApplicationAnswer,
  type ApplicationFormRecord,
  type ApplicationQuestion,
  type ApplicationQuestionType,
} from '@/lib/application-forms';
import { modalStyle, type ThemeColors } from '@/lib/theme';

const TYPE_LABELS: Record<ApplicationQuestionType, string> = {
  short_text: 'Short text', long_text: 'Long text', email: 'Email', phone: 'Phone', number: 'Number', date: 'Date',
  single_choice: 'Single choice', multiple_choice: 'Multiple choice', dropdown: 'Dropdown', yes_no: 'Yes / No', file: 'File upload', consent: 'Consent',
};

function newQuestion(): ApplicationQuestion {
  return { id: `q-${crypto.randomUUID()}`, label: 'New question', type: 'short_text', required: false };
}

export function ApplicationFormBuilder({ initial, token, relatedItems, C, onBack, onSaved }: {
  initial: ApplicationFormRecord;
  token: string;
  relatedItems: { id: string; title: string; slug: string }[];
  C: ThemeColors;
  onBack: () => void;
  onSaved: (form: ApplicationFormRecord) => void;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, ApplicationAnswer>>({});
  const config = form.config;
  const setConfig = (patch: Partial<typeof config>) => setForm(previous => ({ ...previous, config: { ...previous.config, ...patch } }));
  const input = { width: '100%', background: C.input, color: C.text, border: `1px solid ${C.inputBorder}`, borderRadius: 10, padding: '10px 11px', outline: 'none' };
  const label = { color: C.muted };

  async function save(status = form.status) {
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/application-forms/${form.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ config: form.config, slug: form.slug, status }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not save the form.');
      setForm(value.form); onSaved(value.form);
    } catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  }

  function updateQuestion(index: number, patch: Partial<ApplicationQuestion>) {
    const questions = [...config.questions]; questions[index] = { ...questions[index], ...patch }; setConfig({ questions });
  }
  function moveQuestion(index: number, direction: -1 | 1) {
    const next = index + direction; if (next < 0 || next >= config.questions.length) return;
    const questions = [...config.questions]; [questions[index], questions[next]] = [questions[next], questions[index]]; setConfig({ questions });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="text-sm font-semibold" style={{ color: C.muted }}>Back to forms</button>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setPreview(true)} className="px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-2" style={{ background: C.pill, color: C.muted }}><Eye className="w-4 h-4" /> Preview</button>
          <button onClick={() => void save()} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ background: C.pill, color: C.text }}>{saving ? 'Saving...' : 'Save draft'}</button>
          <button onClick={() => void save('published')} disabled={saving} className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60" style={{ background: C.cta, color: C.ctaText }}>{form.status === 'published' ? 'Save and keep published' : 'Publish'}</button>
        </div>
      </div>
      {error && <div className="rounded-xl p-3 text-sm" style={{ background: C.errorBg, color: C.errorText }}>{error}</div>}

      <section className="rounded-2xl p-5 sm:p-6 space-y-4" style={{ background: C.card }}>
        <div><h2 className="font-bold" style={{ color: C.text }}>Form details</h2><p className="text-xs mt-1" style={{ color: C.faint }}>Set the registration link that participants will receive.</p></div>
        <div><label className="block text-xs font-semibold mb-1" style={label}>Title *</label><input value={config.title} onChange={event => setConfig({ title: event.target.value })} style={input} /></div>
        <div>
          <label className="block text-xs font-semibold mb-1" style={label}>Registration URL *</label>
          <div className="flex items-center rounded-xl overflow-hidden" style={{ border: `1px solid ${C.inputBorder}`, background: C.input }}>
            <span className="text-sm pl-3 whitespace-nowrap" style={{ color: C.faint }}>/apply/</span>
            <input value={form.slug} onChange={event => {
              const slug = event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+/, '').slice(0, 64);
              setForm(previous => ({ ...previous, slug }));
            }} onBlur={() => setForm(previous => ({ ...previous, slug: previous.slug.replace(/-+$/, '') || 'application' }))} aria-label="Registration URL" className="flex-1 min-w-0" style={{ ...input, border: 0, borderRadius: 0 }} />
          </div>
          <p className="text-xs mt-1.5" style={{ color: C.faint }}>Use a unique name such as data-bootcamp-2026. Changing a published URL will stop the old link from working.</p>
        </div>
        <div><label className="block text-xs font-semibold mb-1" style={label}>Description *</label><textarea rows={4} value={config.description} onChange={event => setConfig({ description: event.target.value })} style={{ ...input, resize: 'vertical' }} /></div>
        <div><label className="block text-xs font-semibold mb-1" style={label}>Eligibility information</label><textarea rows={4} value={config.eligibility} onChange={event => setConfig({ eligibility: event.target.value })} style={{ ...input, resize: 'vertical' }} /></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div><label className="block text-xs font-semibold mb-1" style={label}>Opening date</label><input type="datetime-local" value={config.opensAt?.slice(0, 16) ?? ''} onChange={event => setConfig({ opensAt: event.target.value ? new Date(event.target.value).toISOString() : '' })} style={input} /></div>
          <div><label className="block text-xs font-semibold mb-1" style={label}>Closing date</label><input type="datetime-local" value={config.closesAt?.slice(0, 16) ?? ''} onChange={event => setConfig({ closesAt: event.target.value ? new Date(event.target.value).toISOString() : '' })} style={input} /></div>
        </div>
        <div><label className="block text-xs font-semibold mb-1" style={label}>Confirmation message *</label><textarea rows={3} value={config.confirmationMessage} onChange={event => setConfig({ confirmationMessage: event.target.value })} style={{ ...input, resize: 'vertical' }} /></div>
      </section>

      <section className="rounded-2xl p-5 sm:p-6 space-y-4" style={{ background: C.card }}>
        <div className="flex items-center justify-between"><div><h2 className="font-bold" style={{ color: C.text }}>Questions</h2><p className="text-xs mt-1" style={{ color: C.faint }}>Email access is collected separately. Every other field is editable.</p></div><button onClick={() => setConfig({ questions: [...config.questions, newQuestion()] })} className="px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5" style={{ background: C.cta, color: C.ctaText }}><Plus className="w-4 h-4" /> Add question</button></div>
        <div className="space-y-3">
          {config.questions.map((question, index) => (
            <div key={question.id} className="rounded-xl p-4 space-y-3" style={{ background: C.input }}>
              <div className="flex gap-2 items-start">
                <span className="text-xs font-bold pt-3" style={{ color: C.faint }}>{index + 1}</span>
                <input aria-label={`Question ${index + 1} label`} value={question.label} onChange={event => updateQuestion(index, { label: event.target.value })} className="flex-1" style={{ ...input, background: C.card }} />
                <button onClick={() => moveQuestion(index, -1)} disabled={index === 0} className="p-2.5 disabled:opacity-30" style={{ color: C.muted }}><ArrowUp className="w-4 h-4" /></button>
                <button onClick={() => moveQuestion(index, 1)} disabled={index === config.questions.length - 1} className="p-2.5 disabled:opacity-30" style={{ color: C.muted }}><ArrowDown className="w-4 h-4" /></button>
                <button onClick={() => setConfig({ questions: config.questions.filter(item => item.id !== question.id) })} className="p-2.5" style={{ color: C.deleteText }}><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <select value={question.type} onChange={event => updateQuestion(index, { type: event.target.value as ApplicationQuestionType, options: ['single_choice', 'multiple_choice', 'dropdown'].includes(event.target.value) ? question.options ?? ['Option 1', 'Option 2'] : undefined })} style={{ ...input, background: C.card }}>
                  {APPLICATION_QUESTION_TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
                </select>
                <input value={question.helpText ?? ''} onChange={event => updateQuestion(index, { helpText: event.target.value })} placeholder="Help text (optional)" style={{ ...input, background: C.card }} />
                <label className="flex items-center gap-2 text-sm px-2" style={{ color: C.text }}><input type="checkbox" checked={question.required} onChange={event => updateQuestion(index, { required: event.target.checked })} style={{ accentColor: C.cta }} /> Required</label>
              </div>
              {['single_choice', 'multiple_choice', 'dropdown'].includes(question.type) && <div><label className="block text-xs mb-1" style={label}>Options, one per line</label><textarea rows={3} value={(question.options ?? []).join('\n')} onChange={event => updateQuestion(index, { options: event.target.value.split('\n').map(item => item.trim()).filter(Boolean) })} style={{ ...input, background: C.card, resize: 'vertical' }} /></div>}
              {index > 0 && <div className="grid sm:grid-cols-3 gap-2">
                <select value={question.condition?.questionId ?? ''} onChange={event => updateQuestion(index, { condition: event.target.value ? { questionId: event.target.value, operator: question.condition?.operator ?? 'equals', value: question.condition?.value ?? '' } : undefined })} style={{ ...input, background: C.card }}><option value="">Always show</option>{config.questions.slice(0, index).map(item => <option key={item.id} value={item.id}>If: {item.label}</option>)}</select>
                {question.condition && <><select value={question.condition.operator} onChange={event => updateQuestion(index, { condition: { ...question.condition!, operator: event.target.value as any } })} style={{ ...input, background: C.card }}><option value="equals">Equals</option><option value="not_equals">Does not equal</option><option value="contains">Contains</option></select><input value={question.condition.value} onChange={event => updateQuestion(index, { condition: { ...question.condition!, value: event.target.value } })} placeholder="Value" style={{ ...input, background: C.card }} /></>}
              </div>}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl p-5 sm:p-6 space-y-4" style={{ background: C.card }}>
        <div><h2 className="font-bold" style={{ color: C.text }}>Review stages</h2><p className="text-xs mt-1" style={{ color: C.faint }}>The applicant label is what applicants can see on their secure status page.</p></div>
        {config.stages.map((stage, index) => <div key={stage.id} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2"><input value={stage.name} onChange={event => { const stages = [...config.stages]; stages[index] = { ...stage, name: event.target.value }; setConfig({ stages }); }} placeholder="Internal stage" style={input} /><input value={stage.applicantLabel} onChange={event => { const stages = [...config.stages]; stages[index] = { ...stage, applicantLabel: event.target.value }; setConfig({ stages }); }} placeholder="Applicant status" style={input} /><button disabled={config.stages.length === 1} onClick={() => setConfig({ stages: config.stages.filter(item => item.id !== stage.id) })} className="p-2 disabled:opacity-30" style={{ color: C.deleteText }}><Trash2 className="w-4 h-4" /></button></div>)}
        <button onClick={() => setConfig({ stages: [...config.stages, { id: `stage-${crypto.randomUUID()}`, name: 'New stage', applicantLabel: 'Under review' }] })} className="text-xs font-semibold flex items-center gap-1" style={{ color: C.cta }}><Plus className="w-4 h-4" /> Add stage</button>
      </section>

      <section className="rounded-2xl p-5 sm:p-6 space-y-4" style={{ background: C.card }}>
        <div><h2 className="font-bold" style={{ color: C.text }}>After submission</h2><p className="text-xs mt-1" style={{ color: C.faint }}>Matches the completion options used by existing courses and forms.</p></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-2">{[
          ['default', 'Thank you'], ['redirect', 'Redirect URL'], ['button', 'CTA button'], ['events', 'Show programmes'], ['notice', 'Notice'],
        ].map(([value, text]) => <button key={value} onClick={() => setConfig({ postSubmission: { ...config.postSubmission, type: value as any } })} className="rounded-xl p-3 text-xs font-semibold" style={{ background: config.postSubmission.type === value ? C.cta : C.pill, color: config.postSubmission.type === value ? C.ctaText : C.muted }}>{text}</button>)}</div>
        {config.postSubmission.type === 'redirect' && <input type="url" value={config.postSubmission.redirectUrl ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, redirectUrl: event.target.value } })} placeholder="https://example.com/next" style={input} />}
        {config.postSubmission.type === 'button' && <div className="grid sm:grid-cols-2 gap-2"><input value={config.postSubmission.buttonLabel ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, buttonLabel: event.target.value } })} placeholder="Button label" style={input} /><input type="url" value={config.postSubmission.buttonUrl ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, buttonUrl: event.target.value } })} placeholder="https://example.com" style={input} /></div>}
        {config.postSubmission.type === 'notice' && <div className="space-y-2"><input value={config.postSubmission.noticeTitle ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, noticeTitle: event.target.value } })} placeholder="Notice title" style={input} /><textarea rows={3} value={config.postSubmission.noticeBody ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, noticeBody: event.target.value } })} placeholder="Notice message" style={{ ...input, resize: 'vertical' }} /></div>}
        {config.postSubmission.type === 'events' && <div className="max-h-52 overflow-y-auto space-y-2">{relatedItems.length === 0 ? <p className="text-xs" style={{ color: C.faint }}>No published courses or events are available.</p> : relatedItems.map(item => { const checked = (config.postSubmission.relatedEventIds ?? []).includes(item.id); return <label key={item.id} className="flex items-center gap-2 rounded-xl p-3" style={{ background: C.input, color: C.text }}><input type="checkbox" checked={checked} onChange={() => setConfig({ postSubmission: { ...config.postSubmission, relatedEventIds: checked ? (config.postSubmission.relatedEventIds ?? []).filter(id => id !== item.id) : [...(config.postSubmission.relatedEventIds ?? []), item.id] } })} style={{ accentColor: C.cta }} /><span className="text-sm">{item.title}</span></label>; })}</div>}
      </section>

      {preview && <div className="fixed inset-0 z-50 grid place-items-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}><div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl p-6" style={modalStyle(C)}><div className="flex items-center justify-between mb-5"><div><p className="text-xs font-semibold" style={{ color: C.cta }}>Preview</p><h2 className="text-xl font-bold" style={{ color: C.text }}>{config.title}</h2></div><button onClick={() => setPreview(false)}><X className="w-5 h-5" style={{ color: C.muted }} /></button></div><p className="text-sm mb-6 whitespace-pre-line" style={{ color: C.muted }}>{config.description}</p><ApplicationQuestionFields questions={config.questions} answers={previewAnswers} onChange={setPreviewAnswers} C={C} /></div></div>}
    </div>
  );
}
