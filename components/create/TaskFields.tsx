'use client';

// Per-type editor fields for ONE task inside a scenario (used by ScenariosEditor).
// Written response / file upload need only a title + rich prompt; MCQ adds options and a
// correct answer; the AI-review types add a rubric (with reference-solution extraction),
// plus type-specific settings that mirror the review players' props.

import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/ThemeProvider';
import { LessonEditor } from '@/components/lesson/LessonEditorLazy';
import { LIGHT_C } from '@/lib/theme';
import { Plus, X, Upload, Loader2, Check } from 'lucide-react';
import type { AssignmentTask } from '@/lib/assignment-scenarios';
import { isAiTaskType } from '@/lib/assignment-scenarios';

function inputStyle(C: typeof LIGHT_C): React.CSSProperties {
  return { width: '100%', minHeight: 44, padding: '10px 13px', borderRadius: 11, border: `1px solid ${C.cardBorder}`, background: C.card, color: C.text, fontSize: 13, outline: 'none' };
}
function textareaStyle(C: typeof LIGHT_C): React.CSSProperties {
  return { ...inputStyle(C), minHeight: 104, resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' };
}
function labelStyle(C: typeof LIGHT_C): React.CSSProperties {
  return { display: 'block', fontSize: 12, fontWeight: 750, color: C.muted, marginBottom: 7 };
}
function hintStyle(C: typeof LIGHT_C): React.CSSProperties {
  return { fontSize: 11.5, color: C.faint, marginTop: 4 };
}

export function TaskFields({ task, onChange, C }: {
  task: AssignmentTask;
  onChange: (updates: Partial<AssignmentTask>) => void;
  C: typeof LIGHT_C;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState('');
  const refFileRef = useRef<HTMLInputElement>(null);

  const options = task.options ?? [];
  const updateOption = (i: number, value: string) => {
    // Keep the correct-answer pointer in sync when its option's text is edited.
    const wasCorrect = task.correctAnswer != null && options[i] === task.correctAnswer;
    onChange({
      options: options.map((o, idx) => idx === i ? value : o),
      ...(wasCorrect ? { correctAnswer: value } : {}),
    });
  };
  const addOption = () => onChange({ options: [...options, ''] });
  const removeOption = (i: number) => {
    const removed = options[i];
    onChange({
      options: options.filter((_, idx) => idx !== i),
      correctAnswer: task.correctAnswer === removed ? undefined : task.correctAnswer,
    });
  };

  async function handleExtractRubric(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setExtracting(true);
    setExtractError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const form = new FormData();
      form.append('file', file);
      form.append('label', 'reference_solution');
      const res = await fetch('/api/extract-rubric', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Extraction failed.');
      const incoming: string[] = json.criteria ?? [];
      onChange({ rubric: [...(task.rubric ?? []), ...incoming].filter(Boolean) });
    } catch (err: any) {
      setExtractError(err?.message || 'Failed to extract rubric.');
    } finally {
      setExtracting(false);
    }
  }

  const showRubric = isAiTaskType(task.type);
  const showMinScore = task.type === 'code_review' || task.type === 'excel_review' || task.type === 'document_review';
  const showContext = task.type === 'excel_review' || task.type === 'document_review';
  const showSchema = task.type === 'code_review';
  const fieldGroupStyle: React.CSSProperties = { padding: '15px 0', borderBottom: `1px solid ${C.divider}` };
  const accentSoft = isDark ? `${C.cta}18` : `${C.cta}0f`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Title */}
      <div style={fieldGroupStyle}>
        <label style={labelStyle(C)}>Task title <span style={{ color: C.errorText }}>*</span></label>
        <input
          value={task.title}
          onChange={e => onChange({ title: e.target.value })}
          placeholder={task.type === 'mcq' ? 'e.g. Which metric best measures retention?' : 'e.g. Analyse the churn drivers'}
          style={inputStyle(C)}
          maxLength={200}
        />
      </div>

      {/* Description / prompt -- full interactive editor (images, carousel, steps, callouts...) */}
      <div style={fieldGroupStyle}>
        <label style={labelStyle(C)}>
          {task.type === 'mcq' ? 'Question / prompt' : 'Instructions'}
          <span style={{ fontWeight: 400, color: C.faint }}> (optional)</span>
        </label>
        <LessonEditor
          doc={task.doc}
          bodyFallback={task.description}
          onChange={({ doc, body }) => onChange({ doc, description: body })}
          placeholder="Describe what the student should do. Add images, steps, callouts, tables..."
          isDark={isDark}
          accentColor={C.cta}
        />
      </div>

      {/* Type-specific */}
      {task.type === 'upload' && (
        <div style={fieldGroupStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', borderRadius: 12, background: C.page }}>
            <span style={{ width: 32, height: 32, flexShrink: 0, display: 'grid', placeItems: 'center', borderRadius: 9, background: accentSoft, color: C.cta }}><Upload style={{ width: 15, height: 15 }}/></span>
            <p style={{ ...hintStyle(C), margin: 0 }}>Students upload a file for instructor review. This task does not run an AI review.</p>
          </div>
        </div>
      )}

      {task.type === 'mcq' && (
        <div style={fieldGroupStyle}>
          <label style={labelStyle(C)}>Options <span style={{ fontWeight: 400, color: C.faint }}>(select the correct one)</span></label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {options.map((opt, i) => {
              const isCorrect = !!opt && task.correctAnswer === opt;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 12, border: `1px solid ${isCorrect ? C.green : C.divider}`, background: isCorrect ? (isDark ? 'rgba(16,185,129,.08)' : 'rgba(16,185,129,.055)') : C.page }}>
                  <button
                    type="button"
                    onClick={() => opt && onChange({ correctAnswer: opt })}
                    title="Mark as correct answer"
                    style={{
                      width: 26, height: 26, borderRadius: '50%', flexShrink: 0, cursor: opt ? 'pointer' : 'not-allowed',
                      border: `2px solid ${isCorrect ? C.green : C.cardBorder}`,
                      background: isCorrect ? C.green : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                    {isCorrect && <Check style={{ width: 14, height: 14, color: '#fff' }} />}
                  </button>
                  <input
                    value={opt}
                    onChange={e => updateOption(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                    style={{ ...inputStyle(C), flex: 1 }}
                    maxLength={300}
                  />
                  <button type="button" onClick={() => removeOption(i)} disabled={options.length <= 1}
                    style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, border: 'none', background: C.deleteBg, color: C.deleteText, cursor: options.length <= 1 ? 'not-allowed' : 'pointer', opacity: options.length <= 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <X style={{ width: 13, height: 13 }} />
                  </button>
                </div>
              );
            })}
          </div>
          <button type="button" onClick={addOption}
            style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.divider}`, background: 'transparent', color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <Plus style={{ width: 13, height: 13 }} /> Add option
          </button>
          <p style={hintStyle(C)}>The student is auto-marked right or wrong; it contributes to a preliminary score, but you set the final grade.</p>
        </div>
      )}

      {showRubric && (
        <div style={fieldGroupStyle}>
          <label style={labelStyle(C)}>Grading rubric</label>
          <div style={{ marginBottom: 8 }}>
            <input ref={refFileRef} type="file" accept=".xlsx,.pdf,.csv,.txt,.png,.jpg,.jpeg,.docx" style={{ display: 'none' }} onChange={handleExtractRubric} />
            <button type="button" disabled={extracting} onClick={() => refFileRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: `1px solid ${C.divider}`, background: 'transparent', color: C.muted, fontSize: 12, fontWeight: 700, cursor: extracting ? 'not-allowed' : 'pointer', opacity: extracting ? 0.5 : 1 }}>
              {extracting ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin" /> Extracting...</> : <><Upload style={{ width: 13, height: 13 }} /> Upload reference solution</>}
            </button>
          </div>
          <textarea
            value={(task.rubric ?? []).join('\n')}
            onChange={e => onChange({ rubric: e.target.value.split('\n') })}
            placeholder={'One criterion per line:\nResults are correct\nQueries are optimised'}
            style={textareaStyle(C)}
          />
          <p style={hintStyle(C)}>Each line is a rubric criterion the AI grades against. Leave empty to use the AI default standards.</p>
          {extractError && <p style={{ ...hintStyle(C), color: C.errorText }}>{extractError}</p>}
        </div>
      )}

      {showContext && (
        <div style={fieldGroupStyle}>
          <label style={labelStyle(C)}>{task.type === 'document_review' ? 'Report scope / context' : 'Business context'} <span style={{ fontWeight: 400, color: C.faint }}>(optional)</span></label>
          <textarea
            value={task.context ?? ''}
            onChange={e => onChange({ context: e.target.value })}
            placeholder="Context the AI should apply when reviewing..."
            style={textareaStyle(C)}
          />
        </div>
      )}

      {showSchema && (
        <div style={fieldGroupStyle}>
          <label style={labelStyle(C)}>Database schema <span style={{ fontWeight: 400, color: C.faint }}>(optional, for SQL)</span></label>
          <textarea
            value={task.schema ?? ''}
            onChange={e => onChange({ schema: e.target.value })}
            placeholder="CREATE TABLE orders (id INT, ...);"
            style={{ ...textareaStyle(C), fontFamily: 'monospace', fontSize: 12 }}
          />
        </div>
      )}

      {task.type === 'document_review' && (
        <div style={fieldGroupStyle}>
          <label style={labelStyle(C)}>Review mode</label>
          <div role="radiogroup" aria-label="Document review mode" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            {([
              ['ai_only', 'AI review', 'Automated feedback'],
              ['manual', 'Instructor review', 'Manual assessment'],
              ['hybrid', 'Hybrid review', 'AI and instructor'],
            ] as const).map(([value, label, description]) => {
              const active = (task.documentReviewMode ?? 'ai_only') === value;
              return (
                <button key={value} type="button" role="radio" aria-checked={active} onClick={() => onChange({ documentReviewMode: value })}
                  style={{ minHeight: 62, padding: '10px 12px', textAlign: 'left', borderRadius: 11, border: `1px solid ${active ? C.cta : C.divider}`, background: active ? accentSoft : C.page, color: active ? C.cta : C.text, cursor: 'pointer' }}>
                  <strong style={{ display: 'block', fontSize: 12.5 }}>{label}</strong>
                  <span style={{ display: 'block', marginTop: 3, fontSize: 10.5, color: active ? C.cta : C.faint }}>{description}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {showMinScore && (
        <div style={fieldGroupStyle}>
          <label style={labelStyle(C)}>AI pass score <span style={{ fontWeight: 400, color: C.faint }}>(out of 100)</span></label>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 7, padding: 6, borderRadius: 13, background: C.page }}>
            {[60, 70, 80, 90].map(score => {
              const active = (task.minScore ?? 70) === score;
              return <button key={score} type="button" onClick={() => onChange({ minScore: score })}
                style={{ minWidth: 54, minHeight: 38, padding: '7px 11px', borderRadius: 9, border: 'none', background: active ? C.cta : 'transparent', color: active ? C.ctaText : C.muted, fontSize: 12, fontWeight: 750, cursor: 'pointer' }}>{score}%</button>;
            })}
            <input aria-label="Custom AI pass score" type="number" min={1} max={100} value={task.minScore ?? 70}
              onChange={e => onChange({ minScore: Math.min(100, Math.max(1, Number(e.target.value))) })}
              style={{ ...inputStyle(C), width: 112, minHeight: 38, marginLeft: 'auto', background: C.card }} />
          </div>
          <p style={hintStyle(C)}>Used only for the AI feedback shown to the student. You still set the final grade.</p>
        </div>
      )}
    </div>
  );
}
