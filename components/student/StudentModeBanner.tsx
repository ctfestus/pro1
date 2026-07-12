'use client';

import { LogOut, ShieldAlert } from 'lucide-react';
import { clearStudentMode, STUDENT_MODE_HEADER, type StudentModeContext } from '@/lib/student-mode-client';
import { supabase } from '@/lib/supabase';

export function StudentModeBanner({ context, fixed = false }: { context: StudentModeContext | null; fixed?: boolean }) {
  if (!context) return null;
  const exit = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await fetch('/api/student-mode', {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            [STUDENT_MODE_HEADER]: context.sessionId,
          },
        });
      }
    } catch {
      // Exiting locally must never be blocked by an audit request.
    }
    clearStudentMode();
    window.location.href = '/dashboard#students';
  };

  return (
    <div className={`${fixed ? 'fixed inset-x-0 top-0' : 'sticky top-0'} z-[10000] flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold`}
      style={{ background: '#f59e0b', color: '#111827', boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }}>
      <span className="flex min-w-0 items-center gap-2">
        <ShieldAlert className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">
          Student Mode: {context.name} ({context.email}) - actions update this student&apos;s real progress
        </span>
      </span>
      <button onClick={exit}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-75"
        style={{ background: 'rgba(17,24,39,0.12)' }}>
        <LogOut className="h-3.5 w-3.5" /> Exit Student Mode
      </button>
    </div>
  );
}
