'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  AlignLeft,
  AtSign,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Circle,
  CircleDot,
  Copy,
  Eye,
  FileText,
  GripVertical,
  Hash,
  LayoutTemplate,
  Link2,
  ListChecks,
  Lock,
  Minus,
  Phone,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  ToggleLeft,
  Upload,
  Workflow,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ApplicationStart } from '@/components/ApplicationStart';
import { PexelsImagePicker } from '@/components/PexelsImagePicker';
import {
  type ApplicationCondition,
  type ApplicationFormRecord,
  type ApplicationPostSubmission,
  type ApplicationQuestion,
  type ApplicationQuestionType,
} from '@/lib/application-forms';
import type { ApplicationRelatedItem } from '@/lib/application-related';
import { modalStyle, type ThemeColors } from '@/lib/theme';

const TYPE_LABELS: Record<ApplicationQuestionType, string> = {
  short_text: 'Short answer',
  long_text: 'Paragraph',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  date: 'Date',
  single_choice: 'Multiple choice',
  multiple_choice: 'Checkboxes',
  dropdown: 'Dropdown',
  yes_no: 'Yes or no',
  file: 'File upload',
  consent: 'Consent',
};

const CHOICE_TYPES: ApplicationQuestionType[] = ['single_choice', 'multiple_choice', 'dropdown'];

const QUESTION_TYPE_ICONS: Record<ApplicationQuestionType, LucideIcon> = {
  short_text: Minus,
  long_text: AlignLeft,
  email: AtSign,
  phone: Phone,
  number: Hash,
  date: CalendarDays,
  single_choice: CircleDot,
  multiple_choice: ListChecks,
  dropdown: ChevronsUpDown,
  yes_no: ToggleLeft,
  file: Upload,
  consent: ShieldCheck,
};

const QUESTION_TYPE_GROUPS: Array<{ label: string; types: ApplicationQuestionType[] }> = [
  { label: 'Text', types: ['short_text', 'long_text'] },
  { label: 'Contact and details', types: ['email', 'phone', 'number', 'date'] },
  { label: 'Choice', types: ['single_choice', 'multiple_choice', 'dropdown', 'yes_no'] },
  { label: 'Other', types: ['file', 'consent'] },
];

const TABS = [
  { id: 'questions', label: 'Questions', icon: ListChecks },
  { id: 'settings', label: 'Settings', icon: Settings2 },
  { id: 'workflow', label: 'Review flow', icon: Workflow },
  { id: 'completion', label: 'After submit', icon: Send },
] as const;

type BuilderTab = typeof TABS[number]['id'];

const POST_OPTIONS: Array<{
  value: ApplicationPostSubmission['type'];
  title: string;
  description: string;
}> = [
  { value: 'default', title: 'Thank you', description: 'Show the confirmation and reference number.' },
  { value: 'notice', title: 'Show notice', description: 'Add a custom next-steps message.' },
  { value: 'button', title: 'Action button', description: 'Send applicants to another page.' },
  { value: 'redirect', title: 'Auto redirect', description: 'Move applicants to another page automatically.' },
  { value: 'events', title: 'Recommend programmes', description: 'Show selected courses and events.' },
];

function newQuestion(): ApplicationQuestion {
  return { id: `q-${crypto.randomUUID()}`, label: 'Untitled question', type: 'short_text', required: false };
}

function withValidConditions(questions: ApplicationQuestion[]): ApplicationQuestion[] {
  const available = new Set<string>();
  return questions.map(question => {
    const valid = !question.condition || available.has(question.condition.questionId);
    available.add(question.id);
    return valid ? question : { ...question, condition: undefined };
  });
}

function SectionHeading({ icon: Icon, title, description, C, action }: {
  icon: typeof ListChecks;
  title: string;
  description: string;
  C: ThemeColors;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl" style={{ background: C.pill, color: C.muted }}>
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-sm font-semibold" style={{ color: C.text }}>{title}</h2>
          <p className="mt-1 text-[11px] leading-5" style={{ color: C.faint }}>{description}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

function QuestionTypePicker({ value, index, C, onChange }: {
  value: ApplicationQuestionType;
  index: number;
  C: ThemeColors;
  onChange: (type: ApplicationQuestionType) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ActiveIcon = QUESTION_TYPE_ICONS[value];

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative ml-auto w-full max-w-48">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium"
        style={{ background: C.input, color: C.text }}
        aria-label={`Question ${index + 1} type`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <ActiveIcon className="h-4 w-4 shrink-0" style={{ color: C.faint }} />
        <span className="min-w-0 flex-1 truncate">{TYPE_LABELS[value]}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: C.faint }} />
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] z-50 max-h-[min(70vh,440px)] w-64 overflow-y-auto rounded-2xl p-2" style={modalStyle(C)} role="listbox" aria-label="Question type">
          {QUESTION_TYPE_GROUPS.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex > 0 ? 'mt-1 border-t pt-1' : ''} style={groupIndex > 0 ? { borderColor: C.inputBorder } : undefined}>
              <p className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-wider" style={{ color: C.faint }}>{group.label}</p>
              {group.types.map(type => {
                const Icon = QUESTION_TYPE_ICONS[type];
                const selected = value === type;
                return (
                  <button
                    key={type}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={event => { event.stopPropagation(); onChange(type); setOpen(false); }}
                    onMouseEnter={event => { if (!selected) event.currentTarget.style.background = C.input; }}
                    onMouseLeave={event => { if (!selected) event.currentTarget.style.background = 'transparent'; }}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition-colors"
                    style={{ background: selected ? C.pill : 'transparent', color: C.text }}
                  >
                    <Icon className="h-4 w-4 shrink-0" style={{ color: selected ? C.cta : C.faint }} />
                    <span className="flex-1 font-medium">{TYPE_LABELS[type]}</span>
                    {selected && <Check className="h-3.5 w-3.5" style={{ color: C.cta }} />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, label, C }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  C: ThemeColors;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium" style={{ color: C.text }}>
      <input className="sr-only" type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span className="relative h-5 w-9 rounded-full transition-colors" style={{ background: checked ? C.cta : C.inputBorder }}>
        <span className="absolute top-[3px] h-3.5 w-3.5 rounded-full bg-white transition-all" style={{ left: checked ? 19 : 3 }} />
      </span>
      {label}
    </label>
  );
}

function QuestionEditorCard({ question, index, questions, active, dragging, C, inputStyle, onActivate, onUpdate, onMove, onDuplicate, onRemove, onDragStart, onDragEnd, onDrop }: {
  question: ApplicationQuestion;
  index: number;
  questions: ApplicationQuestion[];
  active: boolean;
  dragging: boolean;
  C: ThemeColors;
  inputStyle: CSSProperties;
  onActivate: () => void;
  onUpdate: (patch: Partial<ApplicationQuestion>) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const [logicOpen, setLogicOpen] = useState(Boolean(question.condition));
  const [dragOver, setDragOver] = useState(false);
  const isChoice = CHOICE_TYPES.includes(question.type);

  function updateOption(optionIndex: number, value: string) {
    const options = [...(question.options ?? [])];
    options[optionIndex] = value;
    onUpdate({ options });
  }

  function removeOption(optionIndex: number) {
    onUpdate({ options: (question.options ?? []).filter((_, current) => current !== optionIndex) });
  }

  function setConditionQuestion(questionId: string) {
    if (!questionId) {
      onUpdate({ condition: undefined });
      return;
    }
    onUpdate({ condition: {
      questionId,
      operator: question.condition?.operator ?? 'equals',
      value: question.condition?.value ?? '',
    } });
  }

  const surface: CSSProperties = {
    background: C.card,
    boxShadow: dragOver ? `inset 0 2px 0 ${C.cta}` : 'none',
    opacity: dragging ? 0.55 : 1,
  };

  return (
    <article
      className={`relative rounded-2xl p-4 transition-shadow sm:p-5 ${active ? 'z-10' : ''}`}
      style={surface}
      onClick={onActivate}
      onDragEnter={event => { event.preventDefault(); if (!dragging) setDragOver(true); }}
      onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false); }}
      onDrop={event => { event.preventDefault(); setDragOver(false); onDrop(); }}
    >
      {active && <span className="absolute bottom-4 left-0 top-4 w-[3px]" style={{ background: C.cta, borderRadius: 2 }} />}
      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          draggable
          onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', question.id); onDragStart(); }}
          onDragEnd={onDragEnd}
          className="flex cursor-grab items-center gap-1.5 rounded-lg px-2 py-1.5 active:cursor-grabbing"
          style={{ background: dragging ? C.pill : C.input, color: dragging ? C.cta : C.faint }}
          aria-label={`Drag question ${index + 1}`}
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
          <span className="hidden text-[10px] font-semibold sm:inline">Drag to reorder</span>
        </button>
        <span className="grid h-7 w-7 place-items-center rounded-lg text-xs font-bold" style={{ background: C.pill, color: C.muted }}>{index + 1}</span>
        <QuestionTypePicker value={question.type} index={index} C={C} onChange={type => onUpdate({ type, options: CHOICE_TYPES.includes(type) ? question.options ?? ['Option 1', 'Option 2'] : undefined })} />
      </div>

      <input
        value={question.label}
        onChange={event => onUpdate({ label: event.target.value })}
        onFocus={onActivate}
        aria-label={`Question ${index + 1} label`}
        placeholder="Question"
        className="w-full text-sm font-semibold"
        style={{ ...inputStyle, background: C.input }}
      />
      <input
        value={question.helpText ?? ''}
        onChange={event => onUpdate({ helpText: event.target.value })}
        placeholder="Description or help text (optional)"
        className="mt-2 w-full text-sm"
        style={{ ...inputStyle, background: 'transparent', borderColor: 'transparent', paddingLeft: 2 }}
      />

      {isChoice && (
        <div className="mt-4 space-y-2">
          {(question.options ?? []).map((option, optionIndex) => (
            <div key={`${question.id}-option-${optionIndex}`} className="flex items-center gap-2">
              {question.type === 'multiple_choice' ? <Square className="h-4 w-4 shrink-0" style={{ color: C.faint }} /> : <Circle className="h-4 w-4 shrink-0" style={{ color: C.faint }} />}
              <input value={option} onChange={event => updateOption(optionIndex, event.target.value)} placeholder={`Option ${optionIndex + 1}`} className="flex-1" style={{ ...inputStyle, background: C.input, padding: '9px 10px' }} />
              <button type="button" onClick={() => removeOption(optionIndex)} className="rounded-lg p-2" style={{ color: C.faint }} aria-label={`Remove option ${optionIndex + 1}`}><X className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => onUpdate({ options: [...(question.options ?? []), `Option ${(question.options?.length ?? 0) + 1}`] })} className="ml-6 flex items-center gap-1.5 px-1 py-2 text-xs font-semibold" style={{ color: C.cta }}><Plus className="h-3.5 w-3.5" /> Add option</button>
        </div>
      )}

      {index > 0 && (
        <div className="mt-4 rounded-xl p-3" style={{ background: C.input }}>
          <button type="button" onClick={() => setLogicOpen(value => !value)} className="flex w-full items-center justify-between gap-3 text-left">
            <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: question.condition ? C.cta : C.muted }}><Sparkles className="h-4 w-4" /> Conditional logic {question.condition ? 'on' : 'off'}</span>
            <span className="text-xs" style={{ color: C.faint }}>{logicOpen ? 'Hide' : 'Edit'}</span>
          </button>
          {logicOpen && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <select value={question.condition?.questionId ?? ''} onChange={event => setConditionQuestion(event.target.value)} style={{ ...inputStyle, background: C.card }}>
                <option value="">Always show</option>
                {questions.slice(0, index).map(item => <option key={item.id} value={item.id}>If {item.label}</option>)}
              </select>
              {question.condition && (
                <>
                  <select value={question.condition.operator} onChange={event => onUpdate({ condition: { ...question.condition!, operator: event.target.value as ApplicationCondition['operator'] } })} style={{ ...inputStyle, background: C.card }}>
                    <option value="equals">Equals</option><option value="not_equals">Does not equal</option><option value="contains">Contains</option>
                  </select>
                  <input value={question.condition.value} onChange={event => onUpdate({ condition: { ...question.condition!, value: event.target.value } })} placeholder="Answer value" style={{ ...inputStyle, background: C.card }} />
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-end gap-1 pt-3" style={{ borderTop: `1px solid ${C.inputBorder}` }}>
        <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="rounded-lg p-2 disabled:opacity-25" style={{ color: C.muted }} aria-label="Move question up"><ArrowUp className="h-4 w-4" /></button>
        <button type="button" onClick={() => onMove(1)} disabled={index === questions.length - 1} className="rounded-lg p-2 disabled:opacity-25" style={{ color: C.muted }} aria-label="Move question down"><ArrowDown className="h-4 w-4" /></button>
        <button type="button" onClick={event => { event.stopPropagation(); onDuplicate(); }} className="rounded-lg p-2" style={{ color: C.muted }} aria-label="Duplicate question"><Copy className="h-4 w-4" /></button>
        <button type="button" onClick={event => { event.stopPropagation(); onRemove(); }} className="rounded-lg p-2" style={{ color: C.deleteText }} aria-label="Delete question"><Trash2 className="h-4 w-4" /></button>
        <span className="mx-2 h-6 w-px" style={{ background: C.inputBorder }} />
        <Toggle checked={question.required} onChange={required => onUpdate({ required })} label="Required" C={C} />
      </div>
    </article>
  );
}

export function ApplicationFormBuilder({ initial, token, relatedItems, C, onBack, onSaved }: {
  initial: ApplicationFormRecord;
  token: string;
  relatedItems: ApplicationRelatedItem[];
  C: ThemeColors;
  onBack: () => void;
  onSaved: (form: ApplicationFormRecord) => void;
}) {
  const [form, setForm] = useState(initial);
  const [tab, setTab] = useState<BuilderTab>('questions');
  const [activeQuestionId, setActiveQuestionId] = useState(initial.config.questions[0]?.id ?? '');
  const [draggedQuestionId, setDraggedQuestionId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const config = form.config;

  const setConfig = (patch: Partial<typeof config>) => setForm(previous => ({ ...previous, config: { ...previous.config, ...patch } }));
  const inputStyle: CSSProperties = { width: '100%', background: C.input, color: C.text, border: `1px solid ${C.inputBorder}`, borderRadius: 12, padding: '11px 12px', outline: 'none' };
  const panelStyle: CSSProperties = { background: C.card };

  async function save(status = form.status) {
    setSaving(true); setError('');
    try {
      const response = await fetch(`/api/application-forms/${form.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ config: form.config, slug: form.slug, status }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Could not save the form.');
      setForm(value.form); onSaved(value.form);
    } catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  }

  function updateQuestion(index: number, patch: Partial<ApplicationQuestion>) {
    const questions = [...config.questions]; questions[index] = { ...questions[index], ...patch }; setConfig({ questions });
  }
  function setQuestions(questions: ApplicationQuestion[]) { setConfig({ questions: withValidConditions(questions) }); }
  function addQuestion(afterIndex = config.questions.length - 1) {
    const question = newQuestion(); const questions = [...config.questions]; questions.splice(afterIndex + 1, 0, question); setQuestions(questions); setActiveQuestionId(question.id);
  }
  function moveQuestion(index: number, direction: -1 | 1) {
    const next = index + direction; if (next < 0 || next >= config.questions.length) return;
    const questions = [...config.questions]; [questions[index], questions[next]] = [questions[next], questions[index]]; setQuestions(questions);
  }
  function dropQuestion(targetIndex: number) {
    const sourceIndex = config.questions.findIndex(item => item.id === draggedQuestionId); if (sourceIndex < 0 || sourceIndex === targetIndex) return;
    const questions = [...config.questions]; const [moved] = questions.splice(sourceIndex, 1); questions.splice(targetIndex, 0, moved); setQuestions(questions); setDraggedQuestionId('');
  }
  function duplicateQuestion(index: number) {
    const source = config.questions[index];
    const duplicate: ApplicationQuestion = { ...source, id: `q-${crypto.randomUUID()}`, label: `${source.label} copy`, options: source.options ? [...source.options] : undefined, condition: source.condition ? { ...source.condition } : undefined };
    const questions = [...config.questions]; questions.splice(index + 1, 0, duplicate); setQuestions(questions); setActiveQuestionId(duplicate.id);
  }
  function removeQuestion(index: number) {
    if (config.questions.length === 1) { setError('A form must have at least one question.'); return; }
    const removedId = config.questions[index].id;
    const questions = config.questions.filter((_, current) => current !== index).map(question => question.condition?.questionId === removedId ? { ...question, condition: undefined } : question);
    setQuestions(questions); setActiveQuestionId(questions[Math.min(index, questions.length - 1)]?.id ?? '');
  }

  return (
    <div className="min-h-screen pb-16" style={{ color: C.text }}>
      <div className="sticky top-0 z-30 -mx-4 mb-6 px-4 py-3 backdrop-blur-xl sm:-mx-6 sm:px-6" style={{ background: C.nav }}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
          <button type="button" onClick={onBack} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: C.pill, color: C.muted }}><ArrowLeft className="h-4 w-4" /> Forms</button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><h1 className="truncate text-sm font-bold sm:text-base" style={{ color: C.text }}>{config.title || 'Untitled application'}</h1><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: form.status === 'published' ? C.successText : C.muted }}>{form.status}</span></div>
            <p className="mt-0.5 hidden text-xs sm:block" style={{ color: C.faint }}>/apply/{form.slug}</p>
          </div>
          <button type="button" onClick={() => setPreview(true)} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: C.pill, color: C.muted }}><Eye className="h-4 w-4" /> Preview</button>
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-60" style={{ background: C.pill, color: C.text }}>{saving ? 'Saving...' : 'Save'}</button>
          <button type="button" onClick={() => void save('published')} disabled={saving} className="rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-60" style={{ background: C.cta, color: C.ctaText }}>{form.status === 'published' ? 'Update live form' : 'Publish'}</button>
        </div>
      </div>

      <div className="mx-auto max-w-6xl">
        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-2xl p-1.5" style={{ background: C.card }} aria-label="Form builder sections">
          {TABS.map(item => { const Icon = item.icon; const selected = tab === item.id; return <button key={item.id} type="button" onClick={() => setTab(item.id)} className="flex min-w-fit flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors" style={{ background: selected ? C.cta : 'transparent', color: selected ? C.ctaText : C.muted }}><Icon className="h-3.5 w-3.5" /> {item.label}</button>; })}
        </nav>

        {error && <div className="mb-5 flex items-start justify-between gap-3 rounded-xl p-3 text-sm" style={{ background: C.errorBg, color: C.errorText }}><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Dismiss error"><X className="h-4 w-4" /></button></div>}

        {tab === 'questions' && (
          <div className="mx-auto max-w-6xl">
            <div className="space-y-5">
              <section className="overflow-hidden rounded-2xl" style={panelStyle}>
                <div className="p-5 sm:p-6">
                  <SectionHeading icon={LayoutTemplate} title="Cover image" description="Choose from Pexels, upload a new image, or reuse one from your image library." C={C} />
                  <div className="mt-4 flex justify-center">
                    <PexelsImagePicker
                      value={config.coverImage || null}
                      altValue={config.coverImageAlt || null}
                      onChange={(url, alt) => setConfig({ coverImage: url, coverImageAlt: alt, coverImagePlacement: config.coverImagePlacement ?? 'header' })}
                      onClear={() => setConfig({ coverImage: '', coverImageAlt: '' })}
                      C={C}
                      token={token}
                      previewMaxWidth={520}
                    />
                  </div>
                </div>
                {config.coverImage && <div className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="text-xs font-semibold" style={{ color: C.text }}>Image placement</p><p className="mt-0.5 text-[11px]" style={{ color: C.faint }}>Choose how applicants see the image.</p></div><div className="flex rounded-xl p-1" style={{ background: C.input }}>{([['header', 'Wide header'], ['inside', 'Inside form']] as const).map(([value, text]) => <button key={value} type="button" onClick={() => setConfig({ coverImagePlacement: value })} className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: (config.coverImagePlacement ?? 'header') === value ? C.card : 'transparent', color: (config.coverImagePlacement ?? 'header') === value ? C.text : C.faint }}>{text}</button>)}</div></div>}
              </section>

              <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold" style={{ color: C.cta }}><LayoutTemplate className="h-4 w-4" /> Form introduction</div>
                <input value={config.title} onChange={event => setConfig({ title: event.target.value })} placeholder="Form title" className="w-full bg-transparent text-xl font-bold outline-none sm:text-2xl" style={{ color: C.text }} />
                <textarea rows={3} value={config.description} onChange={event => setConfig({ description: event.target.value })} placeholder="Describe the programme and what applicants should expect." className="mt-3 w-full resize-none bg-transparent text-xs leading-5 outline-none" style={{ color: C.muted }} />
              </section>

              <div className="flex items-end justify-between gap-4 px-1">
                <div><h2 className="text-sm font-semibold" style={{ color: C.text }}>Questions</h2><p className="mt-1 text-[11px]" style={{ color: C.faint }}>Email plus {config.questions.length} custom question{config.questions.length === 1 ? '' : 's'}.</p></div>
                <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: C.pill, color: C.muted }}>{config.questions.length + 1} fields</span>
              </div>

              <div className="flex flex-wrap items-center gap-2 px-1 py-1 text-xs" style={{ color: C.muted }}><Lock className="h-3.5 w-3.5" style={{ color: C.cta }} /><span className="font-semibold" style={{ color: C.text }}>Email address</span><span style={{ color: C.faint }}>Added automatically for confirmations and status access</span><span className="ml-auto rounded-full px-2 py-1 text-[9px] font-bold uppercase" style={{ background: C.pill, color: C.successText }}>Required</span></div>

              <div className="space-y-4">{config.questions.map((question, index) => <QuestionEditorCard key={question.id} question={question} index={index} questions={config.questions} active={activeQuestionId === question.id} dragging={draggedQuestionId === question.id} C={C} inputStyle={inputStyle} onActivate={() => setActiveQuestionId(question.id)} onUpdate={patch => updateQuestion(index, patch)} onMove={direction => moveQuestion(index, direction)} onDuplicate={() => duplicateQuestion(index)} onRemove={() => removeQuestion(index)} onDragStart={() => setDraggedQuestionId(question.id)} onDragEnd={() => setDraggedQuestionId('')} onDrop={() => dropQuestion(index)} />)}</div>
              <button type="button" onClick={() => addQuestion()} className="flex w-full items-center justify-center gap-2 rounded-2xl p-3 text-xs font-semibold" style={{ background: C.card, color: C.cta }}><Plus className="h-4 w-4" /> Add question</button>
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="mx-auto max-w-6xl space-y-5">
            <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={Link2} title="Registration link" description="Customize the public link that you share with applicants." C={C} /><div className="mt-5 flex items-center overflow-hidden rounded-xl" style={{ background: C.input, border: `1px solid ${C.inputBorder}` }}><span className="pl-3 text-sm" style={{ color: C.faint }}>/apply/</span><input value={form.slug} onChange={event => { const slug = event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+/, '').slice(0, 64); setForm(previous => ({ ...previous, slug })); }} onBlur={() => setForm(previous => ({ ...previous, slug: previous.slug.replace(/-+$/, '') || 'application' }))} aria-label="Registration URL" className="min-w-0 flex-1 bg-transparent px-1 py-3 text-sm font-semibold outline-none" style={{ color: C.text }} /></div><p className="mt-2 text-xs" style={{ color: C.faint }}>Changing a published URL stops the old link from working.</p></section>
            <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={FileText} title="Applicant guidance" description="Add eligibility details and the message shown after submission." C={C} /><div className="mt-5 space-y-4"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Eligibility information</label><textarea rows={5} value={config.eligibility} onChange={event => setConfig({ eligibility: event.target.value })} placeholder="Who should apply and what should they prepare?" style={{ ...inputStyle, resize: 'vertical' }} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Confirmation message *</label><textarea rows={4} value={config.confirmationMessage} onChange={event => setConfig({ confirmationMessage: event.target.value })} placeholder="Thank applicants and explain what happens next." style={{ ...inputStyle, resize: 'vertical' }} /></div></div></section>
            <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={CalendarClock} title="Application window" description="Leave either date empty if the form should remain open-ended." C={C} /><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Opening date</label><input type="datetime-local" value={config.opensAt?.slice(0, 16) ?? ''} onChange={event => setConfig({ opensAt: event.target.value ? new Date(event.target.value).toISOString() : '' })} style={inputStyle} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Closing date</label><input type="datetime-local" value={config.closesAt?.slice(0, 16) ?? ''} onChange={event => setConfig({ closesAt: event.target.value ? new Date(event.target.value).toISOString() : '' })} style={inputStyle} /></div></div></section>
          </div>
        )}

        {tab === 'workflow' && (
          <div className="mx-auto max-w-6xl"><section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={Workflow} title="Review stages" description="Internal names help reviewers. Applicant labels appear on secure status pages." C={C} action={<button type="button" onClick={() => setConfig({ stages: [...config.stages, { id: `stage-${crypto.randomUUID()}`, name: 'New stage', applicantLabel: 'Under review' }] })} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: C.cta, color: C.ctaText }}><Plus className="h-4 w-4" /> Add stage</button>} /><div className="mt-6 space-y-3"><div className="hidden grid-cols-[36px_1fr_1fr_40px] gap-3 px-2 text-[10px] font-bold uppercase tracking-wider sm:grid" style={{ color: C.faint }}><span /><span>Internal stage</span><span>Applicant sees</span><span /></div>{config.stages.map((stage, index) => <div key={stage.id} className="grid items-center gap-3 rounded-xl p-3 sm:grid-cols-[36px_1fr_1fr_40px]" style={{ background: C.input }}><span className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold" style={{ background: C.card, color: C.cta }}>{index + 1}</span><input value={stage.name} onChange={event => { const stages = [...config.stages]; stages[index] = { ...stage, name: event.target.value }; setConfig({ stages }); }} placeholder="Internal stage" style={{ ...inputStyle, background: C.card }} /><input value={stage.applicantLabel} onChange={event => { const stages = [...config.stages]; stages[index] = { ...stage, applicantLabel: event.target.value }; setConfig({ stages }); }} placeholder="Applicant status" style={{ ...inputStyle, background: C.card }} /><button type="button" disabled={config.stages.length === 1} onClick={() => setConfig({ stages: config.stages.filter(item => item.id !== stage.id) })} className="rounded-lg p-2 disabled:opacity-30" style={{ color: C.deleteText }} aria-label={`Delete ${stage.name}`}><Trash2 className="h-4 w-4" /></button></div>)}</div></section></div>
        )}

        {tab === 'completion' && (
          <div className="mx-auto max-w-6xl space-y-5">
            <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={Send} title="After submission" description="Choose what applicants see immediately after completing the form." C={C} /><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{POST_OPTIONS.map(option => { const selected = config.postSubmission.type === option.value; return <button key={option.value} type="button" onClick={() => setConfig({ postSubmission: { ...config.postSubmission, type: option.value } })} className="relative rounded-2xl p-4 text-left" style={{ background: selected ? C.pill : C.input, boxShadow: selected ? `inset 0 0 0 1px ${C.cta}` : 'none' }}>{selected && <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full" style={{ background: C.cta, color: C.accent }}><Check className="h-3.5 w-3.5" /></span>}<p className="pr-7 text-xs font-bold" style={{ color: C.text }}>{option.title}</p><p className="mt-1 text-[11px] leading-5" style={{ color: C.faint }}>{option.description}</p></button>; })}</div></section>
            {config.postSubmission.type !== 'default' && <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={Sparkles} title="Customize the completion" description="These details appear below the application confirmation." C={C} /><div className="mt-5">{config.postSubmission.type === 'redirect' && <div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Redirect URL</label><input type="url" value={config.postSubmission.redirectUrl ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, redirectUrl: event.target.value } })} placeholder="https://example.com/next" style={inputStyle} /></div>}{config.postSubmission.type === 'button' && <div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Button label</label><input value={config.postSubmission.buttonLabel ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, buttonLabel: event.target.value } })} placeholder="Continue" style={inputStyle} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Button URL</label><input type="url" value={config.postSubmission.buttonUrl ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, buttonUrl: event.target.value } })} placeholder="https://example.com" style={inputStyle} /></div></div>}{config.postSubmission.type === 'notice' && <div className="space-y-3"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Notice title</label><input value={config.postSubmission.noticeTitle ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, noticeTitle: event.target.value } })} placeholder="What happens next" style={inputStyle} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Notice message</label><textarea rows={4} value={config.postSubmission.noticeBody ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, noticeBody: event.target.value } })} placeholder="Share timelines, preparation steps, or contact details." style={{ ...inputStyle, resize: 'vertical' }} /></div></div>}{config.postSubmission.type === 'events' && <div><p className="mb-3 text-xs font-semibold" style={{ color: C.muted }}>Choose programmes to recommend</p><div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">{relatedItems.length === 0 ? <p className="text-xs" style={{ color: C.faint }}>No published courses or events are available.</p> : relatedItems.map(item => { const checked = (config.postSubmission.relatedEventIds ?? []).includes(item.id); return <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-xl p-3" style={{ background: checked ? C.pill : C.input, color: C.text, boxShadow: checked ? `inset 0 0 0 1px ${C.cta}` : 'none' }}><input type="checkbox" checked={checked} onChange={() => setConfig({ postSubmission: { ...config.postSubmission, relatedEventIds: checked ? (config.postSubmission.relatedEventIds ?? []).filter(id => id !== item.id) : [...(config.postSubmission.relatedEventIds ?? []), item.id] } })} style={{ accentColor: C.cta }} /><span className="min-w-0 flex-1 truncate text-xs font-medium">{item.title}</span><span className="text-[9px] uppercase" style={{ color: C.faint }}>{item.type}</span></label>; })}</div></div>}</div></section>}
          </div>
        )}
      </div>

      {preview && <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: C.page }}><div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 backdrop-blur-xl" style={{ background: C.nav, borderBottom: `1px solid ${C.navBorder}` }}><div><p className="flex items-center gap-2 text-xs font-semibold" style={{ color: C.cta }}><Eye className="h-4 w-4" /> Participant preview</p><p className="mt-0.5 text-xs" style={{ color: C.faint }}>This is the same form participants will see.</p></div><button type="button" onClick={() => setPreview(false)} className="rounded-xl p-2" style={{ background: C.pill }} aria-label="Close preview"><X className="h-5 w-5" style={{ color: C.muted }} /></button></div><ApplicationStart previewForm={form} previewRelatedItems={relatedItems.filter(item => (config.postSubmission.relatedEventIds ?? []).includes(item.id))} /></div>}
    </div>
  );
}
