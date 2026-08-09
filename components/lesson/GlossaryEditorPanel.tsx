'use client';

import { useEffect, useRef, useState } from 'react';
import { BookMarked, Check, Trash2, X } from 'lucide-react';

export interface GlossaryDetails {
  definition: string;
  pronunciation: string;
  example: string;
  learnMoreUrl: string;
}

interface GlossaryEditorPanelProps {
  term: string;
  initial: GlossaryDetails;
  dark: boolean;
  accentColor: string;
  canRemove: boolean;
  onSave: (details: GlossaryDetails) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function GlossaryEditorPanel({
  term,
  initial,
  dark,
  accentColor,
  canRemove,
  onSave,
  onRemove,
  onClose,
}: GlossaryEditorPanelProps) {
  const [details, setDetails] = useState(initial);
  const definitionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { definitionRef.current?.focus(); }, []);

  const update = (key: keyof GlossaryDetails, value: string) => {
    setDetails((current) => ({ ...current, [key]: value }));
  };

  const saveDetails = () => {
    if (details.definition.trim()) onSave({
      definition: details.definition.trim(),
      pronunciation: details.pronunciation.trim(),
      example: details.example.trim(),
      learnMoreUrl: details.learnMoreUrl.trim(),
    });
  };

  return (
    <div
      role="group"
      aria-label={`Define ${term || 'selected term'}`}
      className={`lesson-glossary-editor${dark ? ' dark' : ''}`}
      style={{ '--lesson-accent-base': accentColor } as React.CSSProperties}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        event.stopPropagation();
        saveDetails();
      }}
    >
      <div className="lesson-glossary-editor__head">
        <span className="lesson-glossary-editor__icon"><BookMarked width={15} height={15} /></span>
        <span>
          <strong>Define “{term || 'selected term'}”</strong>
          <small>Add context learners can open without leaving the lesson.</small>
        </span>
        <button type="button" className="lesson-glossary-editor__close" onClick={onClose} aria-label="Close glossary editor"><X width={15} height={15} /></button>
      </div>

      <label className="lesson-glossary-editor__field lesson-glossary-editor__field--wide">
        <span>Definition <em>Required</em></span>
        <textarea
          ref={definitionRef}
          rows={2}
          value={details.definition}
          placeholder="Explain the term in plain language…"
          onChange={(event) => update('definition', event.target.value)}
        />
      </label>

      <div className="lesson-glossary-editor__grid">
        <label className="lesson-glossary-editor__field">
          <span>Pronunciation <em>Optional</em></span>
          <input value={details.pronunciation} placeholder="e.g. /ˈdeɪtə/" onChange={(event) => update('pronunciation', event.target.value)} />
        </label>
        <label className="lesson-glossary-editor__field">
          <span>Learn more <em>Optional</em></span>
          <input type="url" value={details.learnMoreUrl} placeholder="https://…" onChange={(event) => update('learnMoreUrl', event.target.value)} />
        </label>
        <label className="lesson-glossary-editor__field lesson-glossary-editor__field--wide">
          <span>Example <em>Optional</em></span>
          <input value={details.example} placeholder="Use the term in context…" onChange={(event) => update('example', event.target.value)} />
        </label>
      </div>

      <div className="lesson-glossary-editor__actions">
        {canRemove ? (
          <button type="button" className="lesson-glossary-editor__remove" onClick={onRemove}><Trash2 width={13} height={13} /> Remove term</button>
        ) : <span />}
        <button type="button" className="lesson-glossary-editor__save" disabled={!details.definition.trim()} onClick={saveDetails}><Check width={14} height={14} /> Save definition</button>
      </div>
    </div>
  );
}
