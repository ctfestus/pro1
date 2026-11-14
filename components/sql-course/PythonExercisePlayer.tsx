'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Code2,
  Loader2,
  Lightbulb,
  Play,
  RotateCcw,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { acceptCompletion, autocompletion, completionKeymap, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, indentLess, indentMore } from '@codemirror/commands';
import { python, pythonLanguage } from '@codemirror/lang-python';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { sanitizeRichText } from '@/lib/sanitize';
import { SignInError } from '@/lib/fresh-session-fetch';
import { LessonRenderer } from '@/components/lesson/LessonRenderer';
import {
  initPythonRuntime,
  loadPythonDatasets,
  runPython,
  type PythonDatasetPreview,
  type PythonRuntime,
} from '@/lib/python-engine';
import type { LessonDoc } from '@/lib/lesson-doc';

// VSCode-style Python syntax highlighting
const pyDarkHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword,                                              color: '#569cd6', fontWeight: '600' },
  { tag: tags.string,                                               color: '#ce9178' },
  { tag: tags.special(tags.string),                                 color: '#ce9178' },
  { tag: tags.number,                                               color: '#b5cea8' },
  { tag: tags.comment,                                              color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.lineComment,                                          color: '#6a9955', fontStyle: 'italic' },
  { tag: tags.bool,                                                 color: '#569cd6' },
  { tag: tags.null,                                                 color: '#569cd6' },
  { tag: tags.function(tags.definition(tags.variableName)),         color: '#dcdcaa' },
  { tag: tags.definition(tags.variableName),                        color: '#dcdcaa' },
  { tag: tags.className,                                            color: '#4ec9b0' },
  { tag: tags.self,                                                 color: '#569cd6' },
  { tag: tags.operator,                                             color: '#d4d4d4' },
]));

const pyLightHighlight = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword,                                              color: '#af00db', fontWeight: '600' },
  { tag: tags.string,                                               color: '#a31515' },
  { tag: tags.special(tags.string),                                 color: '#a31515' },
  { tag: tags.number,                                               color: '#098658' },
  { tag: tags.comment,                                              color: '#008000', fontStyle: 'italic' },
  { tag: tags.lineComment,                                          color: '#008000', fontStyle: 'italic' },
  { tag: tags.bool,                                                 color: '#0000ff' },
  { tag: tags.null,                                                 color: '#0000ff' },
  { tag: tags.function(tags.definition(tags.variableName)),         color: '#795e26' },
  { tag: tags.definition(tags.variableName),                        color: '#795e26' },
  { tag: tags.className,                                            color: '#267f99' },
  { tag: tags.self,                                                 color: '#0070c1' },
]));

// ---- Custom completions: pandas / numpy / matplotlib + loaded dataset vars ----

const PANDAS_TOP = ['DataFrame','Series','Index','MultiIndex','DatetimeIndex','read_csv','read_json','read_excel','read_sql','read_parquet','read_html','concat','merge','merge_ordered','get_dummies','cut','qcut','to_datetime','to_timedelta','to_numeric','date_range','period_range','isnull','notnull','isna','notna','pivot','crosstab','melt','NA','NaT','Timestamp','Timedelta','options','set_option'].sort();

const DF_MEMBERS = ['head','tail','info','describe','sample','shape','dtypes','columns','index','values','size','ndim','to_numpy','to_csv','to_dict','to_json','to_excel','to_html','to_markdown','groupby','merge','join','pivot_table','pivot','melt','stack','unstack','explode','sort_values','sort_index','rank','rename','drop','drop_duplicates','dropna','fillna','ffill','bfill','replace','interpolate','filter','where','mask','apply','map','applymap','agg','aggregate','transform','pipe','value_counts','nunique','unique','duplicated','astype','copy','reset_index','set_index','reindex','sum','mean','median','std','var','min','max','count','quantile','mode','cumsum','cumprod','cummax','cummin','diff','pct_change','shift','corr','cov','skew','kurt','isnull','notnull','isna','notna','any','all','abs','round','clip','loc','iloc','at','iat','plot','hist','boxplot','str','dt','cat','nlargest','nsmallest','T','transpose','memory_usage'].sort();

const NUMPY_TOP = ['array','zeros','ones','empty','full','eye','identity','diag','arange','linspace','logspace','meshgrid','concatenate','stack','vstack','hstack','dstack','column_stack','split','reshape','ravel','flatten','squeeze','expand_dims','transpose','sum','mean','median','std','var','min','max','argmin','argmax','cumsum','cumprod','diff','dot','matmul','cross','inner','outer','sort','argsort','unique','searchsorted','where','nonzero','clip','round','floor','ceil','abs','sign','sqrt','exp','log','log2','log10','power','sin','cos','tan','arcsin','arccos','arctan','random','linalg','fft','nan','inf','pi','e','int32','int64','float32','float64','bool_','ndarray','dtype','newaxis','isinf','isnan','isfinite','maximum','minimum','percentile','quantile','count_nonzero','prod'].sort();

const PLT_TOP = ['plot','scatter','bar','barh','hist','boxplot','pie','errorbar','step','stem','stackplot','fill_between','imshow','pcolor','pcolormesh','contour','contourf','quiver','show','close','clf','cla','figure','subplot','subplots','savefig','gca','gcf','title','xlabel','ylabel','suptitle','legend','colorbar','xlim','ylim','axis','xticks','yticks','tick_params','grid','axhline','axvline','axhspan','axvspan','text','annotate','arrow','tight_layout','subplots_adjust','style','rcParams','rc','get_cmap'].sort();

const SCIPY_TOP = ['stats','optimize','linalg','interpolate','signal','special','integrate','sparse','fft'].sort();

const SCIPY_STATS = ['norm','uniform','t','chi2','f','binom','poisson','expon','beta','gamma','weibull_min','ttest_ind','ttest_1samp','ttest_rel','mannwhitneyu','wilcoxon','kruskal','chi2_contingency','ks_2samp','pearsonr','spearmanr','kendalltau','pointbiserialr','f_oneway','shapiro','normaltest','anderson','describe','zscore','iqr','sem','skew','kurtosis','mode','gmean','hmean','percentileofscore','rankdata'].sort();

const SCIPY_OPTIMIZE = ['minimize','minimize_scalar','curve_fit','linprog','fsolve','root','brentq','bisect','newton','least_squares','nnls'].sort();

const SCIPY_LINALG = ['solve','inv','det','eig','eigh','eigvals','svd','norm','lstsq','qr','lu','cholesky','expm','logm','solve_triangular','pinv'].sort();

// Pools reachable by multi-level prefix (e.g. sp.stats.xxx or stats.xxx after direct import)
const NESTED_POOLS: Record<string, { pool: string[]; detail: string }> = {
  'sp.stats':       { pool: SCIPY_STATS,    detail: 'scipy.stats' },
  'scipy.stats':    { pool: SCIPY_STATS,    detail: 'scipy.stats' },
  'sp.optimize':    { pool: SCIPY_OPTIMIZE, detail: 'scipy.optimize' },
  'scipy.optimize': { pool: SCIPY_OPTIMIZE, detail: 'scipy.optimize' },
  'sp.linalg':      { pool: SCIPY_LINALG,   detail: 'scipy.linalg' },
  'scipy.linalg':   { pool: SCIPY_LINALG,   detail: 'scipy.linalg' },
  // Also handle direct import: from scipy import stats stats.xxx
  'stats':    { pool: SCIPY_STATS,    detail: 'scipy.stats' },
  'optimize': { pool: SCIPY_OPTIMIZE, detail: 'scipy.optimize' },
};

function makePyCompletions(datasets: string[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w.]+/);
    if (!word || (word.from === word.to && !context.explicit)) return null;

    const text = word.text;
    const dot = text.lastIndexOf('.');

    if (dot > 0) {
      const obj = text.slice(0, dot);
      const partial = text.slice(dot + 1).toLowerCase();
      const from = word.from + dot + 1;

      // Multi-level: sp.stats.xxx, stats.xxx, scipy.optimize.xxx, etc.
      const nested = NESTED_POOLS[obj];
      if (nested) {
        return {
          from,
          options: nested.pool
            .filter(m => !partial || m.toLowerCase().startsWith(partial))
            .map(m => ({ label: m, type: 'function' as const, detail: nested.detail })),
          validFor: /^\w*$/,
        };
      }

      let pool: string[] = [];
      let detail = '';
      let type: 'function' | 'method' = 'function';

      if (obj === 'pd' || obj === 'pandas')    { pool = PANDAS_TOP;  detail = 'pandas'; }
      else if (obj === 'np' || obj === 'numpy') { pool = NUMPY_TOP;   detail = 'numpy'; }
      else if (obj === 'plt')                   { pool = PLT_TOP;     detail = 'matplotlib.pyplot'; }
      else if (obj === 'sp' || obj === 'scipy') { pool = SCIPY_TOP;   detail = 'scipy'; }
      else if (datasets.includes(obj))          { pool = DF_MEMBERS;  detail = 'DataFrame'; type = 'method'; }

      if (!pool.length) return null;

      return {
        from,
        options: pool
          .filter(m => !partial || m.toLowerCase().startsWith(partial))
          .map(m => ({ label: m, type, detail })),
        validFor: /^\w*$/,
      };
    }

    // Top-level: dataset vars + common package aliases
    const partial = text.toLowerCase();
    const topLevel = [
      ...datasets.map(d => ({ label: d, type: 'variable' as const, detail: 'DataFrame' })),
      { label: 'pd',     type: 'variable' as const, detail: 'pandas' },
      { label: 'np',     type: 'variable' as const, detail: 'numpy' },
      { label: 'plt',    type: 'variable' as const, detail: 'matplotlib.pyplot' },
      { label: 'sp',     type: 'variable' as const, detail: 'scipy' },
      { label: 'stats',  type: 'variable' as const, detail: 'scipy.stats' },
    ].filter(({ label }) => !partial || label.toLowerCase().startsWith(partial));

    if (!topLevel.length) return null;
    return { from: word.from, options: topLevel, validFor: /^\w*$/ };
  };
}

function PythonCodeEditor({
  value,
  onChange,
  isDark,
  bg,
  accentColor,
  readOnly = false,
  datasets = [],
}: {
  value: string;
  onChange: (v: string) => void;
  isDark: boolean;
  bg: string;
  accentColor: string;
  readOnly?: boolean;
  datasets?: string[];
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const reactId = useId();
  const uid = `cm-py-${reactId.replace(/:/g, '')}`;

  useEffect(() => {
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          python(),
          // Register custom completions (pandas/numpy/matplotlib + dataset vars) alongside python() builtins
          pythonLanguage.data.of({ autocomplete: makePyCompletions(datasets) }),
          keymap.of([
            { key: 'Tab', run: (v) => acceptCompletion(v) || indentMore(v) },
            { key: 'Shift-Tab', run: indentLess },
            ...completionKeymap.filter(b => b.key !== 'Tab'),
            ...defaultKeymap,
          ]),
          autocompletion({ activateOnTyping: true, closeOnBlur: false, maxRenderedOptions: 12 }),
          EditorView.lineWrapping,
          EditorView.editable.of(!readOnly),
          EditorView.theme({
            '&': { fontSize: '13.5px', height: '100%', background: bg, color: isDark ? '#d4d4d4' : '#1e1e1e' },
            '.cm-content': { padding: '14px 0 24px', caretColor: accentColor, color: isDark ? '#d4d4d4' : '#1e1e1e' },
            '.cm-line': { padding: '0 20px', lineHeight: '1.75' },
            '.cm-scroller': { fontFamily: '"JetBrains Mono","Fira Code",ui-monospace,monospace' },
            '.cm-gutters': { borderRight: 'none', background: bg, color: isDark ? '#444b6e' : '#c8d0e4', fontSize: '11px', minWidth: '44px' },
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
            '.cm-tooltip-autocomplete': { padding: '4px' },
            '.cm-tooltip-autocomplete ul': {
              fontFamily: '"JetBrains Mono","Fira Code",ui-monospace,monospace',
              fontSize: '12.5px',
              maxHeight: '220px',
              padding: '0',
            },
            '.cm-tooltip-autocomplete ul li': {
              display: 'flex', alignItems: 'center', padding: '5px 10px',
              borderRadius: '6px', lineHeight: '1.4',
              color: isDark ? '#c9d1e8' : '#2d3a52', transition: 'background 0.1s',
            },
            '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: `${accentColor}22`, color: isDark ? '#ffffff' : '#0f1a2e' },
            '.cm-completionIcon': { display: 'none' },
            '.cm-completionLabel': { fontFamily: '"JetBrains Mono","Fira Code",ui-monospace,monospace', fontSize: '12.5px' },
            '.cm-completionMatchedText': { color: accentColor, fontWeight: '700', textDecoration: 'none' },
            '.cm-completionDetail': { marginLeft: '8px', fontSize: '11px', opacity: '0.45', fontStyle: 'normal', fontFamily: 'ui-sans-serif,system-ui,sans-serif' },
          }),
          EditorView.updateListener.of(u => { if (u.docChanged && !readOnly) onChange(u.state.doc.toString()); }),
          isDark ? pyDarkHighlight : pyLightHighlight,
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);

  // Sync externally-driven value changes (e.g. reset button) into the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return (
    <div id={uid} className="h-full [&_.cm-editor]:h-full">
      <style>{`
        #${uid} .cm-cursor, #${uid} .cm-dropCursor {
          border-left-color: ${accentColor} !important;
          border-left-width: 2px !important;
        }
        #${uid} .cm-editor.cm-focused .cm-selectionBackground,
        #${uid} .cm-selectionBackground {
          background: ${accentColor}30 !important;
        }
        #${uid} .cm-editor:focus-visible { outline: none !important; }
      `}</style>
      <div ref={setHost} className="h-full" />
    </div>
  );
}

function renderRichText(html: string): string {
  return sanitizeRichText(
    html.replace(/`([^`]+)`/g, (_, code: string) =>
      `<code>${code.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))}</code>`
    )
  );
}

function parseSaved(saved?: string) {
  if (!saved) return null;
  try { return JSON.parse(saved); } catch { return { code: saved }; }
}

interface CheckResult {
  passed: boolean;
  message: string;
  proof?: string;
}

interface Props {
  question: any;
  isDark: boolean;
  accentColor: string;
  savedAnswer?: string;
  completed: boolean;
  topOffset?: number;
  leftOffset?: number;
  rightOffset?: number;
  sessionToken?: string;
  hintPenalty?: number;
  solutionPenalty?: number;
  onComplete: (payload: { code: string; output: string; passed: boolean; attempts?: number; solutionViewed?: boolean; skipped?: boolean; proof?: string }) => void;
  onHintUsed: () => void;
  onCheckAnswer?: (questionId: string, code: string, output: string) => Promise<CheckResult>;
  onRevealSolution?: (questionId: string, attempts: number) => Promise<string>;
  onNext?: () => void;
  isLastQuestion?: boolean;
  isFirstTaskForLesson?: boolean;
  examMode?: boolean;   // certifications: hide hints + View Solution (no answers shown in an exam)
}

function PythonPlots({ plots }: { plots: string[] }) {
  if (!plots.length) return null;
  return (
    <div className="mt-4 grid gap-4">
      {plots.map((src, idx) => (
        <div key={`${idx}:${src.length}`} className="rounded-xl overflow-hidden bg-white p-3 max-w-full">
          <img src={src} alt={`Python plot ${idx + 1}`} className="block max-w-full h-auto mx-auto" />
        </div>
      ))}
    </div>
  );
}

export default function PythonExercisePlayer({
  question,
  isDark,
  accentColor,
  savedAnswer,
  completed,
  topOffset = 0,
  leftOffset = 0,
  rightOffset = 0,
  sessionToken,
  hintPenalty,
  solutionPenalty,
  onComplete,
  onHintUsed,
  onNext,
  isLastQuestion,
  isFirstTaskForLesson = true,
  onCheckAnswer,
  onRevealSolution,
  examMode = false,
}: Props) {
  const saved = parseSaved(savedAnswer);
  const starterCode = String(question.pythonStarterCode ?? '# Write your Python code here\n').trimEnd();

  const [code, setCode]               = useState<string>(saved?.code || starterCode);
  const [output, setOutput]           = useState<string>(saved?.output ?? '');
  const [plots, setPlots]             = useState<string[]>([]);
  const [error, setError]             = useState<string>('');
  const [running, setRunning]         = useState(false);
  const [checking, setChecking]       = useState(false);
  const [feedback, setFeedback]       = useState<CheckResult | null>(
    (saved?.skipped || saved?.solutionViewed) ? null : (saved?.feedback ?? null)
  );
  const [failedAttempts, setFailedAttempts] = useState<number>(Number(saved?.attempts ?? 0));
  const [solutionRevealed, setSolutionRevealed] = useState<boolean>(!!saved?.solutionViewed);
  const [revealedSolution, setRevealedSolution] = useState<string>('');
  const [solutionLoading, setSolutionLoading] = useState(false);
  const [solutionError, setSolutionError] = useState('');
  const [leftOpen, setLeftOpen]       = useState(true);
  const [leftWidth, setLeftWidth]     = useState(420);
  const [editorPct, setEditorPct]     = useState(55);
  const [isMobile, setIsMobile]       = useState(false);
  const [mobileTab, setMobileTab]     = useState<'lesson' | 'code' | 'output'>('code');
  const [hintShown, setHintShown]     = useState(false);
  const [leftTab, setLeftTab]         = useState<'lesson' | 'hint'>('lesson');
  const [codeTab, setCodeTab]         = useState<'student' | 'solution'>('student');
  const [outputTab, setOutputTab]     = useState<string>('output');
  const [feedbackDismissed, setFeedbackDismissed] = useState(false);
  const [preparing, setPreparing]     = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const [datasetPreviews, setDatasetPreviews] = useState<Record<string, PythonDatasetPreview>>({});
  const [datasetsLoading, setDatasetsLoading] = useState(false);

  const pyRuntimeRef = useRef<PythonRuntime | null>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const vResizingRef = useRef(false);
  const vResizeStartY = useRef(0);
  const vResizeStartPct = useRef(0);

  const lesson = question?.lesson;
  const hasHints = !examMode && (question.pythonHints ?? []).filter(Boolean).length > 0;
  const hasChecker = !!question.pythonHasExpectedOutput || !!(question.pythonExpectedOutput?.trim());

  const runnableDatasets = () => (question.pythonDatasets ?? [])
    .filter((d: any) => d.variableName?.trim() && (d.csvUrl || d.fileUrl));

  async function createPreparedRuntime(previewRows = 0): Promise<{ runtime: PythonRuntime; previews: Record<string, PythonDatasetPreview> }> {
    const runtime = await initPythonRuntime(question.pythonSetupCode?.trim() || undefined);
    const datasets = runnableDatasets();
    const previews = datasets.length ? await loadPythonDatasets(runtime, datasets, previewRows) : {};
    return { runtime, previews };
  }

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Init Pyodide then load datasets -- re-runs when question changes
  useEffect(() => {
    let cancelled = false;
    pyRuntimeRef.current = null;
    setPreparing(true);
    setPrepareError('');
    setDatasetPreviews({});
    setDatasetsLoading(false);

    (async () => {
      try {
        const { runtime, previews } = await createPreparedRuntime(10);
        if (cancelled) return;
        pyRuntimeRef.current = runtime;
        setDatasetPreviews(previews);
        setDatasetsLoading(false);
        setPreparing(false);
      } catch (err: any) {
        if (!cancelled) {
          setPrepareError(err?.message || 'Could not load Python environment.');
          setPreparing(false);
        }
      }
    })();

    return () => { cancelled = true; };
  // question.id gates re-init; pythonDatasets/setupCode are stable once question loads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  function onResizeStart(e: React.MouseEvent) {
    resizingRef.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = leftWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      setLeftWidth(Math.max(200, Math.min(520, resizeStartW.current + ev.clientX - resizeStartX.current)));
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function onVerticalResizeStart(e: React.MouseEvent) {
    vResizingRef.current = true;
    vResizeStartY.current = e.clientY;
    vResizeStartPct.current = editorPct;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      if (!vResizingRef.current) return;
      const totalH = rightPanelRef.current?.offsetHeight ?? 1;
      const delta = ((ev.clientY - vResizeStartY.current) / totalH) * 100;
      setEditorPct(Math.max(25, Math.min(75, vResizeStartPct.current + delta)));
    };
    const onUp = () => {
      vResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const canvas    = isDark ? '#17181E' : '#F2F5FA';
  const leftBg    = isDark ? '#1E1F26' : '#ffffff';
  const editorBg  = isDark ? '#1E1F26' : '#ffffff';
  const outputBg  = isDark ? '#0d1117' : '#111827';
  const headerBg  = isDark ? '#17181E' : '#F2F5FA';
  const text      = isDark ? '#ACB8C5' : '#111111';
  const muted     = isDark ? '#A8B5C2' : '#555555';
  const subtle    = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)';


  async function runCode() {
    if (!pyRuntimeRef.current) return;
    const codeToRun = codeTab === 'solution' && revealedSolution ? revealedSolution : code;
    setRunning(true);
    setError('');
    setOutput('');
    setPlots([]);
    setFeedback(null);
    try {
      const { runtime } = await createPreparedRuntime(0);
      pyRuntimeRef.current = runtime;
      const res = await runPython(runtime, codeToRun);
      if (res.error) {
        setError(res.error);
      } else {
        const out = res.stdout + (res.returnValue !== null && !res.stdout.trim() ? `Out: ${res.returnValue}` : '');
        setOutput(out);
        setPlots(res.plots ?? []);
      }
    } catch (e: any) {
      setError(e?.message || 'Run failed.');
    } finally {
      setRunning(false);
      if (isMobile) setMobileTab('output');
    }
  }

  async function checkAnswer() {
    if (!pyRuntimeRef.current || !hasChecker) return;
    setChecking(true);
    setError('');
    setPlots([]);
    setFeedbackDismissed(false);
    try {
      const { runtime } = await createPreparedRuntime(0);
      pyRuntimeRef.current = runtime;
      const res = await runPython(runtime, code);
      if (res.error) {
        setError(res.error);
        const attempts = failedAttempts + 1;
        setFailedAttempts(attempts);
        onComplete({ code, output: '', passed: false, attempts, solutionViewed: solutionRevealed });
        return;
      }
      const actualOutput = res.stdout + (res.returnValue !== null && !res.stdout.trim() ? `Out: ${res.returnValue}` : '');
      setOutput(actualOutput);
      setPlots(res.plots ?? []);
      const check = onCheckAnswer
        ? await onCheckAnswer(question.id, code, actualOutput)
        : {
            passed: actualOutput.trim() === String(question.pythonExpectedOutput ?? '').trim(),
            message: actualOutput.trim() === String(question.pythonExpectedOutput ?? '').trim()
              ? 'Output matches.'
              : 'Output does not match the expected result.',
          };
      const attempts = check.passed ? failedAttempts : failedAttempts + 1;
      if (!check.passed) setFailedAttempts(attempts);
      setFeedback(check);
      if (onCheckAnswer && check.passed && !check.proof) {
        setError('Your output matched, but server verification did not complete. Please check your connection and try again.');
        return;
      }
      onComplete({ code, output: actualOutput, passed: check.passed, attempts, solutionViewed: solutionRevealed, feedback: check, proof: check.proof } as any);
    } catch (e: any) {
      setError(e?.message || 'Run failed.');
      // A sign-in problem says nothing about the answer, so it is not a failed attempt.
      if (!(e instanceof SignInError)) setFailedAttempts(failedAttempts + 1);
    } finally {
      setChecking(false);
      if (isMobile) setMobileTab('output');
    }
  }

  function continueIncorrect() {
    if (!onNext) return;
    onComplete({ code, output, passed: false, skipped: true, attempts: failedAttempts, solutionViewed: solutionRevealed });
    onNext();
  }

  async function doRevealSolution() {
    setSolutionLoading(true);
    setSolutionError('');
    let sol = '';
    try {
      sol = onRevealSolution
        ? await onRevealSolution(question.id, failedAttempts)
        : String(question.pythonSolution ?? '');
      setRevealedSolution(sol);
      setSolutionRevealed(true);
      if (sol) setCodeTab('solution');
      onComplete({ code: sol || code, output, passed: false, attempts: failedAttempts, solutionViewed: true });
    } catch (err: any) {
      setSolutionError(err?.message || 'Could not load the solution.');
      setSolutionLoading(false);
      return;
    }
    setSolutionLoading(false);

    // Auto-run the solution immediately using `sol` directly (not state, avoids React flush timing)
    if (sol && pyRuntimeRef.current) {
      setRunning(true);
      setError('');
      setOutput('');
      setPlots([]);
      setFeedback(null);
      try {
        const { runtime } = await createPreparedRuntime(0);
        pyRuntimeRef.current = runtime;
        const res = await runPython(runtime, sol);
        if (res.error) {
          setError(res.error);
        } else {
          const out = res.stdout + (res.returnValue !== null && !res.stdout.trim() ? `Out: ${res.returnValue}` : '');
          setOutput(out);
          setPlots(res.plots ?? []);
        }
      } catch (e: any) {
        setError(e?.message || 'Run failed.');
      } finally {
        setRunning(false);
        if (isMobile) setMobileTab('output');
      }
    }
  }

  if (preparing) {
    return (
      <div className="w-full flex items-center justify-center py-20" style={{ color: text }}>
        <div className="text-center">
          <div className="relative w-12 h-12 mx-auto mb-5">
            <div className="absolute inset-0 rounded-full border-2" style={{ borderColor: accentColor, opacity: 0.15 }} />
            <div className="absolute inset-0 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: accentColor }} />
            <Code2 className="absolute inset-0 m-auto w-5 h-5" style={{ color: accentColor }} />
          </div>
          <p className="font-semibold text-[14px] mb-1">Loading Python environment</p>
          <p className="text-[12px]" style={{ color: muted }}>This may take a moment on first load</p>
        </div>
      </div>
    );
  }

  if (prepareError) {
    return <div className="w-full p-5 text-[13px] text-red-400">{prepareError}</div>;
  }

  const feedbackVisible = feedback && !feedbackDismissed;
  const canReveal = !examMode && hasChecker && !completed && !revealedSolution;
  const showContinueAfterSolution = solutionRevealed && !completed && !!onNext;
  const showContinueWithoutChecker = !hasChecker && !completed && !!onNext;
  const showingSolutionTab = codeTab === 'solution' && !!revealedSolution;

  return (
    <div
      className="fixed bottom-0 right-0 z-40 flex flex-col overflow-hidden"
      style={{ top: topOffset, left: leftOffset, right: rightOffset, transition: 'left 300ms ease, right 300ms ease', background: canvas, color: text }}
    >
      <style>{`
        .task-body code { font-family: "JetBrains Mono","Fira Code",ui-monospace,monospace !important; font-size: 0.85em; background: ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}; color: ${isDark ? '#86efac' : '#166534'}; border-radius: 4px; padding: 1px 5px; }
        .task-body pre { font-family: "JetBrains Mono","Fira Code",ui-monospace,monospace; font-size: 0.85em; background: ${isDark ? '#0f1120' : '#f1f3f8'}; color: ${isDark ? '#c9d1d9' : '#1a1d2e'}; border-radius: 6px; padding: 12px 16px; margin: 0.75rem 0; overflow-x: auto; }
        .task-body pre code { background: none; padding: 0; border-radius: 0; color: inherit; font-size: inherit; }
        .task-body p { margin: 0 0 12px; }
        .task-body ul, .task-body ol { margin: 0 0 12px; padding-left: 22px; }
        .task-body li { margin: 4px 0; }
        .task-body h2, .task-body h3 { font-weight: 700; margin: 0 0 10px; }
        .task-body a { color: ${accentColor}; text-decoration: underline; }
        .task-body table { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
        .task-body th, .task-body td { border: 1px solid ${isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)'}; padding: 6px 10px; text-align: left; }
        .task-body th { font-weight: 700; background: ${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}; }
      `}</style>
      {/* EXAM MODE: the task reads like a normal certification question -- a centered heading on top (no "TASK" label or box), matching the multiple-choice question style. */}
      {examMode && question.question && (
        <div className="flex-shrink-0 px-6 pt-6 pb-1" style={{ maxHeight: '26vh', overflowY: 'auto' }}>
          <div className="task-body"
            style={/<(table|ul|ol|pre|h[1-4]|blockquote|img)/i.test(question.question)
              ? { textAlign: 'left', fontSize: 18, fontWeight: 400, lineHeight: 1.6, color: text, maxWidth: 940, margin: '0 auto' }
              : { textAlign: 'center', fontSize: 22, fontWeight: 700, lineHeight: 1.4, color: text, maxWidth: 940, margin: '0 auto' }}
            dangerouslySetInnerHTML={{ __html: renderRichText(question.question) }} />
        </div>
      )}

      {/* MOBILE TAB BAR */}
      {isMobile && (
        <div className="flex-shrink-0 flex items-stretch gap-1.5 px-2 pt-2">
          {!examMode && (lesson?.title || lesson?.doc || lesson?.body || question.question) && (
            <button type="button" onClick={() => setMobileTab('lesson')}
              className="flex-1 h-9 rounded-lg text-[12px] font-semibold transition-colors"
              style={{ background: mobileTab === 'lesson' ? leftBg : 'transparent', color: mobileTab === 'lesson' ? text : muted }}>
              Lesson
            </button>
          )}
          <button type="button" onClick={() => setMobileTab('code')}
            className="flex-1 h-9 rounded-lg text-[12px] font-semibold transition-colors"
            style={{ background: mobileTab === 'code' ? leftBg : 'transparent', color: mobileTab === 'code' ? text : muted }}>
            Code
          </button>
          <button type="button" onClick={() => setMobileTab('output')}
            className="flex-1 h-9 rounded-lg text-[12px] font-semibold transition-colors"
            style={{ background: mobileTab === 'output' ? leftBg : 'transparent', color: mobileTab === 'output' ? text : muted }}>
            Output
          </button>
        </div>
      )}

      {/* CONTENT ROW */}
      <div className="flex-1 min-h-0 flex overflow-hidden p-2 sm:p-3">

        {/* LEFT PANEL (hidden in exam mode -- the task is shown on top instead) */}
        {!examMode && (!isMobile ? leftOpen : mobileTab === 'lesson') && (
          <div className="flex flex-col rounded-2xl overflow-hidden"
            style={{ width: isMobile ? '100%' : leftWidth, flexShrink: 0, background: leftBg }}>
            <div className="flex-shrink-0 flex items-center gap-1 px-3 m-2 rounded-xl" style={{ height: 48, background: headerBg }}>
              <button type="button" onClick={() => setLeftTab('lesson')}
                className="flex-shrink-0 h-8 px-3 rounded-lg text-[12px] font-bold transition-colors"
                style={{ background: leftTab === 'lesson' ? subtle : 'transparent', color: leftTab === 'lesson' ? text : muted }}>
                Lesson
              </button>
              {hasHints && (
                <button type="button"
                  onClick={() => { setLeftTab('hint'); if (!hintShown) { setHintShown(true); onHintUsed(); } }}
                  className="flex-shrink-0 h-8 px-3 rounded-lg text-[12px] font-bold transition-colors"
                  style={{ background: leftTab === 'hint' ? subtle : 'transparent', color: leftTab === 'hint' ? text : muted }}>
                  <span className="inline-flex items-center gap-1.5"><Lightbulb className="w-3.5 h-3.5" /> Hint</span>{hintPenalty && !hintShown ? <span className="ml-1 text-[10px] font-semibold" style={{ color: isDark ? '#fca5a5' : '#dc2626' }}>-{hintPenalty} pts</span> : null}
                </button>
              )}
            </div>

            {leftTab === 'lesson' && (
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
                {isFirstTaskForLesson && lesson?.title && (
                  <h2 className="text-[18px] font-bold leading-snug mb-3" style={{ color: text }}>{lesson.title}</h2>
                )}
                {lesson?.videoUrl && (
                  <div className="rounded-xl overflow-hidden mb-4" style={{ aspectRatio: '16/9', background: '#000' }}>
                    <iframe src={lesson.videoUrl} className="w-full h-full" allowFullScreen />
                  </div>
                )}
                {(lesson?.doc || lesson?.body) && (
                  <div className="lesson-content" style={{ color: text }}>
                    {lesson.doc
                      ? <LessonRenderer doc={lesson.doc as LessonDoc} isDark={isDark} />
                      : <div dangerouslySetInnerHTML={{ __html: renderRichText(lesson.body ?? '') }} />}
                  </div>
                )}
                {question.question && (
                  <div className="mt-5 task-body" style={{ color: text }}>
                    <p className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: accentColor }}>Task</p>
                    <div className="mb-4" style={{ borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }} />
                    <div className="text-[15px] leading-relaxed"
                      dangerouslySetInnerHTML={{ __html: renderRichText(question.question) }} />
                  </div>
                )}
              </div>
            )}

            {leftTab === 'hint' && (
              <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5">
                <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: accentColor }}>Hints</p>
                {(question.pythonHints ?? []).filter(Boolean).map((hint: string, i: number) => (
                  <div key={i} className="mb-3 flex items-start gap-3 p-3 rounded-xl" style={{ background: subtle }}>
                    <span className="w-7 h-7 flex-shrink-0 inline-flex items-center justify-center rounded-lg" style={{ color: isDark ? '#fcd34d' : '#a16207', background: isDark ? 'rgba(245,158,11,0.10)' : '#fffbeb' }}><Lightbulb className="w-3.5 h-3.5" /></span>
                    <p className="text-[13px] leading-relaxed flex-1" style={{ color: text }}
                      dangerouslySetInnerHTML={{ __html: renderRichText(hint) }} />
                  </div>
                ))}
              </div>
            )}

          </div>
        )}

        {/* RESIZE HANDLE */}
        {!isMobile && !examMode && leftOpen && (
          <div onMouseDown={onResizeStart}
            className="flex-shrink-0 w-2 cursor-col-resize hover:bg-white/10 transition-colors mx-1 rounded-full" />
        )}

        {/* RIGHT PANEL -- exam mode (desktop) lays editor + output side by side; otherwise stacked. */}
        {(!isMobile || mobileTab === 'code' || mobileTab === 'output') && (
          <div ref={rightPanelRef} className={`flex-1 min-w-0 flex ${examMode && !isMobile ? 'flex-row gap-3' : 'flex-col gap-2 sm:gap-0'}`}>

            {/* CODE EDITOR SECTION */}
            {(!isMobile || mobileTab === 'code') && (
              <div className="flex flex-col rounded-2xl overflow-hidden"
                style={{ flex: isMobile ? 1 : (examMode ? '1 1 0%' : `0 0 ${editorPct}%`), minHeight: 0, minWidth: 0, background: editorBg }}>

                {/* Editor header */}
                <div className="flex-shrink-0 flex items-center gap-3 px-3 m-2 rounded-xl" style={{ height: 48, background: headerBg }}>
                  {!isMobile && !examMode && (
                    <button type="button" onClick={() => setLeftOpen(v => !v)}
                      className="w-8 h-8 grid place-items-center rounded-lg transition-opacity hover:opacity-70 flex-shrink-0"
                      style={{ background: subtle, color: muted }}
                      title={leftOpen ? 'Collapse lesson' : 'Expand lesson'}>
                      <ChevronRight className={`w-3.5 h-3.5 transition-transform ${leftOpen ? '' : 'rotate-180'}`} />
                    </button>
                  )}
                  <div className="flex items-center gap-1 min-w-0">
                    <button type="button" onClick={() => setCodeTab('student')}
                      className="h-8 px-3 rounded-lg text-[12px] font-bold transition-colors"
                      style={{ background: codeTab === 'student' ? subtle : 'transparent', color: codeTab === 'student' ? text : muted }}>
                      Student Code
                    </button>
                    {revealedSolution && (
                      <button type="button" onClick={() => setCodeTab('solution')}
                        className="h-8 px-3 rounded-lg text-[12px] font-bold transition-colors"
                        style={{ background: codeTab === 'solution' ? 'rgba(52,211,153,0.13)' : 'transparent', color: codeTab === 'solution' ? '#34d399' : muted }}>
                        Solution
                      </button>
                    )}
                  </div>
                  <div className="flex-1" />
                  <button type="button"
                    disabled={showingSolutionTab}
                    onClick={() => { setCode(starterCode); setOutput(''); setPlots([]); setError(''); setFeedback(null); }}
                    className="w-8 h-8 grid place-items-center rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                    style={{ background: subtle, color: muted }} title="Reset">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Solution notice */}
                {revealedSolution && !completed && (
                  <div className="flex-shrink-0 flex items-center gap-2.5 px-4 py-2"
                    style={{ background: 'rgba(52,211,153,0.10)' }}>
                    <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#34d399' }}>Solution</span>
                    <span className="text-[12px]" style={{ color: isDark ? '#A8B5C2' : '#555555' }}>
                      The solution is open in its own tab. Your code was not changed.
                    </span>
                  </div>
                )}

                {/* CodeMirror editor with Python syntax highlighting */}
                <div className="flex-1 min-h-0 relative">
                  <PythonCodeEditor
                    key={showingSolutionTab ? 'solution' : 'student'}
                    value={showingSolutionTab ? (revealedSolution ?? '') : code}
                    onChange={setCode}
                    isDark={isDark}
                    bg={editorBg}
                    accentColor={accentColor}
                    readOnly={showingSolutionTab}
                    datasets={(question.pythonDatasets ?? [])
                      .filter((d: any) => d.variableName?.trim())
                      .map((d: any) => d.variableName.trim())}
                  />
                </div>

                {/* ACTION BAR -- same position as SQL exercise */}
                <div className="flex-shrink-0 flex flex-wrap items-center justify-end gap-2 sm:gap-2.5 px-4 py-3">
                  {examMode && onNext && !completed && (
                    <button type="button" onClick={onNext}
                      className="mr-auto inline-flex items-center justify-center h-9 px-4 rounded-lg text-[13px] font-semibold transition-opacity hover:opacity-80"
                      style={{ color: muted, background: subtle }}>
                      Skip question
                    </button>
                  )}
                  {canReveal && (
                    <button type="button" onClick={doRevealSolution} disabled={solutionLoading}
                      className="inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg text-[13px] font-semibold transition-opacity disabled:opacity-50 hover:opacity-80"
                      style={{ color: '#34d399', background: 'rgba(52,211,153,0.13)' }}>
                      {solutionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      View Solution
                      {solutionPenalty ? <span className="ml-1 text-[10px] font-semibold opacity-70">-{solutionPenalty} XP</span> : null}
                    </button>
                  )}
                  <button type="button" onClick={runCode} disabled={running || checking || !pyRuntimeRef.current}
                    className="inline-flex items-center justify-center gap-2 h-9 px-5 rounded-lg text-[13px] font-semibold transition-opacity disabled:opacity-40 hover:opacity-80"
                    style={{ background: subtle, color: text }}>
                    {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    Run Code
                  </button>
                  {hasChecker && !completed && !solutionRevealed && (
                    <button type="button" onClick={checkAnswer} disabled={running || checking || !pyRuntimeRef.current}
                      className="inline-flex items-center justify-center gap-2 h-9 px-5 rounded-lg text-[13px] font-semibold transition-opacity disabled:opacity-40"
                      style={{ background: accentColor, color: '#ffffff' }}>
                      {checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Submit Answer
                    </button>
                  )}
                  {showContinueAfterSolution && (
                    <button type="button" onClick={continueIncorrect}
                      className="inline-flex items-center justify-center gap-2 h-9 px-5 rounded-lg text-[13px] font-semibold transition-opacity hover:opacity-80"
                      style={{ background: accentColor, color: '#ffffff' }}>
                      <ChevronRight className="w-3.5 h-3.5" />
                      {isLastQuestion ? 'Finish Course' : 'Continue'}
                    </button>
                  )}
                  {showContinueWithoutChecker && (
                    <button type="button" onClick={continueIncorrect}
                      className="inline-flex items-center justify-center gap-2 h-9 px-5 rounded-lg text-[13px] font-semibold transition-opacity hover:opacity-80"
                      style={{ background: accentColor, color: '#ffffff' }}>
                      <ChevronRight className="w-3.5 h-3.5" />
                      {isLastQuestion ? 'Finish Course' : 'Continue'}
                    </button>
                  )}
                  {completed && onNext && (
                    <button type="button" onClick={onNext}
                      className="inline-flex items-center justify-center gap-2 h-9 px-5 rounded-lg text-[13px] font-semibold"
                      style={{ background: accentColor, color: '#ffffff' }}>
                      {isLastQuestion ? 'Finish Course' : 'Next'}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {solutionError && <p className="text-[11.5px] text-red-400">{solutionError}</p>}
                </div>
              </div>
            )}

            {/* VERTICAL RESIZE HANDLE (only when editor is stacked above output) */}
            {!isMobile && !examMode && (
              <div onMouseDown={onVerticalResizeStart}
                className="flex-shrink-0 h-2 cursor-row-resize hover:bg-white/10 transition-colors rounded-full" />
            )}

            {/* OUTPUT PANEL */}
            {(!isMobile || mobileTab === 'output') && (
              <div className="flex flex-col rounded-2xl overflow-hidden"
                style={{ flex: isMobile ? 1 : `1 1 0%`, minHeight: 0, minWidth: 0, background: outputBg }}>

                {/* Tab bar: Output + one tab per dataset */}
                <div className="flex-shrink-0 flex items-center gap-1 px-3 overflow-x-auto no-scrollbar"
                  style={{ height: 40, background: isDark ? '#111318' : '#1a1f2e' }}>
                  <button type="button" onClick={() => setOutputTab('output')}
                    className="flex-shrink-0 h-7 px-3 rounded-md text-[11px] font-semibold transition-colors"
                    style={{ background: outputTab === 'output' ? 'rgba(255,255,255,0.08)' : 'transparent', color: outputTab === 'output' ? '#c9d1d9' : '#6b7a89' }}>
                    output
                  </button>
                  {(question.pythonDatasets ?? []).filter((d: any) => d.variableName?.trim() && d.csvUrl).map((ds: any) => (
                    <button key={ds.id} type="button" onClick={() => setOutputTab(`data:${ds.variableName}`)}
                      className="flex-shrink-0 h-7 px-3 rounded-md text-[11px] font-semibold transition-colors"
                      style={{ background: outputTab === `data:${ds.variableName}` ? 'rgba(255,255,255,0.08)' : 'transparent', color: outputTab === `data:${ds.variableName}` ? '#c9d1d9' : '#6b7a89' }}>
                      {ds.variableName}
                    </button>
                  ))}
                </div>

                {/* Output content */}
                {outputTab === 'output' && (
                  <div className="flex-1 min-h-0 overflow-auto p-4">
                    {error ? (
                      <>
                        <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: '#fda4af', fontFamily: '"JetBrains Mono",ui-monospace,monospace' }}>{error}</pre>
                        {plots.length > 0 && <PythonPlots plots={plots} />}
                      </>
                    ) : output || plots.length > 0 ? (
                      <>
                        {output && <pre className="text-[12.5px] leading-relaxed whitespace-pre-wrap" style={{ color: '#c9d1d9', fontFamily: '"JetBrains Mono",ui-monospace,monospace' }}>{output}</pre>}
                        {plots.length > 0 && <PythonPlots plots={plots} />}
                      </>
                    ) : (
                      <p className="text-[12px] italic" style={{ color: '#4a5568' }}>Run your code to see output here</p>
                    )}
                  </div>
                )}

                {/* Dataset preview content */}
                {outputTab.startsWith('data:') && (() => {
                  const varName = outputTab.slice(5);
                  const preview = datasetPreviews[varName];
                  const isLoading = datasetsLoading && !preview;
                  return (
                    <div className="flex-1 min-h-0 overflow-auto">
                      {isLoading && (
                        <div className="flex items-center gap-2 px-4 py-4">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: '#6b7a89' }} />
                          <span className="text-[12px]" style={{ color: '#6b7a89' }}>Loading {varName}...</span>
                        </div>
                      )}
                      {preview?.error && (
                        <p className="px-4 py-4 text-[12px]" style={{ color: '#fda4af' }}>Could not load {varName}: {preview.error}</p>
                      )}
                      {preview && !preview.error && preview.columns.length > 0 && (
                        <table className="text-[12px] border-collapse w-full">
                          <thead>
                            <tr>
                              {preview.columns.map(col => (
                                <th key={col} className="text-left px-4 py-2 whitespace-nowrap font-semibold"
                                  style={{ color: accentColor, background: isDark ? '#111318' : '#1a1f2e', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.rows.map((row, ri) => (
                              <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.03)' }}>
                                {row.map((cell, ci) => (
                                  <td key={ci} className="px-4 py-1.5 whitespace-nowrap font-mono"
                                    style={{ color: '#c9d1d9', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: 11.5 }}>
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  );
                })()}

                {/* FEEDBACK BANNER */}
                {feedbackVisible && (
                  <div className="flex-shrink-0 px-4 py-3 flex items-start gap-3"
                    style={{ background: feedback.passed ? 'rgba(16,185,129,0.12)' : 'rgba(244,63,94,0.12)', borderTop: `1px solid ${feedback.passed ? 'rgba(16,185,129,0.25)' : 'rgba(244,63,94,0.25)'}` }}>
                    {feedback.passed
                      ? <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#10b981' }} />
                      : <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#f43f5e' }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-semibold" style={{ color: feedback.passed ? '#10b981' : '#f43f5e' }}>
                        {feedback.passed ? 'Correct!' : 'Not quite right'}
                      </p>
                      {!feedback.passed && (
                        <pre className="text-[11.5px] mt-1 whitespace-pre-wrap" style={{ color: isDark ? '#94a3b8' : '#64748b', fontFamily: '"JetBrains Mono",ui-monospace,monospace' }}>
                          {feedback.message}
                        </pre>
                      )}
                    </div>
                    <button type="button" onClick={() => setFeedbackDismissed(true)}><X className="w-3.5 h-3.5" style={{ color: muted }} /></button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
