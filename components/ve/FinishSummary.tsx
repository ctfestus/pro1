'use client';

import { CaretRight, FileText, LinkSimple, Sparkle } from '@phosphor-icons/react';
import { lessonCompletionPct } from '@/lib/ve-completion';
import { parseReviewNotes } from '@/lib/reviewRecord';
import { repairVeSubmissionUrl } from '@/lib/ve-upload';
import { PersonAvatar, firstNameOf, type Person } from '@/components/ve/workplace';
import type { Module, Progress, Requirement } from '@/components/ve/requirements/types';

const REVIEW_TYPES: Requirement['type'][] = ['dashboard_critique', 'code_review', 'excel_review', 'document_review'];

export interface WorkItem {
  key: string;
  name: string;
  kind: 'file' | 'link' | 'review' | 'answer';
  missionTitle: string;
  moduleId: string;
  lessonId: string;
  url?: string;
  score?: number;
}

/** The AI score of a saved review report, or undefined when there is none to show. */
function reviewScore(req: Requirement, notes?: string): number | undefined {
  // A manual document review is marked by a person; its saved report carries a placeholder 0.
  if (req.type === 'document_review' && req.documentReviewMode === 'manual') return undefined;
  const report = parseReviewNotes(notes)?.report;
  const score = report?.overallScore ?? report?.audit?.overallScore;
  return typeof score === 'number' && Number.isFinite(score) ? Math.round(score) : undefined;
}

/** Everything the learner submitted, in mission order, from saved progress. */
export function collectWork(modules: Module[], progress: Progress): WorkItem[] {
  const items: WorkItem[] = [];
  for (const mod of modules) {
    for (const lesson of mod.lessons || []) {
      for (const req of lesson.requirements || []) {
        const entry = progress[req.id];
        if (!entry) continue;
        const where = { missionTitle: lesson.title, moduleId: mod.id, lessonId: lesson.id };
        const aiScore = typeof entry.aiScore === 'number' ? Math.round(entry.aiScore) : undefined;
        if (entry.fileUrl) {
          let name = '';
          try { name = decodeURIComponent(entry.fileUrl.split('/').pop()?.split('?')[0] || ''); } catch { /* fall back below */ }
          items.push({ key: `f-${req.id}`, kind: 'file', name: name || req.label || 'File', url: repairVeSubmissionUrl(entry.fileUrl), score: aiScore, ...where });
        }
        if (entry.linkUrl) {
          items.push({
            key: `l-${req.id}`, kind: 'link', url: entry.linkUrl, score: aiScore, ...where,
            name: req.type === 'linkedin_share' ? 'LinkedIn post' : entry.linkUrl.replace(/^https?:\/\//, '').slice(0, 60),
          });
        }
        if (REVIEW_TYPES.includes(req.type) && entry.completed && entry.notes) {
          items.push({ key: `r-${req.id}`, kind: 'review', name: req.label || 'AI review', score: reviewScore(req, entry.notes), ...where });
        }
        if ((req.type === 'text' || req.type === 'reflection') && aiScore !== undefined && !entry.fileUrl && !entry.linkUrl) {
          items.push({ key: `a-${req.id}`, kind: 'answer', name: req.label || 'Written answer', score: aiScore, ...where });
        }
      }
    }
  }
  return items;
}

const card = (isDark: boolean) => ({
  background: isDark ? '#1c1c1c' : '#fff',
  boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.06)' : '0 10px 28px rgba(15,23,42,0.06)',
});

/**
 * The top of the finish screen: the manager's closing note, the real numbers, and the learner's
 * work. Built only from saved progress; nothing here is AI-written.
 */
export function FinishSummary({ modules, progress, manager, studentName, isDark, accentColor, text, muted, onOpenMission }: {
  modules: Module[];
  progress: Progress;
  manager: Person;
  studentName: string;
  isDark: boolean;
  accentColor: string;
  text: string;
  muted: string;
  /** Opens a mission in review, for work with no file to open. */
  onOpenMission: (moduleId: string, lessonId: string) => void;
}) {
  const work = collectWork(modules, progress);
  const sentCount = work.filter(w => w.kind !== 'answer').length;
  const scores = work.map(w => w.score).filter((s): s is number => s !== undefined);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const lessons = modules.flatMap(m => m.lessons || []);
  const missionsDone = lessons.filter(l => lessonCompletionPct(l, progress) === 100).length;
  const first = firstNameOf(studentName);
  const line = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

  const stats = [
    { label: 'Missions done', value: `${missionsDone} / ${lessons.length}` },
    { label: 'Work sent', value: String(sentCount) },
    ...(avgScore !== null ? [{ label: 'Average review score', value: `${avgScore}` }] : []),
  ];

  return (
    <>
      {/* The manager closes the project */}
      <div className="flex gap-3 rounded-2xl px-5 py-4" style={card(isDark)}>
        <PersonAvatar {...manager} size={38} presence="active" isDark={isDark} />
        <div className="min-w-0">
          <p className="text-[13px] font-bold" style={{ color: text }}>{manager.name}</p>
          <p className="text-[14.5px] leading-relaxed mt-0.5" style={{ color: text }}>
            Thanks for your work on this project{first ? `, ${first}` : ''}. Everything you sent is listed below, and your certificate is ready when you are.
          </p>
        </div>
      </div>

      {/* Real numbers from saved progress */}
      <div className="grid overflow-hidden rounded-2xl" style={{ ...card(isDark), gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
        {stats.map((s, i) => (
          <div key={s.label} className="p-4 text-center" style={{ borderLeft: i ? `1px solid ${line}` : 'none' }}>
            <p className="text-2xl font-bold tabular-nums" style={{ color: accentColor, fontFamily: 'var(--font-display), sans-serif' }}>{s.value}</p>
            <p className="text-[12px] mt-0.5" style={{ color: muted }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Your work */}
      {work.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={card(isDark)}>
          <div className="px-5 py-4 border-b" style={{ borderColor: line }}>
            <p className="text-[15px] font-semibold" style={{ color: text, fontFamily: 'var(--font-display), sans-serif' }}>Your work</p>
          </div>
          <div>
            {work.map((w, i) => {
              const Icon = w.kind === 'link' ? LinkSimple : w.kind === 'review' || w.kind === 'answer' ? Sparkle : FileText;
              const inner = (
                <>
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${accentColor}14`, color: accentColor }}>
                    <Icon weight="duotone" className="w-4 h-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold truncate" style={{ color: text }}>{w.name}</span>
                    <span className="block text-[12px] truncate" style={{ color: muted }}>
                      {w.missionTitle}{w.kind === 'review' ? ' - AI review' : w.kind === 'answer' ? ' - written answer' : ''}
                    </span>
                  </span>
                  {w.score !== undefined && (
                    <span className="text-[14px] font-bold tabular-nums flex-shrink-0" style={{ color: accentColor }}>{w.score}</span>
                  )}
                  <CaretRight weight="bold" className="w-4 h-4 flex-shrink-0" style={{ color: muted }} />
                </>
              );
              const cls = 'w-full flex items-center gap-3 px-5 py-3 text-left transition-opacity hover:opacity-80';
              const style = { borderTop: i ? `1px solid ${line}` : 'none' };
              return w.url
                ? <a key={w.key} href={w.url} target="_blank" rel="noreferrer" className={cls} style={style}>{inner}</a>
                : <button key={w.key} type="button" onClick={() => onOpenMission(w.moduleId, w.lessonId)} className={cls} style={style}>{inner}</button>;
            })}
          </div>
        </div>
      )}
    </>
  );
}
