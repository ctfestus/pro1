'use client';

// Small pieces of the virtual experience editor used by more than one step: sortable rows,
// the row menu, the rubric builder and the pass mark field.

import React, { useState, useEffect, useRef } from 'react';
import { type ThemeColors } from '@/lib/theme';
import { MoreHorizontal, Plus, X, Upload, GripVertical } from 'lucide-react';
import { RubricFileImportActions } from '@/components/RubricFileImportActions';
import { type RubricImportKind } from '@/lib/rubric-criteria';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export function SortableVEShell({ id, children }: {
  id: string;
  children: (bag: { dragHandle: React.ReactNode; isDragging: boolean }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? {
      opacity: 0.85,
      boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
      borderRadius: 14,
      zIndex: 50,
      position: 'relative',
      outline: '2px solid rgba(173,238,102,0.7)',
    } : {}),
  };
  const dragHandle = (
    <button type="button" {...attributes} {...listeners}
      className="cursor-grab active:cursor-grabbing touch-none flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      style={{ color: '#888' }}>
      <GripVertical className="w-3.5 h-3.5" />
    </button>
  );
  return <div ref={setNodeRef} style={style}>{children({ dragHandle, isDragging })}</div>;
}

// The pass mark of an AI-graded task: 0-100, empty for the task type's default.
export function PassMarkField({ C, value, placeholder, hint, onChange }: {
  C: ThemeColors; value: number | undefined; placeholder: string; hint: string; onChange: (value: number | undefined) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="text-xs font-semibold" style={{ color: C.muted }}>Pass mark</label>
      <input type="number" min={0} max={100} step={5} value={value ?? ''} placeholder={placeholder} aria-label="Pass mark"
        onChange={e => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        className="w-20 outline-none text-[12px] px-2 py-2 rounded-lg" style={{ background: C.input, color: C.text, border: '1.5px solid transparent' }} />
      <span className="text-[11px]" style={{ color: C.muted }}>{hint}</span>
    </div>
  );
}


/** The "..." menu on a milestone, mission or task row: Move to (when there is somewhere to go)
 * and Delete. Keeps the row itself to its title and type. */
export function RowMenu({ C, label, onDelete, moveTargets }: {
  C: ThemeColors;
  label: string;
  onDelete: () => void;
  moveTargets?: { group?: string; label: string; onPick: () => void }[];
}) {
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => { setOpen(false); setMoving(false); };
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const item = 'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors';
  const groups = Array.from(new Set((moveTargets ?? []).map(t => t.group ?? '')));
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setOpen(v => !v); setMoving(false); }}
        className="w-8 h-8 rounded-lg grid place-items-center transition-opacity hover:opacity-70" style={{ color: C.faint }}>
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-9 z-30 min-w-[200px] max-h-72 overflow-auto rounded-xl p-2"
          style={{ background: C.card, boxShadow: `0 0 0 1px ${C.divider}, 0 12px 28px rgba(15,23,42,0.16)` }}>
          {!moving ? (
            <>
              {!!moveTargets?.length && (
                <button type="button" role="menuitem" className={item} style={{ color: C.text }}
                  onMouseEnter={e => (e.currentTarget.style.background = C.input)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  onClick={() => setMoving(true)}>Move to...</button>
              )}
              <button type="button" role="menuitem" className={item} style={{ color: '#dc2626' }}
                onMouseEnter={e => (e.currentTarget.style.background = C.input)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => { setOpen(false); onDelete(); }}>Delete</button>
            </>
          ) : (
            groups.map(g => (
              <div key={g || 'all'}>
                {g && <p className="px-3 pt-2 pb-1 text-xs font-semibold" style={{ color: C.faint }}>{g}</p>}
                {(moveTargets ?? []).filter(t => (t.group ?? '') === g).map((t, i) => (
                  <button key={`${g}-${i}`} type="button" role="menuitem" className={item} style={{ color: C.text }}
                    onMouseEnter={e => (e.currentTarget.style.background = C.input)} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    onClick={() => { setOpen(false); setMoving(false); t.onPick(); }}>{t.label || 'Untitled'}</button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function RubricBuilder({ criteria, onChange, onImport, C, inp, sessionToken, note, sheetNames, grader = 'AI grades each criterion as pass or fail' }: {
  criteria: string[];
  // The requirement's worksheets, so a workbook upload is read the same way the review reads it.
  sheetNames?: string[];
  onChange: (rubric: string[]) => void;
  onImport: (criteria: string[]) => void;
  C: ThemeColors;
  inp: React.CSSProperties;
  sessionToken?: string;
  // Only the review types whose pass gate reads the rubric pass one, so the copy stays true
  // for the types still gated on the AI quality score.
  note?: string;
  // Who marks the criteria, shown beside the heading.
  grader?: string;
}) {
  const [draft, setDraft] = useState('');
  const [extracting, setExtracting] = useState<RubricImportKind | null>(null);
  const [extractError, setExtractError] = useState('');

  const add = () => {
    const val = draft.trim();
    if (!val) return;
    onChange([...criteria, val]);
    setDraft('');
  };

  const handleFile = async (label: RubricImportKind, file: File) => {
    if (!file || !sessionToken) return;
    setExtracting(label);
    setExtractError('');
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('label', label);
      form.append('reviewSheetNames', JSON.stringify(sheetNames ?? []));
      const res = await fetch('/api/extract-rubric', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Rubric import failed.');
      if (!json.criteria?.length) throw new Error('No rubric criteria were found in this file.');
      onImport(json.criteria);
    } catch (error: any) {
      setExtractError(error?.message || 'Rubric import failed. Please try again.');
    } finally {
      setExtracting(null);
    }
  };

  return (
    <div className="space-y-2" style={{ background: 'transparent' }}>
      <p className="text-xs font-semibold" style={{ color: C.muted }}>
        Grading rubric
        <span className="ml-2 font-normal" style={{ color: C.faint }}>
          (optional) {grader}
        </span>
      </p>
      {note && <p className="text-[11px]" style={{ color: C.faint }}>{note}</p>}
      {sessionToken && (
        <div className="space-y-2">
          <RubricFileImportActions
            busy={extracting}
            background={C.card}
            color={C.muted}
            border={`1px solid ${C.inputBorder}`}
            onSelect={handleFile}
          />
          <p className="text-[11px]" style={{ color: C.faint }}>
            Upload completed work or your own rubric file to set the criteria.
          </p>
          {extractError && <p className="text-[11px]" style={{ color: '#ef4444' }}>{extractError}</p>}
        </div>
      )}
      {criteria.map((crit, ci) => (
        <div key={ci} className="flex items-center gap-2 rounded-lg px-3 py-2"
          style={{ background: C.pill }}>
          <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: C.card }}>
            <span className="text-[11px] font-black" style={{ color: C.muted }}>{ci + 1}</span>
          </div>
          <input
            className="flex-1 bg-transparent text-[12px] outline-none"
            style={{ color: C.text }}
            value={crit}
            onChange={e => { const next = [...criteria]; next[ci] = e.target.value; onChange(next); }}
          />
          <button onClick={() => onChange(criteria.filter((_, j) => j !== ci))}
            className="hover:text-red-400 flex-shrink-0 transition-colors" style={{ color: C.faint }}>
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          style={{ ...inp, background: C.card, fontSize: 12, padding: '6px 10px' }}
          placeholder="e.g. Must include a KPI row with at least 3 metrics"
        />
        <button onClick={add} disabled={!draft.trim()}
          className="flex items-center gap-1 px-3 rounded-xl text-[12px] font-semibold flex-shrink-0 transition-all hover:opacity-80 disabled:opacity-40"
          style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>
      {criteria.length === 0 && (
        <p className="text-[11px]" style={{ color: C.faint }}>
          No criteria yet. AI will use its default standards. Add criteria to grade against your specific assignment requirements.
        </p>
      )}
    </div>
  );
}
