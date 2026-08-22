'use client';

// Runnable code block: a code snippet with copy-always and, for SQL, an in-browser
// Run powered by DuckDB-wasm; for Python, powered by Pyodide.
//
// SELF-CONTAINED: the node carries its own `code`, optional `setupSql` (seeds tables
// for SQL), and optional `setupPython` (runs before the main block for Python). On Run
// it lazily spins up its OWN runtime via lib/sql-engine or lib/python-engine -- it never
// depends on an ambient runtime, so it works the same in courses, VE, and assignment
// players. SQL queries run read-only (validated); Python runs unrestricted.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Play, Copy, Check, Loader2, Database, X, ChevronDown } from 'lucide-react';
import { NodeTextInput } from '@/components/lesson/nodes/NodeTextInput';
import { NodeDeleteButton } from '@/components/lesson/nodes/NodeControls';
import { CodeMirrorEditor } from '@/components/lesson/CodeMirrorEditorLazy';
import { LayeredBadgeIcon } from '@/components/lesson/LayeredBadgeIcon';
import { useLessonRuntime } from '@/components/lesson/LessonRuntimeContext';
import { useTheme } from '@/components/ThemeProvider';
import { initSQLRuntime, executeQuery, previewSqlTables, type SQLResult, type SQLRuntime } from '@/lib/sql-engine';
import { initPythonRuntime, runPython, previewDataFrames, type PythonResult, type PythonRuntime } from '@/lib/python-engine';

interface DatasetInfo { name: string; columns: string[]; rows: string[][]; rowCount: number }

const LANGUAGES = ['sql', 'javascript', 'python', 'bash', 'json', 'plaintext'];
const MAX_VISIBLE_ROWS = 50;

function PlaygroundBadgeIcon({ language }: { language: string }) {
  if (language === 'sql') {
    return (
      <LayeredBadgeIcon>
        <ellipse cx="11.3" cy="8.9" rx="4.7" ry="1.75" stroke="#fff" strokeWidth="1.55" />
        <path d="M6.6 8.9v5.8c0 1 2.1 1.8 4.7 1.8s4.7-.8 4.7-1.8V8.9M6.6 11.8c0 1 2.1 1.8 4.7 1.8s4.7-.8 4.7-1.8" stroke="#fff" strokeWidth="1.55" strokeLinecap="round" />
      </LayeredBadgeIcon>
    );
  }
  return (
    <LayeredBadgeIcon>
      <path d="m8.4 9.5-2.5 2.6 2.5 2.6M14.2 9.5l2.5 2.6-2.5 2.6M12.3 8.7l-2 7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </LayeredBadgeIcon>
  );
}

function playgroundTitle(language: string) {
  if (language === 'sql') return 'SQL playground';
  if (language === 'python') return 'Python playground';
  return `${language === 'plaintext' ? 'Code' : language.charAt(0).toUpperCase() + language.slice(1)} snippet`;
}

function RunnableCodeView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
  const language = (node.attrs.language as string) || 'sql';
  const code = (node.attrs.code as string) || '';
  const setupSql = (node.attrs.setupSql as string) || '';
  const setupPython = (node.attrs.setupPython as string) || '';
  const dataScope = (node.attrs.dataScope as string) === 'own' ? 'own' : 'shared';
  const isSql = language === 'sql';
  const isPython = language === 'python';
  const lessonRuntime = useLessonRuntime();
  const [setupOpen, setSetupOpen] = useState(() => setupSql.trim().length > 0 || setupPython.trim().length > 0);

  if (editor.isEditable) {
    // Runnable when Python, or SQL that has data: its own setup, or (when shared) the
    // lesson's shared data defined by some other block.
    const sharedSql = dataScope === 'shared' && (lessonRuntime?.hasSharedSql ?? false);
    const runnable = isPython || (isSql && (setupSql.trim().length > 0 || sharedSql));
    return (
      <NodeViewWrapper className="lesson-code" contentEditable={false}>
        <div className="lesson-code__bar">
          <div className="lesson-code__identity">
            <span className="lesson-code__identity-icon"><PlaygroundBadgeIcon language={language} /></span>
            <span className="lesson-code__identity-copy">
              <strong>{playgroundTitle(language)}</strong>
              <small data-on={runnable ? 'true' : 'false'}>{runnable ? 'Ready to run' : 'Copyable snippet'}</small>
            </span>
          </div>
          <span className="lesson-code__bar-right lesson-block-actions">
            <select
              className="lesson-code__lang"
              value={language}
              aria-label="Code language"
              onChange={(e) => updateAttributes({ language: e.target.value })}
            >
              {LANGUAGES.map((l) => <option key={l} value={l}>{l === 'plaintext' ? 'Plain text' : l.toUpperCase()}</option>)}
            </select>
            <NodeDeleteButton editor={editor} getPos={getPos} nodeSize={node.nodeSize} label="code block" />
          </span>
        </div>
        <NodeTextInput
          multiline
          className="lesson-code__editor"
          value={code}
          placeholder={isSql ? 'SELECT * FROM ...' : isPython ? 'print("Hello, world!")' : 'Code...'}
          onCommit={(v) => updateAttributes({ code: v })}
        />
        {(isSql || isPython) && (
          <div className="lesson-code__setup-shell" data-open={setupOpen ? 'true' : 'false'}>
            <div className="lesson-code__setup-head">
              <button
                type="button"
                className="lesson-code__setup-toggle"
                aria-expanded={setupOpen}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setSetupOpen((current) => !current)}
              >
                <Database width={14} height={14} aria-hidden="true" />
                <span><strong>Data & runtime setup</strong><small>{setupOpen ? 'Hide advanced setup' : 'Configure sample data and scope'}</small></span>
                <ChevronDown width={14} height={14} aria-hidden="true" />
              </button>
              <span className="lesson-code__scope" title="Where this block's data comes from">
                <button type="button" data-active={dataScope === 'shared' ? 'true' : 'false'} onMouseDown={(e) => { e.preventDefault(); updateAttributes({ dataScope: 'shared' }); }}>Shared</button>
                <button type="button" data-active={dataScope === 'own' ? 'true' : 'false'} onMouseDown={(e) => { e.preventDefault(); updateAttributes({ dataScope: 'own' }); }}>Isolated</button>
              </span>
            </div>
            {setupOpen && isSql && <div className="lesson-code__setup">
            <label className="lesson-code__setup-label">
              {dataScope === 'shared'
                ? 'Setup SQL (optional) - shared with the whole lesson; every shared block can query these tables'
                : 'Setup SQL (optional) - this block only; creates sample tables before the query runs'}
            </label>
            <NodeTextInput
              multiline
              className="lesson-code__editor"
              value={setupSql}
              placeholder="CREATE TABLE ...; INSERT INTO ... VALUES ...;"
              onCommit={(v) => updateAttributes({ setupSql: v })}
            />
            </div>}
            {setupOpen && isPython && <div className="lesson-code__setup">
            <label className="lesson-code__setup-label">
              {dataScope === 'shared'
                ? 'Setup Python (optional) - shared with the whole lesson; runs once before the shared blocks'
                : 'Setup Python (optional) - this block only; runs before the main code block'}
            </label>
            <NodeTextInput
              multiline
              className="lesson-code__editor"
              value={setupPython}
              placeholder="# import libraries or define helper functions here"
              onCommit={(v) => updateAttributes({ setupPython: v })}
            />
            </div>}
          </div>
        )}
      </NodeViewWrapper>
    );
  }

  return <RunnableCodePlayer language={language} initialCode={code} setupSql={setupSql} setupPython={setupPython} isSql={isSql} isPython={isPython} dataScope={dataScope} />;
}

function RunnableCodePlayer({ language, initialCode, setupSql, setupPython, isSql, isPython, dataScope }: {
  language: string;
  initialCode: string;
  setupSql: string;
  setupPython: string;
  isSql: boolean;
  isPython: boolean;
  dataScope: 'shared' | 'own';
}) {
  const lessonRuntime = useLessonRuntime();
  const { theme } = useTheme();
  // Prefer the lesson's own dark state (set by the player surface) so the editor and the
  // portaled data popover match the lesson, not the app theme; fall back to the app theme.
  const dark = lessonRuntime?.dark ?? theme === 'dark';
  // Use the lesson's shared runtime unless this block opts out ('own') or there is no
  // provider (block used outside a lesson) -- then fall back to its own runtime.
  const shared = dataScope === 'shared' ? lessonRuntime : null;

  const [code, setCode] = useState(initialCode);
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SQLResult | null>(null);
  const [pyResult, setPyResult] = useState<PythonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sqlRuntimeRef = useRef<SQLRuntime | null>(null);
  const pyRuntimeRef = useRef<PythonRuntime | null>(null);
  const dataBtnRef = useRef<HTMLButtonElement | null>(null);

  const [showData, setShowData] = useState(false);
  const [dataState, setDataState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [datasets, setDatasets] = useState<DatasetInfo[]>([]);
  const [dataTotal, setDataTotal] = useState(0);
  const [dataPos, setDataPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Python is always runnable. SQL needs data: its own setup, or (shared) the lesson's.
  const canRun = isPython || (isSql && (shared ? shared.hasSharedSql : setupSql.trim().length > 0));
  // Whether there is any data to preview (drives the "Data" toggle).
  const hasData = isPython
    ? (shared ? shared.hasSharedPython : setupPython.trim().length > 0)
    : (shared ? shared.hasSharedSql : setupSql.trim().length > 0);

  // Tear down only this block's OWN DuckDB runtime; the shared one is owned by the
  // provider. (Pyodide is a process singleton, no teardown.)
  useEffect(() => () => { sqlRuntimeRef.current?.close().catch(() => {}); }, []);

  // Resolve the runtime to use: the lesson's shared one, or this block's own (lazy).
  const resolveSql = useCallback(async (): Promise<SQLRuntime> => {
    if (shared) return shared.getSql();
    if (!sqlRuntimeRef.current) sqlRuntimeRef.current = await initSQLRuntime(setupSql.trim() ? [{ tableName: 'setup', seedSql: setupSql }] : []);
    return sqlRuntimeRef.current;
  }, [shared, setupSql]);
  const resolvePython = useCallback(async (): Promise<PythonRuntime> => {
    if (shared) return shared.getPython();
    if (!pyRuntimeRef.current) pyRuntimeRef.current = await initPythonRuntime(setupPython.trim() || undefined);
    return pyRuntimeRef.current;
  }, [shared, setupPython]);

  const copy = useCallback(() => {
    navigator.clipboard?.writeText(code).then(
      () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); },
      () => {},
    );
  }, [code]);

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setPyResult(null);
    try {
      if (isSql) {
        setResult(await executeQuery((await resolveSql()).conn, code));
      } else if (isPython) {
        const out = await runPython(await resolvePython(), code);
        if (out.error) setError(out.error); else setPyResult(out);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }, [code, isSql, isPython, resolveSql, resolvePython]);

  const toggleData = useCallback(async () => {
    if (showData) { setShowData(false); return; }
    const r = dataBtnRef.current?.getBoundingClientRect();
    if (r) {
      const width = Math.min(520, window.innerWidth - 24);
      setDataPos({ top: r.bottom + 6, left: Math.max(12, Math.min(r.right - width, window.innerWidth - width - 12)), width });
    }
    setShowData(true);
    if (dataState === 'idle' || dataState === 'error') {
      setDataState('loading');
      try {
        if (isSql) {
          const rt = await resolveSql();
          setDatasets(await previewSqlTables(rt, { maxTables: 12 }));
          setDataTotal(rt.tables.length);
        } else {
          const ds = await previewDataFrames(await resolvePython());
          setDatasets(ds);
          setDataTotal(ds.length);
        }
        setDataState('done');
      } catch { setDataState('error'); }
    }
  }, [showData, dataState, isSql, resolveSql, resolvePython]);

  return (
    <NodeViewWrapper className="lesson-code" contentEditable={false}>
      <div className="lesson-code__bar">
        <div className="lesson-code__identity">
          <span className="lesson-code__identity-icon"><PlaygroundBadgeIcon language={language} /></span>
          <span className="lesson-code__identity-copy">
            <strong>{playgroundTitle(language)}</strong>
            <small data-on={canRun ? 'true' : 'false'}>{canRun ? 'Ready to run' : 'Copyable snippet'}</small>
          </span>
        </div>
        <div className="lesson-code__actions">
          {canRun && (
            <button type="button" className="lesson-code__btn" data-primary="true" onClick={run} disabled={running}>
              {running ? <Loader2 className="lesson-code__spin" width={13} height={13} /> : <Play width={13} height={13} />}
              {running ? 'Running' : 'Run'}
            </button>
          )}
          {hasData && (
            <button ref={dataBtnRef} type="button" className="lesson-code__btn" data-active={showData ? 'true' : 'false'} onClick={toggleData}>
              <Database width={13} height={13} /> Data
            </button>
          )}
          <button type="button" className="lesson-code__btn" data-success={copied ? 'true' : 'false'} onClick={copy}>
            {copied ? <Check width={13} height={13} /> : <Copy width={13} height={13} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {showData && (
        <DatasetPopover
          datasets={datasets}
          state={dataState}
          total={dataTotal}
          isSql={isSql}
          dark={dark}
          pos={dataPos}
          anchorRef={dataBtnRef}
          onClose={() => setShowData(false)}
        />
      )}

      {canRun ? (
        <CodeMirrorEditor
          value={code}
          language={language}
          dark={dark}
          onChange={setCode}
          onRun={run}
          placeholder={isSql ? 'SELECT ...' : isPython ? 'print("Hello, world!")' : ''}
        />
      ) : (
        <pre className="lesson-code__pre"><code>{code}</code></pre>
      )}

      {error && <div className="lesson-code__error">{error}</div>}
      {result && <ResultTable result={result} />}
      {pyResult && <PythonOutput result={pyResult} />}
    </NodeViewWrapper>
  );
}

// The "Available data" preview, portaled to <body> so it floats over the lesson instead
// of pushing content down, and is never clipped by the lesson card's overflow. Anchored
// under the Data button; one tab per table/DataFrame; closes on outside-click/Escape/scroll.
function DatasetPopover({ datasets, state, total, isSql, dark, pos, anchorRef, onClose }: {
  datasets: DatasetInfo[];
  state: 'idle' | 'loading' | 'done' | 'error';
  total: number;
  isSql: boolean;
  dark: boolean;
  pos: { top: number; left: number; width: number } | null;
  anchorRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as globalThis.Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [anchorRef, onClose]);

  if (!pos || typeof document === 'undefined') return null;
  const ds = datasets[Math.min(active, Math.max(0, datasets.length - 1))];

  return createPortal(
    <div
      ref={panelRef}
      className={`lesson-content lesson-data-pop ${dark ? 'dark' : ''}`}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
    >
      <div className="lesson-data-pop__head">
        <span>Available data</span>
        <button type="button" onClick={onClose} aria-label="Close data preview"><X width={14} height={14} /></button>
      </div>
      {state === 'loading' && <p className="lesson-data-pop__note">Loading data...</p>}
      {state === 'error' && <p className="lesson-data-pop__note">Could not load the data preview.</p>}
      {state === 'done' && datasets.length === 0 && (
        <p className="lesson-data-pop__note">No {isSql ? 'tables' : 'dataframes'} available yet.</p>
      )}
      {state === 'done' && datasets.length > 0 && ds && (
        <>
          {datasets.length > 1 && (
            <div className="lesson-data-pop__tabs">
              {datasets.map((d, i) => (
                <button key={d.name} type="button" data-active={i === active ? 'true' : 'false'} onClick={() => setActive(i)}>{d.name}</button>
              ))}
            </div>
          )}
          <div className="lesson-data-pop__meta">
            <strong>{ds.name}</strong>
            <span>{ds.rowCount.toLocaleString()} row{ds.rowCount === 1 ? '' : 's'}, {ds.columns.length} col{ds.columns.length === 1 ? '' : 's'}</span>
          </div>
          <div className="lesson-code__result">
            <div className="lesson-code__result-scroll">
              <table>
                <thead><tr>{ds.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
                <tbody>{ds.rows.map((r, ri) => <tr key={ri}>{r.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>)}</tbody>
              </table>
            </div>
          </div>
          {total > datasets.length && (
            <p className="lesson-data-pop__note">Showing {datasets.length} of {total} tables.</p>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}

function PythonOutput({ result }: { result: PythonResult }) {
  const hasStdout = result.stdout.trim().length > 0;
  const hasReturn = result.returnValue !== null && !hasStdout;
  const hasPlots = (result.plots ?? []).length > 0;
  if (!hasStdout && !hasReturn && !hasPlots) {
    return <p className="lesson-code__result-note">Code ran. No output.</p>;
  }
  return (
    <div className="lesson-code__stdout">
      {hasStdout && <pre className="lesson-code__stdout-pre">{result.stdout}</pre>}
      {hasReturn && <pre className="lesson-code__stdout-pre lesson-code__stdout-pre--return">Out: {result.returnValue}</pre>}
      {hasPlots && (
        <div className="lesson-code__plots">
          {(result.plots ?? []).map((src, idx) => (
            <div className="lesson-code__plot" key={`${idx}:${src.length}`}>
              <img src={src} alt={`Python plot ${idx + 1}`} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ResultTable({ result }: { result: SQLResult }) {
  const rows = result.rows.slice(0, MAX_VISIBLE_ROWS);
  const total = result.totalRows ?? result.rows.length;
  return (
    <div className="lesson-code__result">
      {result.columns.length > 0 ? (
        <div className="lesson-code__result-scroll">
          <table>
            <thead>
              <tr>{result.columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>{r.map((cell, ci) => <td key={ci}>{cell == null ? 'NULL' : String(cell)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="lesson-code__result-note">
        {result.rows.length === 0
          ? 'Query ran. No rows returned.'
          : total > rows.length
            ? `Showing ${rows.length} of ${total} rows`
            : `${result.rows.length} row${result.rows.length === 1 ? '' : 's'}`}
      </p>
    </div>
  );
}

export const RunnableCode = Node.create({
  name: 'runnableCode',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      language: { default: 'sql' },
      code: { default: '' },
      setupSql: { default: '' },
      setupPython: { default: '' },
      // 'shared' (default): runs against the lesson's shared runtime, so this block's
      // setup is pooled with the other shared blocks and any of them can query it.
      // 'own': isolated -- this block runs only its own setup in its own runtime.
      dataScope: { default: 'shared' },
    };
  },

  parseHTML() {
    return [{ tag: 'pre[data-runnable-code]' }];
  },

  // Fallback HTML: a static pre/code block (sanitizer keeps pre + code). Run/copy and
  // the setup script live only in the canonical doc.
  renderHTML({ node, HTMLAttributes }) {
    return ['pre', mergeAttributes(HTMLAttributes, { 'data-runnable-code': '' }), ['code', (node.attrs.code as string) || '']];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RunnableCodeView);
  },
});
