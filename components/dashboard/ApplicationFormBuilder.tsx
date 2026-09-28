'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
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
  Moon,
  Move,
  Palette,
  Phone,
  Plus,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Trash2,
  ToggleLeft,
  Upload,
  Workflow,
  X,
  ZoomIn,
  type LucideIcon,
} from 'lucide-react';
import { ApplicationStart } from '@/components/ApplicationStart';
import { PexelsImagePicker } from '@/components/PexelsImagePicker';
import { RichTextEditor } from '@/components/RichTextEditor';
import {
  APPLICATION_FILE_TYPE_IDS,
  APPLICATION_FILE_TYPES,
  applicationQuestionFileTypes,
  type ApplicationCondition,
  type ApplicationFormConfig,
  type ApplicationFormRecord,
  type ApplicationPostSubmission,
  type ApplicationQuestion,
  type ApplicationQuestionType,
} from '@/lib/application-forms';
import { APPLICATION_COVER_TARGET, applicationCoverQuality, highQualityApplicationCoverUrl } from '@/lib/application-cover';
import type { ApplicationRelatedItem } from '@/lib/application-related';
import { applicationThemeColors } from '@/lib/application-theme-presets';
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
  text_block: 'Text block',
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
  text_block: FileText,
};

const QUESTION_TYPE_GROUPS: Array<{ label: string; types: ApplicationQuestionType[] }> = [
  { label: 'Text', types: ['short_text', 'long_text'] },
  { label: 'Contact and details', types: ['email', 'phone', 'number', 'date'] },
  { label: 'Choice', types: ['single_choice', 'multiple_choice', 'dropdown', 'yes_no'] },
  { label: 'Other', types: ['text_block', 'file', 'consent'] },
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

const EMAIL_INTRO_OPTIONS = [
  {
    id: 'direct',
    label: 'Direct',
    prompt: 'What is your email address?',
    helpText: 'For confirmation and status updates.',
  },
  {
    id: 'friendly',
    label: 'Friendly',
    prompt: 'What is the best email to reach you?',
    helpText: 'We will use it to keep you updated about your application.',
  },
  {
    id: 'confirmation',
    label: 'Confirmation',
    prompt: 'Where should we send your application confirmation?',
    helpText: 'You can also use this email to securely check your application status.',
  },
  {
    id: 'formal',
    label: 'Formal',
    prompt: 'Please provide your email address.',
    helpText: 'Application updates and decisions will be sent to this address.',
  },
] as const;

function newQuestion(type: ApplicationQuestionType = 'short_text'): ApplicationQuestion {
  if (type === 'text_block') return { id: `q-${crypto.randomUUID()}`, label: 'Information', type, required: false, richText: '<p>Add helpful context or instructions here.</p>' };
  return { id: `q-${crypto.randomUUID()}`, label: 'Untitled question', type, required: false };
}

function withValidConditions(questions: ApplicationQuestion[]): ApplicationQuestion[] {
  const available = new Set<string>();
  return questions.map(question => {
    const valid = !question.condition || available.has(question.condition.questionId);
    if (question.type !== 'text_block') available.add(question.id);
    return valid ? question : { ...question, condition: undefined };
  });
}

function clampCoverValue(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function CoverCropEditor({ src, alt, config, C, onChange, onChooseImage, onClear }: {
  src: string;
  alt: string;
  config: ApplicationFormConfig;
  C: ThemeColors;
  onChange: (patch: Partial<ApplicationFormConfig>) => void;
  onChooseImage: () => void;
  onClear: () => void;
}) {
  const displaySrc = highQualityApplicationCoverUrl(src);
  const [imageMeta, setImageMeta] = useState<{ src: string; width: number; height: number; failed?: boolean } | null>(null);
  const drag = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
    positionX: number;
    positionY: number;
    width: number;
    height: number;
  } | null>(null);
  const fit = config.coverImageFit ?? 'cover';
  const legacyY = config.coverImagePosition === 'top' ? 0 : config.coverImagePosition === 'bottom' ? 100 : 50;
  const positionX = clampCoverValue(config.coverImagePositionX ?? 50, 0, 100);
  const positionY = clampCoverValue(config.coverImagePositionY ?? legacyY, 0, 100);
  const currentImageMeta = imageMeta?.src === displaySrc ? imageMeta : null;
  const quality = currentImageMeta && !currentImageMeta.failed ? applicationCoverQuality(currentImageMeta.width, currentImageMeta.height) : null;
  const maximumSharpZoom = quality?.maximumSharpZoom ?? 1;
  const zoom = clampCoverValue(config.coverImageZoom ?? 1, 1, maximumSharpZoom);
  const cropped = fit === 'cover';

  function registerImage(width: number, height: number) {
    const nextQuality = applicationCoverQuality(width, height);
    setImageMeta({ src: displaySrc, width, height });
    if ((config.coverImageZoom ?? 1) > nextQuality.maximumSharpZoom) onChange({ coverImageZoom: nextQuality.maximumSharpZoom });
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!cropped) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, positionX, positionY, width: bounds.width, height: bounds.height };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveCrop(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const nextX = clampCoverValue(state.positionX - ((event.clientX - state.clientX) / state.width) * 100 / zoom, 0, 100);
    const nextY = clampCoverValue(state.positionY - ((event.clientY - state.clientY) / state.height) * 100 / zoom, 0, 100);
    onChange({ coverImagePositionX: Math.round(nextX), coverImagePositionY: Math.round(nextY) });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }

  function nudgeCrop(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!cropped || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const movement = event.shiftKey ? 5 : 1;
    if (event.key === 'ArrowLeft') onChange({ coverImagePositionX: clampCoverValue(positionX - movement, 0, 100) });
    if (event.key === 'ArrowRight') onChange({ coverImagePositionX: clampCoverValue(positionX + movement, 0, 100) });
    if (event.key === 'ArrowUp') onChange({ coverImagePositionY: clampCoverValue(positionY - movement, 0, 100) });
    if (event.key === 'ArrowDown') onChange({ coverImagePositionY: clampCoverValue(positionY + movement, 0, 100) });
  }

  const imageStyle: CSSProperties = {
    objectFit: fit,
    objectPosition: `${positionX}% ${positionY}%`,
    transform: cropped ? `scale(${zoom})` : 'none',
    transformOrigin: `${positionX}% ${positionY}%`,
  };

  return (
    <div className="w-full space-y-4">
      <div
        className={`relative aspect-[16/5] overflow-hidden rounded-xl outline-none ${cropped ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
        style={{ background: C.input, boxShadow: `inset 0 0 0 1px ${C.inputBorder}` }}
        onPointerDown={startDrag}
        onPointerMove={moveCrop}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={nudgeCrop}
        tabIndex={cropped ? 0 : -1}
        role="group"
        aria-label={cropped ? 'Cover crop preview. Drag the image or use the arrow keys to reposition it.' : 'Full cover image preview.'}
      >
        <img src={displaySrc} alt={alt} draggable={false} onLoad={event => registerImage(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} onError={() => setImageMeta({ src: displaySrc, width: 0, height: 0, failed: true })} className="pointer-events-none h-full w-full select-none" style={imageStyle} />
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <button type="button" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onChooseImage(); }} className="inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-2 text-[11px] font-semibold text-zinc-900 shadow-sm transition hover:bg-white" aria-label="Change cover image"><Upload className="h-3.5 w-3.5" /> Change</button>
          <button type="button" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onClear(); }} className="grid h-8 w-8 place-items-center rounded-lg bg-black/65 text-white shadow-sm transition hover:bg-black/80" aria-label="Remove cover image"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
        {cropped && <><span className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/45" /><span className="pointer-events-none absolute inset-y-0 right-1/3 w-px bg-white/45" /><span className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/45" /><span className="pointer-events-none absolute inset-x-0 bottom-1/3 h-px bg-white/45" /><span className="pointer-events-none absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-lg bg-black/65 px-2.5 py-1.5 text-[10px] font-semibold text-white"><Move className="h-3.5 w-3.5" /> Drag to reposition</span></>}
      </div>

      <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3" style={{ background: quality?.sharpAtBaseSize === false ? C.errorBg : C.pill }}>
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: quality?.sharpAtBaseSize === false ? C.errorText : C.cta }} />
        <div className="min-w-0 text-[11px] leading-5" style={{ color: quality?.sharpAtBaseSize === false ? C.errorText : C.muted }}>
          {currentImageMeta?.failed
            ? <p>Resolution could not be verified. The original image is still preserved.</p>
            : quality
              ? <><p className="font-semibold">{quality.sharpAtBaseSize ? 'Original quality protected' : 'Higher-resolution image recommended'} - {currentImageMeta!.width} x {currentImageMeta!.height}px</p><p>{quality.sharpAtBaseSize ? `Zoom is limited to ${Math.round(maximumSharpZoom * 100)}% to keep the cover sharp.` : `Use an image around ${APPLICATION_COVER_TARGET.recommendedWidth} x ${APPLICATION_COVER_TARGET.recommendedHeight}px or larger for a sharp cover.`}</p></>
              : <p>Checking image resolution...</p>}
          <p>The crop only changes how the original is displayed. It never creates or saves a lower-quality cropped copy.</p>
        </div>
      </div>

      <div className="grid gap-4 rounded-xl p-4 lg:grid-cols-[minmax(160px,0.65fr)_minmax(220px,1fr)_auto] lg:items-end" style={{ background: C.input }}>
        <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide" style={{ color: C.faint }}>Cover location</span><select value={config.coverImagePlacement ?? 'header'} onChange={event => onChange({ coverImagePlacement: event.target.value as 'header' | 'inside' })} className="w-full rounded-lg px-3 py-2.5 text-xs font-semibold outline-none" style={{ background: C.card, color: C.text, border: `1px solid ${C.inputBorder}` }}><option value="header">Above the form</option><option value="inside">Inside the introduction</option></select></label>
        <div>
          <div className="mb-2 flex items-center justify-between gap-3"><label htmlFor="application-cover-zoom" className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: C.faint }}><ZoomIn className="h-3.5 w-3.5" /> Zoom</label><span className="text-[10px] font-semibold tabular-nums" style={{ color: C.muted }}>{Math.round(zoom * 100)}%</span></div>
          <input id="application-cover-zoom" type="range" min="1" max={maximumSharpZoom} step="0.05" value={zoom} disabled={!cropped || !quality || maximumSharpZoom <= 1} onChange={event => onChange({ coverImageZoom: Number(event.target.value) })} className="h-1.5 w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-35" style={{ accentColor: C.cta }} />
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold" style={{ background: C.card, color: C.text }}><input type="checkbox" checked={!cropped} onChange={event => onChange({ coverImageFit: event.target.checked ? 'contain' : 'cover' })} style={{ accentColor: C.cta }} /> Show full image</label>
          <button type="button" onClick={() => onChange({ coverImageFit: 'cover', coverImagePosition: 'center', coverImagePositionX: 50, coverImagePositionY: 50, coverImageZoom: 1 })} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold" style={{ background: C.card, color: C.muted }}><RotateCcw className="h-3.5 w-3.5" /> Reset</button>
        </div>
      </div>
    </div>
  );
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
                    onMouseEnter={event => { if (!selected) event.currentTarget.style.background = C.page; }}
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
  const isTextBlock = question.type === 'text_block';
  const conditionSources = questions.slice(0, index).filter(item => item.type !== 'text_block');

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
        <QuestionTypePicker value={question.type} index={index} C={C} onChange={type => onUpdate({ type, required: type === 'text_block' ? false : question.required, options: CHOICE_TYPES.includes(type) ? question.options ?? ['Option 1', 'Option 2'] : undefined, richText: type === 'text_block' ? question.richText ?? '<p>Add helpful context or instructions here.</p>' : undefined, allowedFileTypes: type === 'file' ? question.allowedFileTypes : undefined })} />
      </div>

      <input
        value={question.label}
        onChange={event => onUpdate({ label: event.target.value })}
        onFocus={onActivate}
        aria-label={`Question ${index + 1} label`}
        placeholder={isTextBlock ? 'Section heading' : 'Question'}
        className="w-full text-sm font-semibold"
        style={{ ...inputStyle, background: C.input }}
      />
      {isTextBlock
        ? <div className="mt-3"><RichTextEditor value={question.richText ?? ''} onChange={richText => onUpdate({ richText })} placeholder="Add context, instructions, links, or a formatted description." bgOverride={C.input} /></div>
        : <input
            value={question.helpText ?? ''}
            onChange={event => onUpdate({ helpText: event.target.value })}
            placeholder="Description or help text (optional)"
            className="mt-2 w-full text-sm"
            style={{ ...inputStyle, background: 'transparent', borderColor: 'transparent', paddingLeft: 2 }}
          />}

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

      {question.type === 'file' && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold" style={{ color: C.muted }}>Accepted file types</p>
          <div className="flex flex-wrap gap-2">
            {APPLICATION_FILE_TYPE_IDS.map(type => {
              const fileTypes = applicationQuestionFileTypes(question);
              const checked = fileTypes.includes(type);
              const onlyOne = checked && fileTypes.length === 1;
              return (
                <label key={type} title={onlyOne ? 'At least one file type is required' : undefined} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${onlyOne ? 'cursor-not-allowed' : 'cursor-pointer'}`} style={{ background: checked ? C.pill : C.input, color: C.text, boxShadow: checked ? `inset 0 0 0 1px ${C.cta}` : 'none' }}>
                  <input type="checkbox" checked={checked} disabled={onlyOne} onChange={() => onUpdate({ allowedFileTypes: checked ? fileTypes.filter(item => item !== type) : APPLICATION_FILE_TYPE_IDS.filter(item => item === type || fileTypes.includes(item)) })} style={{ accentColor: C.cta }} />
                  {APPLICATION_FILE_TYPES[type].label}
                </label>
              );
            })}
          </div>
          <p className="mt-2 text-[11px]" style={{ color: C.faint }}>Applicants can upload one file up to 10 MB.</p>
        </div>
      )}

      {conditionSources.length > 0 && (
        <div className="mt-4 rounded-xl p-3" style={{ background: C.input }}>
          <button type="button" onClick={() => setLogicOpen(value => !value)} className="flex w-full items-center justify-between gap-3 text-left">
            <span className="flex items-center gap-2 text-xs font-semibold" style={{ color: question.condition ? C.cta : C.muted }}><Sparkles className="h-4 w-4" /> Conditional logic {question.condition ? 'on' : 'off'}</span>
            <span className="text-xs" style={{ color: C.faint }}>{logicOpen ? 'Hide' : 'Edit'}</span>
          </button>
          {logicOpen && (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <select value={question.condition?.questionId ?? ''} onChange={event => setConditionQuestion(event.target.value)} style={{ ...inputStyle, background: C.card }}>
                <option value="">Always show</option>
                {conditionSources.map(item => <option key={item.id} value={item.id}>If {item.label}</option>)}
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
        {!isTextBlock && <><span className="mx-2 h-6 w-px" style={{ background: C.inputBorder }} /><Toggle checked={question.required} onChange={required => onUpdate({ required })} label="Required" C={C} /></>}
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
  const applicationPreviewTheme = applicationThemeColors(C, config.themeColor, config.theme ?? 'platform', config.customTheme, config.themeMode ?? 'light');
  const selectedThemeColor = applicationPreviewTheme.cta;
  const textBlockCount = config.questions.filter(item => item.type === 'text_block').length;
  const answerFieldCount = config.questions.length - textBlockCount + 1;

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
  function addQuestion(afterIndex = config.questions.length - 1, type: ApplicationQuestionType = 'short_text') {
    const question = newQuestion(type); const questions = [...config.questions]; questions.splice(afterIndex + 1, 0, question); setQuestions(questions); setActiveQuestionId(question.id);
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
    const duplicate: ApplicationQuestion = { ...source, id: `q-${crypto.randomUUID()}`, label: `${source.label} copy`, options: source.options ? [...source.options] : undefined, allowedFileTypes: source.allowedFileTypes ? [...source.allowedFileTypes] : undefined, condition: source.condition ? { ...source.condition } : undefined };
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
                      onChange={(url, alt) => setConfig({ coverImage: url, coverImageAlt: alt, coverImagePlacement: config.coverImagePlacement ?? 'header', coverImageFit: 'cover', coverImagePosition: 'center', coverImagePositionX: 50, coverImagePositionY: 50, coverImageZoom: 1 })}
                      onClear={() => setConfig({ coverImage: '', coverImageAlt: '', coverImageFit: 'cover', coverImagePosition: 'center', coverImagePositionX: 50, coverImagePositionY: 50, coverImageZoom: 1 })}
                      C={C}
                      token={token}
                      previewMaxWidth={520}
                      renderTrigger={config.coverImage ? ({ open, clear }) => <CoverCropEditor src={config.coverImage || ''} alt={config.coverImageAlt || `${config.title} cover`} config={config} C={C} onChange={setConfig} onChooseImage={open} onClear={clear} /> : undefined}
                    />
                  </div>
                </div>
              </section>

              <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}>
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold" style={{ color: C.cta }}><LayoutTemplate className="h-4 w-4" /> Form introduction</div>
                <input value={config.title} onChange={event => setConfig({ title: event.target.value })} placeholder="Form title" className="w-full bg-transparent text-xl font-bold outline-none sm:text-2xl" style={{ color: C.text }} />
                <textarea rows={3} value={config.description} onChange={event => setConfig({ description: event.target.value })} placeholder="Describe the programme and what applicants should expect." className="mt-3 w-full resize-none bg-transparent text-xs leading-5 outline-none" style={{ color: C.muted }} />
              </section>

              <div className="flex items-end justify-between gap-4 px-1">
                <div><h2 className="text-sm font-semibold" style={{ color: C.text }}>Questions and content</h2><p className="mt-1 text-[11px]" style={{ color: C.faint }}>Email plus {config.questions.length} custom form item{config.questions.length === 1 ? '' : 's'}.</p></div>
                <span className="rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ background: C.pill, color: C.muted }}>{answerFieldCount} fields{textBlockCount > 0 ? `, ${textBlockCount} text block${textBlockCount === 1 ? '' : 's'}` : ''}</span>
              </div>

              <section className="rounded-2xl p-4 sm:p-5" style={panelStyle}>
                <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: C.muted }}><Lock className="h-3.5 w-3.5" style={{ color: C.cta }} /><span className="font-semibold" style={{ color: C.text }}>Email question</span><span style={{ color: C.faint }}>Required for confirmation and secure status access</span><span className="ml-auto rounded-full px-2 py-1 text-[9px] font-bold uppercase" style={{ background: C.pill, color: C.successText }}>Required</span></div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {EMAIL_INTRO_OPTIONS.map(option => {
                    const selected = config.emailPrompt === option.prompt && config.emailHelpText === option.helpText;
                    return <button key={option.id} type="button" onClick={() => setConfig({ emailPrompt: option.prompt, emailHelpText: option.helpText })} className="rounded-xl p-3 text-left transition-colors" style={{ background: selected ? C.pill : C.input, boxShadow: selected ? `inset 0 0 0 1px ${C.cta}` : 'none' }} aria-pressed={selected}><span className="block text-[10px] font-bold uppercase tracking-wide" style={{ color: selected ? C.cta : C.faint }}>{option.label}</span><span className="mt-1.5 block text-[11px] leading-4" style={{ color: C.text }}>{option.prompt}</span></button>;
                  })}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide" style={{ color: C.faint }}>Question shown to applicants</span><input value={config.emailPrompt ?? 'What is your email address?'} maxLength={160} onChange={event => setConfig({ emailPrompt: event.target.value })} placeholder="Type your own email question" style={inputStyle} /></label>
                  <label><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide" style={{ color: C.faint }}>Supporting text</span><input value={config.emailHelpText ?? 'For confirmation and status updates.'} maxLength={240} onChange={event => setConfig({ emailHelpText: event.target.value })} placeholder="Optional supporting text" style={inputStyle} /></label>
                </div>
              </section>

              <div className="space-y-4">{config.questions.map((question, index) => <QuestionEditorCard key={question.id} question={question} index={index} questions={config.questions} active={activeQuestionId === question.id} dragging={draggedQuestionId === question.id} C={C} inputStyle={inputStyle} onActivate={() => setActiveQuestionId(question.id)} onUpdate={patch => updateQuestion(index, patch)} onMove={direction => moveQuestion(index, direction)} onDuplicate={() => duplicateQuestion(index)} onRemove={() => removeQuestion(index)} onDragStart={() => setDraggedQuestionId(question.id)} onDragEnd={() => setDraggedQuestionId('')} onDrop={() => dropQuestion(index)} />)}</div>
              <div className="grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => addQuestion()} className="flex w-full items-center justify-center gap-2 rounded-2xl p-3 text-xs font-semibold" style={{ background: C.card, color: C.cta }}><Plus className="h-4 w-4" /> Add question</button><button type="button" onClick={() => addQuestion(config.questions.length - 1, 'text_block')} className="flex w-full items-center justify-center gap-2 rounded-2xl p-3 text-xs font-semibold" style={{ background: C.card, color: C.muted }}><FileText className="h-4 w-4" /> Add text block</button></div>
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="mx-auto max-w-6xl space-y-5">
            <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}>
              <SectionHeading icon={Palette} title="Form appearance" description="Choose a color for actions and focus rings, then select a light or dark neutral interface." C={C} />
              <div className="mt-5 flex flex-col gap-4 rounded-2xl p-4 lg:flex-row lg:items-center" style={{ background: C.input }}>
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl p-3" style={{ background: C.card }}>
                  <input
                    type="color"
                    value={selectedThemeColor}
                    onChange={event => setConfig({ themeColor: event.target.value, theme: undefined, customTheme: undefined })}
                    className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                    aria-label="Application theme color"
                  />
                  <span className="min-w-0"><span className="block text-xs font-semibold" style={{ color: C.text }}>Application color</span><span className="mt-0.5 block font-mono text-[10px] uppercase" style={{ color: C.faint }}>{selectedThemeColor}</span></span>
                </label>
                <div className="flex rounded-xl p-1" style={{ background: C.card }} aria-label="Application color mode">
                  {([['light', 'Light', Sun], ['dark', 'Dark', Moon]] as const).map(([value, label, Icon]) => {
                    const selected = (config.themeMode ?? 'light') === value;
                    return <button key={value} type="button" onClick={() => setConfig({ themeMode: value })} className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold" style={{ background: selected ? C.cta : 'transparent', color: selected ? C.ctaText : C.muted }} aria-pressed={selected}><Icon className="h-3.5 w-3.5" /> {label}</button>;
                  })}
                </div>
                <div className="flex shrink-0 items-center gap-2" aria-label="Generated theme preview">
                  <span className="h-10 w-14 rounded-lg" style={{ background: selectedThemeColor }} title="Action color" />
                  <span className="h-10 w-14 rounded-lg" style={{ background: applicationPreviewTheme.input, boxShadow: `inset 0 0 0 1px ${applicationPreviewTheme.inputBorder}` }} title="Input color" />
                  <span className="h-10 w-14 rounded-lg" style={{ background: applicationPreviewTheme.page }} title="Background color" />
                </div>
              </div>
            </section>
            <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}>
              <SectionHeading icon={ListChecks} title="Question layout" description="Choose how applicants move through the questions." C={C} />
              <div className="mt-5 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Question layout">
                {([
                  ['steps', 'One question at a time', 'A guided flow with a progress bar and a review step before submitting.'],
                  ['list', 'All questions on one page', 'Every question is shown in a single scrolling form.'],
                ] as const).map(([value, label, description]) => {
                  const selected = (config.layout ?? 'steps') === value;
                  return <button key={value} type="button" role="radio" aria-checked={selected} onClick={() => setConfig({ layout: value })} className="rounded-xl p-4 text-left transition-colors" style={{ background: selected ? C.pill : C.input, boxShadow: selected ? `inset 0 0 0 1px ${C.cta}` : 'none' }}><span className="block text-xs font-semibold" style={{ color: selected ? C.cta : C.text }}>{label}</span><span className="mt-1 block text-[11px] leading-4" style={{ color: C.muted }}>{description}</span></button>;
                })}
              </div>
            </section>
            <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={Link2} title="Registration link" description="Customize the public link that you share with applicants." C={C} /><div className="mt-5 flex items-center overflow-hidden rounded-xl" style={{ background: C.input, border: `1px solid ${C.inputBorder}` }}><span className="pl-3 text-sm" style={{ color: C.faint }}>/apply/</span><input value={form.slug} onChange={event => { const slug = event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+/, '').slice(0, 64); setForm(previous => ({ ...previous, slug })); }} onBlur={() => setForm(previous => ({ ...previous, slug: previous.slug.replace(/-+$/, '') || 'application' }))} aria-label="Registration URL" className="min-w-0 flex-1 bg-transparent px-1 py-3 text-sm font-semibold outline-none" style={{ color: C.text }} /></div><p className="mt-2 text-xs" style={{ color: C.faint }}>Changing a published URL stops the old link from working.</p></section>
            <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={FileText} title="Applicant guidance" description="Add eligibility details and the message shown after submission." C={C} /><div className="mt-5 space-y-4"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Eligibility information</label><RichTextEditor value={config.eligibility} onChange={eligibility => setConfig({ eligibility })} placeholder="Who should apply and what should they prepare?" bgOverride={C.input} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Confirmation message *</label><textarea rows={4} value={config.confirmationMessage} onChange={event => setConfig({ confirmationMessage: event.target.value })} placeholder="Thank applicants and explain what happens next." style={{ ...inputStyle, resize: 'vertical' }} /></div></div></section>
            <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={CalendarClock} title="Application window" description="Leave either date empty if the form should remain open-ended." C={C} /><div className="mt-5 grid gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Opening date</label><input type="datetime-local" value={config.opensAt?.slice(0, 16) ?? ''} onChange={event => setConfig({ opensAt: event.target.value ? new Date(event.target.value).toISOString() : '' })} style={inputStyle} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Closing date</label><input type="datetime-local" value={config.closesAt?.slice(0, 16) ?? ''} onChange={event => setConfig({ closesAt: event.target.value ? new Date(event.target.value).toISOString() : '' })} style={inputStyle} /></div></div></section>
          </div>
        )}

        {tab === 'workflow' && (
          <div className="mx-auto max-w-6xl"><section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={Workflow} title="Review stages" description="Internal names help reviewers. Applicant labels appear on secure status pages." C={C} action={<button type="button" onClick={() => setConfig({ stages: [...config.stages, { id: `stage-${crypto.randomUUID()}`, name: 'New stage', applicantLabel: 'Under review' }] })} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: C.cta, color: C.ctaText }}><Plus className="h-4 w-4" /> Add stage</button>} /><div className="mt-6 space-y-3"><div className="hidden grid-cols-[36px_1fr_1fr_40px] gap-3 px-2 text-[10px] font-bold uppercase tracking-wider sm:grid" style={{ color: C.faint }}><span /><span>Internal stage</span><span>Applicant sees</span><span /></div>{config.stages.map((stage, index) => <div key={stage.id} className="grid items-center gap-3 rounded-xl p-3 sm:grid-cols-[36px_1fr_1fr_40px]" style={{ background: C.input }}><span className="grid h-8 w-8 place-items-center rounded-lg text-xs font-bold" style={{ background: C.card, color: C.cta }}>{index + 1}</span><input value={stage.name} onChange={event => { const stages = [...config.stages]; stages[index] = { ...stage, name: event.target.value }; setConfig({ stages }); }} placeholder="Internal stage" style={{ ...inputStyle, background: C.card }} /><input value={stage.applicantLabel} onChange={event => { const stages = [...config.stages]; stages[index] = { ...stage, applicantLabel: event.target.value }; setConfig({ stages }); }} placeholder="Applicant status" style={{ ...inputStyle, background: C.card }} /><button type="button" disabled={config.stages.length === 1} onClick={() => setConfig({ stages: config.stages.filter(item => item.id !== stage.id) })} className="rounded-lg p-2 disabled:opacity-30" style={{ color: C.deleteText }} aria-label={`Delete ${stage.name}`}><Trash2 className="h-4 w-4" /></button></div>)}</div></section></div>
        )}

        {tab === 'completion' && (
          <div className="mx-auto max-w-6xl space-y-5">
            <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={Send} title="After submission" description="Choose what applicants see immediately after completing the form." C={C} /><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{POST_OPTIONS.map(option => { const selected = config.postSubmission.type === option.value; return <button key={option.value} type="button" onClick={() => setConfig({ postSubmission: { ...config.postSubmission, type: option.value } })} className="relative rounded-2xl p-4 text-left" style={{ background: selected ? C.pill : C.input, boxShadow: selected ? `inset 0 0 0 1px ${C.cta}` : 'none' }}>{selected && <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full" style={{ background: C.cta, color: '#FFFFFF' }}><Check className="h-3.5 w-3.5" /></span>}<p className="pr-7 text-xs font-bold" style={{ color: C.text }}>{option.title}</p><p className="mt-1 text-[11px] leading-5" style={{ color: C.faint }}>{option.description}</p></button>; })}</div></section>
            {config.postSubmission.type !== 'default' && <section className="rounded-2xl p-5 sm:p-6" style={panelStyle}><SectionHeading icon={Sparkles} title="Customize the completion" description="These details appear below the application confirmation." C={C} /><div className="mt-5">{config.postSubmission.type === 'redirect' && <div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Redirect URL</label><input type="url" value={config.postSubmission.redirectUrl ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, redirectUrl: event.target.value } })} placeholder="https://example.com/next" style={inputStyle} /></div>}{config.postSubmission.type === 'button' && <div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Button label</label><input value={config.postSubmission.buttonLabel ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, buttonLabel: event.target.value } })} placeholder="Continue" style={inputStyle} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Button URL</label><input type="url" value={config.postSubmission.buttonUrl ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, buttonUrl: event.target.value } })} placeholder="https://example.com" style={inputStyle} /></div></div>}{config.postSubmission.type === 'notice' && <div className="space-y-3"><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Notice title</label><input value={config.postSubmission.noticeTitle ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, noticeTitle: event.target.value } })} placeholder="What happens next" style={inputStyle} /></div><div><label className="mb-1.5 block text-xs font-semibold" style={{ color: C.muted }}>Notice message</label><textarea rows={4} value={config.postSubmission.noticeBody ?? ''} onChange={event => setConfig({ postSubmission: { ...config.postSubmission, noticeBody: event.target.value } })} placeholder="Share timelines, preparation steps, or contact details." style={{ ...inputStyle, resize: 'vertical' }} /></div></div>}{config.postSubmission.type === 'events' && <div><p className="mb-3 text-xs font-semibold" style={{ color: C.muted }}>Choose programmes to recommend</p><div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">{relatedItems.length === 0 ? <p className="text-xs" style={{ color: C.faint }}>No published courses or events are available.</p> : relatedItems.map(item => { const checked = (config.postSubmission.relatedEventIds ?? []).includes(item.id); return <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-xl p-3" style={{ background: checked ? C.pill : C.input, color: C.text, boxShadow: checked ? `inset 0 0 0 1px ${C.cta}` : 'none' }}><input type="checkbox" checked={checked} onChange={() => setConfig({ postSubmission: { ...config.postSubmission, relatedEventIds: checked ? (config.postSubmission.relatedEventIds ?? []).filter(id => id !== item.id) : [...(config.postSubmission.relatedEventIds ?? []), item.id] } })} style={{ accentColor: C.cta }} /><span className="min-w-0 flex-1 truncate text-xs font-medium">{item.title}</span><span className="text-[9px] uppercase" style={{ color: C.faint }}>{item.type}</span></label>; })}</div></div>}</div></section>}
          </div>
        )}
      </div>

      {preview && <div className="fixed inset-0 z-50 overflow-y-auto" style={{ background: C.page }}><div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 backdrop-blur-xl" style={{ background: C.nav, borderBottom: `1px solid ${C.navBorder}` }}><div><p className="flex items-center gap-2 text-xs font-semibold" style={{ color: C.cta }}><Eye className="h-4 w-4" /> Participant preview</p><p className="mt-0.5 text-xs" style={{ color: C.faint }}>This is the same form participants will see.</p></div><button type="button" onClick={() => setPreview(false)} className="rounded-xl p-2" style={{ background: C.pill }} aria-label="Close preview"><X className="h-5 w-5" style={{ color: C.muted }} /></button></div><ApplicationStart previewForm={form} previewRelatedItems={relatedItems.filter(item => (config.postSubmission.relatedEventIds ?? []).includes(item.id))} /></div>}
    </div>
  );
}
