'use client';

// Overview (dashboard home) section, extracted verbatim from app/student/page.tsx.
// OverviewSection is exported; inProgressProgress, InProgressPreview and InProgressRow
// are file-internal.

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { veProgressPct, veCompletionCounts, isVeComplete } from '@/lib/ve-completion';
import { courseProgressCounts, courseProgressPct } from '@/lib/course-progress';
import { CarouselSkeleton, ProgressBar, HoverPreviewCard, stripSqlSolutions } from '@/components/student/shared';
import { isIndividualCohort } from '@/lib/cohort-kind';
import type { SectionId } from '@/components/student/nav';
import {
  BookOpen, Briefcase, CheckCircle, ChevronLeft, ChevronRight, Play, TrendingUp,
  Zap, Award, Medal, ClipboardList, CalendarDays,
} from 'lucide-react';

// --- Overview section ---
// Progress (answered/total or requirements done) for an in-progress course or project
function inProgressProgress(form: any, attempt: any, isProject: boolean) {
  if (isProject) {
    // Shared rule: a skipped optional LinkedIn share must not drag this below 100%.
    const modules = form.config?.modules ?? [];
    const counts = veCompletionCounts(modules, attempt?.progress ?? {});
    return { done: counts.doneReqs, total: counts.totalReqs, pct: veProgressPct(modules, attempt?.progress ?? {}) };
  }
  // Shared rule: an unclaimed optional LinkedIn slide must not drag this below 100%.
  const questions = form.config?.questions ?? [];
  const answers = attempt?.answers ?? {};
  const counts = courseProgressCounts(questions, answers);
  return { done: counts.done, total: counts.total, pct: courseProgressPct(questions, answers) };
}

// Rich hover preview for an in-progress item
function InProgressPreview({ form, isProject, pct, done, total, href, C }: {
  form: any; isProject: boolean; pct: number; done: number; total: number; href: string; C: typeof LIGHT_C;
}) {
  const cover = form.config?.coverImage;
  const desc = (form.config?.description ?? form.description ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: C.card, boxShadow: '0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)' }}>
      <div className="relative w-full aspect-video" style={{ background: 'rgba(34,197,94,0.10)' }}>
        <div className="absolute inset-0 flex items-center justify-center">{isProject ? <Briefcase className="w-9 h-9" style={{ color: '#16a34a' }}/> : <BookOpen className="w-9 h-9" style={{ color: '#16a34a' }}/>}</div>
        {cover && <img src={resolveCoverUrl(cover)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>}
        <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: '#22c55e', color: '#ffffff' }}>In progress</span>
      </div>
      <div className="p-5">
        <p className="text-xs mb-1" style={{ color: C.faint }}>{isProject ? 'Virtual Experience' : 'Course'}</p>
        <h3 className="text-lg font-bold leading-snug mb-2 line-clamp-2" style={{ color: C.text }}>{form.title}</h3>
        {desc && <p className="text-sm leading-relaxed line-clamp-3 mb-3" style={{ color: C.muted }}>{desc}</p>}
        <div className="flex items-center justify-between gap-2 mb-1.5 text-[12px]" style={{ color: C.faint }}>
          <span>{pct}% complete</span><span>{done}/{total}</span>
        </div>
        <ProgressBar value={pct} color="#22c55e"/>
        <a href={href} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl transition-opacity hover:opacity-90 mt-4"
          style={{ background: '#16a34a', color: '#ffffff' }}>
          <Play className="w-3.5 h-3.5"/> Continue
        </a>
      </div>
    </div>
  );
}

// "In Progress" carousel with the grow-from-card hover preview
function InProgressRow({ items, C }: { items: any[]; C: typeof LIGHT_C }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  const [hover, setHover] = useState<{ data: any; left: number; top: number; originX: number; originY: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 120); };
  const openHover = (data: any, el: HTMLElement) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;
    cancelClose();
    const r = el.getBoundingClientRect();
    const W = 320, H = 520;
    const left = Math.max(12, Math.min(r.left + r.width / 2 - W / 2, window.innerWidth - W - 12));
    const top  = Math.max(12, Math.min(r.top - 20, window.innerHeight - H - 12));
    const originX = Math.max(0, Math.min(r.left + r.width / 2 - left, W));
    const originY = Math.max(0, Math.min(r.top + r.height / 2 - top, H));
    setHover({ data, left, top, originX, originY });
  };
  useEffect(() => () => cancelClose(), []);

  return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xl sm:text-2xl font-bold leading-tight" style={{ color: C.text }}>In Progress</h3>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Pick up where you left off</p>
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
        {items.map(({ form, attempt, isProject }: any, idx: number) => {
          const { pct, done, total } = inProgressProgress(form, attempt, isProject);
          const cover = form.config?.coverImage;
          const href  = `/${form.slug || form.id}`;
          const data  = { form, isProject, pct, done, total, href };
          // The first card is the likely LCP element on the overview landing:
          // prioritize it and skip lazy-loading; lazy-load the rest of the row.
          const isLcp = idx === 0;
          return (
            <div key={form.id} className="flex-shrink-0 w-[220px] snap-start"
              onMouseEnter={(e) => openHover(data, e.currentTarget)} onMouseLeave={scheduleClose}>
              <a href={href} target="_blank" rel="noreferrer" className="block transition-transform hover:-translate-y-0.5">
                <div className="relative rounded-xl overflow-hidden w-full aspect-video" style={{ background: 'rgba(34,197,94,0.10)' }}>
                  <div className="absolute inset-0 flex items-center justify-center">{isProject ? <Briefcase className="w-8 h-8" style={{ color: '#16a34a' }}/> : <BookOpen className="w-8 h-8" style={{ color: '#16a34a' }}/>}</div>
                  {cover && <img src={resolveCoverUrl(cover)} alt="" loading={isLcp ? undefined : 'lazy'} fetchPriority={isLcp ? 'high' : undefined} className="absolute inset-0 w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>}
                  <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: '#22c55e', color: '#ffffff' }}>In progress</span>
                </div>
                <p className="text-xs mt-2" style={{ color: C.faint }}>{isProject ? 'Virtual Experience' : 'Course'}</p>
                <p className="text-[15px] font-bold leading-snug mt-0.5 mb-2.5 line-clamp-2" style={{ color: C.text }}>{form.title}</p>
                <ProgressBar value={pct} color="#22c55e"/>
                <p className="text-[11px] mt-1" style={{ color: C.faint }}>{pct}% complete</p>
              </a>
            </div>
          );
        })}
      </div>

      {typeof document !== 'undefined' && hover && createPortal(
        <HoverPreviewCard key={hover.data.form.id} left={hover.left} top={hover.top} originX={hover.originX} originY={hover.originY} onEnter={cancelClose} onLeave={scheduleClose}>
          <InProgressPreview form={hover.data.form} isProject={hover.data.isProject} pct={hover.data.pct} done={hover.data.done} total={hover.data.total} href={hover.data.href} C={C} />
        </HoverPreviewCard>,
        document.body,
      )}
    </section>
  );
}

export function OverviewSection({ user, userEmail, C, onNavigate }: {
  user: any; userEmail: string; C: typeof LIGHT_C; onNavigate: (id: SectionId) => void;
}) {
  const [loading, setLoading]               = useState(true);
  const [courses, setCourses]               = useState<any[]>([]);
  const [courseAttempts, setCourseAttempts] = useState<Record<string, any>>({});
  // Read from student_xp rather than summed here, so this figure and the leaderboard cannot disagree:
  // both come from recalc_student_xp. Summing course_attempts.points locally picked one attempt per
  // course by a slightly different rule than the trigger uses, and could land on an in-progress
  // attempt -- whose points the browser used to report.
  const [totalXP, setTotalXP] = useState(0);
  const [gpAttempts, setGpAttempts]         = useState<Record<string, any>>({});
  const [deadlines, setDeadlines]           = useState<Record<string, Date | null>>({});
  const [certs, setCerts]                   = useState<any[]>([]);
  const [myRank, setMyRank]                 = useState<number | null>(null);
  const [totalInCohort, setTotalInCohort]   = useState(0);
  const [events, setEvents] = useState<any[]>([]);
  const [gaps, setGaps]                     = useState<any[]>([]);
  const [assignmentStats, setAssignmentStats] = useState<{ total: number; submitted: number; graded: number } | null>(null);
  const [assignmentItems, setAssignmentItems] = useState<any[]>([]);
  const [refreshKey, setRefreshKey]           = useState(0);
  const [allBadges, setAllBadges]             = useState<{ id: string; name: string; description: string; icon: string; color: string; image_url: string | null }[]>([]);
  const [earnedBadgeIds, setEarnedBadgeIds]   = useState<Set<string>>(new Set());
  const [streak, setStreak]                   = useState<{ current_streak: number; longest_streak: number } | null>(null);
  const recScrollRef = useRef<HTMLDivElement>(null);
  const recScrollBy = (dir: number) => recScrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  const statScrollRef = useRef<HTMLDivElement>(null);
  const statScrollBy = (dir: number) => statScrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });
  const upScrollRef = useRef<HTMLDivElement>(null);
  const upScrollBy = (dir: number) => upScrollRef.current?.scrollBy({ left: dir * 320, behavior: 'smooth' });

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setRefreshKey(k => k + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';

      const { data: student } = await supabase
        .from('students').select('cohort_id, cohort:cohorts!cohort_id(cohort_kind)').eq('id', user.id).single();
      const cohort = student?.cohort_id ?? null;
      // A synthetic individual-enrollment cohort (migration 165) has no real peer
      // group, so its "leaderboard" is just the one student -- skip fetching it.
      // Courses/VEs/events/assignments stay keyed off `cohort` as-is: they still
      // correctly show whatever's actually tagged into that cohort's cohort_ids
      // (the individually-purchased course), and naturally come back empty for
      // content types individual enrollment never tags (events, VEs, assignments).
      const inIndividualCohort = isIndividualCohort((student as any)?.cohort?.cohort_kind);

      // Fetch the student's group memberships so we can include group assignments below
      const { data: gmRows } = await supabase.from('group_members').select('group_id').eq('student_id', user.id);
      const myGroupIds = (gmRows ?? []).map((r: any) => r.group_id as string);

      const [courseRes, veRes, attemptsRes, gpAttRes, cohortAssignCrsRes, cohortAssignVeRes, certsData, lbData, eventsRes, gapsData, assignmentsRes, asmSubsRes, allBadgesRes, earnedBadgesRes, streakRes, groupAssignmentsRes, groupSubsRes] =
        await Promise.all([
          cohort
            ? supabase.from('courses').select('id, title, slug, cover_image, questions, deadline_days, passmark, description, learn_outcomes').or(`available_to_everyone.eq.true,cohort_ids.cs.{${cohort}}`).eq('status', 'published')
            : supabase.from('courses').select('id, title, slug, cover_image, questions, deadline_days, passmark, description, learn_outcomes').eq('available_to_everyone', true).eq('status', 'published'),
          cohort
            ? supabase.from('virtual_experiences').select('id, title, slug, cover_image, modules, deadline_days').contains('cohort_ids', [cohort]).eq('status', 'published')
            : Promise.resolve({ data: [] as any[] }),
          supabase.from('course_attempts')
            .select('course_id, score, points, current_question_index, completed_at, passed, updated_at, answers')
            .eq('student_id', user.id).order('updated_at', { ascending: false }),
          supabase.from('guided_project_attempts')
            .select('ve_id, completed_at, progress, updated_at')
            .eq('student_id', user.id),
          cohort
            ? supabase.from('cohort_assignments').select('content_id, assigned_at').eq('cohort_id', cohort).eq('content_type', 'course')
            : Promise.resolve({ data: [] as any[] }),
          cohort
            ? supabase.from('cohort_assignments').select('content_id, assigned_at').eq('cohort_id', cohort).eq('content_type', 'virtual_experience')
            : Promise.resolve({ data: [] as any[] }),
          token
            ? fetch('/api/course', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ action: 'get-my-certificates' }),
              }).then(r => r.json()).catch(() => ({ certs: [] }))
            : Promise.resolve({ certs: [] }),
          cohort && token && !inIndividualCohort
            ? fetch(`/api/leaderboard?cohort_id=${encodeURIComponent(cohort)}`, { headers: { Authorization: `Bearer ${token}` } })
                .then(r => r.json()).catch(() => ({ rankings: [] }))
            : Promise.resolve({ rankings: [] }),
          cohort
            ? supabase.from('events').select('id, title, slug, event_date, event_time, cover_image').contains('cohort_ids', [cohort]).eq('status', 'published')
            : Promise.resolve({ data: [] as any[] }),
          token
            ? fetch('/api/vector/gaps', { headers: { Authorization: `Bearer ${token}` } })
                .then(r => r.json()).catch(() => ({ gaps: [] }))
            : Promise.resolve({ gaps: [] }),
          // Assignments assigned to this cohort
          cohort
            ? supabase.from('assignments').select('id, title, deadline_date, cover_image').contains('cohort_ids', [cohort]).eq('status', 'published')
            : Promise.resolve({ data: [] as any[] }),
          // This student's submissions
          supabase.from('assignment_submissions')
            .select('assignment_id, status')
            .eq('student_id', user.id),
          // All badge definitions (public)
          supabase.from('badges').select('id, name, description, icon, color, image_url').order('id'),
          // Earned badge IDs for this student
          supabase.from('student_badges').select('badge_id').eq('student_id', user.id),
          // Streak
          supabase.from('student_streaks')
            .select('current_streak, longest_streak')
            .eq('student_id', user.id)
            .maybeSingle(),
          // Assignments targeting the student's groups
          myGroupIds.length > 0
            ? supabase.from('assignments').select('id, title, deadline_date, cover_image').overlaps('group_ids', myGroupIds).eq('status', 'published')
            : Promise.resolve({ data: [] as any[] }),
          // Group submissions for the student's groups (covers non-leader members)
          myGroupIds.length > 0
            ? supabase.from('assignment_submissions').select('assignment_id, status, participants').in('group_id', myGroupIds)
            : Promise.resolve({ data: [] as any[] }),
        ]);

      if (cancelled) return;

      // Normalize courses and VEs into a unified shape with config reconstruction
      const normalizedCourses = (courseRes.data ?? []).map((c: any) => ({
        ...c, content_type: 'course',
        config: { isCourse: true, title: c.title, coverImage: c.cover_image, questions: stripSqlSolutions(c.questions ?? []), deadline_days: c.deadline_days, passmark: c.passmark, description: c.description ?? '', learnOutcomes: c.learn_outcomes ?? [] },
      }));
      const normalizedVEs = (veRes.data ?? []).map((ve: any) => ({
        ...ve, content_type: 'virtual_experience',
        config: { isVirtualExperience: true, title: ve.title, coverImage: ve.cover_image, modules: ve.modules ?? [], deadline_days: ve.deadline_days },
      }));

      // Deduplicate course attempts: passed+completed always wins over in-progress; higher score among completed.
      const caMap: Record<string, any> = {};
      for (const a of attemptsRes.data ?? []) {
        const key = a.course_id;
        const ex = caMap[key];
        if (!ex) { caMap[key] = a; continue; }
        if (a.passed && a.completed_at && !ex.completed_at) { caMap[key] = a; continue; }
        if (ex.passed && ex.completed_at && !a.completed_at) continue;
        if (!a.completed_at && ex.completed_at && !ex.passed) { caMap[key] = a; continue; }
        if (a.completed_at && ex.completed_at && (a.score ?? 0) > (ex.score ?? 0)) caMap[key] = a;
      }
      const gpMap: Record<string, any> = {};
      for (const a of gpAttRes.data ?? []) gpMap[a.ve_id] = a;

      // Deadline map
      const assignedAtMap: Record<string, string> = {};
      for (const ca of cohortAssignCrsRes.data ?? []) assignedAtMap[ca.content_id] = ca.assigned_at;
      for (const ca of cohortAssignVeRes.data ?? []) assignedAtMap[ca.content_id] = ca.assigned_at;
      const allLearning = [...normalizedCourses, ...normalizedVEs];
      const dlMap: Record<string, Date | null> = {};
      for (const f of allLearning) {
        const dl = f.deadline_days;
        const aa = assignedAtMap[f.id];
        dlMap[f.id] = aa && dl ? new Date(new Date(aa).getTime() + Number(dl) * 86400000) : null;
      }

      const isProjForm = (f: any) =>
        f.content_type === 'guided_project' || f.content_type === 'virtual_experience' ||
        f.config?.isGuidedProject || f.config?.isVirtualExperience;
      const isCrsForm  = (f: any) => f.content_type === 'course' || f.config?.isCourse;

      // Leaderboard rank
      const rankings: any[] = (lbData as any)?.rankings ?? [];
      const myEntry = rankings.find((r: any) => r.isMe);

      // Merge cohort assignments + group assignments, deduplicate by id
      const cohortAsmRows = (assignmentsRes as any)?.data ?? [];
      const groupAsmRows  = (groupAssignmentsRes as any)?.data ?? [];
      const asmById = new Map<string, any>();
      for (const a of [...cohortAsmRows, ...groupAsmRows]) asmById.set(a.id, a);
      const asmRows = Array.from(asmById.values());

      // Merge individual submissions + group submissions (individual wins on conflict)
      const individualSubRows = (asmSubsRes as any)?.data ?? [];
      const groupSubRowsMerge = (groupSubsRes as any)?.data ?? [];
      const subById = new Map<string, any>();
      for (const s of [
        ...groupSubRowsMerge.filter((s: any) => Array.isArray(s.participants) && s.participants.includes(user.id)),
        ...individualSubRows,
      ]) subById.set(s.assignment_id, s);
      const subRows = Array.from(subById.values());
      const subMap  = new Map(subRows.map((s: any) => [s.assignment_id, s.status]));
      for (const a of asmRows) {
        if (a.deadline_date) dlMap[a.id] = new Date(a.deadline_date);
      }

      const { data: xpRow } = await supabase
        .from('student_xp').select('total_xp').eq('student_id', user.id).maybeSingle();
      setTotalXP((xpRow as any)?.total_xp ?? 0);

      setCourses(allLearning);
      setCourseAttempts(caMap);
      setGpAttempts(gpMap);
      setDeadlines(dlMap);
      setCerts((certsData as any)?.certs ?? []);
      setMyRank(myEntry?.rank ?? null);
      setTotalInCohort(rankings.length);
      setEvents((eventsRes as any)?.data ?? []);
      setGaps((gapsData as any)?.gaps ?? []);
      setAssignmentStats({
        total:     asmRows.length,
        submitted: subRows.filter((s: any) => ['submitted', 'graded'].includes(s.status)).length,
        graded:    subRows.filter((s: any) => s.status === 'graded').length,
      });

      // Store assignments in state so deadlines panel can render them
      setAssignmentItems(asmRows.map((a: any) => ({ ...a, _subStatus: subMap.get(a.id) ?? null })));

      // Badges
      setAllBadges((allBadgesRes as any)?.data ?? []);
      setEarnedBadgeIds(new Set(((earnedBadgesRes as any)?.data ?? []).map((b: any) => b.badge_id)));

      // Streak
      const streakData = (streakRes as any)?.data;
      setStreak(streakData ? { current_streak: streakData.current_streak, longest_streak: streakData.longest_streak } : null);

      setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [user.id, userEmail, refreshKey]);

  const isProjForm = (f: any) =>
    f.content_type === 'guided_project' || f.content_type === 'virtual_experience' ||
    f.config?.isGuidedProject || f.config?.isVirtualExperience;

  // eslint-disable-next-line react-hooks/purity
  const now = useMemo(() => Date.now(), []);

  // Shared helper -- true if the item has genuine remaining work
  const isEffectivelyDone = (f: any, a: any, proj: boolean): boolean => {
    if (!a) return false;
    if (a.completed_at) return true;
    if (proj) {
      // Same verdict the server reaches, so an item finished by skipping an optional share does
      // not linger in the In Progress row.
      return isVeComplete(veCompletionCounts(f.config?.modules ?? [], a.progress ?? {}));
    } else {
      const totalQ = (f.config?.questions ?? []).length;
      return totalQ > 0 && (a.current_question_index ?? 0) >= totalQ;
    }
  };

  // Count successful course completions from attempts directly. Restricting this
  // metric to the cohort course catalog omitted courses reached through a learning
  // path, because path items do not need to be assigned to the cohort separately.
  const completedCount = Object.values(courseAttempts).filter(
    a => a?.passed === true && Boolean(a.completed_at),
  ).length;

  // In-progress items sorted by last active -- most recent first
  const inProgressItems = [...courses]
    .map(f => {
      const proj = isProjForm(f);
      const a    = proj ? gpAttempts[f.id] : courseAttempts[f.id];
      return { form: f, attempt: a, isProject: proj, ts: a?.updated_at ? new Date(a.updated_at).getTime() : 0 };
    })
    .filter(({ attempt, form, isProject }) => !!attempt && !isEffectivelyDone(form, attempt, isProject))
    .sort((a, b) => b.ts - a.ts);

  // Deadlines in the next 14 days (excluding already-completed)
  const upcomingDeadlines: Array<{ title: string; daysLeft: number; type: 'course' | 'project' | 'assignment' | 'event'; cover?: string | null }> = [
    // Courses + VEs
    ...Object.entries(deadlines)
      .filter(([formId]) => courses.some(f => f.id === formId))
      .map(([formId, dl]) => {
        if (!dl) return null;
        const form = courses.find(f => f.id === formId);
        if (!form) return null;
        const proj = isProjForm(form);
        const a    = proj ? gpAttempts[formId] : courseAttempts[formId];
        if (isEffectivelyDone(form, a, proj)) return null;
        const daysLeft = Math.ceil((dl.getTime() - now) / 86400000);
        if (daysLeft > 14) return null;
        return { title: form.title, daysLeft, type: proj ? 'project' : 'course', cover: form.config?.coverImage ?? form.cover_image ?? null } as const;
      })
      .filter(Boolean) as any[],
    // Assignments
    ...assignmentItems
      .filter(a => {
        if (!a.deadline_date) return false;
        if (a._subStatus === 'submitted' || a._subStatus === 'graded') return false;
        const dl = new Date(a.deadline_date);
        const daysLeft = Math.ceil((dl.getTime() - now) / 86400000);
        return daysLeft <= 14;
      })
      .map(a => ({
        title: a.title,
        daysLeft: Math.ceil((new Date(a.deadline_date).getTime() - now) / 86400000),
        type: 'assignment' as const,
        cover: a.cover_image ?? null,
      })),
    // Events
    ...events
      .map((ev: any) => {
        if (!ev.event_date) return null;
        const d = new Date(`${ev.event_date}T${(ev.event_time || '00:00').slice(0, 5)}:00`);
        if (Number.isNaN(d.getTime())) return null;
        const daysLeft = Math.ceil((d.getTime() - now) / 86400000);
        if (daysLeft < 0 || daysLeft > 14) return null;
        return { title: ev.title, daysLeft, type: 'event' as const, cover: ev.cover_image ?? null };
      })
      .filter(Boolean) as any[],
  ].sort((a: any, b: any) => a.daysLeft - b.daysLeft);

  if (loading) return <CarouselSkeleton C={C} rows={3}/>;

  return (
    <div className="space-y-4 lg:space-y-6">

      {/* Statistics carousel */}
      <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-xl sm:text-2xl font-bold leading-tight" style={{ color: C.text }}>Statistics</h3>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button onClick={() => statScrollBy(-1)} aria-label="Scroll left"
              className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
              style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
              <ChevronLeft className="w-4 h-4"/>
            </button>
            <button onClick={() => statScrollBy(1)} aria-label="Scroll right"
              className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
              style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
              <ChevronRight className="w-4 h-4"/>
            </button>
          </div>
        </div>

        <div ref={statScrollRef} className="flex gap-5 overflow-x-auto pb-1 mt-4 snap-x"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {([
            { icon: Zap,         color: '#eab308', bg: 'rgba(234,179,8,0.12)',  value: totalXP.toLocaleString(), label: 'XP Earned',        nav: 'badges'       },
            { icon: CheckCircle, color: '#16a34a', bg: 'rgba(22,163,74,0.12)',  value: completedCount,           label: 'Courses Completed', nav: 'courses'      },
            { icon: Award,       color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', value: certs.length,             label: 'Certificates',      nav: 'certificates' },
            { icon: Medal,       color: '#14b8a6', bg: 'rgba(20,184,166,0.12)', value: earnedBadgeIds.size,      label: 'Badges',            nav: 'badges'       },
          ] as const).map(({ icon: Icon, color, bg, value, label, nav }) => (
            <button key={label} onClick={() => onNavigate(nav as SectionId)}
              className="flex-shrink-0 w-[180px] snap-start flex items-center gap-3 text-left transition-opacity hover:opacity-80">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                <Icon className="w-5 h-5" style={{ color }}/>
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-black tabular-nums leading-none" style={{ color: C.text }}>{value}</div>
                <div className="text-[11px] font-medium mt-0.5 truncate" style={{ color: C.muted }}>{label}</div>
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* In Progress carousel */}
      {inProgressItems.length > 0 && <InProgressRow items={inProgressItems} C={C} />}

      {/* Upcoming -- deadlines + events, carousel */}
      <section className="rounded-2xl p-5 sm:p-6 defer-render" style={{ background: C.card }}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-xl sm:text-2xl font-bold leading-tight" style={{ color: C.text }}>Upcoming</h3>
          {upcomingDeadlines.length > 0 && (
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => upScrollBy(-1)} aria-label="Scroll left"
                className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
                style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                <ChevronLeft className="w-4 h-4"/>
              </button>
              <button onClick={() => upScrollBy(1)} aria-label="Scroll right"
                className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
                style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                <ChevronRight className="w-4 h-4"/>
              </button>
            </div>
          )}
        </div>

        {upcomingDeadlines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <CheckCircle className="w-8 h-8 opacity-30" style={{ color: '#16a34a' }}/>
            <p className="text-sm font-semibold" style={{ color: C.text }}>All clear!</p>
            <p className="text-xs" style={{ color: C.faint }}>No deadlines or events in the next 14 days.</p>
          </div>
        ) : (
          <div ref={upScrollRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {upcomingDeadlines.map(({ title, daysLeft, type, cover }, idx) => {
              const col = daysLeft < 0 ? '#ef4444' : daysLeft <= 3 ? '#f59e0b' : daysLeft <= 7 ? '#f97316' : '#16a34a';
              const lbl = daysLeft < 0 ? 'Overdue' : daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft} days`;
              const Icon = type === 'assignment' ? ClipboardList : type === 'project' ? Briefcase : type === 'event' ? CalendarDays : BookOpen;
              const typeLabel = type === 'assignment' ? 'Assignment' : type === 'project' ? 'Project' : type === 'event' ? 'Event' : 'Course';
              return (
                <div key={`${type}-${title}-${idx}`} className="flex-shrink-0 w-[210px] snap-start">
                  <div className="relative rounded-xl overflow-hidden w-full aspect-video flex items-center justify-center" style={{ background: `${col}14` }}>
                    <Icon className="w-10 h-10" style={{ color: col }}/>
                    {cover && <img src={resolveCoverUrl(cover)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>}
                    <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md" style={{ background: col, color: '#ffffff' }}>{lbl}</span>
                  </div>
                  <p className="text-xs mt-2" style={{ color: C.faint }}>{typeLabel}</p>
                  <p className="text-[15px] font-bold leading-snug mt-0.5 line-clamp-2" style={{ color: C.text }}>{title}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recommended for you -- last on page */}
      {gaps.length > 0 && (
        <section className="rounded-2xl p-5 sm:p-6 defer-render" style={{ background: C.card }}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-2 min-w-0">
              <TrendingUp className="w-5 h-5 flex-shrink-0" style={{ color: C.green }}/>
              <h3 className="text-xl sm:text-2xl font-bold leading-tight truncate" style={{ color: C.text }}>Recommended for You</h3>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={() => recScrollBy(-1)} aria-label="Scroll left"
                className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
                style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                <ChevronLeft className="w-4 h-4"/>
              </button>
              <button onClick={() => recScrollBy(1)} aria-label="Scroll right"
                className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
                style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
                <ChevronRight className="w-4 h-4"/>
              </button>
            </div>
          </div>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Topics you haven&apos;t explored yet</p>

          <div ref={recScrollRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {gaps.map((gap: any) => {
              const isVE = gap.course.contentType === 'virtual_experience' || gap.course.contentType === 'guided_project';
              const liveItem = courses.find((c: any) => c.id === gap.course.formId);
              if (!liveItem) return null;
              const href = isVE ? '/student#virtual_experiences' : `/${liveItem.slug || liveItem.id}`;
              const rawCover = gap.course.coverImage;
              const safeCover = (() => {
                try { const u = new URL(rawCover ?? ''); return (u.protocol === 'https:' || u.protocol === 'http:') ? rawCover : null; } catch { return null; }
              })();
              return (
                <a key={gap.course.formId} href={href}
                  className="flex-shrink-0 w-[220px] snap-start block no-underline transition-transform hover:-translate-y-0.5">
                  <div className="relative rounded-xl overflow-hidden w-full aspect-video flex items-center justify-center"
                    style={{ background: 'rgba(34,197,94,0.10)' }}>
                    {isVE ? <Briefcase className="w-8 h-8" style={{ color: '#16a34a' }}/> : <BookOpen className="w-8 h-8" style={{ color: '#16a34a' }}/>}
                    {safeCover && <img src={resolveCoverUrl(safeCover)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>}
                    {gap.topic && (
                      <span className="absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-md"
                        style={{ background: '#16a34a', color: '#ffffff' }}>
                        {String(gap.topic).slice(0, 24)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-2" style={{ color: C.faint }}>{isVE ? 'Virtual Experience' : 'Course'}</p>
                  <p className="text-[15px] font-bold leading-snug mt-0.5 line-clamp-2" style={{ color: C.text }}>{gap.course.title}</p>
                </a>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// --- Copyable detail row used inside payment option cards ---
