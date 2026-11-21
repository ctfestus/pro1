'use client';

// The student dashboard's home: statistics, work in progress, what is due soon, and
// recommendations.

import { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { veProgressPct, veCompletionCounts, isVeComplete } from '@/lib/ve-completion';
import { courseProgressCounts, courseProgressPct } from '@/lib/course-progress';
import { CarouselSkeleton, EmptyState, stripSqlSolutions } from '@/components/student/shared';
import { deadlineTag } from '@/components/student/learning-card';
import { CardMeta, FRAMED_CARD } from '@/components/CardMeta';
import { cleanList } from '@/lib/catalogue-preview-facts';

/** The primary blue, for the Resume button and the progress it continues. */
const BLUE = DARK_C.cta;
import { DISPLAY_FONT, Pill, palette, plural } from '@/components/dashboard/subscriptions/ui';
import type { SectionId } from '@/components/student/nav';
import {
  Video, Briefcase, CheckCircle,
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

export function OverviewSection({ user, name, C, onNavigate }: {
  user: any;
  /** The learner's name, for the greeting. */
  name: string | null;
  C: typeof LIGHT_C; onNavigate: (id: SectionId) => void;
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

      // What the cohort can open, light: titles, covers and deadlines for Upcoming, and the tags,
      // level and tools the Recommended cards show. The lesson and mission content needed for
      // progress is read below, only for work actually started.
      const [courseRes, veRes, attemptsRes, gpAttRes, cohortAssignRes, certsData, eventsRes, gapsData, assignmentsRes, asmSubsRes, earnedBadgesRes, groupAssignmentsRes, groupSubsRes, xpRes] =
        await Promise.all([
          cohort
            ? supabase.from('courses').select('id, title, slug, cover_image, deadline_days, difficulty, tags, tools').or(`available_to_everyone.eq.true,cohort_ids.cs.{${cohort}}`).eq('status', 'published')
            : supabase.from('courses').select('id, title, slug, cover_image, deadline_days, difficulty, tags, tools').eq('available_to_everyone', true).eq('status', 'published'),
          cohort
            ? supabase.from('virtual_experiences').select('id, title, slug, cover_image, deadline_days, industry, difficulty, tags, tools').or(`available_to_everyone.eq.true,cohort_ids.cs.{${cohort}}`).eq('status', 'published')
            : supabase.from('virtual_experiences').select('id, title, slug, cover_image, deadline_days, industry, difficulty, tags, tools').eq('available_to_everyone', true).eq('status', 'published'),
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
  const upcomingDeadlines: Array<{ title: string; daysLeft: number; date: Date; type: 'course' | 'project' | 'assignment' | 'event'; cover?: string | null }> = [
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
        return { title: form.title, daysLeft, date: dl, type: proj ? 'project' : 'course', cover: form.config?.coverImage ?? form.cover_image ?? null } as const;
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
        date: new Date(a.deadline_date),
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
        return { title: ev.title, daysLeft, date: d, type: 'event' as const, cover: ev.cover_image ?? null };
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

  const firstName = (name ?? '').trim().split(/\s+/)[0];
  const dueThisWeek = upcomingDeadlines.filter(item => item.daysLeft <= 7).length;
  const cardBox = 'rounded-2xl p-5 sm:p-6';
  const sectionTitle = 'text-[22px] leading-7 font-bold';
  const seeAll = (label: string, to: SectionId) => (
    <button type="button" onClick={() => onNavigate(to)} className="flex-shrink-0 text-sm font-semibold hover:underline" style={{ color: C.text }}>{label}</button>
  );
  const typeIcon = { assignment: ClipboardList, project: Briefcase, event: CalendarDays, course: Video } as const;
  const typeName = { assignment: 'Assignment', project: 'Virtual experience', event: 'Event', course: 'Course' } as const;

  return (
    <div className="flex flex-col gap-6">
      {/* Greeting, and how much is due this week. */}
      <div>
        <h1 className="text-[28px] leading-9 font-bold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>
          {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
        </h1>
        <p className="mt-1 text-sm" style={{ color: C.muted }}>
          {dueThisWeek ? `${plural(dueThisWeek, 'thing')} coming up in the next 7 days` : 'Nothing coming up in the next 7 days'}
        </p>
      </div>

      {/* Four tiles, each opening its section. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {([
          { icon: Zap,         value: totalXP.toLocaleString(), label: 'XP earned',         nav: 'badges' },
          { icon: CheckCircle, value: completedCount,           label: 'Courses completed', nav: 'courses' },
          { icon: Award,       value: certCount,                label: 'Certificates',      nav: 'certificates' },
          { icon: Medal,       value: badgeCount,               label: 'Badges',            nav: 'badges' },
        ] as const).map(({ icon: Icon, value, label, nav }) => (
          <button key={label} type="button" onClick={() => onNavigate(nav as SectionId)}
            className="flex items-start justify-between gap-3 rounded-2xl p-5 text-left transition-shadow hover:shadow-md" style={{ background: C.card }}>
            <span className="min-w-0">
              <span className="block text-[28px] leading-9 font-bold tabular-nums" style={{ color: C.text }}>{value}</span>
              <span className="mt-1 block text-sm" style={{ color: C.muted }}>{label}</span>
            </span>
            <Icon className="h-5 w-5 flex-shrink-0" style={{ color: C.faint }} />
          </button>
        ))}
      </div>

      {/* Side by side only from 1280px: with the menu open, a 1024px screen left In progress too
          narrow for its cards, so below that Upcoming goes underneath. */}
      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* In progress: each item its own white card, picture on the left, the most recent first. */}
        <section>
          <div className="flex items-center justify-between gap-4">
            <h2 className={sectionTitle} style={{ color: C.text }}>In progress</h2>
            {inProgressItems.length > 4 && seeAll(`See all ${inProgressItems.length}`, 'courses')}
          </div>
          {inProgressItems.length === 0 ? (
            <div className="mt-4 flex flex-col items-start gap-3 rounded-2xl p-6" style={{ background: C.card }}>
              <p className="text-sm" style={{ color: C.muted }}>Nothing in progress yet.</p>
              <button type="button" onClick={() => onNavigate('explore')} className="rounded-xl px-4 py-2 text-sm font-semibold"
                style={{ background: C.cta, color: C.ctaText }}>Explore courses</button>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-4">
              {inProgressItems.slice(0, 4).map(({ form, attempt, isProject }: any) => {
                const { pct } = inProgressProgress(form, attempt, isProject);
                const cover = form.config?.coverImage;
                const tag = deadlineTag(deadlines[form.id], false);
                return (
                  <a key={form.id} href={`/${form.slug || form.id}`}
                    className="group flex items-stretch gap-4 rounded-2xl p-4 transition-shadow hover:shadow-lg sm:gap-5"
                    style={{ background: C.card, boxShadow: '0 1px 2px rgba(16,24,40,0.06), 0 8px 24px -12px rgba(16,24,40,0.18)' }}>
                    {/* The picture inset in the card, its own rounded corners, filling the card's height so
                        the white around it is the same on every side. */}
                    <div className="relative w-24 flex-shrink-0 overflow-hidden rounded-lg sm:min-h-[90px] sm:w-[160px] sm:rounded-xl" style={{ background: C.pill }}>
                      <div className="absolute inset-0 grid place-items-center">
                        {isProject ? <Briefcase className="h-6 w-6" style={{ color: C.faint }} /> : <Video className="h-6 w-6" style={{ color: C.faint }} />}
                      </div>
                      {cover && <img src={resolveCoverUrl(cover)} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" onError={e => (e.currentTarget.style.display = 'none')} />}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col justify-center">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold" style={{ color: C.muted }}>{isProject ? 'Virtual experience' : 'Course'}</span>
                        {tag && <Pill tone={tag.tone === 'red' ? 'bad' : tag.tone === 'amber' ? 'warn' : 'mute'} C={C}>{tag.label}</Pill>}
                      </div>
                      <p className="mt-1 truncate text-base leading-6 font-bold sm:text-lg" title={form.title} style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{form.title}</p>
                      {/* Progress, then the action at the end of the same line, so the title has the
                          card's whole width. */}
                      <div className="mt-3 flex items-center gap-3">
                        <div className="h-2 max-w-[280px] flex-1 overflow-hidden rounded-full" style={{ background: C.pill }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: BLUE }} />
                        </div>
                        <span className="text-xs font-semibold tabular-nums whitespace-nowrap" style={{ color: C.text }}>{pct}%<span className="hidden sm:inline"> complete</span></span>
                        <span className="ml-auto inline-flex h-9 flex-shrink-0 items-center rounded-full px-5 text-sm font-semibold transition-opacity group-hover:opacity-90"
                          style={{ background: BLUE, color: '#ffffff' }}>
                          Resume
                        </span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        {/* Upcoming: a flat list, soonest first. */}
        <section className={cardBox} style={{ background: C.card }}>
          <h2 className={sectionTitle} style={{ color: C.text }}>Upcoming</h2>
          <p className="mt-1 text-sm" style={{ color: C.muted }}>Next 14 days</p>
          {upcomingDeadlines.length === 0 ? (
            <p className="py-6 text-sm" style={{ color: C.muted }}>Nothing due in the next 14 days.</p>
          ) : (
            // A timeline: the date on the left, a dot on the line for each item, soonest first. The
            // dot's colour is how close it is: red overdue, amber within three days, grey after.
            <ol className="mt-4">
              {upcomingDeadlines.map((item, idx) => {
                const Icon = typeIcon[item.type];
                const when = item.daysLeft < 0 ? 'Overdue' : item.daysLeft === 0 ? 'Today' : item.daysLeft === 1 ? 'Tomorrow' : `In ${item.daysLeft} days`;
                const P = palette(C);
                const dot = item.daysLeft < 0 ? P.bad : item.daysLeft <= 3 ? P.warn : C.faint;
                const last = idx === upcomingDeadlines.length - 1;
                return (
                  <li key={`${item.type}-${item.title}-${idx}`} className="flex gap-3">
                    <div className="w-11 flex-shrink-0 pt-0.5 text-right">
                      <p className="text-base leading-5 font-bold tabular-nums" style={{ color: C.text }}>{item.date.getDate()}</p>
                      <p className="text-xs" style={{ color: C.muted }}>{item.date.toLocaleDateString('en-GB', { month: 'short' })}</p>
                    </div>
                    {/* A ring on a dashed line; the line runs from this ring down to the next. */}
                    <div className="relative flex w-4 flex-shrink-0 justify-center">
                      <span className="relative z-10 mt-1 grid h-4 w-4 place-items-center rounded-full" style={{ background: C.card, boxShadow: `inset 0 0 0 2px ${dot}` }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
                      </span>
                      {!last && <span className="absolute bottom-[-4px] top-6 border-l-2 border-dashed opacity-50" style={{ borderColor: C.faint }} />}
                    </div>
                    <div className={`min-w-0 flex-1 ${last ? '' : 'pb-5'}`}>
                      <p className="text-sm font-semibold leading-5" style={{ color: C.text }}>{item.title}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: C.muted }}>
                        <Icon className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>{typeName[item.type]}, <span style={{ color: item.daysLeft <= 3 ? dot : C.muted, fontWeight: item.daysLeft <= 3 ? 600 : 400 }}>{when.charAt(0).toLowerCase() + when.slice(1)}</span></span>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>

      {/* Recommended for you: each its own white card, as on the landing page. */}
      {gaps.length > 0 && (
        <section className="defer-render">
          <h2 className={sectionTitle} style={{ color: C.text }}>Recommended for you</h2>
          <p className="mt-1 text-sm" style={{ color: C.muted }}>Topics you have not explored yet</p>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
            {gaps.slice(0, 4).map((gap: any) => {
              const isVE = gap.course.contentType === 'virtual_experience' || gap.course.contentType === 'guided_project';
              const liveItem = courses.find((c: any) => c.id === gap.course.formId);
              if (!liveItem) return null;
              const href = `/${liveItem.slug || liveItem.id}`;
              const rawCover = gap.course.coverImage;
              const safeCover = (() => {
                try { const u = new URL(rawCover ?? ''); return (u.protocol === 'https:' || u.protocol === 'http:') ? rawCover : null; } catch { return null; }
              })();
              const isDark = C.page !== LIGHT_C.page;
              return (
                <a key={gap.course.formId} href={href} className={FRAMED_CARD} style={{ background: C.card }}>
                  <div className="relative aspect-video w-full overflow-hidden" style={{ background: C.pill }}>
                    <div className="absolute inset-0 grid place-items-center">
                      {isVE ? <Briefcase className="h-8 w-8" style={{ color: C.faint }} /> : <Video className="h-8 w-8" style={{ color: C.faint }} />}
                    </div>
                    {safeCover && <img src={resolveCoverUrl(safeCover)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.07]" onError={e => (e.currentTarget.style.display = 'none')} />}
                    {/* An experience's industry on the cover, as on the landing page. */}
                    {isVE && liveItem.industry && (
                      <span className="absolute left-0 top-3 max-w-[70%] truncate px-3 py-1 text-[11px] font-bold" style={{ background: '#F5D77A', color: '#3d2e00' }}>
                        {liveItem.industry}
                      </span>
                    )}
                  </div>
                  {/* The landing page's card body: the title on two lines, then tags, level and tools. */}
                  <div className="flex flex-1 flex-col px-3 pt-2.5 pb-3.5 sm:px-4 sm:pt-3.5 sm:pb-[18px]">
                    <p className="line-clamp-2 min-h-[40px] text-[15px] leading-5 font-bold" style={{ color: C.text }}>{gap.course.title}</p>
                    <CardMeta tags={cleanList(liveItem.tags)} level={liveItem.difficulty ? String(liveItem.difficulty).charAt(0).toUpperCase() + String(liveItem.difficulty).slice(1) : undefined} tools={cleanList(liveItem.tools)}
                      isDark={isDark} text={C.text} muted={C.muted} />
                  </div>
                </a>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

