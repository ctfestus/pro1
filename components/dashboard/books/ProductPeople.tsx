'use client';

/**
 * Everyone who has one product: buyers (paid), free claims, grants, and signed-in readers who
 * downloaded it through a cohort or as a free product. Searchable, and exportable as CSV.
 * Data from GET /api/books/stats?bookId= (lib/books/stats.ts).
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';
import { formatMoney } from '@/lib/books/format';

type Person = {
  name: string | null;
  email: string | null;
  kind: 'paid' | 'free' | 'cohort' | 'granted';
  guest: boolean;
  amount: number | null;
  currency: string | null;
  date: string | null;
  downloads: number;
};

const KIND_LABEL: Record<Person['kind'], string> = { paid: 'Paid', free: 'Free', cohort: 'Cohort', granted: 'Granted' };

function howLabel(p: Person): string {
  return `${KIND_LABEL[p.kind]}${p.guest ? ', no account' : ''}`;
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Quoted, and a leading formula character neutralised so a spreadsheet never runs a cell.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function ProductPeople({ bookId, slug, C }: { bookId: string; slug: string; C: typeof LIGHT_C }) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch(`/api/books/stats?bookId=${encodeURIComponent(bookId)}`, {
          headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'Could not load people.');
        if (!cancelled) setPeople(d.people ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load people.');
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (people ?? []).filter(p => !term
      || (p.name ?? '').toLowerCase().includes(term)
      || (p.email ?? '').toLowerCase().includes(term));
  }, [people, query]);

  function exportCsv() {
    const rows = [
      ['Name', 'Email', 'How', 'Amount', 'Currency', 'Date', 'Downloads'],
      ...shown.map(p => [p.name, p.email, howLabel(p), p.amount ?? '', p.currency ?? '', p.date ? p.date.slice(0, 10) : '', p.downloads]),
    ];
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug || 'product'}-people.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <p className="text-xs px-1 py-2" style={{ color: '#f43f5e' }}>{error}</p>;
  if (!people) return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" style={{ color: C.green }} /></div>;
  if (!people.length) return <p className="text-xs px-1 py-3" style={{ color: C.faint }}>Nobody has bought, claimed or downloaded this product yet.</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.faint }} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or email" aria-label="Search people"
            className="w-full rounded-xl pl-10 pr-4 py-2 text-sm outline-none" style={{ background: C.input, color: C.text }} />
        </div>
        <button onClick={exportCsv} className="inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
          style={{ background: C.card, color: C.text }}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr style={{ color: C.faint }}>
              {['Name', 'Email', 'How', 'Amount', 'Date', 'Downloads'].map(h => <th key={h} className="text-left font-semibold px-2 py-2 whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((p, i) => (
              <tr key={`${p.email}-${p.date}-${i}`} style={{ color: C.text, borderTop: `1px solid ${C.pill}` }}>
                <td className="px-2 py-2 whitespace-nowrap">{p.name || '-'}</td>
                <td className="px-2 py-2 whitespace-nowrap">{p.email || '-'}</td>
                <td className="px-2 py-2 whitespace-nowrap">
                  <span className="px-2 py-0.5 rounded-full font-semibold"
                    style={p.kind === 'paid' ? { background: '#ffffff', color: '#16a34a', boxShadow: 'inset 0 0 0 1px #bbf7d0' } : { background: C.pill, color: C.muted }}>
                    {howLabel(p)}
                  </span>
                </td>
                <td className="px-2 py-2 whitespace-nowrap">{p.amount !== null && p.currency ? formatMoney(p.amount, p.currency) : '-'}</td>
                <td className="px-2 py-2 whitespace-nowrap">{p.date ? new Date(p.date).toLocaleDateString() : '-'}</td>
                <td className="px-2 py-2 whitespace-nowrap">{p.downloads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px]" style={{ color: C.faint }}>
        {shown.length} of {people.length}. Downloads are counted from when tracking started; earlier downloads were not recorded.
      </p>
    </div>
  );
}
