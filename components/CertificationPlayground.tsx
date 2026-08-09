'use client';

// Non-graded runnable code scratchpad attached to a certification question. The student runs SQL
// (DuckDB-wasm) or Python (Pyodide) to work out the answer, then answers the question normally.
// It carries no expected output / solution, so nothing here is graded or leaks an answer key.
// Reuses the same engines + editor as the lesson runnable-code block.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Loader2 } from 'lucide-react';
import { CodeMirrorEditor } from '@/components/lesson/CodeMirrorEditor';
import { initSQLRuntime, executeQuery, type SQLResult, type SQLRuntime } from '@/lib/sql-engine';
import { initPythonRuntime, runPython, loadPythonDatasets, type PythonResult, type PythonRuntime } from '@/lib/python-engine';

const MAX_ROWS = 50;

export type PlaygroundConfig = {
  language?: 'sql' | 'python';
  setupSql?: string;
  setupPython?: string;
  starterCode?: string;
  sqlTables?: { tableName: string; fileUrl?: string; csvUrl?: string; seedSql?: string }[];
  pythonDatasets?: { id?: string; variableName: string; fileUrl?: string; csvUrl?: string }[];
};

export function CertificationPlayground({ playground, accentColor }: { playground: PlaygroundConfig; accentColor: string }) {
  const isSql = (playground.language ?? 'sql') === 'sql';
  const [code, setCode] = useState(playground.starterCode ?? '');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SQLResult | null>(null);
  const [pyResult, setPyResult] = useState<PythonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sqlRef = useRef<SQLRuntime | null>(null);
  const pyRef = useRef<PythonRuntime | null>(null);

  useEffect(() => () => { sqlRef.current?.close?.().catch(() => {}); }, []);

  const run = useCallback(async () => {
    setRunning(true); setError(null); setResult(null); setPyResult(null);
    try {
      if (isSql) {
        if (!sqlRef.current) {
          const tables = [
            ...((playground.sqlTables ?? []).filter(t => t.tableName && (t.fileUrl || t.csvUrl || t.seedSql))),
            ...(playground.setupSql?.trim() ? [{ tableName: 'setup', seedSql: playground.setupSql }] : []),
          ];
          sqlRef.current = await initSQLRuntime(tables);
        }
        setResult(await executeQuery(sqlRef.current.conn, code));   // read-only validated by default
      } else {
        if (!pyRef.current) {
          pyRef.current = await initPythonRuntime(playground.setupPython?.trim() || undefined);
          if (playground.pythonDatasets?.length) await loadPythonDatasets(pyRef.current, playground.pythonDatasets);
        }
        const out = await runPython(pyRef.current, code);
        if (out.error) setError(out.error); else setPyResult(out);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }, [code, isSql, playground.setupSql, playground.setupPython, playground.sqlTables, playground.pythonDatasets]);

  const border = 'rgba(255,255,255,0.10)';
  return (
    <div style={{ borderRadius: 16, overflow: 'hidden', background: '#0c0d12', border: `1px solid ${border}`, boxShadow: '0 18px 48px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#111318', borderBottom: `1px solid ${border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'flex', gap: 5 }} aria-hidden="true">
            <span style={{ width: 8, height: 8, borderRadius: 999, background: '#fb7185' }} />
            <span className="animate-pulse" style={{ width: 8, height: 8, borderRadius: 999, background: '#fbbf24' }} />
            <span style={{ width: 8, height: 8, borderRadius: 999, background: '#34d399' }} />
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af' }}>
            {isSql ? 'SQL' : 'Python'} workspace
          </span>
        </div>
        <button type="button" onClick={run} disabled={running}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 14px', borderRadius: 8, background: accentColor, color: '#06281a', fontSize: 12.5, fontWeight: 700, cursor: running ? 'default' : 'pointer', opacity: running ? 0.7 : 1 }}>
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />} Run
        </button>
      </div>

      <CodeMirrorEditor
        value={code}
        language={isSql ? 'sql' : 'python'}
        dark
        onChange={setCode}
        onRun={run}
        placeholder={isSql ? 'SELECT ...' : 'print(...)'}
      />

      <div style={{ maxHeight: 260, overflow: 'auto', borderTop: `1px solid ${border}` }}>
        {error && (
          <pre style={{ margin: 0, padding: 12, fontSize: 12.5, lineHeight: 1.5, color: '#fda4af', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' }}>{error}</pre>
        )}
        {!error && result && <SqlResultTable result={result} />}
        {!error && pyResult && (
          <div style={{ padding: 12 }}>
            {pyResult.stdout.trim()
              ? <pre style={{ margin: 0, fontSize: 12.5, lineHeight: 1.5, color: '#c9d1d9', whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace' }}>{pyResult.stdout}</pre>
              : pyResult.returnValue != null
                ? <pre style={{ margin: 0, fontSize: 12.5, color: '#c9d1d9', fontFamily: 'ui-monospace, monospace' }}>Out: {pyResult.returnValue}</pre>
                : (pyResult.plots ?? []).length === 0 && <p style={{ margin: 0, fontSize: 12, fontStyle: 'italic', color: '#4a5568' }}>Code ran. No output.</p>}
            {(pyResult.plots ?? []).map((src, i) => (
              <img key={i} src={src} alt={`plot ${i + 1}`} style={{ display: 'block', maxWidth: '100%', marginTop: 10, borderRadius: 8 }} />
            ))}
          </div>
        )}
        {!error && !result && !pyResult && (
          <p style={{ margin: 0, padding: 12, fontSize: 12, fontStyle: 'italic', color: '#4a5568' }}>Run your code to explore the data before answering.</p>
        )}
      </div>
    </div>
  );
}

// Mirrors the main SQL player's DataGrid (dark): #-numbered rows, uppercase bold headers, font-mono cells.
function SqlResultTable({ result }: { result: SQLResult }) {
  const divider = 'rgba(255,255,255,0.05)';
  const headerBg = '#1b1b1f';
  const rowBg = '#1E1F26';
  const numColor = '#2e3355';
  const rows = result.rows.slice(0, MAX_ROWS);
  const total = result.totalRows ?? result.rows.length;
  if (!result.columns.length) {
    return <p className="font-mono" style={{ margin: 0, padding: 12, fontSize: 12, color: '#8a8a93' }}>Query ran. No rows returned.</p>;
  }
  return (
    <div>
      <div style={{ overflow: 'auto' }}>
        <table className="min-w-max w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky top-0 left-0 z-20 w-10 px-3 py-2.5 text-right font-mono text-[10px]"
                style={{ background: headerBg, borderBottom: `1px solid ${divider}`, color: numColor }}>#</th>
              {result.columns.map((col, ci) => (
                <th key={`${ci}:${col}`}
                  className="sticky top-0 z-10 px-4 py-2.5 text-left text-[10px] font-bold tracking-widest uppercase whitespace-nowrap"
                  style={{ background: headerBg, borderBottom: `1px solid ${divider}`, color: '#7c85b8' }}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="sticky left-0 z-10 px-3 py-2.5 text-right font-mono text-[10px] tabular-nums"
                  style={{ background: rowBg, color: numColor, borderBottom: `1px solid ${divider}` }}>{i + 1}</td>
                {row.map((cell, j) => {
                  const val = cell == null ? '' : String(cell);
                  return (
                    <td key={j} className="px-4 py-2.5 align-top max-w-[300px]" title={val}
                      style={{ background: rowBg, borderBottom: `1px solid ${divider}` }}>
                      {val
                        ? <span className="block truncate font-mono text-[12.5px]" style={{ color: '#c9d1d9' }}>{val}</span>
                        : <span className="font-mono text-[11px] italic" style={{ color: numColor }}>NULL</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > rows.length && <p className="font-mono" style={{ margin: 0, padding: '6px 12px', fontSize: 11.5, color: '#8a8a93' }}>Showing {rows.length} of {total} rows</p>}
    </div>
  );
}
