'use client';

// Instructor management for the certifications content type: the instructor's exams as cards with
// create / edit / preview / delete, and an Analytics panel per exam (pass rate, average score,
// per-skill performance, and per-question correct rates to spot too-easy / too-hard items).
// Delete goes through /api/certifications so Cloudinary covers and cohort_assignments are cleaned up
// (the cascade handles certification_attempts).

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, CheckCircle2, Download, ExternalLink, Pencil, Plus, ShieldCheck, Trash2, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { ConfirmModal } from '@/components/dashboard/cohorts/CohortModals';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { CARD_GRID, ContentCard, Kpis, PageHeader, StatusChips, contentKpis, matchesFilters, useReach, type Reach, type Status } from '@/components/dashboard/content/kit';
import { Card, DISPLAY_FONT, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';

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

export function CertificationsManageSection({ C: theme }: { C: typeof LIGHT_C }) {
  // As on the other admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('all');
  const [analyticsFor, setAnalyticsFor] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const reach = useReach('certifications');

  useEffect(() => {
    supabase.from('certifications')
      .select('id, title, slug, status, passmark, time_limit, max_attempts, created_at, cover_image, badge_image_url, description, cert_type, questions, cohort_ids, available_to_everyone')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setItems(data ?? []); setLoading(false); });
  }, []);

  const term = query.trim().toLowerCase();
  const visibleItems = items.filter(item => matchesFilters(item, status, term, [item.title, item.description]));

  async function remove() {
    const item = deleting;
    setBusy(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/certifications?id=${item.id}`, {
      method: 'DELETE',
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    setBusy(false);
    setDeleting(null);
    if (!res.ok) { const d = await res.json().catch(() => ({})); setNotice({ ok: false, text: d.error || 'Failed to delete.' }); return; }
    setItems(prev => prev.filter(i => i.id !== item.id));
    setNotice({ ok: true, text: `${item.title} deleted` });
  }

  return (
    <div className="space-y-5 pb-12">
      <PageHeader title="Certifications" sub="Timed exams that issue a certificate." C={C} actions={
        <Link href="/create/certification" className={`${btnClass} no-underline`} style={btnStyle('pri', C)}>
          <Plus className="w-4 h-4" />
          New certification
        </Link>
      } />
      {notice && (
        <div role={notice.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={notice.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          {notice.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="w-6 h-6 grid place-items-center rounded-full flex-shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}
      {loading ? (
        <div className="h-64 rounded-2xl animate-pulse" style={{ background: C.card }} />
      ) : items.length === 0 ? (
        <Card C={C} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>No certifications yet</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Create your first timed exam.</p>
        </Card>
      ) : (
        <>
          <Kpis items={contentKpis({ items, reach, noun: ['exam', 'certifications'], totalSub: 'Exams learners can sit', C })} C={C} />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={query} onChange={setQuery} placeholder="Search certifications" C={C} />
            <StatusChips value={status} onChange={setStatus} C={C} />
          </div>
          {visibleItems.length === 0 ? (
            <Card C={C} className="px-5 py-12 text-center"><p className="text-sm" style={{ color: C.muted }}>No certifications match these filters.</p></Card>
          ) : (
            <div className={CARD_GRID}>
              {visibleItems.map(item => <CertCard key={item.id} item={item} reach={reach} onAnalytics={() => setAnalyticsFor(item)} onDelete={() => setDeleting(item)} C={C} />)}
            </div>
          )}
        </>
      )}
      {analyticsFor && <AnalyticsDrawer key={analyticsFor.id} item={analyticsFor} onClose={() => setAnalyticsFor(null)} C={C} />}
      {deleting && (
        <ConfirmModal title="Delete certification?" eyebrow={deleting.title} body="Its attempts are deleted with it. This cannot be undone." action="Delete certification"
          danger busy={busy} onClose={() => setDeleting(null)} onConfirm={remove} C={C} />
      )}
    </div>
  );
}

function CertCard({ item, reach, onAnalytics, onDelete, C }: { item: any; reach: Reach | null; onAnalytics: () => void; onDelete: () => void; C: typeof LIGHT_C }) {
  const router = useRouter();
  return (
    <ContentCard item={item} cover={item.cover_image} Icon={ShieldCheck} reach={reach} onOpen={onAnalytics} C={C}
      menu={(close) => [
        { label: 'Analytics', sub: 'Attempts, pass rate, item analysis', icon: BarChart3, onClick: () => { close(); onAnalytics(); } },
        { label: 'Preview', sub: 'As a learner sees it', icon: ExternalLink, onClick: () => { close(); window.open(`/${item.slug || item.id}`, '_blank', 'noopener'); } },
        { label: 'Edit', sub: 'Questions, timing, pass mark', icon: Pencil, onClick: () => { close(); router.push(`/create/certification?id=${item.id}`); } },
        null,
        { label: 'Delete', sub: 'Asks first', icon: Trash2, danger: true, onClick: () => { close(); onDelete(); } },
      ]} />
  );
}

/** One exam's analytics, in a panel from the right. Loaded when it opens. */
function AnalyticsDrawer({ item, onClose, C }: { item: any; onClose: () => void; C: typeof LIGHT_C }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/certification-attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
          body: JSON.stringify({ action: 'analytics', certification_id: item.id }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || 'Failed to load analytics.');
        if (live) setData(d.analytics);
      } catch (e: any) {
        if (live) setError(e?.message || 'Failed to load analytics.');
      }
    })();
    return () => { live = false; };
  }, [item.id]);

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" style={{ background: 'rgba(4,8,20,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`${item.title} analytics`} className="w-full max-w-2xl h-full overflow-y-auto" style={{ background: C.card }}>
        <div className="flex items-start gap-3 px-6 py-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <div className="min-w-0 flex-1">
            <h3 className="text-[22px] leading-7 font-semibold truncate" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{item.title}</h3>
            <p className="text-sm" style={{ color: C.muted }}>Exam analytics</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0" style={{ background: C.pill, color: C.muted }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5">
          {error ? <p className="text-sm" style={{ color: C.errorText }}>{error}</p>
            : !data ? <p className="text-sm" style={{ color: C.muted }}>Loading analytics...</p>
            : <AnalyticsPanel a={data} C={C} title={item.title} />}
        </div>
      </div>
    </div>
  );
}

function AnalyticsPanel({ a, C, title }: { a: Analytics; C: typeof LIGHT_C; title: string }) {
  const P = palette(C);
  if (a.totalAttempts === 0) {
    return <p className="text-sm py-4" style={{ color: C.faint }}>No completed attempts yet. Analytics appear once students finish the exam.</p>;
  }
  // Hardest questions first, so problem items surface at the top.
  const questions = [...a.perQuestion].sort((x, y) => x.correctRate - y.correctRate);
  const rateColor = (r: number) => (r >= 70 ? P.good : r >= 40 ? P.warn : P.bad);
  const tiles = [
    { label: 'Attempts', value: String(a.totalAttempts) },
    { label: 'Learners', value: String(a.uniqueStudents) },
    { label: 'Pass rate', value: `${a.passRate}%` },
    { label: 'Mean score', value: `${a.avgScore}%` },
    { label: 'Median score', value: `${a.medianScore}%` },
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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs" style={{ color: C.muted }}>Range {a.minScore}% to {a.maxScore}%, std dev {a.stdDev}, pass mark {a.passmark}%</p>
        <button type="button" onClick={exportCsv} className={btnSmClass} style={btnStyle('sec', C)}>
          <Download className="w-3.5 h-3.5" /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {tiles.map(t => (
          <div key={t.label} className="rounded-xl p-3" style={{ background: C.page }}>
            <div className="text-xl leading-7 tabular-nums" style={{ color: t.label === 'Flagged' && a.flagged ? P.warn : C.text, fontFamily: DISPLAY_FONT }}>{t.value}</div>
            <div className="text-xs" style={{ color: C.muted }}>{t.label}</div>
          </div>
        ))}
      </div>

      {a.perSkill.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold mb-3" style={{ color: C.text }}>Performance by skill</h4>
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
        <h4 className="text-sm font-semibold mb-3" style={{ color: C.text }}>Item analysis, hardest first</h4>
        {/* Header row */}
        <div className="flex items-center gap-3 text-xs font-semibold pb-2" style={{ color: C.faint, borderBottom: `1px solid ${C.divider}` }}>
          <span className="flex-shrink-0" style={{ width: 20 }}>#</span>
          <span className="flex-1 min-w-0">Question</span>
          <span className="flex-shrink-0" style={{ width: 44, textAlign: 'right' }}>Right</span>
          <span className="flex-shrink-0" style={{ width: 40, textAlign: 'right' }}>Rate</span>
          <span className="flex-shrink-0" style={{ width: 52, textAlign: 'right' }}>Disc.</span>
        </div>
        <div className="space-y-2 mt-2">
          {questions.map((q, i) => (
            <div key={q.id} className="flex items-center gap-3 text-xs">
              <span className="flex-shrink-0 tabular-nums" style={{ width: 20, color: C.faint }}>{i + 1}</span>
              <span className="flex-1 min-w-0" style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={q.text}>{q.text}</span>
              <span className="flex-shrink-0 tabular-nums" style={{ width: 44, textAlign: 'right', color: C.faint }}>{q.correct}/{q.seen}</span>
              <span className="flex-shrink-0 font-semibold tabular-nums" style={{ width: 40, textAlign: 'right', color: rateColor(q.correctRate) }}>{q.correctRate}%</span>
              <span className="flex-shrink-0 tabular-nums" style={{ width: 52, textAlign: 'right', color: q.discrimination != null && q.discrimination < 0.1 ? P.bad : C.muted }}>{q.discrimination == null ? '-' : q.discrimination.toFixed(2)}</span>
            </div>
          ))}
        </div>
        <p className="text-xs mt-3" style={{ color: C.muted }}>Rate = % correct (difficulty). Disc. = discrimination (top vs bottom 27%); higher is better, values below 0.1 (red) flag weak or miskeyed items.</p>
      </div>
    </div>
  );
}
