'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  Loader2,
  Lightbulb,
  Maximize2,
  Menu,
  Play,
  RotateCcw,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { acceptCompletion, autocompletion, completionKeymap, completionStatus, moveCompletionSelection, selectedCompletion } from '@codemirror/autocomplete';
import { PostgreSQL, sql, type SQLNamespace } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import {
  checkRequiredSqlPatterns,
  compareResults,
  executeQuery,
  SQLCompareResult,
  SQLResult,
  SQLRuntime,
  STUDENT_RESULT_LIMIT,
} from '@/lib/sql-engine';
import { sanitizeRichText } from '@/lib/sanitize';
import { postWithFreshSession, SignInError } from '@/lib/fresh-session-fetch';
import { supabaseSession } from '@/lib/fresh-session-supabase';
import { safeEmbedUrl, isHtmlEmbedUrl } from '@/lib/safe-embed-url';
import { HtmlEmbedFrame } from '@/components/HtmlEmbedFrame';
import { LessonRenderer } from '@/components/lesson/LessonRenderer';
import type { LessonDoc } from '@/lib/lesson-doc';

const vscDarkHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword,             color: '#569cd6', fontWeight: '600' },
  { tag: tags.string,              color: '#ce9178' },
  { tag: tags.number,              color: '#b5cea8' },
  { tag: tags.comment,             color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.lineComment,         color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.blockComment,        color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.bool,                color: '#569cd6' },
  { tag: tags.null,                color: '#569cd6' },
  { tag: tags.special(tags.string),color: '#ce9178' },
  // identifiers stay default (#d4d4d4) -- set via editor theme
]));

const vscLightHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword,             color: '#0000ff', fontWeight: '600' },
  { tag: tags.string,              color: '#a31515' },
  { tag: tags.number,              color: '#098658' },
  { tag: tags.comment,             color: '#008000', fontStyle: 'italic' },
  { tag: tags.lineComment,         color: '#008000', fontStyle: 'italic' },
  { tag: tags.blockComment,        color: '#008000', fontStyle: 'italic' },
  { tag: tags.bool,                color: '#0000ff' },
  { tag: tags.null,                color: '#0000ff' },
  { tag: tags.special(tags.string),color: '#a31515' },
  // identifiers stay default (#1e1e1e) -- set via editor theme
]));

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]!));
}

function stripWrappingBackticks(value: string): string {
  return value.trim()
    .replace(/^`([^`]+)`$/, '$1')
    .replace(/^&#96;([\s\S]+?)&#96;$/i, '$1')
    .replace(/^&grave;([\s\S]+?)&grave;$/i, '$1');
}

function renderRichText(html: string): string {
  const normalizedCode = html.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, code: string) =>
    `<code>${escapeHtml(stripWrappingBackticks(code).replace(/`|&#96;|&grave;/gi, ''))}</code>`
  );
  return sanitizeRichText(
    normalizedCode.replace(/`([^`]+)`/g, (_, code: string) => `<code>${escapeHtml(code)}</code>`)
  );
}

interface Props {
  question: any;
  runtime: SQLRuntime | null;
  isPreparing: boolean;
  prepareError?: string;
  isDark: boolean;
  accentColor: string;
  savedAnswer?: string;
  completed: boolean;
  topOffset?: number;
  leftOffset?: number;
  sessionToken?: string;
  hintPenalty?: number;
  onComplete: (payload: { query: string; result: SQLResult; passed: boolean; feedback: SQLCompareResult; skipped?: boolean; attempts?: number; solutionViewed?: boolean; proof?: string }) => void | Promise<void>;
  onCheckAnswer?: (questionId: string, query: string, result: SQLResult) => Promise<{ passed: boolean; feedback: SQLCompareResult; proof?: string }>;
  onHintUsed: () => void;
  onRevealSolution?: (questionId: string, attempts: number) => Promise<string>;
  onNext?: () => void;
  isLastQuestion?: boolean;
  solutionPenalty?: number;
  isFirstTaskForLesson?: boolean;
  examMode?: boolean;   // certifications: hide hints + View Solution (no answers shown in an exam)
}

type DetailModal =
  | { type: 'cell'; title: string; value: unknown }
  | { type: 'grid'; title: string; result: SQLResult | null };

function parseSaved(saved?: string) {
  if (!saved) return null;
  try { return JSON.parse(saved); } catch { return { query: saved }; }
}

function exportToCsv(result: SQLResult, filename: string) {
  const escape = (v: unknown) => {
    const s = formatCell(v);
    if (s === '') return '';
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const header = result.columns.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',');
  const body = result.rows.map(row => row.map(escape).join(',')).join('\n');
  const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function quoteIdent(name: string) {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;
  return `"${name.replace(/"/g, '""')}"`;
}

function formatCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object') {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
    }
    const s = String(value);
    return s === '[object Object]' ? JSON.stringify(value) : formatCell(s);
  }
  if (typeof value !== 'string') return String(value);

  let text = value.trim();
  for (let i = 0; i < 6; i += 1) {
    const unescaped = text.replace(/\\"/g, '"').replace(/\\'/g, "'");
    if (unescaped !== text) {
      text = unescaped.trim();
      continue;
    }
    if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
      text = text.slice(1, -1).trim();
      continue;
    }
    if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
      text = text.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return text;
}

// ---- DataGrid ----
function DataGrid({
  result, isDark, emptyMessage, onCellOpen,
}: {
  result: SQLResult | null;
  isDark: boolean;
  emptyMessage: string;
  onCellOpen: (title: string, value: unknown) => void;
}) {
  const divider = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.055)';
  const headerBg = isDark ? '#1b1b1f' : '#f8fafc';
  const rowBg = isDark ? '#1E1F26' : '#ffffff';
  const numColor = isDark ? '#2e3355' : '#cbd5e1';
  const visibleRows = result?.rows.slice(0, 100) ?? [];

  if (!result || visibleRows.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Database className="w-5 h-5" style={{ color: isDark ? '#252840' : '#d8ddef' }} />
        <p className="text-[12px] font-mono" style={{ color: isDark ? '#6b7a89' : '#888888' }}>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="min-w-max w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className="sticky top-0 left-0 z-20 w-10 px-3 py-2.5 text-right font-mono text-[10px]"
              style={{ background: headerBg, borderBottom: `1px solid ${divider}`, color: numColor }}>
              #
            </th>
            {result.columns.map((col, ci) => (
              <th key={`${ci}:${col}`}
                className="sticky top-0 z-10 px-4 py-2.5 text-left text-[10px] font-bold tracking-widest uppercase whitespace-nowrap"
                style={{ background: headerBg, borderBottom: `1px solid ${divider}`, color: isDark ? '#7c85b8' : '#475569' }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, i) => (
            <tr key={i}>
              <td className="sticky left-0 z-10 px-3 py-2.5 text-right font-mono text-[10px] tabular-nums"
                style={{ background: rowBg, color: numColor, borderBottom: `1px solid ${divider}` }}>
                {i + 1}
              </td>
              {row.map((cell, j) => {
                const val = formatCell(cell);
                return (
                  <td key={j} className="px-4 py-2.5 align-top max-w-[300px]"
                    style={{ background: rowBg, borderBottom: `1px solid ${divider}` }}>
                    <button type="button"
                      onClick={() => onCellOpen(result.columns[j] ?? 'Value', cell)}
                      className="block w-full text-left truncate transition-opacity hover:opacity-60"
                      title={val}>
                      {val
                        ? <span className="font-mono text-[12.5px]">{val}</span>
                        : <span className="font-mono text-[11px] italic" style={{ color: numColor }}>NULL</span>
                      }
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Accepts the highlighted completion on Tab; if nothing is state-selected yet,
// selects the first item first so acceptCompletion doesn't return false.
const tabAcceptCompletion = (view: EditorView): boolean => {
  if (!completionStatus(view.state)) return false;
  if (selectedCompletion(view.state) === null) moveCompletionSelection(true)(view);
  return acceptCompletion(view);
};

// ---- CodeMirror ----
function CodeMirrorEditor({
  value,
  onChange,
  isDark,
  bg,
  accentColor,
  schema,
  defaultTable,
}: {
  value: string;
  onChange: (v: string) => void;
  isDark: boolean;
  bg: string;
  accentColor: string;
  schema: SQLNamespace;
  defaultTable?: string;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const reactId = useId();
  const uid = `cm-sql-${reactId.replace(/:/g, '')}`;

  useEffect(() => {
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          keymap.of([
            { key: 'Tab', run: tabAcceptCompletion },
            ...completionKeymap.filter(b => b.key !== 'Tab'),
            ...defaultKeymap,
          ]),
          sql({
            dialect: PostgreSQL,
            schema,
            defaultTable,
            upperCaseKeywords: true,
          }),
          autocompletion({
            activateOnTyping: true,
            closeOnBlur: false,
            maxRenderedOptions: 12,
          }),
          EditorView.lineWrapping,
          EditorView.theme({
            '&': { fontSize: '13.5px', height: '100%', background: bg, color: isDark ? '#d4d4d4' : '#1e1e1e' },
            '.cm-content': { padding: '14px 0 24px', caretColor: accentColor, color: isDark ? '#d4d4d4' : '#1e1e1e' },
            '.cm-line': { padding: '0 20px', lineHeight: '1.75' },
            '.cm-scroller': { fontFamily: '"JetBrains Mono","Fira Code",ui-monospace,monospace' },
            '.cm-gutters': {
              borderRight: 'none',
              background: bg,
              color: isDark ? '#262a44' : '#c8d0e4',
              fontSize: '11px',
              minWidth: '44px',
            },
            '.cm-activeLine': { background: isDark ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.018)' },
            '.cm-activeLineGutter': { background: isDark ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.018)' },
            '.cm-tooltip': {
              border: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.10)'}`,
              backgroundColor: isDark ? '#13152a' : '#ffffff',
              color: isDark ? '#e2e8f6' : '#1a1d2e',
              borderRadius: '10px',
              overflow: 'hidden',
              boxShadow: 'none',
            },
            '.cm-tooltip-autocomplete': {
              padding: '4px',
            },
            '.cm-tooltip-autocomplete ul': {
              fontFamily: '"JetBrains Mono","Fira Code",ui-monospace,monospace',
              fontSize: '12.5px',
              maxHeight: '220px',
              padding: '0',
            },
            '.cm-tooltip-autocomplete ul li': {
              display: 'flex',
              alignItems: 'center',
              padding: '5px 10px',
              borderRadius: '6px',
              lineHeight: '1.4',
              color: isDark ? '#c9d1e8' : '#2d3a52',
              transition: 'background 0.1s',
            },
            '.cm-tooltip-autocomplete ul li[aria-selected]': {
              backgroundColor: `${accentColor}22`,
              color: isDark ? '#ffffff' : '#0f1a2e',
            },
            '.cm-completionIcon': {
              display: 'none',
            },
            '.cm-completionLabel': {
              fontFamily: '"JetBrains Mono","Fira Code",ui-monospace,monospace',
              fontSize: '12.5px',
              letterSpacing: '0.01em',
            },
            '.cm-completionMatchedText': {
              color: accentColor,
              fontWeight: '700',
              textDecoration: 'none',
            },
            '.cm-completionDetail': {
              marginLeft: '8px',
              fontSize: '11px',
              opacity: '0.45',
              fontStyle: 'normal',
              fontFamily: 'ui-sans-serif,system-ui,sans-serif',
            },
          }),
          EditorView.updateListener.of(u => { if (u.docChanged) onChange(u.state.doc.toString()); }),
          isDark ? vscDarkHighlight : vscLightHighlight,
        ],
      }),
      parent: host,
    });
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  return (
    <div id={uid} className="h-full [&_.cm-editor]:h-full">
      <style>{`
        #${uid} .cm-cursor,
        #${uid} .cm-dropCursor {
          border-left-color: ${accentColor} !important;
          border-left-width: 2px !important;
        }
        #${uid} .cm-editor.cm-focused .cm-selectionBackground,
        #${uid} .cm-selectionBackground {
          background: ${accentColor}30 !important;
        }
      `}</style>
      <div ref={setHost} className="h-full" />
    </div>
  );
}

// ---- Main ----
export default function SQLExercisePlayer({
  question, runtime, isPreparing, prepareError,
  isDark, accentColor, savedAnswer, completed,
  topOffset = 0,
  leftOffset = 0,
  sessionToken,
  hintPenalty,
  solutionPenalty,
  onComplete, onCheckAnswer, onHintUsed, onRevealSolution, onNext, isLastQuestion,
  isFirstTaskForLesson = true,
  examMode = false,
}: Props) {
  const saved = useMemo(() => parseSaved(savedAnswer), [savedAnswer]);
  const firstTableName = runtime?.tables?.[0]?.tableName ?? '';
  const defaultStarter = firstTableName ? `SELECT * FROM ${quoteIdent(firstTableName)} LIMIT 10;` : 'SELECT * FROM ';
  const configuredStarter = String(question.sqlStarterCode ?? '').trim();
  const starterCode = !configuredStarter || /\btable_name\b/i.test(configuredStarter)
    ? defaultStarter
    : configuredStarter;

  const [query, setQuery]       = useState<string>(saved?.query || starterCode);
  const [result, setResult]     = useState<SQLResult | null>(saved?.result ?? null);
  const [running, setRunning]   = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError]       = useState('');
  const [feedback, setFeedback] = useState<SQLCompareResult | null>(
    (saved?.skipped || saved?.solutionViewed) ? null : (saved?.feedback ?? null)
  );
  const [failedAttempts, setFailedAttempts] = useState<number>(Number(saved?.attempts ?? 0));
  const [solutionRevealed, setSolutionRevealed] = useState<boolean>(!!saved?.solutionViewed);
  const [revealedSolution, setRevealedSolution] = useState<string>('');
  const [solutionLoading, setSolutionLoading] = useState(false);
  const [solutionError, setSolutionError] = useState('');
  const [activeTab, setActiveTab] = useState<'result' | string>('result');
  const [sampleResults, setSampleResults] = useState<Record<string, SQLResult>>({});
  const [sampleLoading, setSampleLoading] = useState('');
  const [leftOpen, setLeftOpen]       = useState(true);
  const [leftWidth, setLeftWidth]     = useState(420);
  const [editorPct, setEditorPct]     = useState(50);
  const [modal, setModal]             = useState<DetailModal | null>(null);
  const [feedbackDismissed, setFeedbackDismissed] = useState(false);
  const [isMobile, setIsMobile]       = useState(false);
  const [mobileTab, setMobileTab]     = useState<'lesson' | 'query' | 'result'>('query');
  const [hintShown, setHintShown]     = useState(false);
  const [leftTab, setLeftTab]         = useState<'lesson' | 'hint'>('lesson');
  const [errorExplain, setErrorExplain]       = useState('');
  const [explainLoading, setExplainLoading]   = useState(false);
  const [resetKey, setResetKey]       = useState(0);
  const [exportingTable, setExportingTable] = useState('');
  const resizingRef = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const vResizingRef = useRef(false);
  const vResizeStartY = useRef(0);
  const vResizeStartPct = useRef(0);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  function onResizeStart(e: React.MouseEvent) {
    resizingRef.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = leftWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(ev: MouseEvent) {
      if (!resizingRef.current) return;
      const next = Math.max(200, Math.min(520, resizeStartW.current + ev.clientX - resizeStartX.current));
      setLeftWidth(next);
    }
    function onUp() {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onVerticalResizeStart(e: React.MouseEvent) {
    vResizingRef.current = true;
    vResizeStartY.current = e.clientY;
    vResizeStartPct.current = editorPct;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    function onMove(ev: MouseEvent) {
      if (!vResizingRef.current) return;
      const totalH = rightPanelRef.current?.offsetHeight ?? 1;
      const delta = ((ev.clientY - vResizeStartY.current) / totalH) * 100;
      setEditorPct(Math.max(25, Math.min(75, vResizeStartPct.current + delta)));
    }
    function onUp() {
      vResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ---- Tokens ----
  // "Sections, not borders": panels are opaque rounded cards floating on the canvas
  // seam; toolbars are tonal bands (translucent overlay) rather than hairline-divided strips.
  const canvas    = isDark ? '#17181E' : '#F2F5FA';                                  // matches the main course page background
  const leftBg    = isDark ? '#1E1F26' : '#ffffff';                                  // unified card surface (same as other lesson cards)
  const editorBg  = isDark ? '#1E1F26' : '#ffffff';
  const resultsBg = isDark ? '#1E1F26' : '#ffffff';
  const headerBg  = isDark ? '#17181E' : '#F2F5FA';                                  // inset header block -- matches the main page background
  const text      = isDark ? '#ACB8C5' : '#111111';
  const muted     = isDark ? '#A8B5C2' : '#555555';
  const subtle    = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)';       // soft control fill
  const border    = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.06)';       // faint divider for the in-lesson <hr>/popover only

  const tables     = useMemo(() => runtime?.tables ?? [], [runtime?.tables]);
  const editorSchema = useMemo<SQLNamespace>(() => {
    const schema: Record<string, string[]> = {};
    for (const table of tables) {
      schema[table.tableName] = table.columns.map(column => column.name);
    }
    return schema;
  }, [tables]);
  const editorSchemaKey = useMemo(
    () => tables.map(table => `${table.tableName}:${table.columns.map(column => column.name).join(',')}`).join('|'),
    [tables],
  );
  const visibleResult = activeTab === 'result' ? result : (sampleResults[activeTab] ?? null);
  const hasChecker = !!question.sqlHasExpectedResult || !!question.sqlExpectedResult || !!question.sqlSolution?.trim();
  const availableHints: string[] = (question.sqlHints?.length ? question.sqlHints : question.hint ? [question.hint] : []);
  const hasHints = !examMode && availableHints.length > 0;
  const canRevealSolution = !examMode && hasChecker && !completed;
  const solutionText = (revealedSolution || String(question.sqlSolution ?? '')).trim();
  const rowCount   = visibleResult?.rows.length ?? 0;
  const displayedRowCount = Math.min(rowCount, 100);
  const totalRowCount = visibleResult?.totalRows ?? rowCount;
  const busy       = running || checking;
  const lesson     = question.lesson as { title?: string; body?: string; doc?: LessonDoc; imageUrl?: string; videoUrl?: string } | undefined;

  useEffect(() => {
    if (saved?.query || !firstTableName) return;
    setQuery(current => /\btable_name\b/i.test(current) || current.trim() === 'SELECT * FROM'
      ? `SELECT * FROM ${quoteIdent(firstTableName)} LIMIT 10;`
      : current);
  }, [firstTableName, saved?.query]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    setHintShown(false);
    setLeftTab('lesson');
    setErrorExplain('');
  }, [question.id]);

  async function previewTable(tableName: string) {
    if (!runtime || sampleResults[tableName]) return;
    setSampleLoading(tableName);
    try {
      const out = await executeQuery(runtime.conn, `SELECT * FROM ${quoteIdent(tableName)} LIMIT 50`);
      setSampleResults(prev => ({ ...prev, [tableName]: out }));
    } catch { /* ignore */ } finally { setSampleLoading(''); }
  }

  async function exportCurrent() {
    if (activeTab === 'result') {
      if (result) exportToCsv(result, 'query_result.csv');
      return;
    }
    if (!runtime || exportingTable) return;
    setExportingTable(activeTab);
    try {
      const full = await executeQuery(runtime.conn, `SELECT * FROM ${quoteIdent(activeTab)}`, false, { limit: null });
      exportToCsv(full, `${activeTab}.csv`);
    } catch { /* ignore */ } finally {
      setExportingTable('');
    }
  }

  async function runQuery() {
    if (!runtime) {
      setActiveTab('result');
      setError('SQL workspace is still preparing. Please try again in a moment.');
      if (isMobile) setMobileTab('result');
      return;
    }
    setRunning(true); setError(''); setResult(null); setFeedback(null); setActiveTab('result'); setErrorExplain('');
    try {
      // Run query directly (same as checkAnswer) to avoid subquery-wrapping issues with malformed/placeholder SQL.
      // Cap rows in JS after the fact so the browser doesn't choke on huge result sets.
      const res = await executeQuery(runtime.conn, query, false, { limit: null });
      const capped = res.rows.length > STUDENT_RESULT_LIMIT;
      setResult({
        ...res,
        rows: capped ? res.rows.slice(0, STUDENT_RESULT_LIMIT) : res.rows,
        totalRows: res.rows.length,
        capped,
      });
    }
    catch (e: any) { setError(e?.message || 'Query failed.'); }
    finally {
      setRunning(false);
      if (isMobile) setMobileTab('result');
    }
  }

  async function checkAnswer() {
    if (!runtime || !hasChecker) return;
    setChecking(true); setError(''); setActiveTab('result'); setFeedbackDismissed(false);
    try {
      const out = await executeQuery(runtime.conn, query, false, { limit: null });
      setResult(out);
      let serverCheck: { passed: boolean; feedback: SQLCompareResult; proof?: string };
      if (onCheckAnswer) {
        serverCheck = await onCheckAnswer(question.id, query, out);
      } else {
        const expected = question.sqlSolution?.trim()
          ? await executeQuery(runtime.conn, question.sqlSolution, false, { limit: null })
          : question.sqlExpectedResult;
        const pat = checkRequiredSqlPatterns(query, question.sqlRequiredPatterns);
        if (!pat.passed) {
          serverCheck = {
            passed: false,
            feedback: { passed: false, matchedRows: 0, totalRows: expected?.rows?.length ?? 0, message: pat.message },
          };
        } else {
          const feedback = compareResults(out, expected, {
            ordered: !!question.sqlResultOrdered,
            numericTolerance: Number(question.sqlNumericTolerance ?? 0),
          });
          serverCheck = { passed: feedback.passed, feedback };
        }
      }
      if (!serverCheck.passed) {
        const attempts = failedAttempts + 1;
        setFailedAttempts(attempts);
        setFeedback(serverCheck.feedback);
        await onComplete({ query, result: out, passed: false, feedback: serverCheck.feedback, attempts, solutionViewed: solutionRevealed });
        return;
      }
      const attempts = failedAttempts;
      if (onCheckAnswer && !serverCheck.proof) {
        setFeedback(serverCheck.feedback);
        setError('Your result matched, but server verification did not complete. Please check your connection and try again.');
        return;
      }
      setFeedback(serverCheck.feedback);
      await onComplete({ query, result: out, passed: true, feedback: serverCheck.feedback, attempts, solutionViewed: solutionRevealed, proof: serverCheck.proof });
    } catch (e: any) {
      // A sign-in problem says nothing about the answer, so it is not a failed attempt.
      if (!(e instanceof SignInError)) setFailedAttempts(failedAttempts + 1);
      setError(e?.message || 'Query failed.');
    }
    finally {
      setChecking(false);
      if (isMobile) setMobileTab('result');
    }
  }

  function continueIncorrect() {
    if (!onNext) return;
    const skipFeedback: SQLCompareResult = {
      passed: false,
      matchedRows: 0,
      totalRows: question.sqlExpectedResult?.rows?.length ?? 0,
      message: solutionRevealed
        ? 'Solution viewed. This exercise is marked incorrect, but you can continue.'
        : 'Skipped. This exercise is marked incorrect, but you can continue.',
    };
    const skipResult = result ?? { columns: [], rows: [] };
    onComplete({
      query,
      result: skipResult,
      passed: false,
      feedback: skipFeedback,
      skipped: true,
      attempts: failedAttempts,
      solutionViewed: solutionRevealed,
    });
    onNext();
  }

  async function revealSolution() {
    setSolutionLoading(true);
    setSolutionError('');
    try {
      const solution = onRevealSolution
        ? await onRevealSolution(question.id, failedAttempts)
        : String(question.sqlSolution ?? '');
      setRevealedSolution(solution);
      setSolutionRevealed(true);
      if (solution) setQuery(solution);
    } catch (err: any) {
      setSolutionError(err?.message || 'Could not load the solution.');
    } finally {
      setSolutionLoading(false);
    }
  }

  async function fetchErrorExplanation(errorText: string) {
    setExplainLoading(true);
    setErrorExplain('');
    try {
      // Sent with the sign-in as it is now; the token in the prop is a snapshot from the last
      // render and may have gone stale.
      const d = await postWithFreshSession('/api/sql-ai', {
        action: 'explain-error',
        query,
        error: errorText,
        tables: tables.map(t => ({ tableName: t.tableName, columns: t.columns })),
      }, 'The AI could not be reached. Please try again.', supabaseSession(undefined, () => sessionToken));
      setErrorExplain(d.explanation?.trim() || 'The AI did not return an explanation. Please try again.');
    } catch (err: any) {
      // The sign-in messages are worded for submitting an answer; this is not that.
      setErrorExplain(err instanceof SignInError
        ? 'Sign in to get an explanation of this error. If you are signed in, refresh the page and sign in again.'
        : `Could not explain this error: ${err?.message || 'unknown error'}`);
    } finally {
      setExplainLoading(false);
    }
  }

  if (isPreparing) {
    return (
      <div className="w-full flex items-center justify-center py-20" style={{ color: text }}>
        <div className="text-center">
          <div className="relative w-12 h-12 mx-auto mb-5">
            <div className="absolute inset-0 rounded-full border-2" style={{ borderColor: accentColor, opacity: 0.15 }} />
            <div className="absolute inset-0 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: accentColor }} />
            <Database className="absolute inset-0 m-auto w-5 h-5" style={{ color: accentColor }} />
          </div>
          <p className="font-semibold text-[14px] mb-1">Preparing workspace</p>
          <p className="text-[12px]" style={{ color: muted }}>Loading course tables</p>
        </div>
      </div>
    );
  }

  if (prepareError) {
    return <div className="w-full p-5 text-[13px] text-red-400">{prepareError}</div>;
  }

  return (
    <>
      {/* ══════════════════════════════════════════════ FULL-SCREEN OVERLAY -- escapes the card ══════════════════════════════════════════════ */}
      <div
        className="fixed bottom-0 right-0 z-40 flex flex-col overflow-hidden"
        style={{
          top: topOffset,
          left: leftOffset,
          transition: 'left 300ms ease',
          border: 'none',
          borderRadius: 0,
          color: text,
          background: canvas,
        }}
      >

        {/* ══════════ MOBILE TAB BAR ══════════ */}
        {isMobile && (
          <div className="flex-shrink-0 flex items-stretch gap-1.5 px-2 pt-2">
            {!examMode && (lesson?.title || lesson?.doc || lesson?.body || lesson?.videoUrl || lesson?.imageUrl || question.question) && (
              <button
                type="button"
                onClick={() => setMobileTab('lesson')}
                className="flex-1 h-9 rounded-lg text-[12px] font-semibold transition-colors"
                style={{ background: mobileTab === 'lesson' ? leftBg : 'transparent', color: mobileTab === 'lesson' ? text : muted }}
              >
                Lesson
              </button>
            )}
            <button
              type="button"
              onClick={() => setMobileTab('query')}
              className="flex-1 h-9 rounded-lg text-[12px] font-semibold transition-colors"
              style={{ background: mobileTab !== 'lesson' ? leftBg : 'transparent', color: mobileTab !== 'lesson' ? text : muted }}
            >
              Query
            </button>
          </div>
        )}

        {/* ══════════ CONTENT ROW ══════════ */}
        <div className="flex-1 min-h-0 flex overflow-hidden p-2 sm:p-3">

        {/* ══════════ LEFT PANEL ══════════ */}
        {!examMode && (!isMobile ? leftOpen : mobileTab === 'lesson') && (
          <div
            className="flex flex-col rounded-2xl overflow-hidden"
            style={{
              width: isMobile ? '100%' : leftWidth,
              flexShrink: 0,
              background: leftBg,
            }}
          >
            {/* Panel header with pill tabs */}
            <div
              className="flex-shrink-0 flex items-center gap-1 px-3 m-2 rounded-xl"
              style={{ height: 48, background: headerBg }}
            >
              <button
                type="button"
                onClick={() => setLeftTab('lesson')}
                className="h-8 px-3 rounded-lg text-[12px] font-bold transition-colors"
                style={{ background: leftTab === 'lesson' ? subtle : 'transparent', color: leftTab === 'lesson' ? text : muted }}
              >
                Lesson
              </button>
              {hasHints && (
                <button
                  type="button"
                  onClick={() => {
                    setLeftTab('hint');
                    if (!hintShown) { setHintShown(true); onHintUsed(); }
                  }}
                  className="h-8 px-3 rounded-lg text-[12px] font-bold transition-colors"
                  style={{ background: leftTab === 'hint' ? subtle : 'transparent', color: leftTab === 'hint' ? text : muted }}
                >
                  <span className="inline-flex items-center gap-1.5"><Lightbulb className="w-3.5 h-3.5" /> Hint</span>{hintPenalty && !hintShown ? <span className="ml-1 text-[10px] font-semibold" style={{ color: isDark ? '#fca5a5' : '#dc2626' }}>-{hintPenalty} pts</span> : null}
                </button>
              )}
            </div>

            {/* Lesson tab */}
            {leftTab === 'lesson' && (
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
              {isFirstTaskForLesson && lesson?.title && (
                <h2 className="text-[18px] font-bold leading-snug mb-3" style={{ color: text }}>
                  {lesson.title}
                </h2>
              )}
              {lesson?.videoUrl && safeEmbedUrl(lesson.videoUrl) && (
                isHtmlEmbedUrl(lesson.videoUrl) ? (
                  <div className="mb-4 rounded-xl overflow-hidden">
                    <HtmlEmbedFrame src={safeEmbedUrl(lesson.videoUrl)!} />
                  </div>
                ) : (
                  <div className="mb-4 rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
                    <iframe
                      src={safeEmbedUrl(lesson.videoUrl)!}
                      className="w-full h-full"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                )
              )}
              {lesson?.imageUrl && (
                <div className="mb-4 rounded-xl overflow-hidden">
                  <img src={lesson.imageUrl} alt="" className="w-full object-cover" />
                </div>
              )}
              {lesson?.doc ? (
                <LessonRenderer key={question.id} doc={lesson.doc} isDark={isDark} />
              ) : lesson?.body ? (
                <div
                  className={`prose max-w-none ve-lesson-body [&_blockquote]:border-l-[color:var(--lesson-accent)] [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[13px] [&_:not(pre)>code]:text-[var(--lesson-accent)] [&_:not(pre)>code]:bg-[var(--lesson-accent-bg)] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_pre]:bg-[var(--lesson-code-bg)] [&_pre]:border-l-4 [&_pre]:border-l-[color:var(--lesson-accent)] [&_pre]:rounded-r-md [&_pre]:py-3 [&_pre]:px-4 [&_pre_code]:font-mono [&_pre_code]:text-[13px] [&_pre_code]:bg-transparent [&_pre_code]:border-0 [&_pre_code]:p-0 [&_pre_code]:text-[var(--lesson-pre-text)] ${isDark ? 'dark prose-invert prose-p:text-[#A8B5C2] prose-p:leading-[1.65] prose-headings:text-[#ACB8C5] prose-headings:font-semibold prose-strong:text-[#ACB8C5] prose-a:text-blue-400 prose-li:text-[#A8B5C2] prose-li:leading-[1.65] prose-hr:border-zinc-800 prose-blockquote:border-l-4 prose-blockquote:text-[#6b7a89] prose-blockquote:not-italic prose-pre:bg-transparent' : 'prose-p:text-[#555555] prose-p:leading-[1.65] prose-headings:text-[#111111] prose-headings:font-semibold prose-strong:text-[#111111] prose-li:text-[#555555] prose-li:leading-[1.65] prose-a:text-blue-600 prose-hr:border-zinc-200 prose-blockquote:border-l-4 prose-blockquote:text-[#888888] prose-blockquote:not-italic prose-pre:bg-transparent'}`}
                  style={{
                    color: isDark ? '#A8B5C2' : '#555555',
                    fontSize: 15,
                    '--lesson-accent': accentColor,
                    '--lesson-accent-bg': `${accentColor}22`,
                    '--lesson-code-bg': isDark ? `${accentColor}18` : `${accentColor}12`,
                    '--lesson-pre-text': isDark ? '#c9d1d9' : '#1a1d2e',
                  } as React.CSSProperties}
                  dangerouslySetInnerHTML={{ __html: renderRichText(lesson.body) }}
                />
              ) : null}

              {/* Task / question instructions */}
              {question.question && (
                <>
                  {(lesson?.doc || lesson?.body || (isFirstTaskForLesson && lesson?.title)) && (
                    <hr className="my-4" style={{ borderColor: border }} />
                  )}
                  <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: accentColor }}>
                    Task
                  </p>
                  <div
                    className={`prose max-w-none ve-lesson-body [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[var(--lesson-accent)] [&_:not(pre)>code]:bg-[var(--lesson-accent-bg)] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 ${isDark ? 'dark prose-invert prose-p:text-[#A8B5C2] prose-p:leading-[1.65] prose-li:text-[#A8B5C2]' : 'prose-p:text-[#555555] prose-p:leading-[1.65] prose-li:text-[#555555]'}`}
                    style={{
                      fontSize: 15,
                      '--lesson-accent': accentColor,
                      '--lesson-accent-bg': `${accentColor}22`,
                    } as React.CSSProperties}
                    dangerouslySetInnerHTML={{ __html: renderRichText(String(question.question)) }}
                  />
                </>
              )}
            </div>
            )}

            {/* Hint tab */}
            {leftTab === 'hint' && (
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
              <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: isDark ? '#fcd34d' : '#92400e' }}>
                Hint
              </p>
              <ul className="space-y-3">
                {availableHints.map((h, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="w-7 h-7 flex-shrink-0 inline-flex items-center justify-center rounded-lg" style={{ color: isDark ? '#fcd34d' : '#a16207', background: isDark ? 'rgba(245,158,11,0.10)' : '#fffbeb' }}><Lightbulb className="w-3.5 h-3.5" /></span>
                    <p className="text-[14px] leading-relaxed" style={{ color: isDark ? '#A8B5C2' : '#555555' }}>{h}</p>
                  </li>
                ))}
              </ul>
            </div>
            )}
          </div>
        )}

        {/* ══════════ RESIZE HANDLE (desktop only) -- canvas seam between cards ══════════ */}
        {!isMobile && !examMode && leftOpen && (
          <div
            className="flex-shrink-0 group relative"
            style={{ width: 8, cursor: 'col-resize', background: 'transparent' }}
            onMouseDown={onResizeStart}
          >
            <div
              className="absolute inset-y-2 left-1/2 -translate-x-1/2 w-[3px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: accentColor }}
            />
          </div>
        )}

        {/* ══════════ RIGHT PANEL -- on mobile shows editor + results stacked on one page ══════════ */}
        {(!isMobile || mobileTab !== 'lesson') && (
        <div ref={rightPanelRef} className="flex-1 min-w-0 flex flex-col gap-2 sm:gap-0">

          {/* ---- EDITOR SECTION ---- */}
          {(!isMobile || mobileTab !== 'lesson') && (
          <div
            className="flex flex-col rounded-2xl overflow-hidden"
            style={{ flex: isMobile ? 1 : `0 0 ${editorPct}%`, minHeight: 0, background: editorBg }}
          >
            {/* Editor header */}
            <div
              className="flex-shrink-0 flex items-center gap-3 px-3 m-2 rounded-xl"
              style={{ height: 48, background: headerBg }}
            >
              {!isMobile && !examMode && (
                <button
                  type="button"
                  onClick={() => setLeftOpen(o => !o)}
                  className="w-8 h-8 grid place-items-center rounded-lg transition-opacity hover:opacity-70 flex-shrink-0"
                  style={{ background: subtle, color: muted }}
                  title={leftOpen ? 'Collapse lesson' : 'Expand lesson'}
                >
                  <Menu className="w-3.5 h-3.5" />
                </button>
              )}
              <span className="font-mono text-[12px] font-semibold" style={{ color: text }}>
                query.sql
              </span>
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => { setQuery(starterCode); setFeedback(null); setError(''); setResetKey(k => k + 1); }}
                className="w-8 h-8 grid place-items-center rounded-lg transition-opacity hover:opacity-70"
                style={{ background: subtle, color: muted }}
                title="Reset"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Solution notice */}
            {solutionRevealed && !completed && (
              <div
                className="flex-shrink-0 flex items-center gap-2.5 px-4 py-2"
                style={{ background: isDark ? 'rgba(52,211,153,0.10)' : 'rgba(52,211,153,0.10)' }}
              >
                <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#34d399' }}>Solution</span>
                <span className="text-[12px]" style={{ color: isDark ? '#A8B5C2' : '#555555' }}>
                  The solution has been loaded into the editor. Click Run Code to see the result.
                </span>
              </div>
            )}

            {/* CodeMirror */}
            <div className="flex-1 min-h-0">
              <CodeMirrorEditor
                key={`${question.id}:${editorSchemaKey}:${solutionRevealed ? 'sol' : 'edit'}:${resetKey}`}
                value={query}
                onChange={setQuery}
                isDark={isDark}
                bg={editorBg}
                accentColor={accentColor}
                schema={editorSchema}
                defaultTable={firstTableName || undefined}
              />
            </div>

            {/* Action bar -- wraps to extra rows on narrow screens instead of overflowing */}
            <div
              className="flex-shrink-0 flex flex-wrap items-center justify-end gap-2 sm:gap-2.5 px-4 py-3"
              style={{ background: 'transparent' }}
            >
              {examMode && onNext && !completed && (
                <button type="button" onClick={onNext}
                  className="mr-auto inline-flex items-center justify-center h-9 px-4 rounded-lg text-[13px] font-semibold transition-opacity hover:opacity-80"
                  style={{ color: muted, background: subtle }}>
                  Skip question
                </button>
              )}
              {canRevealSolution && !solutionRevealed && (
                <button
                  type="button"
                  onClick={() => { revealSolution(); setFeedbackDismissed(true); }}
                  disabled={solutionLoading}
                  className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold transition-opacity disabled:opacity-50 hover:opacity-80"
                  style={{ color: '#34d399', background: 'rgba(52,211,153,0.13)' }}
                >
                  {solutionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  View Solution
                  {solutionPenalty ? <span className="ml-1 text-[10px] font-semibold opacity-70">-{solutionPenalty} XP</span> : null}
                </button>
              )}
              <button
                type="button"
                onClick={runQuery}
                disabled={!runtime || busy}
                className="inline-flex items-center justify-center gap-2 h-9 px-5 rounded-lg text-[13px] font-semibold transition-opacity disabled:opacity-40 hover:opacity-80"
                style={{ background: subtle, color: text }}
              >
                {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                Run Code
              </button>
              {hasChecker && !completed && !solutionRevealed && (
                <button
                  type="button"
                  onClick={checkAnswer}
                  disabled={!runtime || busy}
                  className="inline-flex items-center justify-center gap-2 h-9 px-5 rounded-lg text-[13px] font-semibold transition-opacity disabled:opacity-40"
                  style={{ background: accentColor, color: '#ffffff' }}
                >
                  {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  Submit Answer
                </button>
              )}
              {solutionRevealed && !completed && onNext && (
                <button
                  type="button"
                  onClick={continueIncorrect}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 h-9 px-5 rounded-lg text-[13px] font-semibold transition-opacity disabled:opacity-40"
                  style={{ background: accentColor, color: '#ffffff' }}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                  {isLastQuestion ? 'Finish Course' : 'Continue'}
                </button>
              )}
              {completed && onNext && (
                <button
                  type="button"
                  onClick={onNext}
                  className="inline-flex items-center justify-center gap-2 h-9 px-5 rounded-lg text-[13px] font-semibold"
                  style={{ background: accentColor, color: '#ffffff' }}
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                  {isLastQuestion ? 'Finish Course' : 'Continue'}
                </button>
              )}
            </div>
          </div>
          )} {/* end editor section */}

          {/* ---- VERTICAL RESIZE HANDLE (desktop only) -- canvas seam between cards ---- */}
          {!isMobile && !examMode && (
          <div
            className="flex-shrink-0 group relative"
            style={{ height: 8, cursor: 'row-resize', background: 'transparent' }}
            onMouseDown={onVerticalResizeStart}
          >
            <div
              className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-[3px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: accentColor }}
            />
          </div>
          )}

          {/* ---- RESULTS SECTION ---- */}
          {(!isMobile || mobileTab !== 'lesson') && (
          <div className="flex flex-col rounded-2xl overflow-hidden" style={{ flex: isMobile ? 1 : '1 1 0%', minHeight: 0, background: resultsBg }}>

            {/* Tab bar -- pill tabs, no dividers */}
            <div
              className="flex-shrink-0 flex items-center gap-2 px-3 m-2 rounded-xl"
              style={{ height: 48, background: headerBg }}
            >
              <div className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0">
                {[
                  { id: 'result' as const, label: 'query result' },
                  ...tables.map(t => ({ id: t.tableName, label: t.tableName })),
                ].map(tab => {
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => { setActiveTab(tab.id); if (tab.id !== 'result') previewTable(tab.id); }}
                      className="flex-shrink-0 h-8 px-3 rounded-lg text-[12px] font-semibold whitespace-nowrap transition-colors"
                      style={{
                        background: active ? subtle : 'transparent',
                        color: active ? text : muted,
                      }}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex-1" />
              {activeTab === 'result' && visibleResult && (
                <span className="flex-shrink-0 text-[11px] tabular-nums" style={{ color: muted }}>
                  {displayedRowCount} of {totalRowCount} rows
                  {visibleResult.capped ? ` (capped at ${STUDENT_RESULT_LIMIT})` : ''}
                </span>
              )}
              {(activeTab === 'result' ? !!result : !!runtime) && (
                <button
                  type="button"
                  onClick={exportCurrent}
                  disabled={!!exportingTable}
                  className="flex-shrink-0 w-8 h-8 rounded-lg grid place-items-center transition-opacity hover:opacity-70 disabled:opacity-30"
                  style={{ background: subtle }}
                  title={activeTab === 'result' ? 'Export result as CSV' : `Export ${activeTab} as CSV`}
                >
                  {exportingTable === activeTab
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: muted }} />
                    : <Download className="w-3.5 h-3.5" style={{ color: muted }} />
                  }
                </button>
              )}
              <button
                type="button"
                onClick={() => setModal({ type: 'grid', title: activeTab === 'result' ? 'Query result' : `${activeTab} sample`, result: visibleResult })}
                className="flex-shrink-0 w-8 h-8 rounded-lg grid place-items-center transition-opacity hover:opacity-70"
                style={{ background: subtle }}
                title="Expand"
              >
                <Maximize2 className="w-3.5 h-3.5" style={{ color: muted }} />
              </button>
            </div>

            {/* Feedback panel -- appears above the grid, does not overlay it */}
            {activeTab === 'result' && feedback && !feedbackDismissed && (
              <div
                className="flex-shrink-0"
                style={{
                  background: feedback.passed
                    ? (isDark ? 'rgba(52,211,153,0.09)' : 'rgba(240,253,244,0.95)')
                    : (isDark ? 'rgba(239,68,68,0.09)' : 'rgba(255,245,245,0.95)'),
                }}
              >
                {/* Colored top stripe */}
                <div className="h-[3px]" style={{ background: feedback.passed ? '#34d399' : '#f87171' }} />

                <div className="flex items-start gap-4 px-5 py-4">
                  {/* Icon */}
                  <div
                    className="flex-shrink-0 w-9 h-9 rounded-full grid place-items-center mt-0.5"
                    style={{ background: feedback.passed ? 'rgba(52,211,153,0.15)' : 'rgba(239,68,68,0.15)' }}
                  >
                    {feedback.passed
                      ? <CheckCircle2 style={{ color: '#34d399', width: 18, height: 18 }} />
                      : <XCircle style={{ color: '#f87171', width: 18, height: 18 }} />
                    }
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[10px] font-bold uppercase tracking-widest mb-0.5"
                      style={{ color: feedback.passed ? '#34d399' : '#f87171' }}
                    >
                      {feedback.passed ? 'Correct' : 'Incorrect'}
                    </p>
                    <p className="text-[13px] font-semibold" style={{ color: isDark ? '#ACB8C5' : '#111111' }}>
                      {feedback.passed ? 'Your query is correct!' : 'There was a problem with your query'}
                      {' '}
                      <span className="font-normal" style={{ color: isDark ? '#A8B5C2' : '#555555' }}>{feedback.message}</span>
                    </p>
                  </div>

                  {/* Dismiss */}
                  <button
                    type="button"
                    onClick={() => setFeedbackDismissed(true)}
                    className="flex-shrink-0 w-7 h-7 grid place-items-center rounded-full transition-opacity hover:opacity-70"
                    style={{
                      background: feedback.passed ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
                      color: feedback.passed ? '#34d399' : '#f87171',
                    }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}


            {/* Grid area */}
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {/* AI error explanation -- lives outside the error conditional so it survives tab/state changes */}
              {errorExplain && (
                <div
                  className="flex-shrink-0 flex items-start gap-2.5 px-4 py-3"
                  style={{ background: `${accentColor}14` }}
                >
                  <Sparkles className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: accentColor }} />
                  <p className="text-[12.5px] leading-relaxed flex-1" style={{ color: text }}>{errorExplain}</p>
                  <button type="button" onClick={() => setErrorExplain('')} className="flex-shrink-0 opacity-50 hover:opacity-100 transition-opacity">
                    <X className="w-3.5 h-3.5" style={{ color: accentColor }} />
                  </button>
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-hidden">
              {activeTab === 'result' && error ? (
                <div className="p-5">
                  <div className="rounded-xl p-4" style={{ background: isDark ? 'rgba(239,68,68,0.08)' : 'rgba(239,68,68,0.05)' }}>
                    <pre className="text-[12px] text-red-400 whitespace-pre-wrap font-mono leading-relaxed">{error}</pre>
                    <button
                      type="button"
                      onClick={() => fetchErrorExplanation(error)}
                      disabled={explainLoading}
                      className="inline-flex items-center gap-1.5 mt-3 text-[12px] font-semibold transition-opacity disabled:opacity-40 hover:opacity-80"
                      style={{ color: accentColor }}
                    >
                      {explainLoading
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Sparkles className="w-3.5 h-3.5" />}
                      {explainLoading ? 'Explaining...' : 'What does this mean?'}
                    </button>
                  </div>
                </div>
              ) : sampleLoading === activeTab ? (
                <div className="h-full flex items-center justify-center gap-2" style={{ color: muted }}>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-[12px] font-medium">Loading sample rows...</span>
                </div>
              ) : (
                <div className="h-full overflow-hidden px-3 pb-3 pt-1">
                  <DataGrid
                    result={visibleResult}
                    isDark={isDark}
                    emptyMessage={activeTab === 'result' ? 'Run a query to see results' : 'No data available'}
                    onCellOpen={(title, value) => setModal({ type: 'cell', title, value })}
                  />
                </div>
              )}
            </div>

          </div>
          </div>
          )} {/* end results section */}
        </div>
        )} {/* end right panel wrapper */}

        </div> {/* end content row */}
      </div>

      {/* ══════════ MODAL ══════════ */}
      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={e => { if (e.target === e.currentTarget) setModal(null); }}
        >
          <div
            className="w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden"
            style={{
              background: editorBg,
              borderRadius: 18,
              boxShadow: isDark ? '0 24px 64px rgba(0,0,0,0.7)' : '0 24px 64px rgba(15,23,42,0.18)',
              color: text,
            }}
          >
            <div className="flex-none flex items-center justify-between gap-3 px-5 py-4" style={{ background: headerBg }}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: accentColor }}>
                  {modal.type === 'cell' ? 'Cell Value' : 'Data Preview'}
                </p>
                <h3 className="text-[14px] font-semibold">{modal.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                {modal.type === 'grid' && modal.result && modal.result.rows.length > 0 && (
                  <button
                    type="button"
                    onClick={() => exportToCsv(modal.result!, `${modal.title.replace(/\s+/g, '_')}.csv`)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold transition-opacity hover:opacity-70"
                    style={{ background: subtle, color: muted }}
                    title="Export as CSV"
                  >
                    <Download className="w-3.5 h-3.5" /> Export CSV
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="w-8 h-8 grid place-items-center rounded-lg transition-opacity hover:opacity-70"
                  style={{ background: subtle, color: muted }}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden p-4">
              {modal.type === 'cell' ? (
                <pre className="h-full min-h-[200px] overflow-auto rounded-xl p-4 text-[13px] whitespace-pre-wrap font-mono"
                  style={{ background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.03)', color: text }}>
                  {formatCell(modal.value) || 'NULL'}
                </pre>
              ) : (
                <div className="rounded-xl overflow-hidden" style={{ height: '65vh', background: isDark ? 'rgba(255,255,255,0.02)' : 'rgba(15,23,42,0.02)' }}>
                  <DataGrid
                    result={modal.result}
                    isDark={isDark}
                    emptyMessage="No rows to preview."
                    onCellOpen={(t, v) => setModal({ type: 'cell', title: t, value: v })}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
