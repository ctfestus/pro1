'use client';

// Courses and learning-path journeys shared by the learner dashboard.
// Only the two section components are exported; the rest are file-internal.

import { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  BookOpen, Award, X, Check, CheckCircle, ChevronRight, ChevronLeft, Play, FileText, GraduationCap, Search, Layers, ShieldCheck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/ThemeProvider';
import { sanitizeRichText } from '@/lib/sanitize';
import { getToolIcon } from '@/lib/tool-icons';
import { computeAccess } from '@/lib/enrollment-access';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { courseProgressCounts, courseProgressPct } from '@/lib/course-progress';
import { CarouselSkeleton, EmptyState, ProgressBar, HoverPreviewCard, stripSqlSolutions } from '@/components/student/shared';

// --- Course card ---
function CourseCard({ course, deadline, C, onDetails, hideCategory }: { course: any; deadline?: Date | null; C: typeof LIGHT_C; onDetails: () => void; hideCategory?: boolean }) {
  const questions = course.form?.questions ?? course.config?.questions ?? course.form?.config?.questions ?? [];
  // Shared rule: an unclaimed optional LinkedIn slide leaves the denominator, so a student who
  // skipped it is not shown short of 100%.
  const courseCounts = courseProgressCounts(questions, course.answers ?? {});
  const answeredQ = courseCounts.done;
  const totalQ = courseCounts.total;
  const currentIdx = course.current_question_index ?? 0;
  const completed = !!course.completed_at;
  const passed = course.passed === true;
  const progress = completed ? 100 : courseProgressPct(questions, course.answers ?? {});
  const score = course.score ?? 0;
  const coverImage = course.config?.coverImage ?? course.form?.config?.coverImage;
  const description: string = course.form?.config?.description ?? course.form?.description ?? '';
  const category: string | null = course.form?.category ?? null;
  const categoryIcon = category ? getToolIcon(category) : null;
  const certId: string | null = course.cert_id ?? null;
  const [imgErr, setImgErr] = useState(false);

  const courseUrl = `/${course.slug || course.form?.slug || course.form_id}`;
  const actionHref = courseUrl;
  const actionLabel = completed ? (passed ? 'Review' : 'Retake') : currentIdx > 0 ? 'Continue' : 'Start';

  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const daysLeft = deadline && !completed
    ? Math.ceil((deadline.getTime() - nowMs) / 86400000)
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
      className="rounded-2xl overflow-hidden flex flex-col"
      style={{ background: C.card, minHeight: 500, boxShadow: '0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)' }}
    >
      {/* Cover -- clicking opens the detail pane */}
      <div className="p-3 cursor-pointer" onClick={onDetails}>
        <div className="relative h-44 overflow-hidden rounded-xl group">
          {coverImage && !imgErr
            ? <img src={resolveCoverUrl(coverImage)} alt={course.form?.title} onError={() => setImgErr(true)}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"/>
            : <div className="w-full h-full flex items-center justify-center">
                <BookOpen className="w-10 h-10 opacity-30" style={{ color: C.green }}/>
              </div>
          }
          {completed && (
            <div className="absolute top-2 right-2">
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: passed ? '#f0fdf4' : '#fef2f2', color: passed ? '#16a34a' : '#dc2626' }}>
                {passed ? 'Passed' : 'Not passed'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col flex-1">
        {/* Category tag */}
        {category && !hideCategory && (
          <div className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full mb-3"
            style={{ background: C.pill }}>
            {categoryIcon && <img src={categoryIcon} alt={category} className="w-3.5 h-3.5 object-contain flex-shrink-0" />}
            <span className="text-[11px] font-semibold" style={{ color: C.muted }}>{category}</span>
          </div>
        )}

        <h3 className="mb-1.5 line-clamp-2 leading-snug cursor-pointer hover:opacity-70 transition-opacity"
          style={{ color: C.text, fontSize: '17.5px', fontFamily: 'var(--font-lato)', fontWeight: 900 }} onClick={onDetails}>
          {course.form?.title ?? 'Untitled Course'}
        </h3>
        {course.form?.partner && (
          <div className="flex items-center gap-1.5 mb-2 text-xs" style={{ color: C.faint }}>
            {course.form.partner.logo_url && (
              <img src={course.form.partner.logo_url} alt="" className="w-4 h-4 object-contain" />
            )}
            <span>Offered by {course.form.partner.name}</span>
          </div>
        )}


        {description && (
          <p className="mb-2.5 line-clamp-4" style={{ color: C.faint, fontSize: '14.5px', fontFamily: 'var(--font-lato)', lineHeight: 1.45 }}>
            {description.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()}
          </p>
        )}

        {deadlineLabel && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full mb-2"
            style={{ background: `${deadlineColor ?? '#6b7280'}18`, color: deadlineColor ?? '#6b7280' }}>
            ⏰ {deadlineLabel}
          </span>
        )}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs" style={{ color: C.faint }}>
            {completed ? 'Completed' : currentIdx > 0 ? `${progress}% done` : `${totalQ} questions`}
          </span>
          {completed && score > 0 && (
            <span className="text-xs font-semibold" style={{ color: passed ? '#16a34a' : '#dc2626' }}>Score: {score}%</span>
          )}
        </div>
        <ProgressBar value={progress} color="#22c55e"/>

        <div className="mt-auto pt-4 flex items-center justify-between gap-2">
          {/* Details button */}
          <button onClick={onDetails}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2.5 rounded-xl transition-opacity hover:opacity-70"
            style={{ background: C.pill, color: C.muted }}>
            <FileText className="w-3.5 h-3.5"/>
            Details
          </button>

          <div className="flex items-center gap-2">
            {/* Primary action */}
            <a href={actionHref} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-70 dashboard-cta"
              style={{
                background: completed ? C.pill : C.cta,
                color: completed ? C.muted : C.ctaText,
              }}>
              <Play className="w-3.5 h-3.5"/>
              {actionLabel}
            </a>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// --- Course detail right pane ---
function CourseDetailPane({ course, C, onClose }: { course: any; C: typeof LIGHT_C; onClose: () => void }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const config = course.config ?? course.form?.config ?? {};
  const questions: any[] = course.form?.questions ?? config.questions ?? [];
  const lessons = questions.filter((q: any) => q.lesson?.title || q.lesson?.body || q.lesson?.doc);
  const lessonCount = lessons.length;
  const countableDetailQ = questions.filter((q: any) => !q.isSection);
  const assessmentCount = countableDetailQ.length;
  // Shared rule for the percentage; assessmentCount above stays the plain slide tally, since it
  // labels how much the course contains rather than how far this student has got.
  const detailCounts = courseProgressCounts(questions, course.answers ?? {});
  const answeredDetailQ = detailCounts.done;
  const currentIdx = course.current_question_index ?? 0;
  const completed = !!course.completed_at;
  const passed = course.passed === true;
  const score = course.score ?? 0;
  const certId: string | null = course.cert_id ?? null;
  const progress = completed ? 100 : courseProgressPct(questions, course.answers ?? {});
  const [imgErr, setImgErr] = useState(false);

  const courseUrl = `/${course.slug || course.form?.slug || course.form_id}`;
  const actionHref = completed && passed && certId ? `/certificate/${certId}` : courseUrl;
  const actionLabel = completed ? (passed && certId ? 'View Certificate' : 'Retake') : currentIdx > 0 ? 'Continue' : 'Start';

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)' }}
        onClick={onClose}
      />
      {/* Drawer */}
      <motion.div
        initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
        style={{ width: 'min(600px, 100vw)', background: C.card, boxShadow: '-4px 0 40px rgba(0,0,0,0.18)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0"
          style={{ borderBottom: `1px solid ${C.cardBorder}` }}>
          <span className="text-sm font-semibold" style={{ color: C.text }}>Course Details</span>
          <button onClick={onClose}
            className="p-1.5 rounded-lg transition-opacity hover:opacity-70"
            style={{ color: C.muted }}>
            <X className="w-4 h-4"/>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Cover image */}
          {config.coverImage && !imgErr && (
            <div style={{ height: 180, overflow: 'hidden', flexShrink: 0 }}>
              <img src={resolveCoverUrl(config.coverImage)} alt={course.form?.title}
                onError={() => setImgErr(true)}
                className="w-full h-full object-cover object-center"/>
            </div>
          )}

          <div className="p-5 space-y-5">
            {/* Title + status badge */}
            <div>
              <h2 className="text-base font-bold leading-snug mb-2" style={{ color: C.text }}>
                {course.form?.title ?? 'Untitled Course'}
              </h2>
              {course.form?.partner && (
                <div className="flex items-center gap-2 mb-2 text-xs" style={{ color: C.faint }}>
                  {course.form.partner.logo_url && (
                    <img src={course.form.partner.logo_url} alt="" className="w-5 h-5 object-contain" />
                  )}
                  <span>Offered by {course.form.partner.name}</span>
                </div>
              )}
              {completed && (
                <span className="inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full"
                  style={{ background: passed ? '#f0fdf4' : '#fef2f2', color: passed ? '#16a34a' : '#dc2626' }}>
                  {passed ? `Passed  Score: ${score}%` : `Not passed  Score: ${score}%`}
                </span>
              )}
              {!completed && currentIdx > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="flex justify-between text-xs" style={{ color: C.faint }}>
                    <span>{progress}% complete</span>
                    <span>{detailCounts.done} / {detailCounts.total} slides</span>
                  </div>
                  <ProgressBar value={progress} color={C.green}/>
                </div>
              )}
            </div>


            {/* Description */}
            {config.description && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>About this course</p>
                <div className="rich-preview text-sm leading-relaxed" style={{ color: C.muted }}
                  dangerouslySetInnerHTML={{ __html: sanitizeRichText(config.description) }}/>
              </div>
            )}

            {/* Learning outcomes */}
            {(config.learnOutcomes ?? []).length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.faint }}>What you will learn</p>
                <div className="space-y-2">
                  {(config.learnOutcomes as string[]).map((outcome: string, i: number) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: `${C.green}1a` }}>
                        <CheckCircle className="w-3 h-3" style={{ color: C.green }}/>
                      </div>
                      <span className="text-sm leading-snug" style={{ color: C.text }}>{outcome}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Course outline */}
            {lessonCount > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: C.faint }}>Course outline</p>
                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
                  {lessons.map((q: any, i: number) => (
                    <div key={q.id} className="flex items-center gap-3 px-4 py-3"
                      style={{ borderBottom: i < lessonCount - 1 ? `1px solid ${C.cardBorder}` : 'none' }}>
                      <div className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: `${C.green}18` }}>
                        <span className="text-[10px] font-bold" style={{ color: C.green }}>{i + 1}</span>
                      </div>
                      <span className="text-sm flex-1 leading-snug" style={{ color: C.text }}>
                        {q.lesson?.title || `Lesson ${i + 1}`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer CTA */}
        <div className="p-4 flex-shrink-0 space-y-2" style={{ borderTop: `1px solid ${C.cardBorder}` }}>
          {completed && passed && certId && (
            <a href={courseUrl} target="_blank" rel="noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-70"
              style={{ background: C.pill, color: C.muted }}>
              <Play className="w-4 h-4"/> Review course
            </a>
          )}
          <a href={actionHref} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 dashboard-cta"
            style={{ background: completed && passed && certId ? C.green : C.cta, color: C.ctaText }}>
            {completed && passed && certId ? <Award className="w-4 h-4"/> : <Play className="w-4 h-4"/>}
            {actionLabel}
          </a>
        </div>
      </motion.div>
    </>
  );
}

// --- Learning Paths section (shown above courses) ---
export function LearningPathsSection({ C }: { C: typeof LIGHT_C }) {
  const [paths, setPaths]         = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [selectedPathId, setSelectedPathId] = useState<string | null>(null);

  useEffect(() => {
    const syncSelectedPath = () => setSelectedPathId(new URLSearchParams(window.location.search).get('path'));
    syncSelectedPath();
    window.addEventListener('popstate', syncSelectedPath);
    return () => window.removeEventListener('popstate', syncSelectedPath);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) { setLoading(false); return; }
      const res = await fetch('/api/learning-paths', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action: 'get-student-paths' }),
      });
      if (res.ok) { const { paths: p } = await res.json(); setPaths(p ?? []); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <CarouselSkeleton C={C}/>;

  if (!paths.length) return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: C.pill }}>
        <Layers className="w-7 h-7" style={{ color: C.faint }}/>
      </div>
      <p className="font-semibold text-base mb-1" style={{ color: C.text }}>No learning paths yet</p>
      <p className="text-sm max-w-xs" style={{ color: C.muted }}>Your instructor hasn&apos;t assigned any learning paths to your cohort yet.</p>
    </div>
  );

  const selectedPath = paths.find((path: any) => path.id === selectedPathId) ?? null;
  const openPath = (pathId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('path', pathId);
    window.history.pushState({}, '', url);
    setSelectedPathId(pathId);
  };
  if (selectedPath) return (
    <div>
      <PathRow path={selectedPath} C={C}/>
    </div>
  );

  return (
    <LearningPathCarousel paths={paths} C={C} onOpen={openPath}/>
  );
}

function LearningPathCarousel({ paths, C, onOpen }: { paths: any[]; C: typeof LIGHT_C; onOpen: (id: string) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  // Hover preview: the path opened up -- the contents inside it and how far along the learner
  // is -- in a floating popover, the same detail-on-hover the landing page gives its path cards.
  // Hover-capable pointers only; on touch the card itself is still the way in.
  const [hover, setHover] = useState<{ path: any; left: number; top: number; originX: number; originY: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 120); };
  const openHover = (path: any, el: HTMLElement) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;
    cancelClose();
    const r = el.getBoundingClientRect();
    const W = pathPreviewWidth(path), H = 420;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
    const top  = Math.max(12, Math.min(r.top - 20, window.innerHeight - H - 12));
    // Grow from the hovered card: transform-origin = the card's center relative to the popover box
    const originX = Math.max(0, Math.min(r.left + r.width / 2 - left, W));
    const originY = Math.max(0, Math.min(r.top + r.height / 2 - top, H));
    setHover({ path, left, top, originX, originY });
  };
  useEffect(() => () => cancelClose(), []);

  return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
      {paths.length > 1 && (
        <div className="mb-4 flex justify-end">
          <div className="flex flex-shrink-0 items-center gap-2">
            <button onClick={() => scrollByCards(-1)} aria-label="Previous learning path"
              className="grid h-9 w-9 place-items-center rounded-full transition-opacity hover:opacity-70"
              style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
              <ChevronLeft className="h-4 w-4"/>
            </button>
            <button onClick={() => scrollByCards(1)} aria-label="Next learning path"
              className="grid h-9 w-9 place-items-center rounded-full transition-opacity hover:opacity-70"
              style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
              <ChevronRight className="h-4 w-4"/>
            </button>
          </div>
        </div>
      )}
      <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-1 snap-x" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {paths.map((path: any) => {
          const totalItems = (path.item_ids ?? []).length;
          const completedIds: string[] = path.progress?.completed_item_ids ?? [];
          const completedCount = (path.item_ids ?? []).filter((id: string) => completedIds.includes(id)).length;
          const pct = totalItems ? Math.round((completedCount / totalItems) * 100) : 0;
          const complete = totalItems > 0 && completedCount === totalItems;
          const started = !complete && completedCount > 0;
          return (
            <div key={path.id} className="w-[220px] flex-shrink-0 snap-start"
              onMouseEnter={(e) => openHover(path, e.currentTarget)} onMouseLeave={scheduleClose}>
              <button onClick={() => onOpen(path.id)} className="group block w-full text-left transition-transform hover:-translate-y-0.5">
                <CoverThumbnail cover={path.cover_image} alt={path.title} Icon={Layers}>
                  {complete ? (
                    <span className="absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded-full shadow-sm" style={{ background: '#16a34a', color: '#ffffff' }} title="Completed" aria-label="Completed"><Check className="h-3 w-3" strokeWidth={3}/></span>
                  ) : started ? (
                    <span className="absolute top-2 left-2 rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: '#22c55e', color: '#ffffff' }}>In progress</span>
                  ) : null}
                </CoverThumbnail>
                <p className="mt-2 text-xs" style={{ color: C.faint }}>Learning path</p>
                <p className="mt-0.5 line-clamp-2 text-[15px] font-bold leading-snug" style={{ color: C.text }}>{path.title}</p>
                <ProgressBar value={pct} color="#22c55e"/>
                <p className="mt-1 text-[11px]" style={{ color: C.faint }}>{complete ? 'Completed' : `${completedCount} of ${totalItems} complete`}</p>
              </button>
            </div>
          );
        })}
      </div>

      {/* Hover preview -- the path's contents and the learner's place in them */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {hover && (
            <HoverPreviewCard
              key={hover.path.id}
              left={hover.left}
              top={hover.top}
              originX={hover.originX}
              originY={hover.originY}
              width={pathPreviewWidth(hover.path)}
              onEnter={cancelClose}
              onLeave={scheduleClose}
            >
              <PathPreview path={hover.path} C={C} onOpen={() => { setHover(null); onOpen(hover.path.id); }}/>
            </HoverPreviewCard>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  );
}

// Popover width grows with the number of contents so their thumbnails lay out in one or two
// rows instead of a single cramped column, capped so it never dominates the screen.
const PATH_PREVIEW_MAX_ITEMS = 8;
function pathPreviewWidth(path: any) {
  const shown = Math.min((path.items ?? []).length, PATH_PREVIEW_MAX_ITEMS);
  return Math.min(560, Math.max(320, shown * 122 + 32));
}

// What the 220px card cannot show: the contents inside the path, which of them are done, and
// one way in. Mirrors the learning-path hover popup the landing page gives visitors.
function PathPreview({ path, C, onOpen }: { path: any; C: typeof LIGHT_C; onOpen: () => void }) {
  const items: any[] = path.items ?? [];
  const completedIds: string[] = path.progress?.completed_item_ids ?? [];
  const completedCount = items.filter((item: any) => completedIds.includes(item.id)).length;
  const total = items.length;
  const pct = total ? Math.round((completedCount / total) * 100) : 0;
  const allDone = total > 0 && completedCount === total;
  const shown = items.slice(0, PATH_PREVIEW_MAX_ITEMS);
  const hiddenCount = total - shown.length;
  const desc = (path.description || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  return (
    <button type="button" onClick={onOpen}
      aria-label={`${allDone ? 'Review' : completedCount > 0 ? 'Continue' : 'Start'} ${path.title}`}
      className="block w-full cursor-pointer overflow-hidden rounded-2xl text-left"
      style={{ background: C.card, boxShadow: '0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)' }}>
      <div className="p-4 pb-0">
        <span className="inline-block rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: '#16a34a', color: '#ffffff' }}>Learning path</span>
        <h3 className="mt-2 line-clamp-2 text-lg font-bold leading-snug" style={{ color: C.text }}>{path.title}</h3>
        {desc && <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed" style={{ color: C.muted }}>{desc}</p>}
        <div className="mt-3">
          <ProgressBar value={pct} color="#22c55e"/>
          <p className="mt-1.5 text-[11px]" style={{ color: C.faint }}>
            {allDone ? 'Completed' : `${completedCount} of ${total} complete`}
          </p>
        </div>
      </div>
      <div className="p-4">
        {total > 0 && (
          <>
            <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider" style={{ color: C.faint }}>
              <Layers className="h-3 w-3 flex-shrink-0"/>{total} content{total !== 1 ? 's' : ''}
            </p>
            <div className="flex flex-wrap gap-2.5">
              {shown.map((item: any) => {
                const done = completedIds.includes(item.id);
                const isVE = item.content_type === 'virtual_experience' || item.content_type === 'guided_project';
                const isCert = item.content_type === 'certification';
                return (
                  <div key={item.id} className="flex-shrink-0" style={{ width: 110 }}>
                    <div className="relative">
                      <CoverThumbnail cover={item.cover_image} alt={item.title} Icon={isCert ? ShieldCheck : isVE ? Layers : BookOpen} iconClassName="w-5 h-5"/>
                      {done && (
                        <span className="absolute top-1.5 left-1.5 flex h-4 w-4 items-center justify-center rounded-full shadow-sm"
                          style={{ background: '#16a34a', color: '#ffffff' }} title="Completed" aria-label="Completed">
                          <Check className="h-2.5 w-2.5" strokeWidth={3}/>
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[11px] font-medium leading-snug" style={{ color: C.text }}>{item.title}</p>
                  </div>
                );
              })}
            </div>
            {hiddenCount > 0 && (
              <p className="mt-2.5 text-[11px]" style={{ color: C.faint }}>+{hiddenCount} more</p>
            )}
          </>
        )}
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold"
          style={{ background: allDone ? C.pill : '#16a34a', color: allDone ? C.muted : '#ffffff' }}>
          <Play className="h-3.5 w-3.5"/>{allDone ? 'Review path' : completedCount > 0 ? 'Continue path' : 'Start path'}
        </span>
      </div>
    </button>
  );
}

// One learning path rendered as an ordered, open-access course timeline.
function PathRow({ path, C }: { path: any; C: typeof LIGHT_C }) {
  const totalItems     = (path.item_ids ?? []).length;
  const completedIds: string[] = path.progress?.completed_item_ids ?? [];
  const completedCount = (path.item_ids ?? []).filter((id: string) => completedIds.includes(id)).length;
  const allDone        = completedCount === totalItems && totalItems > 0;
  const pathCertId     = path.progress?.cert_id ?? null;
  const items: any[]   = path.items ?? [];
  const progressPct    = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;
  const currentIndex   = items.findIndex((item: any) => !completedIds.includes(item.id));
  const learnerCount: number = path.learner_count ?? 0;
  const connectorColor = C.page === LIGHT_C.page ? '#d7dde6' : 'rgba(148,163,184,0.32)';

  return (
    <section className="rounded-[22px] overflow-hidden" style={{ background: C.card, border: `1px solid ${C.cardBorder}` }}>
      <div className="p-5 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-xl sm:text-2xl font-bold leading-tight" style={{ color: C.text }}>{path.title}</h3>
          {path.description && <p className="text-sm mt-2 max-w-3xl leading-relaxed" style={{ color: C.muted }}>{path.description}</p>}
          {/* empty:hidden -- an empty path with no learners has nothing to say here, so the
              row must not leave its top margin behind. */}
          <div className="empty:hidden flex flex-wrap items-center gap-x-3 gap-y-2 mt-4 text-xs" style={{ color: C.faint }}>
            {learnerCount > 0 && (
              <span className="flex items-center gap-1.5">
                <GraduationCap className="w-3.5 h-3.5 flex-shrink-0"/>{learnerCount} {learnerCount === 1 ? 'learner' : 'learners'}
              </span>
            )}
            {currentIndex >= 0 && !allDone && (
              <motion.span key={items[currentIndex]?.id ?? currentIndex}
                initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-1.5 min-w-0 max-w-full">
                <motion.span aria-hidden="true" className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#22c55e' }}
                  animate={{ scale: [0.85, 1.15, 0.85], opacity: [0.65, 1, 0.65] }} transition={{ duration: 1.8, repeat: Infinity }}/>
                <span className="flex-shrink-0">Currently learning:</span>
                <strong className="font-semibold truncate max-w-[min(56vw,420px)]" style={{ color: C.muted }}>{items[currentIndex]?.title ?? 'Current content'}</strong>
              </motion.span>
            )}
            {allDone && <span className="font-bold" style={{ color: '#16a34a' }}>Completed</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {pathCertId && (
            <a href={`/certificate/${pathCertId}`} target="_blank" rel="noreferrer"
              className="hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg transition-opacity hover:opacity-80"
              style={{ background: '#f0fdf4', color: '#16a34a' }}>
              <Award className="w-3 h-3"/> Certificate
            </a>
          )}
        </div>
      </div>

      <div className="mt-5">
        <div className="flex items-center justify-between text-[11px] mb-2">
          <span style={{ color: C.faint }}>Overall progress</span>
          <span className="font-bold" style={{ color: allDone ? '#16a34a' : C.text }}>{progressPct}%</span>
        </div>
        <div className="flex items-center">
          <div className="flex-1 h-1.5 rounded-l-full overflow-hidden" style={{ background: C.pill }}>
            <motion.div initial={{ width: 0 }} animate={{ width: `${progressPct}%` }} transition={{ duration: 0.55, ease: [0.16,1,0.3,1] }} className="h-full rounded-l-full rounded-r-full" style={{ background: '#22c55e' }}/>
          </div>
          <span aria-hidden="true" className="w-3 sm:w-4 h-1.5 flex-shrink-0" style={{ background: allDone ? '#22c55e' : C.pill }}/>
          <motion.div title={allDone ? 'Completion reward unlocked' : 'Complete the path to unlock your reward'}
            aria-label={allDone ? 'Completion reward unlocked' : 'Completion reward'}
            animate={allDone ? { scale: [1, 1.06, 1] } : { scale: 1 }}
            transition={allDone ? { duration: 1.8, repeat: Infinity, repeatDelay: 1.4 } : undefined}
            className="relative w-11 h-11 sm:w-12 sm:h-12 flex-shrink-0">
              <span className="absolute inset-0 rounded-xl" style={{ background: C.card, boxShadow: 'inset 0 0 0 1.5px rgba(34,197,94,0.34), 0 5px 14px rgba(22,163,74,0.10)' }}/>
              <span aria-hidden="true" className="absolute inset-1.5 rounded-lg" style={{ background: 'rgba(34,197,94,0.08)' }}/>
              <span className="absolute inset-0 z-10 grid place-items-center">
                {path.badge_image_url
                  ? <img src={path.badge_image_url} alt="Learning path reward" className="w-7 h-7 object-contain"/>
                  : <Award className="w-5 h-5" style={{ color: '#16a34a' }}/>
                }
              </span>
              {!allDone && (
                <motion.span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full"
                  style={{ background: '#22c55e', boxShadow: `0 0 0 2px ${C.card}` }}
                  animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.65, 1, 0.65] }}
                  transition={{ duration: 1.8, repeat: Infinity }}/>
              )}
          </motion.div>
        </div>
      </div>

      <div className="relative mt-7">
        <div className="space-y-3 sm:space-y-4">
        {items.map((item: any, idx: number) => {
          const done      = completedIds.includes(item.id);
          const isCurrent = idx === currentIndex;
          const isVE = item.content_type === 'virtual_experience' || item.content_type === 'guided_project' || item.config?.isVirtualExperience || item.config?.isGuidedProject;
          const isCert = item.content_type === 'certification';
          // Direct link for every type: a path item may not be listed in its own section until
          // it has been attempted, so the card must be the way in (VEs resolve at /{slug} too).
          const href = `/${item.slug || item.id}`;
          const cover = item.cover_image;
          const inProgressPct = !done && typeof item.in_progress_pct === 'number' ? item.in_progress_pct : null;

          return (
            <div key={item.id} className="relative flex gap-3 sm:gap-4">
              <div className="relative z-10 flex w-5 flex-shrink-0 justify-center sm:w-6">
                {items.length > 0 && (
                  <span aria-hidden="true" className="absolute left-1/2 top-10 -bottom-6 w-0.5 -translate-x-1/2 sm:top-11"
                    style={{ background: connectorColor }}/>
                )}
                <span className="mt-4 flex h-5 w-5 items-center justify-center rounded-full sm:h-6 sm:w-6"
                  style={{
                    background: done ? '#16a34a' : 'transparent',
                    color: done ? '#ffffff' : C.muted,
                    boxShadow: done ? '0 5px 12px rgba(22,163,74,0.16)' : 'none',
                  }}>
                  {done ? <Check className="w-3 h-3" strokeWidth={3}/> : <span className={isCurrent ? 'h-3 w-3 rounded-full' : 'h-1.5 w-1.5 rounded-full'} style={{ background: isCurrent ? '#16a34a' : C.faint }}/>}
                </span>
              </div>
              <a href={href} target="_blank" rel="noreferrer"
                className="group relative block min-w-0 flex-1 overflow-hidden rounded-xl p-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg sm:flex sm:h-[184px] sm:items-center sm:p-4"
                style={{
                  background: isCurrent ? 'rgba(34,197,94,0.055)' : C.page === LIGHT_C.page ? '#f8fafc' : C.pill,
                  boxShadow: 'none',
                }}>
                <div className="flex flex-col gap-3 sm:w-full sm:flex-row sm:items-stretch sm:gap-4">
                  <div className="relative w-full flex-shrink-0 overflow-hidden rounded-lg aspect-video sm:w-40 sm:aspect-auto">
                    <CoverThumbnail cover={cover} Icon={isCert ? ShieldCheck : isVE ? Layers : BookOpen} className="sm:h-full sm:aspect-auto"/>
                    {done ? (
                      <span className="absolute top-2 left-2 flex h-5 w-5 items-center justify-center rounded-full shadow-sm" style={{ background: '#16a34a', color: '#ffffff' }} title="Completed" aria-label="Completed">
                        <Check className="w-3 h-3" strokeWidth={3}/>
                      </span>
                    ) : isCurrent ? (
                      <span className="absolute top-2 left-2 rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: '#22c55e', color: '#ffffff' }}>In progress</span>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1 sm:flex sm:h-full sm:flex-col">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={{ color: C.faint }}>
                      <span>{isCert ? 'Certification' : isVE ? 'Virtual Experience' : 'Course'}</span>
                    </div>
                    <h4 className="mt-1 text-base font-bold leading-snug sm:text-lg" style={{ color: C.text }}>{item.title}</h4>
                    <div className="mt-1.5 sm:min-h-[63px]">
                      {inProgressPct !== null ? (
                        <div className="flex h-[63px] max-w-md flex-col justify-center">
                          <div className="mb-1.5 flex items-center justify-between text-xs" style={{ color: C.faint }}>
                            <span>In progress</span><span>{inProgressPct}%</span>
                          </div>
                          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: C.page === LIGHT_C.page ? '#e6ebf1' : C.card }}>
                            <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${inProgressPct}%` }} transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }} style={{ background: '#16a34a' }}/>
                          </div>
                        </div>
                      ) : item.description ? (
                        <p className="line-clamp-3 text-sm leading-relaxed" style={{ color: C.muted }}>{item.description.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()}</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </a>
            </div>
          );
        })}
        <div className="relative flex gap-3 sm:gap-4">
          <div className="relative z-10 flex w-5 flex-shrink-0 justify-center sm:w-6">
            <span className="mt-4 flex h-5 w-5 items-center justify-center rounded-full sm:h-6 sm:w-6" style={{ background: 'transparent' }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: allDone ? '#16a34a' : '#d6b46c' }}/>
            </span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:p-5"
            style={{
              background: C.page === LIGHT_C.page ? '#fffcf5' : C.pill,
              borderColor: C.page === LIGHT_C.page ? '#efe1ba' : C.cardBorder,
            }}>
            <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: C.page === LIGHT_C.page ? '#fff4d8' : 'rgba(212,175,55,0.14)' }}>
              <Award className="h-8 w-8" style={{ color: '#c8962d' }}/>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase" style={{ color: '#b08020' }}>Completion credential</p>
              <h4 className="mt-1 text-lg font-bold" style={{ color: C.text }}>Earn Your Certificate</h4>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: C.muted }}>
                {allDone ? 'You have completed this learning path. Your credential is ready to celebrate and share.' : 'Complete every item in this learning path to unlock your completion credential.'}
              </p>
            </div>
            {allDone && pathCertId ? (
              <a href={`/certificate/${pathCertId}`} target="_blank" rel="noreferrer"
                className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold transition-opacity hover:opacity-80"
                style={{ background: '#16a34a', color: '#ffffff' }}>
                <Award className="h-4 w-4"/> View certificate
              </a>
            ) : (
              <span className="text-sm font-semibold" style={{ color: '#b08020' }}>{completedCount}/{totalItems} complete</span>
            )}
          </div>
        </div>
        </div>
      </div>
      </div>
    </section>
  );
}

// Group courses by their tool/category; named tools alphabetical, "Other" last
function groupCoursesByTool(courses: any[]): [string, any[]][] {
  const groups = new Map<string, any[]>();
  for (const c of courses) {
    const key = (c.form?.category ?? '').trim() || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === 'Other') return 1;
    if (b[0] === 'Other') return -1;
    return a[0].localeCompare(b[0]);
  });
}

function CoverThumbnail({ cover, alt = '', Icon = BookOpen, iconClassName = 'w-8 h-8', children, className = '' }: {
  cover?: string | null;
  alt?: string;
  Icon?: any;
  iconClassName?: string;
  children?: any;
  className?: string;
}) {
  const [imgErr, setImgErr] = useState(false);
  const showImage = !!cover && !imgErr;

  return (
    <div
      className={`relative rounded-xl overflow-hidden w-full aspect-video flex items-center justify-center ${className}`}
      style={{ background: showImage ? '#0b0b0d' : 'rgba(34,197,94,0.10)' }}
    >
      {showImage ? (
        <img
          src={resolveCoverUrl(cover)}
          alt={alt}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={() => setImgErr(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Icon className={iconClassName} style={{ color: '#16a34a' }} />
        </div>
      )}
      {children}
    </div>
  );
}

// One tool group rendered as a titled, horizontally-scrolling carousel of course cards
function ToolRow({ tool, courses, deadlines, C, onDetails }: { tool: string; courses: any[]; deadlines: Record<string, Date | null>; C: typeof LIGHT_C; onDetails: (c: any) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const icon = getToolIcon(tool);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  // Hover preview: show the full course card in a floating popover (desktop / hover-capable pointers only)
  const [hover, setHover] = useState<{ course: any; left: number; top: number; originX: number; originY: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 120); };
  const openHover = (course: any, el: HTMLElement) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;
    cancelClose();
    const r = el.getBoundingClientRect();
    const W = 320, H = 540;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
    const top  = Math.max(12, Math.min(r.top - 20, window.innerHeight - H - 12));
    // Grow from the hovered card: transform-origin = the card's center relative to the popover box
    const originX = Math.max(0, Math.min(r.left + r.width / 2 - left, W));
    const originY = Math.max(0, Math.min(r.top + r.height / 2 - top, H));
    setHover({ course, left, top, originX, originY });
  };
  useEffect(() => () => cancelClose(), []);

  return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
      {/* Header: tool name + nav arrows */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          {icon && <img src={icon} alt="" className="w-6 h-6 object-contain flex-shrink-0"/>}
          <h3 className="text-xl sm:text-2xl font-bold leading-tight truncate" style={{ color: C.text }}>{tool}</h3>
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

      {/* Carousel */}
      <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {courses.map((c: any) => {
          const completed  = !!c.completed_at;
          const currentIdx = c.current_question_index ?? 0;
          const cover      = c.form?.config?.coverImage ?? c.form?.cover_image;
          const title      = c.form?.title ?? 'Untitled Course';
          const status     = completed ? 'Completed' : currentIdx > 0 ? 'In progress' : null;
          const questions  = c.form?.questions ?? c.form?.config?.questions ?? [];
          // Shared rule, so a skipped optional LinkedIn slide does not show as unfinished.
          const cardCounts = courseProgressCounts(questions, c.answers ?? {});
          const answeredQ  = cardCounts.done;
          const totalQ     = cardCounts.total;
          const progress   = completed ? 100 : courseProgressPct(questions, c.answers ?? {});
          return (
            <div key={c.form_id} className="flex-shrink-0 w-[220px] snap-start"
              onMouseEnter={(e) => openHover(c, e.currentTarget)} onMouseLeave={scheduleClose}>
              <button onClick={() => onDetails(c)} className="block w-full text-left transition-transform hover:-translate-y-0.5">
                <CoverThumbnail cover={cover} alt={title}>
                  {completed ? (
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
                </CoverThumbnail>
                {c.form?.partner && (
                  <div className="flex items-center gap-2 mt-2" style={{ color: C.faint }}>
                    {c.form.partner.logo_url && (
                      <img src={c.form.partner.logo_url} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
                    )}
                    <span className="text-xs truncate">{c.form.partner.name}</span>
                  </div>
                )}
                <p className={`text-[15px] font-bold leading-snug ${c.form?.partner ? 'mt-1' : 'mt-2'} mb-2.5 line-clamp-2`} style={{ color: C.text }}>{title}</p>
                <ProgressBar value={progress} color="#22c55e"/>
                <p className="text-[11px] mt-1" style={{ color: C.faint }}>
                  {completed ? 'Completed' : currentIdx > 0 ? `${progress}% complete` : `${totalQ} questions`}
                </p>
              </button>
            </div>
          );
        })}
      </div>

      {/* Hover preview -- the full course card in a floating popover */}
      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {hover && (
            <HoverPreviewCard
              key={hover.course.form_id}
              left={hover.left}
              top={hover.top}
              originX={hover.originX}
              originY={hover.originY}
              onEnter={cancelClose}
              onLeave={scheduleClose}
            >
              <CourseCard
                course={hover.course}
                deadline={deadlines[hover.course.form_id]}
                C={C}
                onDetails={() => { setHover(null); onDetails(hover.course); }}
                hideCategory
              />
            </HoverPreviewCard>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  );
}

// --- Courses section ---
export function CoursesSection({ userEmail, userId: userIdProp, C, isOutstandingProp }: { userEmail: string; userId?: string; C: typeof LIGHT_C; isOutstandingProp?: boolean }) {
  const [courses,   setCourses]   = useState<any[]>([]);
  const [deadlines, setDeadlines] = useState<Record<string, Date | null>>({});
  const [loading,   setLoading]   = useState(true);
  const [detailCourse, setDetailCourse] = useState<any>(null);
  // VE attempt status map: formId -> { started, completed }
  const [veStatusMap, setVeStatusMap] = useState<Record<string, { started: boolean; completed: boolean }>>({});
  const [isOutstandingInternal, setIsOutstandingInternal] = useState(false);
  const isOutstanding = isOutstandingProp ?? isOutstandingInternal;
  // Semantic search
  const [searchQuery,   setSearchQuery]   = useState('');
  const searchTimer = useRef<any>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const effectiveUserId = userIdProp ?? user.id;

      // Get student's cohort -- original_cohort_id being set means they're currently in outstanding
      const { data: student } = await supabase
        .from('students')
        .select('cohort_id, original_cohort_id, payment_exempt')
        .eq('id', effectiveUserId)
        .single();

      // Query by student_id only -- cohort_id filter breaks when student is moved to outstanding cohort
      const { data: enrollment } = await supabase
        .from('bootcamp_enrollments')
        .select('access_status, total_fee, deposit_required, paid_total, payment_plan, bootcamp_ends_at, cohort_id, payment_installments ( due_date, status )')
        .eq('student_id', effectiveUserId)
        // Released enrollments are retained as financial history (migration 171). Reading one
        // here would payment-lock a student who has left the bootcamp -- including a former
        // bootcamp student now on a paid subscription -- out of their content.
        .is('released_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Compute access live so overdue/grace status reflects today's date without needing an admin action
      let liveStatus = enrollment?.access_status ?? null;
      if (enrollment) {
        const { data: settings } = await supabase
          .from('cohort_payment_settings')
          .select('post_bootcamp_access_months, grace_period_days')
          .eq('cohort_id', enrollment.cohort_id)
          .maybeSingle();
        liveStatus = computeAccess({
          payment_plan:                enrollment.payment_plan as any,
          total_fee:                   Number(enrollment.total_fee),
          deposit_required:            Number(enrollment.deposit_required),
          paid_total:                  Number(enrollment.paid_total),
          bootcamp_ends_at:            enrollment.bootcamp_ends_at ? new Date(enrollment.bootcamp_ends_at) : null,
          post_bootcamp_access_months: settings?.post_bootcamp_access_months ?? 3,
          grace_period_days:           settings?.grace_period_days ?? null,
          installments:                (enrollment.payment_installments ?? []).map((i: any) => ({ due_date: new Date(i.due_date), status: i.status })),
        }).access_status;
      }

      const restrictedByPayment = !student?.payment_exempt && ['pending_deposit', 'overdue', 'expired'].includes(liveStatus ?? '');
      const outstanding = !!student?.original_cohort_id || restrictedByPayment;
      setIsOutstandingInternal(outstanding);

      // Get session token for authenticated API calls
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';


      // Load cohort courses + student attempts + certificates in parallel
      const courseCatalogQuery = !restrictedByPayment
        ? (() => {
            const query = supabase.from('courses').select('id, title, slug, cover_image, questions, deadline_days, passmark, description, learn_outcomes, category, content_type:id, partner:partners(name, logo_url)').eq('status', 'published');
            return student?.cohort_id
              ? query.or(`available_to_everyone.eq.true,cohort_ids.cs.{${student.cohort_id}}`)
              : query.eq('available_to_everyone', true);
          })()
        : Promise.resolve({ data: [] });
      const [{ data: cohortCourseRows }, { data: attempts }, certsRes] = await Promise.all([
        courseCatalogQuery,
        supabase.from('course_attempts')
          .select('course_id, score, points, current_question_index, completed_at, passed, updated_at, answers')
          .eq('student_id', effectiveUserId)
          .order('started_at', { ascending: false }),
        token
          ? fetch('/api/course', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify({ action: 'get-my-certificates' }),
            }).then(r => r.json())
          : Promise.resolve({ certs: [] }),
      ]);

      // Build cert lookup: form_id -> cert id
      const certMap: Record<string, string> = {};
      for (const c of (certsRes?.certs ?? [])) certMap[c.form_id ?? c.course_id] = c.id;

      // Normalize course rows with config shape
      const normalizeCourse = (c: any) => ({
        ...c, content_type: 'course',
        config: { isCourse: true, title: c.title, coverImage: c.cover_image,
          questions: stripSqlSolutions(c.questions ?? []), deadline_days: c.deadline_days, passmark: c.passmark,
          description: c.description ?? '', learnOutcomes: c.learn_outcomes ?? [] },
      });
      const cohortCourses = (cohortCourseRows ?? []).map(normalizeCourse);

      // Deduplicate: one row per course.
      // A passed+completed attempt always wins over in-progress (student retaking a passed course).
      // Among completed, prefer higher score. For failed courses, prefer in-progress (retake flow).
      const progressMap: Record<string, any> = {};
      for (const a of attempts ?? []) {
        const ex = progressMap[a.course_id];
        if (!ex) { progressMap[a.course_id] = a; continue; }
        // a is passed+completed and ex is in-progress -- elevate the passing attempt
        if (a.passed && a.completed_at && !ex.completed_at) { progressMap[a.course_id] = a; continue; }
        // ex is already passed+completed -- never overwrite with an in-progress attempt
        if (ex.passed && ex.completed_at && !a.completed_at) continue;
        // Prefer in-progress over a completed-but-failed attempt (student is retaking)
        if (!a.completed_at && ex.completed_at && !ex.passed) { progressMap[a.course_id] = a; continue; }
        // Among completed, prefer higher score
        if (ex.completed_at && a.completed_at && a.score > ex.score) progressMap[a.course_id] = a;
      }

      // Merge: cohort courses + any extra courses the student has attempted
      const cohortIds = new Set(cohortCourses.map((f: any) => f.id));
      const extraIds  = Object.keys(progressMap).filter(id => !cohortIds.has(id));

      let extraForms: any[] = [];
      if (extraIds.length) {
        const { data } = await supabase.from('courses').select('id, title, slug, cover_image, questions, deadline_days, passmark, description, learn_outcomes, category, partner:partners(name, logo_url)').in('id', extraIds).eq('status', 'published');
        extraForms = (data ?? []).map(normalizeCourse);
      }

      const allForms = [...cohortCourses, ...extraForms];
      setCourses(allForms.map(f => ({ ...progressMap[f.id], form: f, form_id: f.id, cert_id: certMap[f.id] ?? null })));

      // Fetch cohort_assignments to compute deadlines
      if (student?.cohort_id && cohortCourses.length) {
        const cohortFormIds = cohortCourses.map((f: any) => f.id);
        const { data: assignments } = await supabase
          .from('cohort_assignments')
          .select('content_id, assigned_at')
          .eq('cohort_id', student.cohort_id)
          .in('content_id', cohortFormIds);

        const dlMap: Record<string, Date | null> = {};
        for (const form of cohortCourses as any[]) {
          const asgn = (assignments ?? []).find((a: any) => a.content_id === form.id);
          const deadlineDays = form.config?.deadline_days;
          dlMap[form.id] = asgn && deadlineDays
            ? new Date(new Date(asgn.assigned_at).getTime() + Number(deadlineDays) * 86400000)
            : null;
        }
        setDeadlines(dlMap);
      }

      // Load guided_project_attempts for VE status in search results
      const { data: veAttempts } = await supabase
        .from('guided_project_attempts')
        .select('ve_id, completed_at')
        .eq('student_id', effectiveUserId);
      if (veAttempts?.length) {
        const map: Record<string, { started: boolean; completed: boolean }> = {};
        for (const a of veAttempts) {
          map[a.ve_id] = { started: true, completed: Boolean(a.completed_at) };
        }
        setVeStatusMap(map);
      }

      setLoading(false);
    };
    load();
  }, [userEmail, userIdProp]);


  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return courses.filter((c: any) => {
      const title    = (c.form?.title ?? '').toLowerCase();
      const desc     = (c.form?.config?.description ?? c.form?.description ?? '').replace(/<[^>]*>/g, ' ').toLowerCase();
      const category = (c.form?.category ?? '').toLowerCase();
      return title.includes(q) || desc.includes(q) || category.includes(q);
    });
  }, [searchQuery, courses]);

  if (loading) return <CarouselSkeleton C={C}/>;

  return (
    <div className="space-y-6">
      {/* Empty state */}
      {!courses.length && !isOutstanding && (
        <EmptyState icon={BookOpen} title="No courses yet"
          body="You have not started any courses. Browse available courses to get started."
          action={<Link href="/" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold hover:opacity-80 dashboard-cta"
            style={{ background: C.cta, color: C.ctaText }}><BookOpen className="w-4 h-4"/> Browse courses</Link>}/>
      )}

      {/* Semantic search bar */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: C.muted }} />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search courses by topic, skill, or keyword…"
          className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm outline-none transition-all"
          style={{
            background:  C.card,
            border:      `1px solid ${C.cardBorder}`,
            color:       C.text,
          }}
        />
      </div>

      {/* Search results */}
      {searchResults !== null && (
        <div>
          {searchResults.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: C.muted }}>
              No courses found for &ldquo;{searchQuery}&rdquo;
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {searchResults.map((c: any) => (
                <CourseCard key={c.form_id} course={c} deadline={deadlines[c.form_id]} C={C} onDetails={() => setDetailCourse(c)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Courses grouped by tool -- hidden while searching */}
      {searchResults === null && (
        <div className="space-y-6">
          {groupCoursesByTool(courses).map(([tool, list]) => (
            <ToolRow key={tool} tool={tool} courses={list} deadlines={deadlines} C={C} onDetails={setDetailCourse} />
          ))}
        </div>
      )}

      <AnimatePresence>
        {detailCourse && (
          <CourseDetailPane course={detailCourse} C={C} onClose={() => setDetailCourse(null)}/>
        )}
      </AnimatePresence>
    </div>
  );
}
