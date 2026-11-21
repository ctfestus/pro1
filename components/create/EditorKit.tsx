'use client';

// Shared pieces for the short single-card editors under /create (announcement, promotion,
// schedule, recording, community): the admin header, flat sections, switch rows, tick rows
// and the cover picker. They follow the certification and product editors' dashboard style.

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ImagePlus, Trash2, X, XCircle } from 'lucide-react';
import { DARK_C, useC, type ThemeColors } from '@/lib/theme';
import { ImageLibrary } from '@/components/ImageLibrary';
import { Tick } from '@/components/dashboard/cohorts/CohortModals';
import { FIELD, inputStyle } from '@/components/dashboard/subscriptions/Modal';
import { Switch } from '@/components/dashboard/subscriptions/PlanForm';
import { DISPLAY_FONT, btnSmClass, btnStyle } from '@/components/dashboard/subscriptions/ui';

/** The dashboard theme with the shared blue on buttons and selection controls. */
export function useEditorC(): ThemeColors {
  const theme = useC();
  return useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
}

export { FIELD, inputStyle };

export function EditorHeader({ C, back, onBack, title, pill, actions, error, onDismissError, children }: {
  C: ThemeColors; back: string; onBack: () => void; title: string; pill?: ReactNode; actions: ReactNode;
  error?: string; onDismissError?: () => void; children?: ReactNode;
}) {
  return (
    <>
      <button type="button" onClick={onBack} className="inline-flex items-center gap-2 text-[13px] font-semibold mb-3 hover:opacity-80" style={{ color: C.muted }}>
        <ArrowLeft className="w-4 h-4" /> {back}
      </button>
      {/* Buttons stay at the top right; a long name wraps instead of pushing them down. */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 md:flex-1">
          <h1 className="text-[28px] leading-9 font-semibold break-words" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h1>
          {pill && <div className="mt-2">{pill}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2 md:flex-nowrap md:flex-shrink-0">{actions}</div>
      </div>
      {children}
      {error && (
        <div role="alert" className="mt-4 rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          <XCircle className="w-4 h-4 flex-shrink-0" /><span className="flex-1">{error}</span>
          {onDismissError && (
            <button type="button" onClick={onDismissError} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4" /></button>
          )}
        </div>
      )}
    </>
  );
}

/** One flat section of the editor card: a sentence-case heading, an optional count or action, then the fields. */
export function Sect({ title, aside, action, first, children, C }: {
  title: string; aside?: string; action?: ReactNode; first?: boolean; children: ReactNode; C: ThemeColors;
}) {
  return (
    <div className="p-5 grid gap-4 min-w-0" style={first ? undefined : { borderTop: `1px solid ${C.divider}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold flex-1" style={{ color: C.text }}>{title}</h3>
        {aside && <span className="text-xs" style={{ color: C.muted }}>{aside}</span>}
        {action}
      </div>
      {children}
    </div>
  );
}

export function Label({ C, children }: { C: ThemeColors; children: ReactNode }) {
  return <label className="block text-xs font-semibold mb-2" style={{ color: C.muted }}>{children}</label>;
}

export function Hint({ C, children, tone }: { C: ThemeColors; children: ReactNode; tone?: string }) {
  return <p className="text-xs mt-1.5" style={{ color: tone ?? C.muted }}>{children}</p>;
}

export function SwitchRow({ C, title, sub, on, onChange }: { C: ThemeColors; title: string; sub: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold" style={{ color: C.text }}>{title}</p>
        <p className="text-xs mt-0.5" style={{ color: C.muted }}>{sub}</p>
      </div>
      <Switch on={on} onChange={onChange} label={title} C={C} />
    </div>
  );
}

/** A list of ticks, each a full-width row; `sub` and `extra` are optional per row. */
export function TickList({ C, items, selected, onToggle }: {
  C: ThemeColors; items: { id: string; name: string; sub?: string; extra?: string }[]; selected: string[]; onToggle: (id: string) => void;
}) {
  return (
    <div>
      {items.map((it, i) => {
        const on = selected.includes(it.id);
        return (
          <button key={it.id} type="button" role="checkbox" aria-checked={on} onClick={() => onToggle(it.id)}
            className="w-full flex items-start gap-3 px-1 py-3 text-left" style={{ borderTop: i ? `1px solid ${C.divider}` : undefined }}>
            <span className="mt-px"><Tick on={on} C={C} /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold" style={{ color: C.text }}>{it.name}</span>
              {it.sub && <span className="block text-xs mt-0.5" style={{ color: C.muted }}>{it.sub}</span>}
            </span>
            {it.extra && <span className="text-xs" style={{ color: C.muted }}>{it.extra}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Cover picker: the shared image library (pick or upload), plus a field for pasting a link. */
export function CoverField({ C, value, onChange, label, placeholder = 'Select or upload a cover image' }: {
  C: ThemeColors; value: string; onChange: (url: string) => void; label?: string; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const url = value.trim();
  return (
    <div className="max-w-md">
      {label && <Label C={C}>{label}</Label>}
      {url ? (
        <div className="relative w-full h-40 rounded-xl overflow-hidden" style={{ background: C.input }}>
          <img src={url} alt="" className="w-full h-full object-cover" onError={e => ((e.target as HTMLImageElement).style.display = 'none')} />
          <div className="absolute top-2 right-2 flex gap-2">
            <button type="button" onClick={() => setOpen(true)} className={btnSmClass} style={btnStyle('sec', C)}><ImagePlus className="w-3.5 h-3.5" /> Change</button>
            <button type="button" onClick={() => onChange('')} className={btnSmClass} style={btnStyle('danger', C)}><Trash2 className="w-3.5 h-3.5" /> Remove</button>
          </div>
        </div>
      ) : (
        <>
          <button type="button" onClick={() => setOpen(true)} className="w-full rounded-xl px-3 py-6 flex flex-col items-center justify-center gap-2 hover:opacity-80"
            style={{ background: C.input, border: `1.5px dashed ${C.inputBorder}` }}>
            <ImagePlus className="w-5 h-5" style={{ color: C.muted }} />
            <span className="text-xs" style={{ color: C.muted }}>{placeholder}</span>
          </button>
          <input type="url" value={value} onChange={e => onChange(e.target.value)} placeholder="Or paste an image link"
            aria-label="Image link" className={`${FIELD} mt-2`} style={inputStyle(C)} />
        </>
      )}
      {open && <ImageLibrary uploadFolder="covers" initialFolder="covers" onSelect={v => onChange(v)} onClose={() => setOpen(false)} />}
    </div>
  );
}
