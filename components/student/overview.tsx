'use client';

// The student dashboard's home: statistics, work in progress, what is due soon, and
// recommendations.

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C } from '@/lib/theme';
import { useScrollRow } from '@/lib/use-scroll-row';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { veProgressPct, veCompletionCounts, isVeComplete } from '@/lib/ve-completion';
import { courseProgressCounts, courseProgressPct } from '@/lib/course-progress';
import { CarouselSkeleton, EmptyState, ProgressBar, stripSqlSolutions } from '@/components/student/shared';
import type { SectionId } from '@/components/student/nav';
import {
  BookOpen, Briefcase, CheckCircle, ChevronLeft, ChevronRight, TrendingUp,
  Zap, Award, Medal, ClipboardList, CalendarDays, RefreshCw,
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

// Scroll buttons for a card row, shown only when the row has more cards than fit.
function RowArrows({ row, C }: { row: { overflows: boolean; scrollBy: (dir: number) => void }; C: typeof LIGHT_C }) {
  if (!row.overflows) return null;
  const btn = 'w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70';
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <button onClick={() => row.scrollBy(-1)} aria-label="Scroll left" className={btn} style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
        <ChevronLeft className="w-4 h-4"/>
      </button>
      <button onClick={() => row.scrollBy(1)} aria-label="Scroll right" className={btn} style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
        <ChevronRight className="w-4 h-4"/>
      </button>
    </div>
  );
}

// "In progress" carousel
function InProgressRow({ items, deadlines, C }: { items: any[]; deadlines: Record<string, Date | null>; C: typeof LIGHT_C }) {
  const { attach: rowRef, ...row } = useScrollRow();

  return (
    <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[22px] leading-7 font-bold" style={{ color: C.text }}>In progress</h3>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Pick up where you left off</p>
        </div>
        <RowArrows row={row} C={C} />
      </div>

      <div ref={rowRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {items.map(({ form, attempt, isProject }: any, idx: number) => {
          const { pct } = inProgressProgress(form, attempt, isProject);
          const cover = form.config?.coverImage;
          const href  = `/${form.slug || form.id}`;
          // The first card is the likely LCP element on the overview landing:
          // prioritize it and skip lazy-loading; lazy-load the rest of the row.
          const isLcp = idx === 0;
          return (
            <div key={form.id} className="flex-shrink-0 w-[220px] snap-start">
              <a href={href} className="block transition-transform hover:-translate-y-0.5">
                <div className="relative rounded-xl overflow-hidden w-full aspect-video" style={{ background: 'rgba(34,197,94,0.10)' }}>
                  <div className="absolute inset-0 flex items-center justify-center">{isProject ? <Briefcase className="w-8 h-8" style={{ color: '#16a34a' }}/> : <BookOpen className="w-8 h-8" style={{ color: '#16a34a' }}/>}</div>
                  {cover && <img src={resolveCoverUrl(cover)} alt="" loading={isLcp ? undefined : 'lazy'} fetchPriority={isLcp ? 'high' : undefined} className="absolute inset-0 w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>}
                  {(() => {
                    // The deadline when there is one, as Upcoming showed it; otherwise "In progress".
                    const dl = deadlines[form.id];
                    const days = dl ? Math.ceil((dl.getTime() - Date.now()) / 86400000) : null;
                    const label = days === null ? 'In progress' : days < 0 ? 'Overdue' : days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${days} days`;
                    const bg = days === null ? '#22c55e' : days < 0 ? '#D93025' : days <= 3 ? '#ea580c' : '#16a34a';
                    return <span className="absolute top-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: bg, color: '#ffffff' }}>{label}</span>;
                  })()}
                </div>
                <p className="text-xs mt-2" style={{ color: C.faint }}>{isProject ? 'Virtual Experience' : 'Course'}</p>
                <p className="text-base font-bold leading-snug mt-0.5 mb-3 line-clamp-2" style={{ color: C.text }}>{form.title}</p>
                <ProgressBar value={pct} color="#22c55e"/>
                <p className="text-[11px] mt-1" style={{ color: C.faint }}>{pct}% complete</p>
              </a>
            </div>
          );
        })}
      </div>

    </section>
  );
}

export function OverviewSection({ user, C, onNavigate }: {
  user: any; C: typeof LIGHT_C; onNavigate: (id: SectionId) => void;
}) {
  const [loading, setLoading]               = useState(true);
  const [loadError, setLoadError]           = useState(false);
  const [courses, setCourses]               = useState<any[]>([]);
  const [courseAttempts, setCourseAttempts] = useState<Record<string, any>>({});
  // Read from student_xp rather than summed here, so this figure and the leaderboard cannot disagree:
  // both come from recalc_student_xp. Summing course_attempts.points locally picked one attempt per
  // course by a slightly different rule than the trigger uses, and could land on an in-progress
  // attempt -- whose points the browser used to report.
  const [totalXP, setTotalXP] = useState(0);
  const [gpAttempts, setGpAttempts]         = useState<Record<string, any>>({});
  const [deadlines, setDeadlines]           = useState<Record<string, Date | null>>({});
  const [certCount, setCertCount]           = useState(0);
  const [events, setEvents] = useState<any[]>([]);
  const [gaps, setGaps]                     = useState<any[]>([]);
  const [assignmentItems, setAssignmentItems] = useState<any[]>([]);
  const [refreshKey, setRefreshKey]           = useState(0);
  const [badgeCount, setBadgeCount]           = useState(0);
  const { attach: recRef, ...recRow } = useScrollRow();
  const { attach: statRef, ...statRow } = useScrollRow();
  const { attach: upRef, ...upRow } = useScrollRow();

  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setRefreshKey(k => k + 1); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // The first load shows the skeleton; a refresh (coming back to the tab, Try again) swaps the
  // figures in place instead of blanking the page.
  const loadedOnce = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!loadedOnce.current) setLoading(true);
      setLoadError(false);
      try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? '';

      const { data: student, error: studentError } = await supabase
        .from('students').select('cohort_id').eq('id', user.id).single();
      if (studentError) throw studentError;
      const cohort = student?.cohort_id ?? null;

      // Fetch the student's group memberships so we can include group assignments below
      const { data: gmRows, error: groupMembershipError } = await supabase.from('group_members').select('group_id').eq('student_id', user.id);
      if (groupMembershipError) throw groupMembershipError;
      const myGroupIds = (gmRows ?? []).map((r: any) => r.group_id as string);

      // What the cohort can open, light: titles, covers and deadlines for Upcoming. The lesson and
      // mission content needed for progress is read below, only for work actually started.
      const [courseRes, veRes, attemptsRes, gpAttRes, cohortAssignRes, certsData, eventsRes, gapsData, assignmentsRes, asmSubsRes, earnedBadgesRes, groupAssignmentsRes, groupSubsRes, xpRes] =
        await Promise.all([
          cohort
            ? supabase.from('courses').select('id, title, slug, cover_image, deadline_days').or(`available_to_everyone.eq.true,cohort_ids.cs.{${cohort}}`).eq('status', 'published')
            : supabase.from('courses').select('id, title, slug, cover_image, deadline_days').eq('available_to_everyone', true).eq('status', 'published'),
          cohort
            ? supabase.from('virtual_experiences').select('id, title, slug, cover_image, deadline_days').or(`available_to_everyone.eq.true,cohort_ids.cs.{${cohort}}`).eq('status', 'published')
            : supabase.from('virtual_experiences').select('id, title, slug, cover_image, deadline_days').eq('available_to_everyone', true).eq('status', 'published'),
          supabase.from('course_attempts')
            .select('course_id, score, points, current_question_index, completed_at, passed, updated_at, answers')
            .eq('student_id', user.id).order('updated_at', { ascending: false }),
          supabase.from('guided_project_attempts')
            .select('ve_id, completed_at, progress, updated_at')
            .eq('student_id', user.id),
          cohort
            ? supabase.from('cohort_assignments').select('content_id, assigned_at').eq('cohort_id', cohort).in('content_type', ['course', 'virtual_experience'])
            : Promise.resolve({ data: [] as any[] }),
          // By student id, not the signed-in user, so view-as shows the student's certificates.
          supabase.from('certificates').select('id', { count: 'exact', head: true }).eq('student_id', user.id).eq('revoked', false),
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
          supabase.from('student_badges').select('badge_id', { count: 'exact', head: true }).eq('student_id', user.id),
          // Assignments targeting the student's groups
          myGroupIds.length > 0
            ? supabase.from('assignments').select('id, title, deadline_date, cover_image').overlaps('group_ids', myGroupIds).eq('status', 'published')
            : Promise.resolve({ data: [] as any[] }),
          // Group submissions for the student's groups (covers non-leader members)
          myGroupIds.length > 0
            ? supabase.from('assignment_submissions').select('assignment_id, status, participants').in('group_id', myGroupIds)
            : Promise.resolve({ data: [] as any[] }),
          // Read from student_xp rather than summed here, so this figure and the leaderboard agree.
          supabase.from('student_xp').select('total_xp').eq('student_id', user.id).maybeSingle(),
        ]);

      if (cancelled) return;

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

      // The content behind started, unfinished work, wherever it was reached from: the cohort, a
      // learning path, or open access. A course taken through a path is not assigned to the cohort
      // itself, so the list above alone left it out of In progress.
      const openCourseIds = Object.values(caMap).filter((a: any) => !a.completed_at).map((a: any) => a.course_id);
      const openVeIds = Object.values(gpMap).filter((a: any) => !a.completed_at).map((a: any) => a.ve_id);
      const [startedCourses, startedVes] = await Promise.all([
        openCourseIds.length
          ? supabase.from('courses').select('id, title, slug, cover_image, deadline_days, questions').in('id', openCourseIds)
          : Promise.resolve({ data: [] as any[] }),
        openVeIds.length
          ? supabase.from('virtual_experiences').select('id, title, slug, cover_image, deadline_days, modules').in('id', openVeIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      if (cancelled) return;

      // One list of courses and experiences: the started ones carry their content, the rest only
      // what Upcoming needs.
      const byId = new Map<string, any>();
      const add = (row: any, type: 'course' | 'virtual_experience') => byId.set(row.id, {
        ...byId.get(row.id), ...row, content_type: type,
        config: type === 'course'
          ? { title: row.title, coverImage: row.cover_image, questions: stripSqlSolutions(row.questions ?? byId.get(row.id)?.questions ?? []) }
          : { title: row.title, coverImage: row.cover_image, modules: row.modules ?? byId.get(row.id)?.modules ?? [] },
      });
      for (const row of courseRes.data ?? []) add(row, 'course');
      for (const row of startedCourses.data ?? []) add(row, 'course');
      for (const row of veRes.data ?? []) add(row, 'virtual_experience');
      for (const row of startedVes.data ?? []) add(row, 'virtual_experience');
      const allLearning = [...byId.values()];

      // Deadline map
      const assignedAtMap: Record<string, string> = {};
      for (const ca of cohortAssignRes.data ?? []) assignedAtMap[ca.content_id] = ca.assigned_at;
      const dlMap: Record<string, Date | null> = {};
      for (const f of allLearning) {
        const dl = f.deadline_days;
        const aa = assignedAtMap[f.id];
        dlMap[f.id] = aa && dl ? new Date(new Date(aa).getTime() + Number(dl) * 86400000) : null;
      }

      // Merge cohort assignments + group assignments, deduplicate by id
      const asmById = new Map<string, any>();
      for (const a of [...((assignmentsRes as any)?.data ?? []), ...((groupAssignmentsRes as any)?.data ?? [])]) asmById.set(a.id, a);
      const asmRows = Array.from(asmById.values());

      // Merge individual submissions + group submissions (individual wins on conflict)
      const subMap = new Map<string, string>();
      for (const sub of [
        ...((groupSubsRes as any)?.data ?? []).filter((g: any) => Array.isArray(g.participants) && g.participants.includes(user.id)),
        ...((asmSubsRes as any)?.data ?? []),
      ]) subMap.set(sub.assignment_id, sub.status);
      for (const a of asmRows) {
        if (a.deadline_date) dlMap[a.id] = new Date(a.deadline_date);
      }

      setTotalXP((xpRes as any)?.data?.total_xp ?? 0);
      setCourses(allLearning);
      setCourseAttempts(caMap);
      setGpAttempts(gpMap);
      setDeadlines(dlMap);
      setCertCount((certsData as any)?.count ?? 0);
      setEvents((eventsRes as any)?.data ?? []);
      setGaps((gapsData as any)?.gaps ?? []);
      setAssignmentItems(asmRows.map((a: any) => ({ ...a, _subStatus: subMap.get(a.id) ?? null })));
      setBadgeCount((earnedBadgesRes as any)?.count ?? 0);
      loadedOnce.current = true;

      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        // A superseded request must not clear the loader owned by the next request.
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [user.id, refreshKey]);

  const isProjForm = (f: any) => f.content_type === 'virtual_experience';

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
        // Started work is listed once, in In progress, with its deadline on the card.
        if (a || isEffectivelyDone(form, a, proj)) return null;
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

  if (loadError) return (
    <EmptyState
      icon={RefreshCw}
      title="Could not load your dashboard"
      body="Check your connection and try again."
      action={(
        <button type="button" onClick={() => setRefreshKey(key => key + 1)}
          className="text-sm font-semibold px-4 py-3 rounded-xl"
          style={{ background: C.cta, color: C.ctaText }}>
          Try again
        </button>
      )}
    />
  );

  return (
    <div className="space-y-4 lg:space-y-6">

      {/* Statistics carousel */}
      <section className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-[22px] leading-7 font-bold" style={{ color: C.text }}>Statistics</h3>
          <RowArrows row={statRow} C={C} />
        </div>

        <div ref={statRef} className="flex gap-5 overflow-x-auto pb-1 mt-4 snap-x"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {([
            { icon: Zap,         color: '#eab308', bg: 'rgba(234,179,8,0.12)',  value: totalXP.toLocaleString(), label: 'XP earned',        nav: 'badges'       },
            { icon: CheckCircle, color: '#16a34a', bg: 'rgba(22,163,74,0.12)',  value: completedCount,           label: 'Courses completed', nav: 'courses'      },
            { icon: Award,       color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', value: certCount,             label: 'Certificates',      nav: 'certificates' },
            { icon: Medal,       color: '#14b8a6', bg: 'rgba(20,184,166,0.12)', value: badgeCount,      label: 'Badges',            nav: 'badges'       },
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
      {inProgressItems.length > 0 && <InProgressRow items={inProgressItems} deadlines={deadlines} C={C} />}

      {/* Upcoming -- deadlines + events, carousel */}
      <section className="rounded-2xl p-5 sm:p-6 defer-render" style={{ background: C.card }}>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-[22px] leading-7 font-bold" style={{ color: C.text }}>Upcoming</h3>
          <RowArrows row={upRow} C={C} />
        </div>

        {upcomingDeadlines.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10">
            <CheckCircle className="w-8 h-8 opacity-30" style={{ color: '#16a34a' }}/>
            <p className="text-sm font-semibold" style={{ color: C.text }}>All clear!</p>
            <p className="text-xs" style={{ color: C.faint }}>No deadlines or events in the next 14 days.</p>
          </div>
        ) : (
          <div ref={upRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x"
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
                    <span className="absolute top-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded-md" style={{ background: col, color: '#ffffff' }}>{lbl}</span>
                  </div>
                  <p className="text-xs mt-2" style={{ color: C.faint }}>{typeLabel}</p>
                  <p className="text-base font-bold leading-snug mt-0.5 line-clamp-2" style={{ color: C.text }}>{title}</p>
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
              <h3 className="text-[22px] leading-7 font-bold truncate" style={{ color: C.text }}>Recommended for you</h3>
            </div>
            <RowArrows row={recRow} C={C} />
          </div>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Topics you haven&apos;t explored yet</p>

          <div ref={recRef} className="flex gap-4 overflow-x-auto pb-1 mt-4 snap-x"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {gaps.map((gap: any) => {
              const isVE = gap.course.contentType === 'virtual_experience' || gap.course.contentType === 'guided_project';
              const liveItem = courses.find((c: any) => c.id === gap.course.formId);
              if (!liveItem) return null;
              // The item's own page, as In progress links it; an experience used to open the list.
              const href = `/${liveItem.slug || liveItem.id}`;
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
                      <span className="absolute top-2 left-2 text-[11px] font-bold px-2 py-0.5 rounded-md"
                        style={{ background: '#16a34a', color: '#ffffff' }}>
                        {String(gap.topic).slice(0, 24)}
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-2" style={{ color: C.faint }}>{isVE ? 'Virtual Experience' : 'Course'}</p>
                  <p className="text-base font-bold leading-snug mt-0.5 line-clamp-2" style={{ color: C.text }}>{gap.course.title}</p>
                </a>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

