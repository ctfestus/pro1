'use client';

import { useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import {
  Settings, Sun, Moon, Menu, X,
  AlertTriangle,
  Loader2, ChevronRight, ChevronLeft,
  FileText, Film, Layers, Briefcase,
  Zap, RefreshCw,
  Check,
} from 'lucide-react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';
import { sanitizeRichText } from '@/lib/sanitize';
import { computeAccess } from '@/lib/enrollment-access';
import { LIGHT_C, useC } from '@/lib/theme';
import { Sk, CarouselSkeleton, EmptyState, StatusBadge, ProgressBar } from '@/components/student/shared';
import { NAV_ITEMS, NAV_GROUPS, type SectionId } from '@/components/student/nav';
import { OverviewSection } from '@/components/student/overview';
import { type CohortTimeline, CohortTimelineBadge, ProfileMenu } from '@/components/student/header';
import { StudentModeBanner } from '@/components/student/StudentModeBanner';
import { COHORT_KIND_BOOTCAMP } from '@/lib/cohort-kind';
import { rememberPurchaseIntent, takePurchaseIntent, purchaseIntentHref } from '@/lib/pending-purchase';
import {
  clearStudentMode,
  getStudentMode,
  installStudentModeFetchBridge,
  setStudentMode,
  type StudentModeContext,
} from '@/lib/student-mode-client';


// Sk, CarouselSkeleton, EmptyState, StatusBadge, ProgressBar live in @/components/student/shared

// Only one section is ever mounted -- see the activeSection switch further down -- but
// importing them all statically put every section in the first load of /student. That is
// roughly 450 KB of source for panels the student has not clicked yet, on the page they
// open most often and usually on a phone.
//
// Overview stays eager because it is the landing section; making it lazy would only add a
// spinner to the very first paint. Everything else arrives when its nav item is chosen.
// Sections sharing a module share a chunk, so Courses and Learning paths still load
// together, as do the three schedule/recordings panels and the three badges panels. Two
// heavy children come along for free: assignments pulls GroupForum, and
// subscription-payments pulls payments.
// The options object has to be written out at every call site: Next's SWC transform reads
// `ssr` statically, so hoisting it into a shared constant fails the build with
// "next/dynamic options must be an object literal". Only the loading component is shared.
const sectionLoading = () => (
  <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#888' }}/></div>
);

const CalendarSection           = dynamic(() => import('@/components/StudentCalendar'), { ssr: false, loading: sectionLoading });
const StudentPaymentsSection    = dynamic(() => import('@/components/student/subscription-payments').then(m => m.StudentPaymentsSection), { ssr: false, loading: sectionLoading });
const CoursesSection            = dynamic(() => import('@/components/student/courses-paths').then(m => m.CoursesSection), { ssr: false, loading: sectionLoading });
const LearningPathsSection      = dynamic(() => import('@/components/student/courses-paths').then(m => m.LearningPathsSection), { ssr: false, loading: sectionLoading });
const EventsSection             = dynamic(() => import('@/components/student/events').then(m => m.EventsSection), { ssr: false, loading: sectionLoading });
const AssignmentsSection        = dynamic(() => import('@/components/student/assignments').then(m => m.AssignmentsSection), { ssr: false, loading: sectionLoading });
const CommunitySection          = dynamic(() => import('@/components/student/community-announcements').then(m => m.CommunitySection), { ssr: false, loading: sectionLoading });
const AnnouncementsSection      = dynamic(() => import('@/components/student/community-announcements').then(m => m.AnnouncementsSection), { ssr: false, loading: sectionLoading });
const VirtualExperiencesSection = dynamic(() => import('@/components/student/virtual-experiences').then(m => m.VirtualExperiencesSection), { ssr: false, loading: sectionLoading });
const CertificationsSection     = dynamic(() => import('@/components/student/certifications').then(m => m.CertificationsSection), { ssr: false, loading: sectionLoading });
const DataCenterSection         = dynamic(() => import('@/components/student/schedule-recordings').then(m => m.DataCenterSection), { ssr: false, loading: sectionLoading });
const RecordingsSection         = dynamic(() => import('@/components/student/schedule-recordings').then(m => m.RecordingsSection), { ssr: false, loading: sectionLoading });
const ScheduleSection           = dynamic(() => import('@/components/student/schedule-recordings').then(m => m.ScheduleSection), { ssr: false, loading: sectionLoading });
const StudentBadgesSection      = dynamic(() => import('@/components/student/badges-leaderboard-certs').then(m => m.StudentBadgesSection), { ssr: false, loading: sectionLoading });
const LeaderboardSection        = dynamic(() => import('@/components/student/badges-leaderboard-certs').then(m => m.LeaderboardSection), { ssr: false, loading: sectionLoading });
const CertificatesSection       = dynamic(() => import('@/components/student/badges-leaderboard-certs').then(m => m.CertificatesSection), { ssr: false, loading: sectionLoading });
const AiCareerToolkitSection    = dynamic(() => import('@/components/student/ai-career-toolkit').then(m => m.AiCareerToolkitSection), { ssr: false, loading: sectionLoading });
const ExploreSection            = dynamic(() => import('@/components/student/explore').then(m => m.ExploreSection), { ssr: false, loading: sectionLoading });

const ACTIVITY_POLL_MIN_GAP_MS = 30_000;
const MY_LEARNING_SECTIONS: SectionId[] = ['learning_paths', 'courses', 'virtual_experiences'];
const COHORT_ONLY_SECTIONS: SectionId[] = ['events', 'assignments', 'calendar', 'schedule', 'recordings', 'community', 'leaderboard'];

function isSectionVisibleForStudent(id: SectionId, showExplore: boolean, showCohortActivities: boolean) {
  if (id === 'explore') return showExplore;
  if (COHORT_ONLY_SECTIONS.includes(id)) return showCohortActivities;
  return true;
}

export default function StudentDashboard() {
  const [mounted, setMounted] = useState(false);
  const C = useC();
  const { toggle: toggleTheme, theme } = useTheme();
  const { logoUrl, logoDarkUrl, emailBannerUrl, appName, primaryColor } = useTenant();
  // Dark mode keeps the ocean accent; light mode uses the tenant's primary color.
  const navAccent = theme === 'dark' ? '#3E93FF' : (primaryColor || '#3E93FF');
  const router = useRouter();
  const [user, setUser]       = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [viewingAs, setViewingAs] = useState<StudentModeContext | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(true);
  const [isOutstanding,        setIsOutstanding]        = useState(false);
  const [enrollmentStatus,     setEnrollmentStatus]     = useState<string | null>(null);
  const [showOutstandingModal, setShowOutstandingModal] = useState(false);
  const [isInGracePeriod,      setIsInGracePeriod]      = useState(false);
  const [graceAccessUntil,     setGraceAccessUntil]     = useState<string | null>(null);
  const [cohortTimeline,       setCohortTimeline]       = useState<CohortTimeline | null>(null);

  // Live activity ticker (persists across all tabs)
  const [activeTicker,       setActiveTicker]       = useState<{ name: string; title: string } | null>(null);
  const [bootcampCohortId,   setBootcampCohortId]   = useState<string | null>(null);
  // Only real cohort students see cohort activity tabs; public and individual students see Explore.
  const hasBootcampCohort = !loading && !!bootcampCohortId;
  const showExplore = !loading && !hasBootcampCohort;
  const showCohortActivities = hasBootcampCohort;
  const seenActivityGlobal = useRef<Set<string>>(new Set());
  const tickerTimerGlobal  = useRef<any>(null);
  const pageLoadTimeGlobal = useRef(Date.now());
  const lastActivityPollStartedAt = useRef(0);

  useEffect(() => installStudentModeFetchBridge(), []);

  useEffect(() => {
    setMounted(true);
    const apply = () => {
      const hash = window.location.hash.replace('#', '') as SectionId;
      if (NAV_ITEMS.some(n => n.id === hash)) {
        setActiveSection(hash);
        sessionStorage.setItem('student-section', hash);
      } else {
        // No hash -- restore the last top-level destination. My Learning always opens
        // on Learning Paths so students see their guided journey before the catalog.
        const saved = sessionStorage.getItem('student-section') as SectionId | null;
        const validSaved = saved && NAV_ITEMS.some(n => n.id === saved) ? saved : null;
        const target: SectionId = validSaved && MY_LEARNING_SECTIONS.includes(validSaved)
          ? 'learning_paths'
          : validSaved ?? 'overview';
        setActiveSection(target);
        window.location.hash = target;
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  // Keep the browser tab title readable (e.g. "My Courses - Festman") instead of
  // the raw URL/hash. Client-side hash routing means the server metadata title
  // never updates per section, so we set it here.
  useEffect(() => {
    const label = MY_LEARNING_SECTIONS.includes(activeSection)
      ? 'My Learning'
      : NAV_ITEMS.find(n => n.id === activeSection)?.label ?? 'Dashboard';
    document.title = appName ? `${label} - ${appName}` : label;
  }, [activeSection, appName]);

  const goSection = useCallback((id: SectionId) => {
    setActiveSection(id);
    sessionStorage.setItem('student-section', id);
    const url = new URL(window.location.href);
    if (id === 'learning_paths') url.searchParams.delete('path');
    url.hash = id;
    history.replaceState(null, '', url);
    if (id === 'learning_paths') window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  useEffect(() => {
    if (loading) return;
    if (isSectionVisibleForStudent(activeSection, showExplore, showCohortActivities)) return;
    goSection(showExplore ? 'explore' : 'overview');
  }, [activeSection, goSection, loading, showCohortActivities, showExplore]);

  // Activity feed polling. Background tabs do no network work, and returning to a tab
  // refreshes immediately rather than waiting for the next interval.
  useEffect(() => {
    if (!bootcampCohortId) return;
    let requestInFlight = false;

    const poll = async () => {
      if (document.visibilityState !== 'visible' || requestInFlight) return;

      const now = Date.now();
      if (now - lastActivityPollStartedAt.current < ACTIVITY_POLL_MIN_GAP_MS) return;
      // Advance before getSession so expired sessions, refresh attempts, network errors,
      // and non-OK responses are rate-limited just like successful requests.
      lastActivityPollStartedAt.current = now;
      requestInFlight = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch(`/api/activity/feed?cohort_id=${bootcampCohortId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok) return;
        const { events } = await res.json();
        const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
        const freshEvents = (events as any[]).filter(e => e.ts > thirtyMinsAgo);
        const newEvent = freshEvents.find(e => {
          const key = `${e.ts}:${e.name}:${e.title}`;
          if (seenActivityGlobal.current.has(key)) return false;
          seenActivityGlobal.current.add(key);
          return true;
        });
        if (newEvent) {
          setActiveTicker({ name: newEvent.name, title: newEvent.title });
          if (tickerTimerGlobal.current) clearTimeout(tickerTimerGlobal.current);
          tickerTimerGlobal.current = setTimeout(() => setActiveTicker(null), 7000);
        }
      } catch { /* ignore */ }
      finally { requestInFlight = false; }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void poll();
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 60_000);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearTimeout(tickerTimerGlobal.current);
    };
  }, [bootcampCohortId]);

  useEffect(() => {
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { rememberPurchaseIntent(window.location.search); router.replace('/auth'); return; }

      const [{ data: { user: authUser } }, { data: studentData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase
          .from('students')
          .select('username, role, full_name, avatar_url, onboarding_done')
          .eq('id', session.user.id)
          .single(),
      ]);

      if (!authUser) { rememberPurchaseIntent(window.location.search); router.replace('/auth'); return; }
      if (!studentData?.onboarding_done) { rememberPurchaseIntent(window.location.search); router.replace('/onboarding'); return; }

      // They asked to buy something before signing in. Put them back where they were going.
      // Single use, and an explicit target in the URL always wins over a remembered one.
      // Skipped while an admin is viewing as a student: redirecting would drop the viewAs
      // parameter and silently end their session as that learner.
      const currentParams = new URLSearchParams(window.location.search);
      if (!currentParams.get('contentTable') && !currentParams.get('viewAs')) {
        const intent = takePurchaseIntent();
        if (intent) { window.location.replace(purchaseIntentHref(intent)); return; }
      }

      // Resolve a new or persisted Student Mode context.
      const viewAsId = new URLSearchParams(window.location.search).get('viewAs');
      const storedMode = getStudentMode();
      let resolvedViewingAs: StudentModeContext | null = null;
      if (viewAsId) {
        const response = await fetch('/api/student-mode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ studentId: viewAsId }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok && result.context) {
          resolvedViewingAs = result.context as StudentModeContext;
          setStudentMode(resolvedViewingAs);
          // Drop ?viewAs= so a reload does not start a second session.
          window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        }
      } else if (storedMode) {
        const response = await fetch('/api/student-mode', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const result = await response.json().catch(() => ({}));
        if (response.ok) {
          resolvedViewingAs = { ...storedMode, name: result.name || storedMode.name, email: result.email || storedMode.email };
          setStudentMode(resolvedViewingAs);
        }
      }
      if ((viewAsId || storedMode) && !resolvedViewingAs) clearStudentMode();
      setViewingAs(resolvedViewingAs);

      setUser(authUser);
      setProfile({
        username:   studentData?.username ?? null,
        role:       studentData?.role ?? null,
        full_name:  studentData?.full_name ?? null,
        avatar_url: studentData?.avatar_url ?? null,
      });

      // Update last_login_at (fire-and-forget) -- skip in viewAs mode
      if (!resolvedViewingAs) {
        supabase.from('students').update({ last_login_at: new Date().toISOString() }).eq('id', authUser.id)
          .then(({ error }) => { if (error) console.error('[last_login_at] update failed:', error.message); });
      }

      // Fetch cohort for global activity ticker + outstanding check
      supabase.from('students').select('cohort_id, original_cohort_id, payment_exempt').eq('id', resolvedViewingAs?.studentId ?? authUser.id).single()
        .then(async ({ data: s }) => {
          if (s?.cohort_id) {
            const { data: cohortDates } = await supabase
              .from('cohorts')
              .select('id, name, start_date, end_date, cohort_kind')
              .eq('id', s.cohort_id)
              .maybeSingle();
            if (cohortDates?.cohort_kind === COHORT_KIND_BOOTCAMP) {
              setBootcampCohortId(s.cohort_id);
              setCohortTimeline(cohortDates ?? null);
            } else {
              setBootcampCohortId(null);
              setCohortTimeline(null);
            }
          } else {
            setBootcampCohortId(null);
            setCohortTimeline(null);
          }
          const { data: enroll } = await supabase
            .from('bootcamp_enrollments')
            .select('access_status, total_fee, deposit_required, paid_total, payment_plan, bootcamp_ends_at, cohort_id, payment_installments ( due_date, status )')
            .eq('student_id', resolvedViewingAs?.studentId ?? authUser.id)
            // Skip released enrollments (migration 171) so a student who left the bootcamp is
            // not shown an outstanding-balance modal for a cohort they are no longer in.
            .is('released_at', null)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          let liveStatus = enroll?.access_status ?? null;
          let liveGraceActive = false;
          let liveAccessUntil: Date | null = null;
          if (enroll) {
            const { data: settings } = await supabase
              .from('cohort_payment_settings')
              .select('post_bootcamp_access_months, grace_period_days')
              .eq('cohort_id', enroll.cohort_id)
              .maybeSingle();
            const result = computeAccess({
              payment_plan:                enroll.payment_plan as any,
              total_fee:                   Number(enroll.total_fee),
              deposit_required:            Number(enroll.deposit_required),
              paid_total:                  Number(enroll.paid_total),
              bootcamp_ends_at:            enroll.bootcamp_ends_at ? new Date(enroll.bootcamp_ends_at) : null,
              post_bootcamp_access_months: settings?.post_bootcamp_access_months ?? 3,
              grace_period_days:           settings?.grace_period_days ?? null,
              installments:                (enroll.payment_installments ?? []).map((i: any) => ({ due_date: new Date(i.due_date), status: i.status })),
            });
            liveStatus      = result.access_status;
            liveGraceActive = result.grace_active;
            liveAccessUntil = result.access_until;
          }
          const restricted = !s?.payment_exempt && ['pending_deposit', 'overdue', 'expired'].includes(liveStatus ?? '');
          const outstanding = !!s?.original_cohort_id || restricted;
          setIsOutstanding(outstanding);
          setEnrollmentStatus(liveStatus);
          setIsInGracePeriod(liveGraceActive);
          setGraceAccessUntil(liveGraceActive && liveAccessUntil ? liveAccessUntil.toISOString().slice(0, 10) : null);
          if (outstanding && !sessionStorage.getItem('outstandingModalDismissed')) {
            setShowOutstandingModal(true);
          }
        });

      setLoading(false);
    };
    init();
  }, [router]);

  const signOut = useCallback(async () => {
    clearStudentMode();
    await supabase.auth.signOut();
    router.replace('/auth');
  }, [router]);

  const effectiveId    = viewingAs?.studentId ?? user?.id;
  const effectiveEmail = viewingAs?.email ?? user?.email;
  const userName = profile?.name || profile?.full_name || user?.email?.split('@')[0] || 'Student';
  const activeItem = NAV_ITEMS.find(n => n.id === activeSection)!;
  const isMyLearning = MY_LEARNING_SECTIONS.includes(activeSection);

  if (!mounted) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#F4F5F7' }}>
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: '#0e09dd' }}/>
    </div>
  );

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: C.page }}>
      <Loader2 className="w-8 h-8 animate-spin" style={{ color: C.green }}/>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: C.page }}>
      {viewingAs && <StudentModeBanner context={viewingAs} />}
      {/* -- Top nav -- */}
      <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 border-b backdrop-blur-md"
        style={{ background: C.nav, borderColor: C.navBorder }}>
        <div className="flex items-center gap-3">
          {/* Mobile menu toggle */}
          <button onClick={() => { setSidebarOpen(o => { if (!o) setNavCollapsed(false); return !o; }); }}
            className="p-2 rounded-xl lg:hidden transition-all hover:opacity-70"
            style={{ background: C.pill }}>
            <Menu className="w-4 h-4" style={{ color: C.text }}/>
          </button>
          {/* Logo / brand */}
          <Link href="/" className="flex items-center block">
            <img src={(theme === 'dark' ? logoDarkUrl || logoUrl : logoUrl) || undefined} alt="Logo" fetchPriority="high" className="h-8 w-auto" />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <CohortTimelineBadge cohort={cohortTimeline}/>
          <button onClick={toggleTheme}
            className="p-2 rounded-xl transition-all hover:opacity-70"
            style={{ background: C.pill }}>
            {theme === 'dark'
              ? <Sun className="w-4 h-4" style={{ color: C.text }}/>
              : <Moon className="w-4 h-4" style={{ color: C.text }}/>}
          </button>
          {user && !viewingAs && <ProfileMenu user={user} profile={profile} onSignOut={signOut}/>}
        </div>
      </header>

      {/* -- Mobile sidebar overlay -- */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-30 lg:hidden"
            style={{ background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setSidebarOpen(false)}/>
        )}
      </AnimatePresence>

      <div className="flex h-[calc(100vh-57px)]">
        {/* -- Sidebar -- */}
        <AnimatePresence>
          {(sidebarOpen || true) && (
            <motion.aside
              initial={false}
              animate={{ width: navCollapsed ? 56 : 220 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className={`fixed lg:static inset-y-0 left-0 z-40 lg:z-auto flex flex-col overflow-hidden transition-transform ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
              style={{ background: C.nav, top: 57 }}>
              {/* Nav items + collapse toggle share the same scroll area */}
              <nav className="flex-1 px-2 pt-1 pb-2 space-y-0.5 overflow-y-auto overflow-x-hidden sidebar-nav">
                {/* Collapse toggle as first row -- desktop only */}
                <div className="hidden lg:flex pb-0.5" style={{ justifyContent: navCollapsed ? 'center' : 'flex-end' }}>
                  <button
                    onClick={() => setNavCollapsed(o => !o)}
                    className="p-1.5 rounded-lg transition-all"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.pill; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                    {navCollapsed
                      ? <ChevronRight className="w-4 h-4" style={{ color: C.faint }}/>
                      : <ChevronLeft className="w-4 h-4" style={{ color: C.faint }}/>}
                  </button>
                </div>
                {NAV_GROUPS.map(group => {
                  const groupItems = group.items
                    .map(id => NAV_ITEMS.find(n => n.id === id)!)
                    .filter(Boolean)
                    .filter(item => isSectionVisibleForStudent(item.id, showExplore, showCohortActivities));
                  if (groupItems.length === 0) return null;
                  return (
                    <div key={group.label} className={navCollapsed ? '' : 'mb-3'}>
                      {!navCollapsed && group.label && (
                        <p className="px-3 mb-1 text-[11px] font-semibold tracking-widest uppercase"
                          style={{ color: C.faint }}>
                          {group.label}
                        </p>
                      )}
                      {groupItems.map(item => {
                        const isActive = item.id === 'courses'
                          ? isMyLearning
                          : activeSection === item.id;
                        return (
                          <button key={item.id}
                            onClick={() => { goSection(item.id === 'courses' ? 'learning_paths' : item.id); setSidebarOpen(false); }}
                            title={navCollapsed ? item.label : undefined}
                            className="w-full flex items-center gap-3 rounded-xl text-sm font-normal transition-all text-left"
                            style={{
                              padding: navCollapsed ? '10px 0' : '8px 12px',
                              justifyContent: navCollapsed ? 'center' : 'flex-start',
                              color: isActive ? navAccent : C.muted,
                            }}
                            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = C.text; }}
                            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = C.muted; }}>
                            <div className="relative w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                              style={{ background: isActive ? `${navAccent}18` : C.pill }}>
                              <item.Icon className="w-4 h-4" style={{ color: isActive ? navAccent : theme === 'dark' ? 'rgba(255,255,255,0.35)' : '#9ca3af' }}/>
                              {navCollapsed && 'badge' in item && item.badge && (
                                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full" style={{ background: C.green, boxShadow: `0 0 0 2px ${C.card}` }}/>
                              )}
                            </div>
                            {!navCollapsed && <span className="truncate">{item.label}</span>}
                            {!navCollapsed && 'badge' in item && item.badge && (
                              <span className="ml-auto text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: C.green, color: '#fff' }}>
                                {item.badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </nav>

              {/* Sidebar footer */}
              <div className="px-2 pb-3 pt-2 border-t space-y-0.5" style={{ borderColor: C.divider }}>
                {!navCollapsed && !viewingAs && (
                  <Link href="/settings"
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-normal transition-all"
                    style={{ color: C.muted }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.muted; }}>
                    <Settings className="w-4 h-4 flex-shrink-0" style={{ color: theme === 'dark' ? 'rgba(255,255,255,0.35)' : '#9ca3af' }}/> Settings
                  </Link>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* -- Main content -- */}
        <main className="flex-1 min-w-0 overflow-y-auto px-5 md:px-8 py-7" style={{ background: activeSection === 'certifications' ? (theme === 'dark' ? C.page : '#ffffff') : undefined }}>
          <motion.div key={activeSection} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            {/* Section header -- hidden on overview (has its own greeting) and assignments (manages its own title) */}
            {activeSection !== 'overview' && activeSection !== 'assignments' && activeSection !== 'certifications' && (
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-[22px] font-bold tracking-tight" style={{ color: C.text }}>{isMyLearning ? 'My Learning' : activeItem.label}</h1>
              </div>
            )}

            {/* Outstanding payment modal -- shown once per session on any tab */}
            {showOutstandingModal && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)' }}>
                <motion.div
                  initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 28 }}
                  className="w-full max-w-sm rounded-xl overflow-hidden"
                  style={{ background: C.card, boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}>
                  <div className="relative">
                    <img src={emailBannerUrl || logoUrl} alt="" className="w-full object-cover" style={{ height: 140 }}/>
                    <div className="absolute inset-0 flex items-end p-4" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, transparent 55%)' }}>
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md" style={{ background: 'rgba(220,38,38,0.9)', backdropFilter: 'blur(8px)' }}>
                        <AlertTriangle className="w-3.5 h-3.5" style={{ color: '#ffffff' }}/>
                        <span className="text-xs font-bold tracking-wide" style={{ color: '#ffffff' }}>Action Required</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-6 space-y-4">
                    <div className="text-center space-y-1">
                      <h3 className="text-lg font-bold tracking-tight" style={{ color: C.text }}>Payment Overdue</h3>
                      <p className="text-sm" style={{ color: C.muted }}>Your course access has been temporarily restricted.</p>
                    </div>
                    <div className="rounded-lg p-4 space-y-2.5" style={{ background: theme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                      <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: C.faint }}>What to do</p>
                      {['Go to Payments and submit a confirmation', 'Include your method, reference, and amount', 'Access is restored once admin approves'].map((step, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-[10px] font-bold"
                            style={{ background: 'linear-gradient(135deg,#dc2626,#b91c1c)', color: 'white' }}>{i + 1}</div>
                          <p className="text-xs" style={{ color: C.muted }}>{step}</p>
                        </div>
                      ))}
                    </div>
                    <div className="flex flex-col gap-2">
                      <button
                        onClick={() => { sessionStorage.setItem('outstandingModalDismissed', '1'); setShowOutstandingModal(false); goSection('payments'); }}
                        className="w-full py-3 rounded-lg text-sm font-bold tracking-wide transition-all hover:opacity-90 active:scale-95"
                        style={{ background: 'linear-gradient(135deg, #dc2626, #b91c1c)', color: 'white', boxShadow: '0 4px 20px rgba(220,38,38,0.4)' }}>
                        Make Payment
                      </button>
                      <button
                        onClick={() => { sessionStorage.setItem('outstandingModalDismissed', '1'); setShowOutstandingModal(false); }}
                        className="w-full py-2.5 rounded-lg text-sm font-medium tracking-wide transition-all hover:opacity-80 active:scale-95"
                        style={{ color: C.muted }}>
                        I Understand
                      </button>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}

            {/* Section content */}

            {/* Grace period banner -- payment is overdue but still within grace window */}
            {isInGracePeriod && !isOutstanding && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl mb-4"
                style={{ background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.35)' }}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: '#d97706' }}/>
                <p className="text-sm font-medium flex-1" style={{ color: '#b45309' }}>
                  {'Your payment installment is overdue. You have until '}
                  <span className="font-bold">{graceAccessUntil ?? 'your grace deadline'}</span>
                  {' to make a payment before your access is restricted. Go to '}
                  <button onClick={() => goSection('payments')} className="underline font-bold" style={{ color: '#b45309' }}>
                    Payments
                  </button>
                  {' to submit a confirmation.'}
                </p>
              </div>
            )}

            {/* Outstanding banner -- persists across all tabs */}
            {isOutstanding && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl mb-4"
                style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.25)' }}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: '#dc2626' }}/>
                <p className="text-sm font-medium flex-1" style={{ color: '#dc2626' }}>
                  {enrollmentStatus === 'expired'
                    ? 'Your post-bootcamp access period has expired. Contact your instructor for assistance.'
                    : 'Payment overdue. Go to '}
                  {enrollmentStatus !== 'expired' && (
                    <button onClick={() => goSection('payments')}
                      className="underline font-bold" style={{ color: '#dc2626' }}>
                      Payments
                    </button>
                  )}
                  {enrollmentStatus !== 'expired' && ' to submit a payment confirmation.'}
                </p>
              </div>
            )}

            {isMyLearning && user && (
              <div
                role="tablist"
                aria-label="My Learning sections"
                className="flex gap-1 overflow-x-auto rounded-xl p-1 mb-6"
                style={{ background: C.card }}>
                {([
                  { id: 'learning_paths', label: 'Learning Paths', Icon: Layers },
                  { id: 'courses', label: 'Courses', Icon: Film },
                  { id: 'virtual_experiences', label: 'Virtual Experiences', Icon: Briefcase },
                ] as const).map(({ id, label, Icon }) => {
                  const selected = activeSection === id;
                  return (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={selected}
                      onClick={() => goSection(id)}
                      className="flex min-w-max flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all"
                      style={{
                        background: selected ? C.page : 'transparent',
                        color: selected ? navAccent : C.muted,
                        boxShadow: selected ? '0 1px 3px rgba(0,0,0,0.10)' : 'none',
                      }}>
                      <Icon className="w-4 h-4" />
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {activeSection === 'overview' && user && (
              <OverviewSection user={{ ...user, id: effectiveId, email: effectiveEmail }} userEmail={effectiveEmail} C={C} onNavigate={goSection}/>
            )}
            {activeSection === 'courses' && user && (
              <CoursesSection userEmail={effectiveEmail} userId={effectiveId} C={C} isOutstandingProp={isOutstanding}/>
            )}
            {activeSection === 'learning_paths' && user && (
              <LearningPathsSection C={C}/>
            )}
            {activeSection === 'events' && user && (
              <EventsSection userId={effectiveId} C={C}/>
            )}
            {activeSection === 'assignments' && user && (
              <AssignmentsSection userId={effectiveId} C={C}/>
            )}
            {activeSection === 'calendar' && user && (
              <CalendarSection userId={effectiveId} onNavigate={(s) => goSection(s as SectionId)}/>
            )}
            {activeSection === 'community' && user && (
              <CommunitySection userId={effectiveId} C={C}/>
            )}
            {activeSection === 'announcements' && (
              <AnnouncementsSection userId={effectiveId} C={C}/>
            )}
            {activeSection === 'virtual_experiences' && user && (
              <VirtualExperiencesSection userId={effectiveId} userEmail={effectiveEmail} C={C}/>
            )}
            {activeSection === 'certifications' && user && (
              <CertificationsSection userId={effectiveId} userEmail={effectiveEmail} C={C}/>
            )}
            {activeSection === 'explore' && user && (
              <ExploreSection C={C} onNavigate={goSection} />
            )}
            {activeSection === 'data_center' && user && (
              <DataCenterSection C={C} />
            )}
            {activeSection === 'recordings' && user && (
              <RecordingsSection userId={effectiveId} C={C}/>
            )}
            {activeSection === 'schedule' && user && (
              <ScheduleSection userId={effectiveId} C={C}/>
            )}
            {activeSection === 'badges' && user && (
              <StudentBadgesSection userId={effectiveId} C={C}/>
            )}
            {activeSection === 'leaderboard' && user && (
              <LeaderboardSection userId={effectiveId} userEmail={effectiveEmail} C={C}/>
            )}
            {activeSection === 'certificates' && user && (
              <CertificatesSection userId={effectiveId} userEmail={effectiveEmail} C={C}/>
            )}
            {activeSection === 'ai_toolkit' && user && (
              <AiCareerToolkitSection C={C}/>
            )}
            {activeSection === 'payments' && user && (
              <StudentPaymentsSection userId={effectiveId} C={C} readOnly={!!viewingAs}/>
            )}
          </motion.div>
        </main>
      </div>

      {/* Global live activity ticker */}
      <AnimatePresence>
        {activeTicker && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            className="fixed bottom-6 left-6 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl max-w-[260px]"
            style={{ background: C.card, boxShadow: '0 8px 32px rgba(0,0,0,0.18)' }}
          >
            <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: `${C.green}18` }}>
              <Zap className="w-3.5 h-3.5" style={{ color: C.green }} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold truncate" style={{ color: C.text }}>
                {activeTicker.name} just completed
              </p>
              <p className="text-[11px] truncate" style={{ color: C.muted }}>{activeTicker.title}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
