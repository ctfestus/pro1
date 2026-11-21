'use client';

// Shared pieces of the AI course generators on /create (SQL, Python, document): the brief
// (step 1) and the outline review (step 2). The dashboard style: the admin header with its
// button top right, one card with flat sections, and the shared blue only on buttons and
// selection controls.

import { useMemo, type ReactNode } from 'react';
import { ArrowLeft, Check, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { DARK_C, useC, type ThemeColors } from '@/lib/theme';
import { MenuSelect } from '@/components/MenuSelect';
import { FIELD } from '@/components/dashboard/subscriptions/Modal';
import { Card, DISPLAY_FONT, Pill, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';

/** The dashboard theme with the shared blue, as on the other editors. */
export function useStarterC(): ThemeColors {
  const theme = useC();
  return useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
}

export function useFieldStyles() {
  const C = useStarterC();
  return {
    inputStyle: { background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text },
    inputClass: FIELD,
  };
}

export function Field({ label, optional, hint, children }: { label: string; optional?: boolean; hint?: string; children: ReactNode }) {
  const C = useStarterC();
  return (
    <div>
      <label className="text-xs font-semibold mb-2 block" style={{ color: C.muted }}>
        {label}{optional && <span className="font-normal" style={{ color: C.faint }}> (optional)</span>}
      </label>
      {children}
      {hint && <p className="text-xs mt-2" style={{ color: C.muted }}>{hint}</p>}
    </div>
  );
}

/** One flat section of a card: a sentence-case heading, an optional aside, then the content. */
export function Sect({ title, aside, action, first, children }: { title: ReactNode; aside?: ReactNode; action?: ReactNode; first?: boolean; children?: ReactNode }) {
  const C = useStarterC();
  return (
    <div className="p-5 grid gap-4" style={first ? undefined : { borderTop: `1px solid ${C.divider}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold flex-1 min-w-[12rem]" style={{ color: C.text }}>{title}</h3>
        {aside && <span className="text-xs" style={{ color: C.muted }}>{aside}</span>}
        {action}
      </div>
      {children}
    </div>
  );
}

/** Back link, title with the step pill, the Generate button top right, then the subtitle. */
function StarterHeader({ back, onBack, title, step, description, generateLabel, onGenerate, disabled }: {
  back: string; onBack: () => void; title: string; step: string; description: string; generateLabel: string; onGenerate: () => void; disabled?: boolean;
}) {
  const C = useStarterC();
  return (
    <>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-[13px] font-semibold mb-3 hover:opacity-80" style={{ color: C.muted }}>
        <ArrowLeft className="w-4 h-4" /> {back}
      </button>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 md:flex-1">
          <h1 className="text-[28px] leading-9 font-semibold break-words" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h1>
          <div className="mt-2"><Pill tone="mute" C={C}>{step}</Pill></div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:flex-shrink-0">
          <button type="button" onClick={onGenerate} disabled={disabled} className={btnClass} style={btnStyle('pri', C)}>
            <Sparkles className="w-4 h-4" /> {generateLabel}
          </button>
        </div>
      </div>
      <p className="text-sm mt-3" style={{ color: C.muted }}>{description}</p>
    </>
  );
}

/** Step 1: the brief. Children are the card's sections. */
export function BriefPanel({ title, description, onBack, onGenerate, disabled, children }: {
  title: string; description: string; onBack: () => void; onGenerate: () => void; disabled?: boolean; children: ReactNode;
}) {
  const C = useStarterC();
  return (
    <div className="w-full max-w-3xl mx-auto">
      <StarterHeader back="All courses" onBack={onBack} title={title} step="Step 1 of 2" description={description}
        generateLabel="Generate outline" onGenerate={onGenerate} disabled={disabled} />
      <Card C={C} className="mt-4">{children}</Card>
    </div>
  );
}

/** Pill choices; `multi` options toggle independently. */
export function Chips<K extends string | boolean>({ options, isOn, onPick }: { options: ReadonlyArray<{ key: K; label: string }>; isOn: (k: K) => boolean; onPick: (k: K) => void }) {
  const C = useStarterC();
  const P = palette(C);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map(opt => {
        const on = isOn(opt.key);
        return (
          <button key={String(opt.key)} type="button" onClick={() => onPick(opt.key)} aria-pressed={on}
            className="flex items-center gap-1 h-8 px-3 rounded-full text-xs font-semibold transition-colors"
            style={on ? { background: P.sel, color: P.onSel } : { background: C.pill, color: C.muted }}>
            {on && <Check className="w-3 h-3" />}{opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Step 2: back to the brief, the title with the step pill, and Generate course. */
export function OutlineHeader({ title, description, onBack, onGenerate, disabled }: { title: string; description: string; onBack: () => void; onGenerate: () => void; disabled?: boolean }) {
  return (
    <div className="mb-4">
      <StarterHeader back="Back to the brief" onBack={onBack} title={title} step="Step 2 of 2" description={description}
        generateLabel="Generate course" onGenerate={onGenerate} disabled={disabled} />
    </div>
  );
}

export interface OutlineModule { id?: string; title: string; description?: string; lessons?: OutlineLesson[]; [k: string]: any }
export interface OutlineLesson { id?: string; title: string; questionType: string; [k: string]: any }

/** Step 2: the modules, one section each inside a single card. */
export function OutlineModules({ modules, onChange, typeOptions, newLesson, onRegenerate, regenerating }: {
  modules: OutlineModule[];
  onChange: (modules: OutlineModule[]) => void;
  typeOptions: ReadonlyArray<{ value: string; label: string }>;
  newLesson: () => OutlineLesson;
  onRegenerate: (index: number) => void;
  regenerating: number | null;
}) {
  const C = useStarterC();
  const P = palette(C);
  const fieldStyle = { background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text };
  const onSoft = { ...fieldStyle, background: C.card };
  const setModule = (i: number, patch: Partial<OutlineModule>) => onChange(modules.map((m, mi) => (mi === i ? { ...m, ...patch } : m)));
  const setLessons = (i: number, lessons: OutlineLesson[]) => setModule(i, { lessons });
  const iconBtn = 'w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0';

  return (
    <Card C={C}>
      {modules.map((mod, mi) => {
        const lessons = mod.lessons ?? [];
        return (
          <Sect key={mod.id || mi} first={mi === 0}
            title={(
              <span className="flex items-center gap-1">
                <span className="flex-shrink-0">Module {mi + 1}:</span>
                <input value={mod.title} onChange={e => setModule(mi, { title: e.target.value })} aria-label={`Module ${mi + 1} name`}
                  className="flex-1 min-w-0 bg-transparent border-none outline-none font-semibold" style={{ color: C.text }} />
              </span>
            )}
            action={(
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => onRegenerate(mi)} disabled={regenerating !== null} className={btnSmClass} style={btnStyle('sec', C)}>
                  <RefreshCw className={`w-3.5 h-3.5 ${regenerating === mi ? 'animate-spin' : ''}`} /> Regenerate
                </button>
                <button type="button" onClick={() => onChange(modules.filter((_, i) => i !== mi))} title="Remove module" aria-label={`Remove module ${mi + 1}`}
                  className={iconBtn} style={{ background: P.badSoft, color: P.bad }}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}>
            <div>
              <label className="text-xs font-semibold mb-2 block" style={{ color: C.muted }}>Module description</label>
              <input value={mod.description ?? ''} onChange={e => setModule(mi, { description: e.target.value })} placeholder="What this module covers" aria-label={`Module ${mi + 1} description`}
                className={FIELD} style={fieldStyle} />
            </div>
            {lessons.length > 0 && (
              <div className="grid gap-2">
                {lessons.map((lesson, li) => (
                  <div key={lesson.id || li} className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3 rounded-xl px-3 py-2" style={{ background: C.page }}>
                    <span className="w-7 h-7 rounded-full grid place-items-center text-xs font-bold flex-shrink-0" style={{ background: P.sel, color: P.onSel }}>{li + 1}</span>
                    <input value={lesson.title} onChange={e => setLessons(mi, lessons.map((l, i) => (i === li ? { ...l, title: e.target.value } : l)))} aria-label="Lesson title"
                      className={`${FIELD} flex-1 min-w-0 !w-auto`} style={onSoft} />
                    <div className="order-last w-full sm:order-none sm:w-44 flex-shrink-0">
                      <MenuSelect field label="Lesson type" C={{ ...C, input: C.card }} value={lesson.questionType}
                        onChange={v => setLessons(mi, lessons.map((l, i) => (i === li ? { ...l, questionType: v } : l)))}
                        options={typeOptions.map(t => ({ value: t.value, label: t.label }))} />
                    </div>
                    <button type="button" onClick={() => setLessons(mi, lessons.filter((_, i) => i !== li))} title="Remove lesson" aria-label="Remove lesson"
                      className={iconBtn} style={{ background: P.badSoft, color: P.bad }}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div>
              <button type="button" onClick={() => setLessons(mi, [...lessons, newLesson()])} className={btnSmClass} style={btnStyle('sec', C)}>
                <Plus className="w-3.5 h-3.5" /> Add lesson
              </button>
            </div>
          </Sect>
        );
      })}
    </Card>
  );
}

/** Step 2: a card beside the modules (dataset, outcomes). */
export function SidePanel({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  const C = useStarterC();
  return (
    <Card C={C}>
      <Sect title={title} first>
        {description && <p className="text-xs -mt-2" style={{ color: C.muted }}>{description}</p>}
        {children}
      </Sect>
    </Card>
  );
}

export const newLessonId = () => Math.random().toString(36).slice(2, 9);
