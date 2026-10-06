'use client';

import { useRef, useState } from 'react';
import { AlertTriangle, Download, FileSpreadsheet, Loader2, Upload, X } from 'lucide-react';
import type { ApplicationQuestion, ApplicationQuestionType } from '@/lib/application-forms';
import {
  csvParseProblem,
  parseApplicationQuestionRows,
  questionImportTemplateCsv,
  type QuestionImportResult,
} from '@/lib/application-question-import';
import { modalStyle, type ThemeColors } from '@/lib/theme';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function readRows(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const { firstWorkbookSheetRows } = await import('@/lib/workbook-rows');
    return (await firstWorkbookSheetRows(await file.arrayBuffer())).rows;
  }
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    const Papa = (await import('papaparse')).default;
    const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: false });
    const problem = csvParseProblem(parsed.errors);
    if (problem) throw new Error(problem);
    return parsed.data;
  }
  throw new Error('Choose a CSV file or an Excel (.xlsx) file. For an older .xls file, save it as .xlsx first.');
}

/** Upload a CSV or Excel list of questions, check it, then add or replace the form's questions. */
export function ApplicationQuestionImport({ C, typeLabels, existingCount, canReplace, onImport, onClose }: {
  C: ThemeColors;
  typeLabels: Record<ApplicationQuestionType, string>;
  existingCount: number;
  /** Replacing is allowed only while the form has no applications, so no answers lose their question. */
  canReplace: boolean;
  onImport: (questions: ApplicationQuestion[], mode: 'append' | 'replace') => void;
  onClose: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<QuestionImportResult | null>(null);
  const [mode, setMode] = useState<'append' | 'replace'>('append');

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    setError(''); setResult(null); setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) { setError('This file is larger than 2 MB. A question list should be much smaller.'); return; }
    setReading(true);
    try {
      setResult(parseApplicationQuestionRows(await readRows(file)));
    } catch (reason) {
      setError((reason as Error).message || 'Could not read this file.');
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([questionImportTemplateCsv()], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'application-questions-template.csv';
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  }

  const questions = result?.questions ?? [];
  const errors = result?.issues.filter(issue => issue.level === 'error') ?? [];
  const warnings = result?.issues.filter(issue => issue.level === 'warning') ?? [];
  const box = { background: C.input, borderRadius: 12 };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !reading) onClose(); }}>
      <section className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl" style={modalStyle(C)} role="dialog" aria-modal="true" aria-labelledby="import-questions-title">
        <div className="flex items-start justify-between gap-4 p-5">
          <div>
            <h3 id="import-questions-title" className="text-base font-bold" style={{ color: C.text }}>Import questions</h3>
            <p className="mt-1 text-xs leading-5" style={{ color: C.faint }}>Upload a CSV or Excel file with one question per row. You can check and edit everything before saving the form.</p>
          </div>
          <button type="button" disabled={reading} onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg disabled:opacity-40" style={{ background: C.input, color: C.muted }} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-3 px-5 pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3 p-4" style={box}>
            <div className="min-w-0">
              <p className="text-xs font-semibold" style={{ color: C.text }}>Columns: Question, Type, Required, Options, Help text</p>
              <p className="mt-1 text-[11px] leading-4" style={{ color: C.muted }}>Separate options with semicolons. Add {'"'}Other (please specify){'"'} to give applicants their own answer box.</p>
            </div>
            <button type="button" onClick={downloadTemplate} className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: C.card, color: C.cta }}><Download className="h-3.5 w-3.5" /> Download template</button>
          </div>

          <input ref={fileInput} type="file" accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={event => void chooseFile(event.target.files?.[0])} />
          <button type="button" disabled={reading} onClick={() => fileInput.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl p-4 text-xs font-semibold disabled:opacity-60" style={{ background: C.pill, color: C.cta }}>
            {reading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {reading ? 'Reading file...' : fileName ? 'Choose a different file' : 'Choose CSV or Excel file'}
          </button>
          {fileName && !reading && <p className="flex items-center gap-1.5 text-[11px]" style={{ color: C.muted }}><FileSpreadsheet className="h-3.5 w-3.5" /> {fileName}</p>}

          {error && <p role="alert" className="rounded-xl px-3 py-2.5 text-xs" style={{ background: C.errorBg, color: C.errorText }}>{error}</p>}

          {result && (errors.length > 0 || warnings.length > 0) && (
            <div className="rounded-xl p-3 text-xs" style={{ background: errors.length ? C.errorBg : C.input, color: errors.length ? C.errorText : C.muted }} role="status">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-3.5 w-3.5" /> {errors.length ? `${errors.length} ${errors.length === 1 ? 'row was' : 'rows were'} skipped` : 'Imported with changes'}</p>
              <ul className="mt-2 max-h-36 space-y-1 overflow-y-auto">
                {[...errors, ...warnings].map((issue, index) => <li key={index}>{issue.row ? `Row ${issue.row}: ` : ''}{issue.message}</li>)}
              </ul>
            </div>
          )}

          {questions.length > 0 && <>
            <div className="p-3" style={box}>
              <p className="text-xs font-bold" style={{ color: C.text }}>{questions.length} {questions.length === 1 ? 'question' : 'questions'} ready</p>
              <ol className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
                {questions.map((question, index) => (
                  <li key={question.id} className="flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-xs" style={{ background: C.card }}>
                    <span className="min-w-0 break-words" style={{ color: C.text }}>{index + 1}. {question.label}{question.required && <span style={{ color: C.errorText }}> *</span>}</span>
                    <span className="shrink-0 text-[11px]" style={{ color: C.faint }}>{typeLabels[question.type]}{question.options ? `, ${question.options.length + (question.allowOther ? 1 : 0)} options` : ''}</span>
                  </li>
                ))}
              </ol>
            </div>

            {existingCount > 0 && (
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Where to put the imported questions">
                {([['append', 'Add to the end', `Keep the ${existingCount} existing ${existingCount === 1 ? 'question' : 'questions'}.`], ['replace', 'Replace the questions', canReplace ? 'Remove the existing questions first.' : 'Not available once the form has applications.']] as const).map(([value, label, hint]) => {
                  const selected = mode === value;
                  const disabled = value === 'replace' && !canReplace;
                  return <button key={value} type="button" role="radio" aria-checked={selected} disabled={disabled} onClick={() => setMode(value)} className="rounded-xl p-3 text-left disabled:opacity-50" style={{ background: selected ? C.pill : C.input, boxShadow: selected ? `inset 0 0 0 1px ${C.cta}` : 'none' }}><span className="block text-xs font-semibold" style={{ color: selected ? C.cta : C.text }}>{label}</span><span className="mt-0.5 block text-[11px]" style={{ color: C.muted }}>{hint}</span></button>;
                })}
              </div>
            )}
          </>}

          <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
            <button type="button" disabled={reading} onClick={onClose} className="rounded-lg px-4 py-2.5 text-xs font-semibold disabled:opacity-50" style={{ color: C.muted }}>Cancel</button>
            <button type="button" disabled={reading || questions.length === 0} onClick={() => onImport(questions, existingCount > 0 && canReplace ? mode : 'append')} className="rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}>
              {questions.length === 0 ? 'Import questions' : mode === 'replace' && canReplace && existingCount > 0 ? `Replace with ${questions.length}` : `Add ${questions.length} ${questions.length === 1 ? 'question' : 'questions'}`}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
