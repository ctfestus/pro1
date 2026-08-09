'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Link2, Trash2, X } from 'lucide-react';

export interface LinkDetails {
  text: string;
  href: string;
  newTab: boolean;
}

function normalizeLink(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const candidate = /^(https?:|mailto:|tel:)/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

interface LinkEditorPanelProps {
  initial: LinkDetails;
  dark: boolean;
  accentColor: string;
  canRemove: boolean;
  onSave: (details: LinkDetails) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function LinkEditorPanel({ initial, dark, accentColor, canRemove, onSave, onRemove, onClose }: LinkEditorPanelProps) {
  const [text, setText] = useState(initial.text);
  const [href, setHref] = useState(initial.href);
  const [newTab, setNewTab] = useState(initial.newTab);
  const hrefRef = useRef<HTMLInputElement>(null);
  const normalizedHref = useMemo(() => normalizeLink(href), [href]);
  const showInvalid = href.trim().length > 0 && !normalizedHref;

  useEffect(() => { hrefRef.current?.focus(); }, []);

  const applyLink = () => {
    if (text.trim() && normalizedHref) onSave({ text: text.trim(), href: normalizedHref, newTab });
  };

  return (
    <div
      role="group"
      aria-label={canRemove ? 'Edit link' : 'Add link'}
      className={`lesson-link-editor${dark ? ' dark' : ''}`}
      style={{ '--lesson-accent-base': accentColor } as React.CSSProperties}
      onKeyDown={(event) => {
        const target = event.target as HTMLInputElement;
        if (event.key !== 'Enter' || target.type === 'checkbox') return;
        event.preventDefault();
        event.stopPropagation();
        applyLink();
      }}
    >
      <div className="lesson-link-editor__head">
        <span className="lesson-link-editor__icon"><Link2 width={15} height={15} /></span>
        <span><strong>{canRemove ? 'Edit link' : 'Add link'}</strong><small>Connect selected text to a safe destination.</small></span>
        <button type="button" className="lesson-link-editor__close" onClick={onClose} aria-label="Close link editor"><X width={15} height={15} /></button>
      </div>

      <div className="lesson-link-editor__grid">
        <label className="lesson-link-editor__field">
          <span>Display text</span>
          <input value={text} placeholder="Text learners will see" onChange={(event) => setText(event.target.value)} />
        </label>
        <label className="lesson-link-editor__field">
          <span>Destination URL</span>
          <input ref={hrefRef} type="text" inputMode="url" value={href} placeholder="example.com/resource" aria-invalid={showInvalid} onChange={(event) => setHref(event.target.value)} />
          {showInvalid ? <small>Enter a valid web, email, or phone link.</small> : null}
        </label>
      </div>

      <div className="lesson-link-editor__foot">
        <label className="lesson-link-editor__toggle">
          <input type="checkbox" checked={newTab} onChange={(event) => setNewTab(event.target.checked)} />
          <span aria-hidden="true" /> Open in a new tab
        </label>
        <div className="lesson-link-editor__actions">
          {canRemove ? <button type="button" className="lesson-link-editor__remove" onClick={onRemove}><Trash2 width={13} height={13} /> Remove</button> : null}
          <button type="button" className="lesson-link-editor__save" disabled={!text.trim() || !normalizedHref} onClick={applyLink}><Check width={14} height={14} /> Apply link</button>
        </div>
      </div>
    </div>
  );
}
