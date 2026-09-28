'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Check, ChevronDown, FileCheck2, Loader2, Upload } from 'lucide-react';
import {
  isQuestionVisible,
  type ApplicationAnswer,
  type ApplicationQuestion,
} from '@/lib/application-forms';
import { sanitizeRichText } from '@/lib/sanitize';
import { supabase } from '@/lib/supabase';
import type { ThemeColors } from '@/lib/theme';

function ApplicationDropdown({ questionId, value, options, onChange, C, disabled, autoFocus }: {
  questionId: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  C: ThemeColors;
  disabled: boolean;
  autoFocus: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedIndex = options.indexOf(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedIndex));
  const listboxId = `${questionId}-options`;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  function showMenu() {
    if (disabled || options.length === 0) return;
    setActiveIndex(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function choose(option: string) {
    onChange(option);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || options.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        showMenu();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(current => (current + direction + options.length) % options.length);
      return;
    }
    if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End' && open) {
      event.preventDefault();
      setActiveIndex(Math.max(0, options.length - 1));
      return;
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      if (options[activeIndex]) choose(options[activeIndex]);
    }
  }

  return (
    <div ref={rootRef} className="relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button
        type="button"
        role="combobox"
        autoFocus={autoFocus}
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? `${questionId}-option-${activeIndex}` : undefined}
        onClick={() => open ? setOpen(false) : showMenu()}
        onKeyDown={handleKeyDown}
        className="application-dropdown-trigger flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left text-sm outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: C.input, color: value ? C.text : C.faint, border: `1px solid ${open ? C.cta : C.inputBorder}`, borderRadius: 10 }}
      >
        <span className="min-w-0 flex-1 truncate">{value || (options.length > 0 ? 'Select an option' : 'No options configured')}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} style={{ color: open ? C.cta : C.faint }} />
      </button>

      {open && options.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Options"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-64 overflow-y-auto rounded-lg border p-1.5"
          style={{ background: C.card, borderColor: C.inputBorder, boxShadow: '0 18px 45px rgba(0, 0, 0, 0.20)', color: C.text }}
        >
          {options.map((option, index) => {
            const selected = option === value;
            const active = index === activeIndex;
            return (
              <button
                key={`${option}-${index}`}
                id={`${questionId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors"
                style={{ background: selected || active ? C.page : C.card, color: C.text }}
              >
                <span className="min-w-0 flex-1 truncate">{option}</span>
                {selected && <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ background: C.cta, color: '#FFFFFF' }}><Check className="h-3 w-3" strokeWidth={3} /></span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ApplicationQuestionFields({ questions, answers, onChange, errors = {}, C, uploadToken, ensureUploadToken, previewUploads = false, disabled = false, startAt = 2, focused = false, autoFocus = false }: {
  questions: ApplicationQuestion[];
  answers: Record<string, ApplicationAnswer>;
  onChange: (answers: Record<string, ApplicationAnswer>) => void;
  errors?: Record<string, string>;
  C: ThemeColors;
  uploadToken?: string;
  ensureUploadToken?: () => Promise<string>;
  previewUploads?: boolean;
  disabled?: boolean;
  startAt?: number;
  focused?: boolean;
  autoFocus?: boolean;
}) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<Record<string, string>>({});
  const visibleQuestions = questions.filter(question => isQuestionVisible(question, answers));
  const set = (id: string, value: ApplicationAnswer) => onChange({ ...answers, [id]: value });
  const inputStyle: CSSProperties = {
    width: '100%',
    background: C.input,
    color: C.text,
    border: `1px solid ${C.inputBorder}`,
    borderRadius: 10,
    padding: '13px 14px',
    outline: 'none',
  };

  async function upload(questionId: string, file: File) {
    if (previewUploads) {
      set(questionId, { url: '#', publicId: 'supabase/preview', name: file.name, size: file.size, type: file.type });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError(previous => ({ ...previous, [questionId]: 'Files must be 10 MB or smaller.' }));
      return;
    }
    setUploading(questionId);
    setUploadError(previous => ({ ...previous, [questionId]: '' }));
    try {
      const token = uploadToken || await ensureUploadToken?.();
      if (!token) throw new Error('Enter your email address before uploading a file.');
      const response = await fetch(`/api/public/applications/${encodeURIComponent(token)}/upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId, name: file.name, size: file.size, type: file.type }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Upload failed.');
      const uploaded = await supabase.storage.from(json.bucket).uploadToSignedUrl(json.path, json.uploadToken, file, {
        contentType: file.type || 'application/octet-stream',
      });
      if (uploaded.error) throw new Error(uploaded.error.message || 'Upload failed.');
      set(questionId, { ...json.file, url: URL.createObjectURL(file) });
    } catch (error) {
      setUploadError(previous => ({ ...previous, [questionId]: (error as Error).message }));
    } finally {
      setUploading(null);
    }
  }

  function optionStyle(selected: boolean): CSSProperties {
    return {
      background: C.input,
      color: C.text,
      border: `1px solid ${selected ? C.cta : C.inputBorder}`,
      borderRadius: 10,
    };
  }

  return (
    <div className="space-y-4">
      {visibleQuestions.map((question, index) => {
        const value = answers[question.id];
        const error = errors[question.id] || uploadError[question.id];
        const isTextBlock = question.type === 'text_block';
        return (
          <section key={question.id} className={focused ? '' : 'rounded-2xl p-5 sm:p-6'} style={focused ? undefined : { background: C.card, boxShadow: error ? `inset 4px 0 0 ${C.errorText}` : 'none' }}>
            {!focused && <div className="mb-4 flex items-start gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-xs font-bold" style={{ background: error ? C.errorBg : C.pill, color: error ? C.errorText : C.muted }}>{startAt + index}</span>
              <div className="min-w-0 flex-1">
                <label className="block text-sm font-semibold leading-6 sm:text-base" style={{ color: C.text }}>
                  {question.label}{question.required && <span className="ml-1" style={{ color: C.errorText }}>*</span>}
                </label>
                {question.helpText && <p className="mt-1 text-xs leading-5" style={{ color: C.faint }}>{question.helpText}</p>}
              </div>
              {!isTextBlock && !question.required && <span className="shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold" style={{ background: C.pill, color: C.faint }}>Optional</span>}
            </div>}

            {isTextBlock && <div className="application-rich-content rich-content" style={{ color: C.muted }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(question.richText ?? '') }} />}

            {question.type === 'long_text' && (
              <textarea autoFocus={autoFocus} disabled={disabled} rows={5} value={String(value ?? '')} placeholder={question.placeholder || 'Type your answer'} onChange={event => set(question.id, event.target.value)} style={{ ...inputStyle, resize: 'vertical', minHeight: 132 }} />
            )}

            {['short_text', 'email', 'phone', 'number', 'date'].includes(question.type) && (
              <input
                disabled={disabled}
                autoFocus={autoFocus}
                type={question.type === 'short_text' ? 'text' : question.type === 'phone' ? 'tel' : question.type}
                value={String(value ?? '')}
                placeholder={question.placeholder || 'Type your answer'}
                onChange={event => set(question.id, question.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)}
                style={inputStyle}
              />
            )}

            {question.type === 'dropdown' && (
              <ApplicationDropdown questionId={question.id} value={String(value ?? '')} options={question.options ?? []} onChange={next => set(question.id, next)} C={C} disabled={disabled} autoFocus={autoFocus} />
            )}

            {(question.type === 'single_choice' || question.type === 'yes_no') && (
              <div className={question.type === 'yes_no' ? 'grid grid-cols-2 gap-2.5' : 'grid gap-2.5'}>
                {(question.type === 'yes_no' ? ['Yes', 'No'] : question.options ?? []).map((option, optionIndex) => {
                  const selected = value === option;
                  return (
                    <label key={option} onMouseEnter={event => { event.currentTarget.style.background = C.page; }} onMouseLeave={event => { event.currentTarget.style.background = C.input; }} className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 transition-colors" style={optionStyle(selected)}>
                      <input autoFocus={autoFocus && optionIndex === 0} className="sr-only" disabled={disabled} type="radio" name={question.id} checked={selected} onChange={() => set(question.id, option)} />
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full" style={{ border: `2px solid ${selected ? C.cta : C.inputBorder}`, background: selected ? C.cta : C.card }}>
                        {selected && <span className="h-2 w-2 rounded-full" style={{ background: '#FFFFFF' }} />}
                      </span>
                      <span className="text-sm font-medium">{option}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {question.type === 'multiple_choice' && (
              <div className="grid gap-2.5">
                {(question.options ?? []).map((option, optionIndex) => {
                  const selected = Array.isArray(value) && value.includes(option);
                  return (
                    <label key={option} onMouseEnter={event => { event.currentTarget.style.background = C.page; }} onMouseLeave={event => { event.currentTarget.style.background = C.input; }} className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3 transition-colors" style={optionStyle(selected)}>
                      <input autoFocus={autoFocus && optionIndex === 0} className="sr-only" disabled={disabled} type="checkbox" checked={selected} onChange={() => {
                        const current = Array.isArray(value) ? value.map(String) : [];
                        set(question.id, selected ? current.filter(item => item !== option) : [...current, option]);
                      }} />
                      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ border: `2px solid ${selected ? C.cta : C.inputBorder}`, background: selected ? C.cta : C.card }}>
                        {selected && <Check className="h-3 w-3" strokeWidth={3} style={{ color: '#FFFFFF' }} />}
                      </span>
                      <span className="text-sm font-medium">{option}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {question.type === 'consent' && (
              <label onMouseEnter={event => { event.currentTarget.style.background = C.page; }} onMouseLeave={event => { event.currentTarget.style.background = C.input; }} className="flex cursor-pointer items-start gap-3 px-4 py-4 transition-colors" style={optionStyle(value === true)}>
                <input autoFocus={autoFocus} className="sr-only" disabled={disabled} type="checkbox" checked={value === true} onChange={event => set(question.id, event.target.checked)} />
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md" style={{ border: `2px solid ${value === true ? C.cta : C.inputBorder}`, background: value === true ? C.cta : C.card }}>
                  {value === true && <Check className="h-3 w-3" strokeWidth={3} style={{ color: '#FFFFFF' }} />}
                </span>
                <span className="text-sm leading-5">I agree and give my consent.</span>
              </label>
            )}

            {question.type === 'file' && (
              <div className="rounded-lg p-4" style={{ background: C.input, border: `1px dashed ${error ? C.errorText : C.inputBorder}` }}>
                {typeof value === 'object' && value && !Array.isArray(value) && 'url' in value ? (
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: C.pill, color: C.cta }}><FileCheck2 className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">{value.url && value.url !== '#' ? <a href={value.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-semibold" style={{ color: C.text }}>{value.name}</a> : <span className="block truncate text-sm font-semibold" style={{ color: C.text }}>{value.name}</span>}<p className="mt-0.5 text-[11px]" style={{ color: C.faint }}>File ready</p></div>
                    {!disabled && <button type="button" onClick={() => set(question.id, null)} className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: C.card, color: C.deleteText }}>Remove</button>}
                  </div>
                ) : (
                  <label className="flex cursor-pointer flex-col items-center justify-center gap-2 py-4 text-center">
                    <span className="grid h-10 w-10 place-items-center rounded-xl" style={{ background: C.card, color: C.cta }}>{uploading === question.id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}</span>
                    <span className="text-sm font-semibold" style={{ color: C.text }}>{uploading === question.id ? 'Uploading...' : 'Choose a file'}</span>
                    <span className="text-[11px]" style={{ color: C.faint }}>PDF, Office files, images, text, or ZIP up to 10 MB</span>
                    <input disabled={disabled || uploading === question.id} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.zip" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(question.id, file); event.target.value = ''; }} />
                  </label>
                )}
              </div>
            )}

            {error && <p className="mt-3 text-xs font-medium" style={{ color: C.errorText }}>{error}</p>}
          </section>
        );
      })}
    </div>
  );
}
