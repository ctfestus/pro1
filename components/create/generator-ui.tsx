'use client';

// Shared pieces of the AI course generators on /create (SQL, Python, document): the brief
// (step 1) and the outline review (step 2). One look for all three, with modules drawn like
// the course editor's module boxes. Neutrals come from the create theme; every coloured part
// uses the platform colour (lib/theme `cta`: the tenant's primary colour in light mode).

import type { ReactNode } from 'react';
import { ArrowLeft, Check, ChevronDown, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { useC } from '@/components/create/theme';
import { useC as usePlatformC } from '@/lib/theme';

/** Platform colour, plus a soft tint of it for strips and selected chips. */
export function useBrand() {
  const { cta, ctaText } = usePlatformC();
  return { brand: cta, brandText: ctaText, tint: `color-mix(in srgb, ${cta} 12%, transparent)` };
}

export function useFieldStyles() {
  const C = useC();
  return {
    inputStyle: { background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text },
    inputClass: 'w-full rounded-[10px] px-3 py-2 text-sm',
  };
}

export function Field({ label, optional, hint, children }: { label: string; optional?: boolean; hint?: string; children: ReactNode }) {
  const C = useC();
  return (
    <div>
      <label className="text-xs font-medium mb-1.5 block" style={{ color: C.muted }}>
        {label}{optional && <span className="font-normal" style={{ color: C.faint }}> (optional)</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] mt-1.5" style={{ color: C.faint }}>{hint}</p>}
    </div>
  );
}

export function GenerateButton({ label, onClick, disabled, full }: { label: string; onClick: () => void; disabled?: boolean; full?: boolean }) {
  const { brand, brandText } = useBrand();
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40 ${full ? 'w-full py-3.5 mt-1' : 'px-5 py-3 shrink-0'}`}
      style={{ background: brand, color: brandText }}>
      <Sparkles className="w-4 h-4" /> {label}
    </button>
  );
}

/** Step 1: the brief. */
export function BriefPanel({ icon, title, description, onBack, children }: { icon: ReactNode; title: string; description: string; onBack: () => void; children: ReactNode }) {
  const C = useC();
  return (
    <div className="w-full max-w-3xl mx-auto">
      <button type="button" onClick={onBack} className="flex items-center gap-2 text-sm font-medium mb-5 transition-opacity hover:opacity-60" style={{ color: C.muted }}>
        <ArrowLeft className="w-4 h-4" /> Back to dashboard
      </button>
      <div className="rounded-[24px] p-6 sm:p-8" style={{ background: C.card }}>
        <div className="flex items-start gap-4 mb-7">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: C.pill, color: C.muted }}>{icon}</div>
          <div>
            <p className="text-xs mb-0.5" style={{ color: C.faint }}>Step 1 of 2</p>
            <h2 className="text-xl font-semibold tracking-tight" style={{ color: C.text }}>{title}</h2>
            <p className="text-sm mt-1 max-w-xl" style={{ color: C.muted }}>{description}</p>
          </div>
        </div>
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}

/** Pill choices; `multi` options toggle independently. */
export function Chips<K extends string | boolean>({ options, isOn, onPick }: { options: ReadonlyArray<{ key: K; label: string }>; isOn: (k: K) => boolean; onPick: (k: K) => void }) {
  const C = useC();
  const { brand, tint } = useBrand();
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const on = isOn(opt.key);
        return (
          <button key={String(opt.key)} type="button" onClick={() => onPick(opt.key)} aria-pressed={on}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full text-xs transition-colors"
            style={on ? { background: tint, color: brand, fontWeight: 600 } : { background: C.pill, color: C.muted, fontWeight: 500 }}>
            {on && <Check className="w-3 h-3" />}{opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Step 2: header bar with back, title and Generate course. */
export function OutlineHeader({ title, description, onBack, onGenerate, disabled }: { title: string; description: string; onBack: () => void; onGenerate: () => void; disabled?: boolean }) {
  const C = useC();
  return (
    <div className="rounded-[20px] p-4 sm:p-5 mb-5 flex flex-col sm:flex-row sm:items-center gap-4" style={{ background: C.card }}>
      <button type="button" onClick={onBack} className="w-9 h-9 rounded-xl flex items-center justify-center transition-opacity hover:opacity-60 shrink-0" style={{ background: C.pill, color: C.muted }} title="Back to the brief" aria-label="Back to the brief">
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-xs mb-0.5" style={{ color: C.faint }}>Step 2 of 2</p>
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: C.text }}>{title}</h2>
        <p className="text-sm" style={{ color: C.muted }}>{description}</p>
      </div>
      <GenerateButton label="Generate course" onClick={onGenerate} disabled={disabled} />
    </div>
  );
}

export interface OutlineModule { id?: string; title: string; description?: string; lessons?: OutlineLesson[]; [k: string]: any }
export interface OutlineLesson { id?: string; title: string; questionType: string; [k: string]: any }

/** Step 2: the modules, as the course editor draws them. */
export function OutlineModules({ modules, onChange, typeOptions, newLesson, onRegenerate, regenerating }: {
  modules: OutlineModule[];
  onChange: (modules: OutlineModule[]) => void;
  typeOptions: ReadonlyArray<{ value: string; label: string }>;
  newLesson: () => OutlineLesson;
  onRegenerate: (index: number) => void;
  regenerating: number | null;
}) {
  const C = useC();
  const { brand, tint } = useBrand();
  const setModule = (i: number, patch: Partial<OutlineModule>) => onChange(modules.map((m, mi) => (mi === i ? { ...m, ...patch } : m)));
  const setLessons = (i: number, lessons: OutlineLesson[]) => setModule(i, { lessons });

  return (
    <div className="flex flex-col gap-3">
      {modules.map((mod, mi) => {
        const lessons = mod.lessons ?? [];
        return (
          <div key={mod.id || mi} className="rounded-2xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}>
            <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: tint }}>
              <span className="text-[12px] font-bold tracking-[0.08em] uppercase shrink-0" style={{ color: brand }}>Module {mi + 1}:</span>
              <input value={mod.title} onChange={e => setModule(mi, { title: e.target.value })} aria-label={`Module ${mi + 1} name`}
                className="flex-1 min-w-0 bg-transparent border-none outline-none text-[12px] font-bold tracking-[0.08em] uppercase" style={{ color: brand }} />
              <button type="button" onClick={() => onRegenerate(mi)} disabled={regenerating !== null}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg shrink-0 transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: C.card, color: C.muted }}>
                <RefreshCw className={`w-3 h-3 ${regenerating === mi ? 'animate-spin' : ''}`} /> Regenerate
              </button>
              <button type="button" onClick={() => onChange(modules.filter((_, i) => i !== mi))} title="Remove module" aria-label={`Remove module ${mi + 1}`}
                className="p-1 shrink-0 transition-opacity hover:opacity-60" style={{ color: C.faint }}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="px-4 pt-2.5 pb-3">
              <input value={mod.description ?? ''} onChange={e => setModule(mi, { description: e.target.value })} placeholder="Module description" aria-label={`Module ${mi + 1} description`}
                className="w-full bg-transparent border-none outline-none text-xs mb-2" style={{ color: C.muted }} />
              <div className="flex flex-col gap-1.5">
                {lessons.map((lesson, li) => (
                  <div key={lesson.id || li} className="group flex items-center gap-2 rounded-[10px] px-3 py-2" style={{ background: C.input }}>
                    <input value={lesson.title} onChange={e => setLessons(mi, lessons.map((l, i) => (i === li ? { ...l, title: e.target.value } : l)))} aria-label="Lesson title"
                      className="flex-1 min-w-0 bg-transparent border-none outline-none text-sm" style={{ color: C.text }} />
                    <span className="relative shrink-0">
                      <select value={lesson.questionType} onChange={e => setLessons(mi, lessons.map((l, i) => (i === li ? { ...l, questionType: e.target.value } : l)))} aria-label="Lesson type"
                        className="appearance-none rounded-lg pl-2.5 pr-6 py-1 text-[11px] font-semibold cursor-pointer outline-none" style={{ background: C.card, border: `1px solid ${C.inputBorder}`, color: C.text }}>
                        {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.faint }} />
                    </span>
                    <button type="button" onClick={() => setLessons(mi, lessons.filter((_, i) => i !== li))} title="Remove lesson" aria-label="Remove lesson"
                      className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity" style={{ color: C.faint }}>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setLessons(mi, [...lessons, newLesson()])}
                className="flex items-center gap-1 text-xs font-semibold mt-2 px-1 py-1 transition-opacity hover:opacity-80" style={{ color: brand }}>
                <Plus className="w-3 h-3" /> Add lesson
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Step 2: a card beside the modules (dataset, outcomes). */
export function SidePanel({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  const C = useC();
  return (
    <div className="rounded-2xl p-4" style={{ background: C.card }}>
      <h3 className="text-sm font-semibold" style={{ color: C.text }}>{title}</h3>
      {description && <p className="text-xs mt-1" style={{ color: C.muted }}>{description}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

export const newLessonId = () => Math.random().toString(36).slice(2, 9);
