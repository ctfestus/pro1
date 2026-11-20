'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.
// Imports content/assignment/VE export JSON files (single or bulk) via /api/content-import.

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';

type BulkSummary = { created: number; updated: number; failed: number; warnings: number };
type ImportState =
  | { status: 'idle' }
  | { status: 'importing'; current: number; total: number }
  | { status: 'done'; summary: BulkSummary }
  | { status: 'warning'; message: string }
  | { status: 'error'; message: string };

export function ImportButton({ types, onImported, onBulkDone, C, className, style }: {
  types: string[];
  onImported: (result: { id: string; type: string }) => void;
  onBulkDone?: () => void;
  C: typeof LIGHT_C;
  /** The button's look on pages in the newer admin style. */
  className?: string;
  style?: React.CSSProperties;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<ImportState>({ status: 'idle' });

  const postItem = async (item: any, token: string) => {
    const res = await fetch('/api/content-import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...item, mode: 'sync' }),
    });
    return res.json();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setState({ status: 'importing', current: 0, total: 1 });
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (payload.exportVersion !== 1) throw new Error('Unrecognised export file.');

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';

      if (payload.bulkExport === true) {
        const items: any[] = payload.items ?? [];
        const invalid = items.filter(it => !types.includes(it.type));
        if (invalid.length) throw new Error(`Bulk file contains "${invalid[0].type}" which is not allowed here.`);
        const summary: BulkSummary = { created: 0, updated: 0, failed: 0, warnings: 0 };
        setState({ status: 'importing', current: 0, total: items.length });
        for (let i = 0; i < items.length; i++) {
          setState({ status: 'importing', current: i + 1, total: items.length });
          try {
            const result = await postItem(items[i], token);
            if (result.error) {
              summary.failed++;
            } else {
              if (Array.isArray(result.sqlWarnings) && result.sqlWarnings.length) summary.warnings += result.sqlWarnings.length;
              if (result.action === 'updated') { summary.updated++; } else { summary.created++; }
            }
          } catch { summary.failed++; }
        }
        setState({ status: 'done', summary });
        setTimeout(() => { setState({ status: 'idle' }); onBulkDone?.(); }, 2500);
      } else {
        if (!types.includes(payload.type)) throw new Error(`File is a "${payload.type}", expected ${types.join(' or ')}.`);
        const res = await fetch('/api/content-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        const result = await res.json();
        if (result.error) {
          const issueText = Array.isArray(result.issues) && result.issues.length ? ` ${result.issues[0]}` : '';
          throw new Error(`${result.error}${issueText}`);
        }
        const warning = Array.isArray(result.sqlWarnings) && result.sqlWarnings.length ? result.sqlWarnings[0] : '';
        setState(warning ? { status: 'warning', message: `Imported with SQL warning: ${warning}` } : { status: 'idle' });
        onImported(result);
        if (warning) setTimeout(() => setState({ status: 'idle' }), 5000);
      }
    } catch (err: any) {
      setState({ status: 'error', message: err.message || 'Import failed.' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const busy = state.status === 'importing';
  const label = state.status === 'importing'
    ? `${state.current}/${state.total}`
    : state.status === 'done'
    ? `+${state.summary.created} ~${state.summary.updated} !${state.summary.warnings} x${state.summary.failed}`
    : 'Import';

  return (
    <div className="relative">
      <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleFile} />
      <button onClick={() => { setState({ status: 'idle' }); fileRef.current?.click(); }} disabled={busy}
        className={className ?? 'flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50'}
        style={style ?? { background: C.card, color: state.status === 'done' ? C.green : state.status === 'warning' ? '#f59e0b' : C.muted }}>
        <Upload className={style ? 'w-4 h-4' : 'w-3.5 h-3.5'} /> {label}
      </button>
      {(state.status === 'error' || state.status === 'warning') && (
        <p className="absolute top-full left-0 mt-1 text-xs px-3 py-2 rounded-xl z-10 whitespace-nowrap"
          style={state.status === 'error'
            ? { background: C.deleteBg, color: C.deleteText, border: `1px solid ${C.deleteBorder}` }
            : { background: 'rgba(245,158,11,0.12)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.30)' }}>
          {state.message}
        </p>
      )}
    </div>
  );
}
