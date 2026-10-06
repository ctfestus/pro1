'use client';

import { useState, type CSSProperties } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import type { ApplicationQuestion, ApplicationQuestionValidation } from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

function NumericCriterion({ label, value, onChange, inputStyle, integer = false, max }: {
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  inputStyle: CSSProperties;
  integer?: boolean;
  max?: number;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  return (
    <label className="block text-[11px] font-medium">
      <span className="mb-1.5 block">{label}</span>
      <input type="number" inputMode={integer ? 'numeric' : 'decimal'} step={integer ? 1 : 'any'} min={integer ? 1 : undefined} max={max} value={draft}
        onChange={event => {
          const next = event.target.value;
          setDraft(next);
          if (next === '') onChange(undefined);
          else if (Number.isFinite(Number(next))) onChange(Number(next));
        }} style={inputStyle} />
    </label>
  );
}

export function ApplicationResponseValidation({ question, C, inputStyle, onChange }: {
  question: ApplicationQuestion;
  C: ThemeColors;
  inputStyle: CSSProperties;
  onChange: (validation: ApplicationQuestionValidation | undefined) => void;
}) {
  const supported = ['short_text', 'long_text', 'number', 'date', 'multiple_choice'].includes(question.type);
  const validation = question.validation ?? {};
  const ruleCount = Object.values(validation).filter(value => value !== undefined && value !== false).length;
  const choiceCount = new Set((question.options ?? []).filter(option => typeof option === 'string' && option.trim())).size + (question.allowOther ? 1 : 0);
  const [open, setOpen] = useState(ruleCount > 0);
  if (!supported) return null;

  function update(patch: Partial<ApplicationQuestionValidation>) {
    const next = Object.fromEntries(Object.entries({ ...validation, ...patch }).filter(([, value]) => value !== undefined && value !== false)) as ApplicationQuestionValidation;
    onChange(Object.keys(next).length ? next : undefined);
  }

  const fieldStyle = { ...inputStyle, background: C.card, borderRadius: 8, padding: '9px 10px' };
  return (
    <div className="mt-4 rounded-xl p-3" style={{ background: C.input }}>
      <button type="button" className="flex w-full items-center justify-between gap-3 text-left" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: ruleCount ? C.cta : C.muted }}><ShieldCheck className="h-4 w-4" /> Response validation</span>
        <span className="flex items-center gap-1 text-[11px]" style={{ color: C.faint }}>{ruleCount ? `${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}` : 'Optional'}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} /></span>
      </button>
      {open && <div className="mt-3 space-y-3" style={{ color: C.muted }}>
        {question.type === 'short_text' && <>
          <div className="grid gap-3 sm:grid-cols-2">
            <NumericCriterion label="Minimum characters" value={validation.minCharacters} onChange={minCharacters => update({ minCharacters })} inputStyle={fieldStyle} integer max={2000} />
            <NumericCriterion label="Maximum characters" value={validation.maxCharacters} onChange={maxCharacters => update({ maxCharacters })} inputStyle={fieldStyle} integer max={2000} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium"><input type="checkbox" checked={Boolean(validation.requireUrl)} onChange={event => update({ requireUrl: event.target.checked })} style={{ accentColor: C.cta }} /> Require a valid HTTP or HTTPS URL</label>
        </>}
        {question.type === 'long_text' && <div className="grid gap-3 sm:grid-cols-2">
          <NumericCriterion label="Minimum words" value={validation.minWords} onChange={minWords => update({ minWords })} inputStyle={fieldStyle} integer max={10000} />
          <NumericCriterion label="Maximum words" value={validation.maxWords} onChange={maxWords => update({ maxWords })} inputStyle={fieldStyle} integer max={10000} />
        </div>}
        {question.type === 'number' && <div className="grid gap-3 sm:grid-cols-2">
          <NumericCriterion label="Minimum value" value={validation.minNumber} onChange={minNumber => update({ minNumber })} inputStyle={fieldStyle} />
          <NumericCriterion label="Maximum value" value={validation.maxNumber} onChange={maxNumber => update({ maxNumber })} inputStyle={fieldStyle} />
        </div>}
        {question.type === 'date' && <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[11px] font-medium"><span className="mb-1.5 block">Earliest date</span><input type="date" value={validation.minDate ?? ''} onChange={event => update({ minDate: event.target.value || undefined })} style={fieldStyle} /></label>
          <label className="block text-[11px] font-medium"><span className="mb-1.5 block">Latest date</span><input type="date" value={validation.maxDate ?? ''} onChange={event => update({ maxDate: event.target.value || undefined })} style={fieldStyle} /></label>
        </div>}
        {question.type === 'multiple_choice' && <div className="grid gap-3 sm:grid-cols-2">
          <NumericCriterion label="Minimum selections" value={validation.minSelections} onChange={minSelections => update({ minSelections })} inputStyle={fieldStyle} integer max={choiceCount} />
          <NumericCriterion label="Maximum selections" value={validation.maxSelections} onChange={maxSelections => update({ maxSelections })} inputStyle={fieldStyle} integer max={choiceCount} />
        </div>}
        <p className="text-[10px] leading-4" style={{ color: C.faint }}>Leave a limit empty if it should not apply. Applicants will see these rules.</p>
      </div>}
    </div>
  );
}
