'use client';

import { useState, type ReactNode } from 'react';
import { ArrowUpRight, CheckCircle2, ChevronDown, Lightbulb, ShieldCheck, TriangleAlert, Zap } from 'lucide-react';

export type ReviewFindingSeverity = 'error' | 'warning' | 'suggestion';

export interface StructuredReviewFinding {
  location?: string;
  severity: ReviewFindingSeverity;
  title: string;
  detail: string;
  fix?: string;
}

export interface StructuredReviewCategory {
  name: string;
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
}

export interface StructuredReviewRubricGrade {
  criterion: string;
  passed: boolean;
  comment: string;
}

interface Props {
  reportLabel: string;
  title: string;
  metadata?: string;
  score: number;
  summary: string;
  findings: StructuredReviewFinding[];
  categories: StructuredReviewCategory[];
  recommendations: string[];
  rubricGrades?: StructuredReviewRubricGrade[];
  accentColor: string;
  isDark: boolean;
  actions?: ReactNode;
  findingsTitle?: string;
  locationLabel?: string;
  severityLabels?: Partial<Record<ReviewFindingSeverity, string>>;
  metricLabels?: Partial<Record<'strengths' | 'risks' | 'opportunities' | 'rubric', string>>;
}

const SEVERITY_COLORS: Record<ReviewFindingSeverity, string> = {
  error: '#ef4444',
  warning: '#f59e0b',
  suggestion: '#3b82f6',
};

function scoreColor(score: number) {
  if (score >= 80) return '#22c55e';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
}

export default function AiStructuredReviewReport({
  reportLabel,
  title,
  metadata,
  score,
  summary,
  findings,
  categories,
  recommendations,
  rubricGrades = [],
  accentColor,
  isDark,
  actions,
  findingsTitle = 'Review findings',
  locationLabel,
  severityLabels = {},
  metricLabels = {},
}: Props) {
  const [filter, setFilter] = useState<'all' | ReviewFindingSeverity>('all');
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0]));
  const card = isDark ? '#1a1a1a' : '#ffffff';
  const text = isDark ? '#f0f0f0' : '#111827';
  const muted = isDark ? '#9299a3' : '#667085';
  const border = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(16,24,40,0.07)';
  const surface = isDark ? '#12151b' : '#f8fafc';
  const inner = isDark ? '#22272f' : '#f7f8fa';
  const safeScore = Math.max(0, Math.min(100, score));
  const verdict = safeScore >= 80 ? 'Excellent outcome' : safeScore >= 60 ? 'Solid foundation' : 'Needs another pass';
  const verdictColor = scoreColor(safeScore);
  const errors = findings.filter(finding => finding.severity === 'error');
  const warnings = findings.filter(finding => finding.severity === 'warning');
  const suggestions = findings.filter(finding => finding.severity === 'suggestion');
  const visibleFindings = filter === 'all' ? findings : findings.filter(finding => finding.severity === filter);
  const strengths = categories.reduce((count, category) => count + category.strengths.length, 0);
  const opportunities = categories.reduce((count, category) => count + category.gaps.length, 0);
  const rubricPassed = rubricGrades.filter(grade => grade.passed).length;

  function toggleFinding(index: number) {
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div className="space-y-4" style={{ fontFamily: 'var(--font-sans)' }}>
      <section className="overflow-hidden rounded-[24px]" style={{ background: surface }}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6" style={{ borderBottom: `1px solid ${border}` }}>
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden="true">
              <span className="absolute h-3 w-3 animate-ping rounded-full opacity-25 motion-reduce:animate-none" style={{ background: accentColor }} />
              <span className="relative h-2 w-2 rounded-full" style={{ background: accentColor }} />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: accentColor }}>{reportLabel}</p>
              {metadata && <p className="mt-0.5 text-[11px] font-medium" style={{ color: muted }}>{metadata}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>

        <div className="grid gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em]" style={{ background: `${verdictColor}16`, color: verdictColor }}>{verdict}</span>
              <span className="text-[11px] font-medium" style={{ color: muted }}>{findings.length} findings detected</span>
            </div>
            <h2 className="mt-4 text-xl font-bold tracking-[-0.02em] sm:text-2xl" style={{ color: text }}>{title}</h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed" style={{ color: muted }}>{summary}</p>
          </div>
          <div className="rounded-2xl p-4" style={{ background: card }}>
            <div className="flex items-end justify-between gap-3">
              <div><span className="text-4xl font-extrabold leading-none tabular-nums" style={{ color: text }}>{safeScore.toFixed(1)}</span><span className="ml-1 text-xs font-semibold" style={{ color: muted }}>/100</span></div>
              <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: verdictColor }}>Overall</span>
            </div>
            <div className="mt-4 h-2.5 overflow-hidden rounded-full" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : '#e7ebf0' }}>
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${safeScore}%`, background: accentColor, boxShadow: `0 0 16px ${accentColor}45` }} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px sm:grid-cols-4" style={{ background: border }}>
          {[
            { label: metricLabels.strengths ?? 'Strengths', value: strengths, icon: ShieldCheck, color: '#22c55e' },
            { label: metricLabels.risks ?? 'Risks', value: errors.length + warnings.length, icon: TriangleAlert, color: '#f59e0b' },
            { label: metricLabels.opportunities ?? 'Opportunities', value: opportunities, icon: Lightbulb, color: '#3b82f6' },
            { label: metricLabels.rubric ?? 'Rubric passed', value: rubricGrades.length ? `${rubricPassed}/${rubricGrades.length}` : 'N/A', icon: CheckCircle2, color: accentColor },
          ].map(metric => (
            <div key={metric.label} className="flex items-center gap-3 px-4 py-4 sm:px-5" style={{ background: card }}>
              <metric.icon className="h-4 w-4 shrink-0" style={{ color: metric.color }} />
              <div className="min-w-0"><span className="block text-lg font-bold leading-none tabular-nums" style={{ color: text }}>{metric.value}</span><span className="mt-1 block truncate text-[9px] font-semibold uppercase tracking-[0.1em]" style={{ color: muted }}>{metric.label}</span></div>
            </div>
          ))}
        </div>
      </section>

      {findings.length > 0 && (
        <section className="rounded-[22px] p-4 sm:p-5" style={{ background: card, border: `1px solid ${border}` }}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Diagnostic feed</p><h3 className="mt-1 text-base font-semibold" style={{ color: text }}>{findingsTitle}</h3></div>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['all', 'All', findings.length],
                ['error', severityLabels.error ?? 'Critical', errors.length],
                ['warning', severityLabels.warning ?? 'Warnings', warnings.length],
                ['suggestion', severityLabels.suggestion ?? 'Ideas', suggestions.length],
              ] as const).map(([value, label, count]) => (
                <button key={value} onClick={() => setFilter(value)} className="rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-colors" style={{ background: filter === value ? accentColor : inner, color: filter === value ? '#fff' : muted }}>{label} {count}</button>
              ))}
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {visibleFindings.length === 0 ? (
              <div className="grid min-h-28 place-items-center rounded-2xl text-center" style={{ background: inner }}><div><CheckCircle2 className="mx-auto h-5 w-5 text-emerald-500" /><p className="mt-2 text-xs font-medium" style={{ color: muted }}>No findings in this category</p></div></div>
            ) : visibleFindings.map(finding => {
              const originalIndex = findings.indexOf(finding);
              const color = SEVERITY_COLORS[finding.severity];
              const isExpanded = expanded.has(originalIndex);
              return (
                <article key={originalIndex} className="overflow-hidden rounded-2xl" style={{ background: inner }}>
                  <button onClick={() => toggleFinding(originalIndex)} className="flex w-full items-center gap-3 p-3.5 text-left sm:p-4" aria-expanded={isExpanded}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 0 4px ${color}14` }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-bold uppercase tracking-[0.11em]" style={{ color }}>{severityLabels[finding.severity] ?? finding.severity}</span>{finding.location && <span className="text-[10px] font-medium" style={{ color: muted, fontFamily: 'var(--font-mono)' }}>{locationLabel ? `${locationLabel} ` : ''}{finding.location}</span>}</div>
                      <p className="mt-1 truncate text-[13px] font-semibold" style={{ color: text }}>{finding.title}</p>
                    </div>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} style={{ color: muted }} />
                  </button>
                  {isExpanded && <div className="px-4 pb-4 sm:pl-[43px]"><p className="text-[12.5px] leading-relaxed" style={{ color: muted }}>{finding.detail}</p>{finding.fix && <div className="mt-3 rounded-xl p-3.5" style={{ background: card }}><p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.12em]" style={{ color: accentColor }}><ArrowUpRight className="h-3 w-3" /> Recommended action</p><p className="mt-1.5 text-[12.5px] leading-relaxed" style={{ color: text }}>{finding.fix}</p></div>}</div>}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <div className={`grid gap-4 ${rubricGrades.length > 0 ? 'lg:grid-cols-2' : ''} lg:items-start`}>
        {rubricGrades.length > 0 && (
          <section className="rounded-[22px] p-4 sm:p-5" style={{ background: card, border: `1px solid ${border}` }}>
            <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Rubric signal</p><h3 className="mt-1 text-base font-semibold" style={{ color: text }}>Requirements check</h3></div><span className="text-sm font-bold tabular-nums" style={{ color: text }}>{rubricPassed}<span style={{ color: muted }}>/{rubricGrades.length}</span></span></div>
            <div className="mt-4 space-y-2">{rubricGrades.map((grade, index) => <div key={index} className="flex items-start gap-2.5 rounded-xl p-3" style={{ background: inner }}><span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold" style={{ background: grade.passed ? '#22c55e' : isDark ? '#343943' : '#dfe4ea', color: grade.passed ? '#fff' : muted }}>{grade.passed ? 'Y' : '-'}</span><div className="min-w-0"><p className="text-[11.5px] font-semibold" style={{ color: text }}>{grade.criterion}</p><p className="mt-1 text-[10.5px] leading-relaxed" style={{ color: muted }}>{grade.comment}</p></div></div>)}</div>
          </section>
        )}
        {categories.length > 0 && (
          <section className="rounded-[22px] p-4 sm:p-5" style={{ background: card, border: `1px solid ${border}` }}>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Performance matrix</p><h3 className="mt-1 text-base font-semibold" style={{ color: text }}>Quality by dimension</h3>
            <div className="mt-4 space-y-4">{categories.map(category => <div key={category.name}><div className="flex items-center justify-between gap-3"><p className="truncate text-[12px] font-semibold" style={{ color: text }}>{category.name}</p><span className="text-[12px] font-bold tabular-nums" style={{ color: scoreColor(category.score) }}>{category.score}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: inner }}><div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, category.score))}%`, background: scoreColor(category.score) }} /></div><p className="mt-2 text-[11px] leading-relaxed" style={{ color: muted }}>{category.summary}</p></div>)}</div>
          </section>
        )}
      </div>

      {recommendations.length > 0 && (
        <section className="rounded-[22px] p-4 sm:p-5" style={{ background: surface }}>
          <div className="flex items-center justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentColor }}>Next best actions</p><h3 className="mt-1 text-base font-semibold" style={{ color: text }}>Your improvement path</h3></div><Zap className="h-5 w-5" style={{ color: accentColor }} /></div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{recommendations.map((recommendation, index) => <div key={index} className="rounded-2xl p-4" style={{ background: card }}><span className="grid h-7 w-7 place-items-center rounded-lg text-[11px] font-bold" style={{ background: accentColor, color: '#fff' }}>{index + 1}</span><p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: text }}>{recommendation}</p></div>)}</div>
        </section>
      )}
    </div>
  );
}
