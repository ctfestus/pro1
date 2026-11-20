'use client';

// Download list for an assignment's SOLUTION files (the instructor's model answer). Shared by the
// student results view and the dashboard, so both get the same gated download path: solution files
// live in a private bucket and are fetched as a short-lived signed URL through
// /api/assignments/solution-file. Links open directly.
//
// Renders the list only -- each surface wraps it in its own card.

import { useState } from 'react';
import { Download, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';
import { fetchSolutionFileUrl, type AssignmentSolution } from '@/lib/assignment-solutions';

export function SolutionFilesList({ solutions, C }: { solutions: AssignmentSolution[]; C: typeof LIGHT_C }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function download(s: AssignmentSolution) {
    setBusyId(s.id); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Your session expired. Please sign in again.');
      const url = await fetchSolutionFileUrl(s.id, session.access_token);
      // Served as an attachment, so this downloads without navigating away from the page.
      window.location.href = url;
    } catch (err: any) {
      setError(err?.message || 'Could not open the solution file.');
    } finally {
      setBusyId(null);
    }
  }

  const rowStyle = { background: C.pill, border: `1px solid ${C.divider}`, textDecoration: 'none' } as const;

  return (
    <div className="flex flex-col gap-2">
      {solutions.map(s => {
        const body = (
          <>
            <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: C.card }}>
              {s.kind === 'file'
                ? <FileText className="w-4 h-4" style={{ color: C.muted }}/>
                : <ExternalLink className="w-4 h-4" style={{ color: C.muted }}/>}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-[13px] font-medium truncate" style={{ color: C.text }}>{s.name}</p>
              <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>{s.kind === 'file' ? 'Solution file' : 'Solution link'}</p>
            </div>
            {busyId === s.id
              ? <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" style={{ color: C.faint }}/>
              : s.kind === 'file'
                ? <Download className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>
                : <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>}
          </>
        );
        return s.kind === 'file' ? (
          <button key={s.id} type="button" onClick={() => download(s)} disabled={busyId === s.id}
            className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-opacity hover:opacity-80 w-full"
            style={{ ...rowStyle, cursor: busyId === s.id ? 'wait' : 'pointer' }}>
            {body}
          </button>
        ) : (
          <a key={s.id} href={s.url ?? '#'} target="_blank" rel="noreferrer"
            className="flex items-center gap-3 rounded-2xl px-4 py-3 transition-opacity hover:opacity-80"
            style={rowStyle}>
            {body}
          </a>
        );
      })}
      {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
    </div>
  );
}
