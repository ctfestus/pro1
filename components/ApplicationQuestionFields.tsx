'use client';

import { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import {
  isQuestionVisible,
  type ApplicationAnswer,
  type ApplicationQuestion,
} from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

export function ApplicationQuestionFields({ questions, answers, onChange, errors = {}, C, uploadToken, ensureUploadToken, previewUploads = false, disabled = false }: {
  questions: ApplicationQuestion[];
  answers: Record<string, ApplicationAnswer>;
  onChange: (answers: Record<string, ApplicationAnswer>) => void;
  errors?: Record<string, string>;
  C: ThemeColors;
  uploadToken?: string;
  ensureUploadToken?: () => Promise<string>;
  previewUploads?: boolean;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<Record<string, string>>({});
  const set = (id: string, value: ApplicationAnswer) => onChange({ ...answers, [id]: value });
  const inputStyle = { width: '100%', background: C.input, color: C.text, border: `1px solid ${C.inputBorder}`, borderRadius: 10, padding: '11px 12px', outline: 'none' };

  async function upload(questionId: string, file: File) {
    if (previewUploads) {
      set(questionId, { url: '#', publicId: 'preview', name: file.name, size: file.size, type: file.type });
      return;
    }
    setUploading(questionId);
    setUploadError(previous => ({ ...previous, [questionId]: '' }));
    try {
      const token = uploadToken || await ensureUploadToken?.();
      if (!token) throw new Error('Enter your email address before uploading a file.');
      const data = new FormData();
      data.set('file', file);
      const response = await fetch(`/api/public/applications/${encodeURIComponent(token)}/upload`, { method: 'POST', body: data });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Upload failed.');
      set(questionId, json.file);
    } catch (error) {
      setUploadError(previous => ({ ...previous, [questionId]: (error as Error).message }));
    } finally {
      setUploading(null);
    }
  }

  return (
    <div className="space-y-6">
      {questions.filter(question => isQuestionVisible(question, answers)).map(question => {
        const value = answers[question.id];
        const error = errors[question.id] || uploadError[question.id];
        return (
          <div key={question.id}>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: C.text }}>
              {question.label}{question.required ? ' *' : ''}
            </label>
            {question.helpText && <p className="text-xs mb-2" style={{ color: C.faint }}>{question.helpText}</p>}

            {question.type === 'long_text' && (
              <textarea disabled={disabled} rows={5} value={String(value ?? '')} placeholder={question.placeholder}
                onChange={event => set(question.id, event.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
            )}
            {['short_text', 'email', 'phone', 'number', 'date'].includes(question.type) && (
              <input disabled={disabled} type={question.type === 'short_text' ? 'text' : question.type === 'phone' ? 'tel' : question.type}
                value={String(value ?? '')} placeholder={question.placeholder}
                onChange={event => set(question.id, question.type === 'number' && event.target.value !== '' ? Number(event.target.value) : event.target.value)} style={inputStyle} />
            )}
            {question.type === 'dropdown' && (
              <select disabled={disabled} value={String(value ?? '')} onChange={event => set(question.id, event.target.value)} style={inputStyle}>
                <option value="">Select an option</option>
                {(question.options ?? []).map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            )}
            {(question.type === 'single_choice' || question.type === 'yes_no') && (
              <div className="space-y-2">
                {(question.type === 'yes_no' ? ['Yes', 'No'] : question.options ?? []).map(option => (
                  <label key={option} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer" style={{ background: C.input, color: C.text }}>
                    <input disabled={disabled} type="radio" name={question.id} checked={value === option} onChange={() => set(question.id, option)} style={{ accentColor: C.cta }} />
                    <span className="text-sm">{option}</span>
                  </label>
                ))}
              </div>
            )}
            {question.type === 'multiple_choice' && (
              <div className="space-y-2">
                {(question.options ?? []).map(option => {
                  const selected = Array.isArray(value) && value.includes(option);
                  return (
                    <label key={option} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 cursor-pointer" style={{ background: C.input, color: C.text }}>
                      <input disabled={disabled} type="checkbox" checked={selected} onChange={() => {
                        const current = Array.isArray(value) ? value.map(String) : [];
                        set(question.id, selected ? current.filter(item => item !== option) : [...current, option]);
                      }} style={{ accentColor: C.cta }} />
                      <span className="text-sm">{option}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {question.type === 'consent' && (
              <label className="flex items-start gap-3 rounded-xl px-3 py-3 cursor-pointer" style={{ background: C.input, color: C.text }}>
                <input disabled={disabled} type="checkbox" checked={value === true} onChange={event => set(question.id, event.target.checked)} className="mt-0.5" style={{ accentColor: C.cta }} />
                <span className="text-sm">I agree</span>
              </label>
            )}
            {question.type === 'file' && (
              <div className="rounded-xl p-3" style={{ background: C.input }}>
                {typeof value === 'object' && value && !Array.isArray(value) && 'url' in value ? (
                  <div className="flex items-center justify-between gap-3">
                    <a href={value.url} target="_blank" rel="noopener noreferrer" className="text-sm underline truncate" style={{ color: C.cta }}>{value.name}</a>
                    {!disabled && <button type="button" onClick={() => set(question.id, null)} className="text-xs" style={{ color: C.deleteText }}>Remove</button>}
                  </div>
                ) : (
                  <label className="flex items-center justify-center gap-2 py-2 cursor-pointer text-sm font-semibold" style={{ color: C.muted }}>
                    {uploading === question.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {uploading === question.id ? 'Uploading...' : 'Choose file (max 10 MB)'}
                    <input disabled={disabled || uploading === question.id} type="file" className="hidden"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.jpg,.jpeg,.png,.webp,.zip"
                      onChange={event => { const file = event.target.files?.[0]; if (file) void upload(question.id, file); event.target.value = ''; }} />
                  </label>
                )}
              </div>
            )}
            {error && <p className="text-xs mt-1.5" style={{ color: C.errorText }}>{error}</p>}
          </div>
        );
      })}
    </div>
  );
}
