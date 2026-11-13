'use client';

/**
 * An event's public registrants (migration 244) on its dashboard: who registered from the public
 * events page, when, whether they have used their join link, and their answers. The list shows
 * the newest 1000 (and exports them); the count is exact. Read under RLS
 * (owner or admin), so nothing here needs the service role.
 */
import { useEffect, useState } from 'react';
import { Check, Download, Link2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Row = {
  id: string;
  name: string;
  email: string;
  responses: Record<string, unknown> | null;
  registered_at: string;
  first_joined_at: string | null;
};

const LIMIT = 1000;

/** A CSV cell, quoted, with spreadsheet formulas neutralized (a typed answer can start with =). */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function PublicRegistrationsCard({ eventId, slug, title, isDark, onCount }: {
  eventId: string;
  slug: string;
  title: string;
  isDark: boolean;
  onCount?: (n: number) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  // The true total: the list itself stops at LIMIT rows.
  const [total, setTotal] = useState<number | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase
      .from('event_public_registrations')
      .select('id, name, email, responses, registered_at, first_joined_at', { count: 'exact' })
      .eq('event_id', eventId)
      .order('registered_at', { ascending: false })
      .limit(LIMIT)
      .then(({ data, error: err, count }) => {
        if (cancelled) return;
        if (err) { setError(true); setRows([]); return; }
        setRows((data as Row[]) ?? []);
        const n = count ?? (data ?? []).length;
        setTotal(n);
        onCount?.(n);
      });
    return () => { cancelled = true; };
  }, [eventId, onCount]);

  const card = isDark ? 'bg-zinc-900/35 border-zinc-800/60' : 'bg-white border-[rgba(0,0,0,0.07)]';
  const head = isDark ? 'border-zinc-800' : 'border-[rgba(0,0,0,0.07)]';
  const textPrim = isDark ? 'text-white' : 'text-[#111]';
  const textMut = isDark ? 'text-zinc-500' : 'text-[#888]';
  const textSub = isDark ? 'text-zinc-300' : 'text-[#555]';
  const pill = isDark ? 'bg-zinc-800 text-zinc-300' : 'bg-[#f1f2f3] text-[#555]';
  const btn = `inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-opacity hover:opacity-70 ${textSub}`;
  const btnBg = { background: isDark ? 'rgba(255,255,255,0.05)' : '#f5f6f7' };
  const publicUrl = typeof window !== 'undefined' ? `${window.location.origin}/events/${encodeURIComponent(slug)}` : `/events/${slug}`;

  function exportCsv() {
    if (!rows?.length) return;
    const answerKeys = Array.from(rows.reduce((keys, r) => {
      Object.keys(r.responses ?? {}).forEach(k => keys.add(k));
      return keys;
    }, new Set<string>()));
    const header = ['name', 'email', 'registered_at', 'first_joined_at', ...answerKeys];
    const lines = rows.map(r => [r.name, r.email, r.registered_at, r.first_joined_at ?? '', ...answerKeys.map(k => (r.responses ?? {})[k])].map(cell).join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([[header.map(cell).join(','), ...lines].join('\n')], { type: 'text/csv' }));
    a.download = `${title || 'event'} - public registrations.csv`;
    a.click();
  }

  // Taking someone off (signed up by another person, or asked to be removed) also stops their
  // reminders and closes their join link. Allowed by the owner delete policy (migration 244).
  async function remove(r: Row) {
    if (!window.confirm(`Remove ${r.name} (${r.email}) from this event? They will get no more reminders and their join link stops working.`)) return;
    setRemoving(r.id);
    const { error: err } = await supabase.from('event_public_registrations').delete().eq('id', r.id);
    setRemoving(null);
    if (err) { window.alert('Could not remove this registration. Try again.'); return; }
    setRows(prev => (prev ?? []).filter(x => x.id !== r.id));
    const n = Math.max(0, (total ?? 1) - 1);
    setTotal(n);
    onCount?.(n);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', publicUrl);
    }
  }

  return (
    <div className={`rounded-[28px] border ${card}`}>
      <div className={`flex flex-wrap items-center justify-between gap-3 border-b px-6 py-5 ${head}`}>
        <div>
          <h3 className={`text-base font-semibold ${textPrim}`}>Public registrations</h3>
          <p className={`mt-1 text-sm ${textMut}`}>People who registered on the public events page, with or without an account.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={copyLink} className={btn} style={btnBg}>
            {copied ? <Check className="w-3.5 h-3.5" /> : <Link2 className="w-3.5 h-3.5" />} {copied ? 'Copied' : 'Copy public link'}
          </button>
          <button type="button" onClick={exportCsv} disabled={!rows?.length} className={`${btn} disabled:opacity-40`} style={btnBg}>
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${pill}`}>{total ?? '-'} total</span>
        </div>
      </div>
      {rows === null ? (
        <div className={`px-6 py-10 text-center text-sm ${textMut}`}>Loading</div>
      ) : error ? (
        <div className={`px-6 py-10 text-center text-sm ${textMut}`}>Could not load public registrations.</div>
      ) : rows.length === 0 ? (
        <div className={`px-6 py-10 text-center text-sm ${textMut}`}>No public registrations yet. Share the public link to start collecting them.</div>
      ) : (
        <div className="divide-y divide-black/5 dark:divide-white/5">
          {rows.map(r => {
            const answers = Object.entries(r.responses ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
            return (
              <div key={r.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 px-4 sm:px-6 py-4">
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-sm font-semibold ${textPrim}`}>{r.name}</p>
                  <p className={`truncate text-xs ${textMut}`}>{r.email}</p>
                  {answers.length > 0 && (
                    <p className={`mt-1 text-xs ${textSub} line-clamp-2`}>
                      {answers.map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v)}`).join(' | ')}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {r.first_joined_at && (
                    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: '#ffffff', color: '#15803d' }}>Joined</span>
                  )}
                  <span className={`text-xs font-medium ${textMut}`}>
                    {new Date(r.registered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                  <button type="button" onClick={() => remove(r)} disabled={removing === r.id}
                    aria-label={`Remove ${r.name}`} title="Remove registration"
                    className={`rounded-lg p-1.5 transition-opacity hover:opacity-70 disabled:opacity-40 ${textMut}`}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
