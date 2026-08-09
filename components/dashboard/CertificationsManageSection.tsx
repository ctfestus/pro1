'use client';

// Instructor management for the certifications content type. Lists the instructor's exams with
// create / edit / preview / delete, plus an expandable Analytics panel per exam (pass rate, average
// score, per-skill performance, and per-question correct rates to spot too-easy / too-hard items).
// Delete goes through /api/certifications so Cloudinary covers and cohort_assignments are cleaned up
// (the cascade handles certification_attempts).

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Plus, Edit2, Trash2, ExternalLink, ShieldCheck, Clock, Loader2, BarChart3, ChevronDown, ChevronUp, Download, Search, Layers3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { SectionEmptyState } from '@/components/dashboard/primitives';
import { resolveCoverUrl } from '@/lib/cloudinary-url';

type Analytics = {
  totalAttempts: number; uniqueStudents: number; passCount: number; passRate: number; avgScore: number;
  medianScore: number; minScore: number; maxScore: number; stdDev: number;
  buckets: number[]; flagged: number; questionCount: number; passmark: number;
  perSkill: { id: string; name: string; correctRate: number; questions: number }[];
  perQuestion: { id: string; type: string; text: string; seen: number; correct: number; correctRate: number; discrimination: number | null }[];
};

// Classical item difficulty label from the correct rate (p-value).
function difficultyLabel(rate: number): string {
  return rate >= 80 ? 'Easy' : rate >= 50 ? 'Medium' : 'Hard';
}

// Build a standard item-analysis CSV: report header, summary stats, skill table, and per-item rows.
function analyticsToCsv(a: Analytics, title: string, dateStr: string): string {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows: (string | number)[][] = [
    ['Certification analytics report'],
    ['Certification', title],
    ['Generated', dateStr],
    ['Pass mark (%)', a.passmark],
    [],
    ['Summary'],
    ['Attempts', a.totalAttempts],
    ['Unique students', a.uniqueStudents],
    ['Passed', a.passCount],
    ['Pass rate (%)', a.passRate],
    ['Mean score (%)', a.avgScore],
    ['Median score (%)', a.medianScore],
    ['Std deviation', a.stdDev],
    ['Min score (%)', a.minScore],
    ['Max score (%)', a.maxScore],
    ['Flagged attempts', a.flagged],
    [],
    ['Performance by skill'],
    ['Skill', 'Questions', 'Correct rate (%)'],
    ...a.perSkill.map(s => [s.name, s.questions, s.correctRate]),
    [],
    ['Item analysis'],
    ['#', 'Question', 'Type', 'Delivered', 'Correct', 'Correct rate (%)', 'Difficulty', 'Discrimination'],
    ...a.perQuestion.map((q, i) => [i + 1, q.text, q.type, q.seen, q.correct, q.correctRate, difficultyLabel(q.correctRate), q.discrimination == null ? '' : q.discrimination]),
  ];
  return rows.map(r => r.map(esc).join(',')).join('\r\n');
}

export function CertificationsManageSection({ C }: { C: typeof LIGHT_C }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');

  useEffect(() => {
    supabase.from('certifications')
      .select('id, title, slug, status, passmark, time_limit, max_attempts, created_at, cover_image, badge_image_url, description, cert_type, questions')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setItems(data ?? []); setLoading(false); });
  }, []);

  const visibleItems = useMemo(() => {
    const term = query.trim().toLowerCase();
    return items.filter(item => (statusFilter === 'all' || item.status === statusFilter)
      && (!term || item.title?.toLowerCase().includes(term) || item.description?.toLowerCase().includes(term)));
  }, [items, query, statusFilter]);

  async function remove(id: string) {
    if (!window.confirm('Delete this certification? This cannot be undone.')) return;
    setDeletingId(id);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/certifications?id=${id}`, {
      method: 'DELETE',
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    setDeletingId(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); window.alert(d.error || 'Failed to delete.'); return; }
    setItems(prev => prev.filter(i => i.id !== id));
  }

  if (loading) return <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.green }} /></div>;
  if (!items.length) return <SectionEmptyState Icon={ShieldCheck} label="certification" createHref="/create/certification" createLabel="New certification" C={C} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div><p className="text-sm" style={{ color: C.faint }}>Build trusted, skills-based credentials and monitor exam quality.</p><p className="text-xs mt-1" style={{ color: C.faint }}>{items.length} certification{items.length === 1 ? '' : 's'}</p></div>
        <Link href="/create/certification" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-4 h-4" /> New certification
        </Link>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 p-3 rounded-2xl" style={{ ...cardStyle(C) }}>
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.faint }}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search certifications..." className="w-full rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none" style={{ background: C.input, color: C.text }}/></div>
        <div className="flex gap-1 p-1 rounded-xl" style={{ background: C.pill }}>{(['all','published','draft'] as const).map(filter => <button key={filter} onClick={() => setStatusFilter(filter)} className="px-3 py-2 rounded-lg text-xs font-semibold capitalize" style={{ background: statusFilter === filter ? C.card : 'transparent', color: statusFilter === filter ? C.green : C.faint }}>{filter}</button>)}</div>
      </div>
      <div className="space-y-4">
        {visibleItems.map(item => (
          <CertRow key={item.id} item={item} C={C} deleting={deletingId === item.id} onDelete={() => remove(item.id)} />
        ))}
        {visibleItems.length === 0 && <div className="py-16 text-center rounded-2xl" style={{ ...cardStyle(C) }}><Search className="w-6 h-6 mx-auto mb-2" style={{ color: C.faint }}/><p className="text-sm font-semibold" style={{ color: C.text }}>No matching certifications</p><p className="text-xs mt-1" style={{ color: C.faint }}>Try another search or status filter.</p></div>}
      </div>
    </div>
  );
}

function CertRow({ item, C, deleting, onDelete }: { item: any; C: typeof LIGHT_C; deleting: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Analytics | null>(null);
  const [loadingA, setLoadingA] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !data && !loadingA) {
      setLoadingA(true); setError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/certification-attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ action: 'analytics', certification_id: item.id }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Failed to load analytics.');
        setData(d.analytics);
      } catch (e: any) {
        setError(e?.message || 'Failed to load analytics.');
      } finally {
        setLoadingA(false);
      }
    }
  }

  return (
    <article className="group rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 sm:p-5">
        <div className="flex items-center gap-4 min-w-0 flex-1">
          <div className="relative w-20 h-16 rounded-xl overflow-hidden flex-shrink-0 grid place-items-center" style={{ background: `${C.green}0d` }}>
            {item.cover_image
              ? <img src={resolveCoverUrl(item.cover_image)} alt="" className="absolute inset-0 w-full h-full object-cover"/>
              : <Layers3 className="w-6 h-6" style={{ color: C.green }}/>
            }
            {item.badge_image_url && <span className="absolute bottom-1 right-1 w-7 h-7 rounded-lg grid place-items-center" style={{ background: C.card }}><img src={resolveCoverUrl(item.badge_image_url)} alt="" className="w-5 h-5 object-contain"/></span>}
          </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-bold text-base truncate" style={{ color: C.text }}>{item.title}</p>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: item.status === 'published' ? `${C.green}14` : 'rgba(251,191,36,0.12)', color: item.status === 'published' ? C.green : '#f59e0b' }}>{item.status}</span>
          </div>
          {item.description && <p className="text-xs mt-1 truncate" style={{ color: C.muted }}>{item.description}</p>}
          <div className="flex flex-wrap items-center gap-3 mt-2 text-xs" style={{ color: C.faint }}>
            <span>Pass {item.passmark ?? 70}%</span>
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{item.time_limit ? `${item.time_limit}m` : 'Untimed'}</span>
            <span>{item.max_attempts ? `${item.max_attempts} attempt${item.max_attempts === 1 ? '' : 's'}` : 'Unlimited'}</span>
            <span>{Array.isArray(item.questions) ? item.questions.length : 0} questions</span>
          </div>
        </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={toggle} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: open ? C.cta : C.pill, color: open ? C.ctaText : C.muted }} title="Analytics">
            <BarChart3 className="w-3.5 h-3.5" /> Analytics {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <Link href={`/${item.slug || item.id}`} target="_blank" className="p-2.5 rounded-xl" style={{ background: C.pill, color: C.muted }} title="Preview"><ExternalLink className="w-3.5 h-3.5" /></Link>
          <Link href={`/create/certification?id=${item.id}`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: C.pill, color: C.muted }}><Edit2 className="w-3.5 h-3.5" /> Edit</Link>
          <button onClick={onDelete} disabled={deleting} aria-label={`Delete ${item.title}`} title="Delete certification"
            className="w-9 h-9 grid place-items-center rounded-xl"
            style={{ background: C.deleteBg, color: C.deleteText, border: `1px solid ${C.deleteBorder}`, opacity: deleting ? 0.6 : 1 }}>
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 pb-4 pt-1" style={{ borderTop: `1px solid ${C.cardBorder}` }}>
          {loadingA ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" style={{ color: C.green }} /></div>
          ) : error ? (
            <p className="text-sm py-4" style={{ color: '#ef4444' }}>{error}</p>
          ) : data ? (
            <AnalyticsPanel a={data} C={C} title={item.title} />
          ) : null}
        </div>
      )}
    </article>
  );
}

function AnalyticsPanel({ a, C, title }: { a: Analytics; C: typeof LIGHT_C; title: string }) {
  if (a.totalAttempts === 0) {
    return <p className="text-sm py-4" style={{ color: C.faint }}>No completed attempts yet. Analytics appear once students finish the exam.</p>;
  }
  // Hardest questions first, so problem items surface at the top.
  const questions = [...a.perQuestion].sort((x, y) => x.correctRate - y.correctRate);
  const rateColor = (r: number) => (r >= 70 ? '#16a34a' : r >= 40 ? '#f59e0b' : '#ef4444');
  const tiles = [
    { label: 'Attempts', value: String(a.totalAttempts) },
    { label: 'Students', value: String(a.uniqueStudents) },
    { label: 'Pass rate', value: `${a.passRate}%` },
    { label: 'Mean', value: `${a.avgScore}%` },
    { label: 'Median', value: `${a.medianScore}%` },
    { label: 'Flagged', value: String(a.flagged) },
  ];

  const exportCsv = () => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const csv = analyticsToCsv(a, title, dateStr);
    const slug = (title || 'certification').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'certification';
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${slug}-analytics-${dateStr}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-3 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs" style={{ color: C.faint }}>Range {a.minScore}% to {a.maxScore}%, std dev {a.stdDev}, pass mark {a.passmark}%</p>
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0" style={{ background: C.pill, color: C.text }}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {tiles.map(t => (
          <div key={t.label} className="rounded-xl p-3" style={{ background: C.pill }}>
            <div className="text-lg font-bold" style={{ color: C.text }}>{t.value}</div>
            <div className="text-[11px]" style={{ color: C.faint }}>{t.label}</div>
          </div>
        ))}
      </div>

      {a.perSkill.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: C.faint }}>Performance by skill</p>
          <div className="space-y-2">
            {a.perSkill.map(s => (
              <div key={s.id} className="flex items-center gap-3">
                <span className="text-xs flex-shrink-0" style={{ width: 150, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <div className="flex-1 h-2 rounded-full" style={{ background: C.pill }}>
                  <div className="h-full rounded-full" style={{ width: `${s.correctRate}%`, background: rateColor(s.correctRate) }} />
                </div>
                <span className="text-xs tabular-nums flex-shrink-0" style={{ width: 36, textAlign: 'right', color: C.muted }}>{s.correctRate}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: C.faint }}>Item analysis (hardest first)</p>
        {/* Header row */}
        <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider pb-1.5" style={{ color: C.faint, borderBottom: `1px solid ${C.cardBorder}` }}>
          <span className="flex-shrink-0" style={{ width: 20 }}>#</span>
          <span className="flex-1 min-w-0">Question</span>
          <span className="flex-shrink-0" style={{ width: 44, textAlign: 'right' }}>Corr.</span>
          <span className="flex-shrink-0" style={{ width: 40, textAlign: 'right' }}>Rate</span>
          <span className="flex-shrink-0" style={{ width: 52, textAlign: 'right' }}>Disc.</span>
        </div>
        <div className="space-y-1.5 mt-1.5">
          {questions.map((q, i) => (
            <div key={q.id} className="flex items-center gap-3 text-xs">
              <span className="flex-shrink-0 tabular-nums" style={{ width: 20, color: C.faint }}>{i + 1}</span>
              <span className="flex-1 min-w-0" style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={q.text}>{q.text}</span>
              <span className="flex-shrink-0 tabular-nums" style={{ width: 44, textAlign: 'right', color: C.faint }}>{q.correct}/{q.seen}</span>
              <span className="flex-shrink-0 font-semibold tabular-nums" style={{ width: 40, textAlign: 'right', color: rateColor(q.correctRate) }}>{q.correctRate}%</span>
              <span className="flex-shrink-0 tabular-nums" style={{ width: 52, textAlign: 'right', color: q.discrimination != null && q.discrimination < 0.1 ? '#ef4444' : C.muted }}>{q.discrimination == null ? '-' : q.discrimination.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] mt-2" style={{ color: C.faint }}>Rate = % correct (difficulty). Disc. = discrimination (top vs bottom 27%); higher is better, values below 0.1 (red) flag weak or miskeyed items.</p>
      </div>
    </div>
  );
}
