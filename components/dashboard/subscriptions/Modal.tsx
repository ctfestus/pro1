'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { modalStyle, type ThemeColors } from '@/lib/theme';
import { DISPLAY_FONT } from './ui';

export const FIELD = 'field-focus w-full rounded-[10px] px-3 py-3 text-sm outline-none transition-shadow';
export const NUMBER_FIELD = `${FIELD} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`;
export const BUTTON = 'inline-flex items-center justify-center gap-2 h-10 rounded-xl px-4 text-sm font-semibold whitespace-nowrap transition-opacity hover:opacity-90 disabled:opacity-50';
export const inputStyle = (C: ThemeColors) => ({ background: C.input, color: C.text, border: `1px solid ${C.inputBorder}` });

export function Modal({ title, eyebrow, onClose, C, children, error, wide = false }: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  C: ThemeColors;
  children: ReactNode;
  error?: string;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6"
      style={{ background: 'rgba(4,8,20,0.68)', backdropFilter: 'blur(10px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`w-full ${wide ? 'max-w-4xl' : 'max-w-xl'} max-h-[92vh] overflow-hidden rounded-[20px] flex flex-col`}
        style={modalStyle(C)}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <div className="min-w-0">
            <h3 className="text-[22px] font-semibold leading-7" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h3>
            {eyebrow && <p className="text-sm mt-1" style={{ color: C.muted }}>{eyebrow}</p>}
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0 transition-opacity hover:opacity-70"
            style={{ background: C.pill }}
            aria-label="Close"
          >
            <X className="w-4 h-4" style={{ color: C.muted }} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {error && (
            <div className="rounded-xl px-4 py-3 mb-4 text-sm" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
              {error}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}

/** Asked when a plan pop-up closes with edits not yet saved. */
export function UnsavedChangesDialog({ creating, busy, canSave, onDiscard, onKeepEditing, onSave, C }: {
  creating: boolean;
  busy: boolean;
  canSave: boolean;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onSave: () => void;
  C: ThemeColors;
}) {
  return (
    <Modal title="Save your changes?" eyebrow="This plan has changes that are not saved yet" onClose={onKeepEditing} C={C}>
      <p className="text-sm leading-relaxed" style={{ color: C.muted }}>
        {creating
          ? 'Save this setup as a draft so you can continue later, or discard it permanently.'
          : 'Save the updates to this plan, or discard the changes you just made.'}
      </p>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
        <button type="button" onClick={onDiscard} disabled={busy} className={BUTTON} style={{ background: C.deleteBg, color: C.deleteText }}>
          Discard changes
        </button>
        <button type="button" onClick={onKeepEditing} disabled={busy} className={BUTTON} style={{ background: C.pill, color: C.text }}>
          Keep editing
        </button>
        <button type="button" onClick={onSave} disabled={busy || !canSave} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
          {creating ? 'Save draft' : 'Save changes'}
        </button>
      </div>
    </Modal>
  );
}

/** Details in a panel from the right: a title, one line under it, and the content. */
export function SidePanel({ title, sub, onClose, children, C }: { title: string; sub: string; onClose: () => void; children: ReactNode; C: ThemeColors }) {
  return (
    <div className="fixed inset-0 z-[80] flex justify-end" style={{ background: 'rgba(4,8,20,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-xl h-full overflow-y-auto" style={{ background: C.card }}>
        <div className="flex items-start gap-3 px-6 py-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <div className="min-w-0 flex-1">
            <h3 className="text-[22px] leading-7 font-semibold truncate" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{title}</h3>
            <p className="text-sm" style={{ color: C.muted }}>{sub}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0" style={{ background: C.pill, color: C.muted }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
