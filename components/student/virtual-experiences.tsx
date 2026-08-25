'use client';

// Virtual Experiences section, extracted verbatim from app/student/page.tsx.
// VirtualExperiencesSection is exported; VirtualExperienceCard,
// VirtualExperienceDetailPane, groupVEsByIndustry and IndustryRow are file-internal.

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/ThemeProvider';
import { sanitizeRichText } from '@/lib/sanitize';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { veProgressPct, veCompletionCounts } from '@/lib/ve-completion';
import { CarouselSkeleton, EmptyState, ProgressBar, HoverPreviewCard } from '@/components/student/shared';
import { publicGuide, GuideByline, GuideCard } from '@/components/ve/guide';
import {
  Briefcase, Check, CheckCircle, ChevronLeft, ChevronRight, FileText, Play, RefreshCw, Star, X, Zap,
} from 'lucide-react';

const DEADLINE_REFERENCE_MS = Date.now();

// --- Virtual Experience Card ---
function VirtualExperienceCard({ form, attempt, deadline, C, onDetails }: {
  form: any; attempt: any; deadline?: Date | null; C: typeof LIGHT_C; onDetails: () => void;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const cfg = form.config || {};
  const color = C.cta;
  const slug  = form.slug || form.id;
  // Shared rule, so a skipped optional LinkedIn share cannot hold this below 100% while the
  // status beside it reads Completed.
  const veCounts = veCompletionCounts(cfg.modules || [], attempt?.progress ?? {});
  const totalReqs = veCounts.totalReqs;
  const doneReqs = veCounts.doneReqs;
  const pct = veProgressPct(cfg.modules || [], attempt?.progress ?? {});
  const isCompleted = !!attempt?.completed_at;
  const isStarted   = !!attempt && !isCompleted;
  const actionLabel = isCompleted ? 'Review' : isStarted ? 'Continue' : 'Start';
  const actionHref  = `/${slug}`;
  const totalModules = (cfg.modules || []).length;
  const totalLessons = (cfg.modules || []).reduce((a: number, m: any) => a + (m.lessons?.length || 0), 0);
  const guide = publicGuide(cfg);

  // Deadline display
  const daysLeft = deadline && !isCompleted
    ? Math.ceil((deadline.getTime() - DEADLINE_REFERENCE_MS) / 86400000)
    : null;
  const deadlineLabel = daysLeft === null ? null
    : daysLeft < 0  ? 'Overdue'
    : daysLeft === 0 ? 'Due today'
    : `${daysLeft}d left`;
  const deadlineColor = daysLeft === null ? null
    : daysLeft < 0  ? '#ef4444'
    : daysLeft <= 3 ? '#f59e0b'
    : '#6b7280';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -3 }}
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{ background: C.card, boxShadow: isDark ? '0 0 0 1px rgba(255,255,255,0.06)' : '0 10px 28px rgba(15,23,42,0.07)' }}>
      {/* Cover */}
      <div className="relative h-40 overflow-hidden cursor-pointer group flex-shrink-0"
        style={{ background: `${color}14` }} onClick={onDetails}>
        <div className="absolute inset-0 flex items-center justify-center">
          <Briefcase className="w-10 h-10 opacity-25" style={{ color }}/>
        </div>
        {cfg.coverImage && (
          <img src={resolveCoverUrl(cfg.coverImage)} alt={form.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" onError={e => (e.currentTarget.style.display = 'none')}/>
        )}
        {/* Industry badge */}
        <div className="absolute top-2 left-2">
          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{ background: `${color}dd`, color: 'white', backdropFilter: 'blur(4px)' }}>
            {cfg.industry}
          </span>
        </div>
        {/* Status badge */}
        {isCompleted && (
          <div className="absolute top-2 right-2">
            <span className="flex items-center justify-center w-5 h-5 rounded-full shadow-sm"
              style={{ background: '#16a34a', color: '#ffffff' }} title="Completed" aria-label="Completed">
              <Check className="w-3 h-3" strokeWidth={3}/>
            </span>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col flex-1">
        <h3 className="text-sm font-semibold leading-snug mb-1 line-clamp-2 cursor-pointer hover:opacity-70 transition-opacity"
          style={{ color: C.text }} onClick={onDetails}>
          {form.title}
        </h3>
        {cfg.company && (
          <p className="text-xs mb-2" style={{ color: C.faint }}>{cfg.company} · {cfg.role}</p>
        )}
        {guide && (
          <div className="mb-2">
            <GuideByline guide={guide} size={20}
              theme={{ text: C.text, muted: C.muted, faint: C.faint, surface: C.card, border: C.cardBorder, accent: color }} />
          </div>
        )}
        {deadlineLabel && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full mb-2"
            style={{ background: `${deadlineColor ?? '#6b7280'}18`, color: deadlineColor ?? '#6b7280' }}>
            ⏰ {deadlineLabel}
          </span>
        )}

        {/* Progress */}
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1.5" style={{ color: C.faint }}>
            <span>{isCompleted ? 'Completed' : isStarted ? 'In progress' : 'Not started'}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: isCompleted ? '#10b981' : color }}/>
          </div>
        </div>

        {/* Instructor score */}
        {attempt?.review && (
          <div className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-xl mb-3"
            style={{ background: `${color}12`, color }}>
            <Star className="w-3 h-3 flex-shrink-0"/> Instructor score: <strong>{attempt.review.score}/100</strong>
          </div>
        )}

        {/* Actions */}
        <div className="mt-auto flex items-center gap-2">
          <button onClick={onDetails}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2.5 rounded-xl transition-opacity hover:opacity-70"
            style={{ background: C.pill, color: C.muted }}>
            <FileText className="w-3 h-3"/> Details
          </button>
          <a href={actionHref}
            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2.5 rounded-xl transition-opacity hover:opacity-80"
            style={{
              background: isCompleted ? C.pill : color,
              color: isCompleted ? C.muted : 'white',
              textDecoration: 'none',
            }}>
            <Play className="w-3 h-3"/> {actionLabel}
          </a>
        </div>
      </div>
    </motion.div>
  );
}

// --- Virtual Experience Detail Pane ---
function VirtualExperienceDetailPane({ form, attempt, C, onClose }: {
  form: any; attempt: any; C: typeof LIGHT_C; onClose: () => void;
}) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const cfg = form.config || {};
  const color = C.cta;
  const slug  = form.slug || form.id;
  const [imgErr, setImgErr] = useState(false);

  const modules = cfg.modules || [];
  const totalLessons = modules.reduce((a: number, m: any) => a + (m.lessons?.length || 0), 0);
  // Shared rule, so a skipped optional LinkedIn share cannot hold this below 100% while the
  // status beside it reads Completed.
  const veCounts = veCompletionCounts(modules, attempt?.progress ?? {});
  const totalReqs = veCounts.totalReqs;
  const doneReqs = veCounts.doneReqs;
  const pct = veProgressPct(modules, attempt?.progress ?? {});
  const isCompleted = !!attempt?.completed_at;
  const isStarted   = !!attempt && !isCompleted;
  const actionLabel = isCompleted ? 'Review Project' : isStarted ? 'Continue Project' : 'Start Project';
  const guide = publicGuide(cfg);

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />
      {/* Drawer */}
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
        style={{ width: 'min(620px, 100vw)', background: C.card, boxShadow: '-12px 0 48px rgba(0,0,0,0.20)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-20" style={{ background: color }} />
              <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: color }} />
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={{ background: `${color}18`, color }}>
              {cfg.industry}
            </span>
            {cfg.difficulty && (
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: C.faint }}>
                {cfg.difficulty}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-opacity hover:opacity-70" style={{ color: C.muted }}>
            <X className="w-4 h-4"/>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Cover */}
          {cfg.coverImage && !imgErr ? (
            <div style={{ height: 180, overflow: 'hidden', flexShrink: 0 }}>
              <img src={resolveCoverUrl(cfg.coverImage)} alt={form.title} onError={() => setImgErr(true)} className="w-full h-full object-cover"/>
            </div>
          ) : (
            <div className="h-32 flex items-center justify-center" style={{ background: `${color}14` }}>
              <Briefcase className="w-12 h-12 opacity-20" style={{ color }}/>
            </div>
          )}

          <div className="p-5 space-y-5">
            {/* Title + company */}
            <div>
              <h2 className="text-base font-bold leading-snug mb-1" style={{ color: C.text }}>{form.title}</h2>
              {cfg.company && (
                <p className="text-sm" style={{ color: C.text }}>{cfg.company} · {cfg.role}</p>
              )}
              {cfg.tagline && (
                <p className="text-sm mt-1" style={{ color: C.text }}>{cfg.tagline}</p>
              )}
            </div>

            {/* The real professional playing the manager */}
            {guide && (
              <GuideCard guide={guide}
                theme={{ text: C.text, muted: C.muted, faint: C.faint, surface: isDark ? 'rgba(255,255,255,0.04)' : C.pill, border: 'transparent', accent: color }} />
            )}

            {/* Progress (if started) */}
            {isStarted && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs" style={{ color: C.muted }}>
                  <span>Progress</span>
                  <span>{doneReqs} / {totalReqs} tasks · {pct}%</span>
                </div>
                <ProgressBar value={pct} color={color}/>
              </div>
            )}
            {isCompleted && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl"
                style={{ background: `${color}12`, color }}>
                <CheckCircle className="w-4 h-4 flex-shrink-0"/>
                <span className="text-sm font-semibold">Project completed</span>
                {attempt?.review?.score !== undefined && (
                  <span className="ml-auto text-sm font-bold">{attempt.review.score}/100</span>
                )}
              </div>
            )}

            {/* Tools row */}
            {(cfg.tools || []).length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color }}/>
                {(cfg.tools as string[]).map((t: string) => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-lg font-medium"
                    style={{ background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', color: C.text }}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            {/* Background / description */}
            {(cfg.background || cfg.description) && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>About this project</p>
                <div className="text-sm leading-relaxed rich-preview" style={{ color: C.text }}
                  dangerouslySetInnerHTML={{ __html: sanitizeRichText(cfg.background || cfg.description) }}/>
              </div>
            )}

            {/* Learning outcomes */}
            {(cfg.learnOutcomes || []).length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.faint }}>What you will learn</p>
                <div className="space-y-2">
                  {(cfg.learnOutcomes as string[]).map((o: string, i: number) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: `${color}1a` }}>
                        <CheckCircle className="w-3 h-3" style={{ color }}/>
                      </div>
                      <span className="text-sm leading-snug" style={{ color: C.text }}>{o}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Module outline */}
            {modules.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.faint }}>Project outline</p>
                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
                  {modules.map((m: any, mi: number) => (
                    <div key={m.id} style={{ borderBottom: mi < modules.length - 1 ? `1px solid ${C.cardBorder}` : 'none' }}>
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: `${color}18` }}>
                          <span className="text-[10px] font-bold" style={{ color }}>{mi + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium leading-snug" style={{ color: C.text }}>{m.title}</span>
                          {(m.lessons || []).length > 0 && (
                            <span className="text-xs ml-2" style={{ color: C.muted }}>{m.lessons.length} mission{m.lessons.length !== 1 ? 's' : ''}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Instructor feedback */}
            {attempt?.review?.feedback && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Instructor Feedback</p>
                <div className="text-sm leading-relaxed px-4 py-3 rounded-xl" style={{ background: `${color}0e`, color: C.text, border: `1px solid ${color}22` }}>
                  {attempt.review.feedback}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer CTA */}
        <div className="p-4 flex-shrink-0 space-y-2" style={{ borderTop: `1px solid ${C.cardBorder}` }}>
          <a href={`/${slug}`}
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: isCompleted ? C.green : color, color: 'white', textDecoration: 'none' }}>
            {isCompleted ? <RefreshCw className="w-4 h-4"/> : isStarted ? <Play className="w-4 h-4"/> : <Zap className="w-4 h-4"/>}
            {actionLabel}
          </a>
        </div>
      </motion.div>
    </>
  );
}

// Group virtual experiences by industry; named industries alphabetical, "Other" last
function groupVEsByIndustry(items: any[]): [string, any[]][] {
  const groups = new Map<string, any[]>();
  for (const f of items) {
    const key = (f.industry ?? f.config?.industry ?? '').trim() || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === 'Other') return 1;
    if (b[0] === 'Other') return -1;
    return a[0].localeCompare(b[0]);
  });
}

// One industry group rendered as a titled carousel of VE cards, with the grow-from-card hover preview
function IndustryRow({ industry, items, attempts, deadlines, C, onDetails }: {
  industry: string; items: any[]; attempts: Record<string, any>; deadlines: Record<string, Date | null>;
  C: typeof LIGHT_C; onDetails: (f: any) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  const [hover, setHover] = useState<{ form: any; left: number; top: number; originX: number; originY: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 120); };
  const openHover = (form: any, el: HTMLElement) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;
    cancelClose();
    const r = el.getBoundingClientRect();
    const W = 320, H = 480;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
    const top  = Math.max(12, Math.min(r.top - 20, window.innerHeight - H - 12));
    const originX = Math.max(0, Math.min(r.left + r.width / 2 - left, W));
    const originY = Math.max(0, Math.min(r.top + r.height / 2 - top, H));
    setHover({ form, left, top, originX, originY });
  };
  useEffect(() => () => cancelClose(), []);

  return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <h3 className="text-xl sm:text-2xl font-bold leading-tight truncate" style={{ color: C.text }}>{industry.replace(/\b\w/g, c => c.toUpperCase())}</h3>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => scrollByCards(-1)} aria-label="Scroll left"
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <ChevronLeft className="w-4 h-4"/>
          </button>
          <button onClick={() => scrollByCards(1)} aria-label="Scroll right"
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <ChevronRight className="w-4 h-4"/>
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {items.map((form: any) => {
          const attempt     = attempts[form.id];
          const isCompleted = !!attempt?.completed_at;
          const isStarted   = !!attempt && !isCompleted;
          const status      = isCompleted ? 'Completed' : isStarted ? 'In progress' : null;
          const cover       = form.config?.coverImage ?? form.cover_image;
          return (
            <div key={form.id} className="flex-shrink-0 w-[220px] snap-start"
              onMouseEnter={(e) => openHover(form, e.currentTarget)} onMouseLeave={scheduleClose}>
              <button onClick={() => onDetails(form)} className="block w-full text-left transition-transform hover:-translate-y-0.5">
                <div className="relative rounded-xl overflow-hidden w-full aspect-video" style={{ background: 'rgba(34,197,94,0.10)' }}>
                  <div className="absolute inset-0 flex items-center justify-center"><Briefcase className="w-8 h-8" style={{ color: '#16a34a' }}/></div>
                  {cover && <img src={resolveCoverUrl(cover)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>}
                  {isCompleted ? (
                    <span className="absolute top-2 left-2 flex items-center justify-center w-5 h-5 rounded-full shadow-sm"
                      style={{ background: '#16a34a', color: '#ffffff' }} title="Completed" aria-label="Completed">
                      <Check className="w-3 h-3" strokeWidth={3}/>
                    </span>
                  ) : status && (
                    <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md"
                      style={{ background: '#22c55e', color: '#ffffff' }}>
                      {status}
                    </span>
                  )}
                </div>
                <p className="text-xs mt-2" style={{ color: C.faint }}>Virtual Experience</p>
                <p className="text-[15px] font-bold leading-snug mt-0.5 line-clamp-2" style={{ color: C.text }}>{form.title}</p>
              </button>
            </div>
          );
        })}
      </div>

      {/* Hover preview -- pops out of the hovered card, and back into it on close */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {hover && (
            <HoverPreviewCard
              key={hover.form.id}
              left={hover.left}
              top={hover.top}
              originX={hover.originX}
              originY={hover.originY}
              onEnter={cancelClose}
              onLeave={scheduleClose}
            >
              <VirtualExperienceCard
                form={hover.form}
                attempt={attempts[hover.form.id]}
                deadline={deadlines[hover.form.id]}
                C={C}
                onDetails={() => { setHover(null); onDetails(hover.form); }}
              />
            </HoverPreviewCard>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  );
}

export function VirtualExperiencesSection({ userId, userEmail, C }: { userId: string; userEmail: string; C: typeof LIGHT_C }) {
  const [items,       setItems]       = useState<any[]>([]);
  const [attempts,    setAttempts]    = useState<Record<string, any>>({});
  const [deadlines,   setDeadlines]   = useState<Record<string, Date | null>>({});
  const [loading,     setLoading]     = useState(true);
  const [detail,      setDetail]      = useState<any | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: profile } = await supabase.from('students').select('cohort_id').eq('id', userId).maybeSingle();
      if (!profile?.cohort_id) { setLoading(false); return; }

      const veSelect = 'id, title, slug, cover_image, modules, industry, difficulty, role, company, duration, tools, tagline, deadline_days, cohort_ids, status, guide_snapshot';
      const normalizeVe = (ve: any) => ({
        ...ve,
        content_type: 'virtual_experience',
        config: {
          title: ve.title,
          coverImage: ve.cover_image,
          modules: ve.modules ?? [],
          deadline_days: ve.deadline_days,
          industry: ve.industry,
          difficulty: ve.difficulty,
          role: ve.role,
          company: ve.company,
          duration: ve.duration,
          tools: ve.tools,
          tagline: ve.tagline,
          guideSnapshot: ve.guide_snapshot,
        },
      });

      const [{ data: veRows }, { data: attRows }] = await Promise.all([
        // A virtual experience can now be offered to everyone (migration 186), so a learner with no
        // cohort still has one to show here. Without this branch a public VE unlocks in Explore and
        // then never appears in My Learning, which reads as the toggle not working.
        (profile.cohort_id
          ? supabase
              .from('virtual_experiences')
              .select(veSelect)
              .eq('status', 'published')
              .or(`available_to_everyone.eq.true,cohort_ids.cs.{${profile.cohort_id}}`)
          : supabase
              .from('virtual_experiences')
              .select(veSelect)
              .eq('status', 'published')
              .eq('available_to_everyone', true)),
        supabase
          .from('guided_project_attempts')
          .select('*')
          .eq('student_id', userId),
      ]);

      const cohortForms = (veRows ?? []).map(normalizeVe);

      // Merge: VEs the student has attempted that are not directly assigned to the cohort
      // (e.g. started from a learning path) -- matches how the Courses section surfaces
      // attempted extra courses. RLS grants the read through the published learning path.
      const cohortVeIds = new Set(cohortForms.map((f: any) => f.id));
      const extraIds = [...new Set((attRows ?? []).map((a: any) => a.ve_id))].filter(id => id && !cohortVeIds.has(id));
      let extraForms: any[] = [];
      if (extraIds.length) {
        const { data: extraRows } = await supabase
          .from('virtual_experiences')
          .select(veSelect)
          .eq('status', 'published')
          .in('id', extraIds);
        extraForms = (extraRows ?? []).map(normalizeVe);
      }

      const forms = [...cohortForms, ...extraForms];
      setItems(forms);

      if (forms.length) {
        const ids = forms.map((f: any) => f.id);
        const { data: assignments } = await supabase
          .from('cohort_assignments')
          .select('content_id, assigned_at')
          .eq('cohort_id', profile.cohort_id)
          .eq('content_type', 'virtual_experience')
          .in('content_id', ids);
        const attMap: Record<string, any> = {};
        for (const a of attRows ?? []) attMap[a.ve_id] = a;
        setAttempts(attMap);

        // Compute per-VE deadlines
        const dlMap: Record<string, Date | null> = {};
        const assignmentByForm = new Map((assignments ?? []).map((a: any) => [a.content_id, a.assigned_at]));
        for (const form of forms) {
          const deadlineDays = form.deadline_days;
          const assignedAt   = assignmentByForm.get(form.id);
          if (deadlineDays && assignedAt) {
            dlMap[form.id] = new Date(new Date(assignedAt).getTime() + deadlineDays * 86400000);
          } else {
            dlMap[form.id] = null;
          }
        }
        setDeadlines(dlMap);
      }
      setLoading(false);
    };
    load();
  }, [userEmail, userId]);

  if (loading) return <CarouselSkeleton C={C}/>;

  if (!items.length) return (
    <EmptyState icon={Briefcase} title="No Virtual Experiences" body="Virtual experiences assigned to your cohort will appear here." />
  );

  return (
    <div className="space-y-6">
      {groupVEsByIndustry(items).map(([industry, list]) => (
        <IndustryRow
          key={industry}
          industry={industry}
          items={list}
          attempts={attempts}
          deadlines={deadlines}
          C={C}
          onDetails={setDetail}
        />
      ))}
      <AnimatePresence>
        {detail && (
          <VirtualExperienceDetailPane
            form={detail}
            attempt={attempts[detail.id]}
            C={C}
            onClose={() => setDetail(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
