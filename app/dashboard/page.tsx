'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2, Plus, Trash2, Sun, Moon, Download, Menu } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';
import { useC } from '@/lib/theme';
import { exportAllInSection } from '@/lib/dashboard-export';
import { PushAllButton } from '@/components/dashboard/primitives';
import { ImportButton } from '@/components/dashboard/ImportButton';
import { SYNC_ENABLED } from '@/lib/sync';
import { IsStaffContext } from '@/components/dashboard/context';
import { ProfileMenu } from '@/components/dashboard/ProfileMenu';
import { NAV_ITEMS, STAFF_SECTION_IDS, type SectionId } from '@/components/dashboard/nav';
import { Sidebar } from '@/components/dashboard/Sidebar';
import { SectionContent } from '@/components/dashboard/SectionContent';
import { CreateCourseMenu, getFormType } from '@/components/dashboard/content-cards';
import { pointsSystemFromCourseRow } from '@/lib/course-schema';

// --- Cache ---
const _cache: { forms: any[] | null; profile: any | null; user: any | null } = { forms: null, profile: null, user: null };

// --- Dashboard ---
export default function DashboardPage() {
  const C = useC();
  const router = useRouter();
  const { toggle: toggleTheme, theme } = useTheme();
  const { logoUrl, logoDarkUrl, appName, primaryColor } = useTenant();
  // Dark mode keeps the ocean accent; light mode uses the tenant's primary color.
  const navAccent = theme === 'dark' ? '#3E93FF' : (primaryColor || '#3E93FF');
  const [forms, setForms]           = useState<any[]>(_cache.forms ?? []);
  const [loading, setLoading]       = useState(_cache.forms === null);
  const [user, setUser]             = useState<any>(_cache.user ?? null);
  const [profile, setProfile]       = useState<any>(_cache.profile ?? null);
  const [formToDelete, setFormToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const deletingForm = forms.find(f => f.id === formToDelete);
  const deletingName = deletingForm?.config?.title || deletingForm?.title || 'this item';
  const [shareMenuOpen, setShareMenuOpen] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('courses');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isStaff = profile?.role === 'staff';

  // Read hash on mount and on browser back/forward
  useEffect(() => {
    const apply = () => {
      const hash = window.location.hash.replace('#', '') as SectionId;
      if (NAV_ITEMS.some(n => n.id === hash)) {
        setActiveSection(hash);
        sessionStorage.setItem('dashboard-section', hash);
      } else {
        const saved = sessionStorage.getItem('dashboard-section') as SectionId | null;
        if (saved && NAV_ITEMS.some(n => n.id === saved)) {
          setActiveSection(saved);
          window.location.hash = saved;
        }
      }
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, []);

  // Keep the browser tab title readable (e.g. "Courses - Festman") instead of
  // the raw URL/hash. Client-side hash routing means the server metadata title
  // never updates per section, so we set it here.
  useEffect(() => {
    const label = NAV_ITEMS.find(n => n.id === activeSection)?.label ?? 'Dashboard';
    document.title = appName ? `${label} - ${appName}` : label;
  }, [activeSection, appName]);

  function goSection(id: SectionId) {
    if (isStaff && !STAFF_SECTION_IDS.has(id)) id = 'events';
    setActiveSection(id);
    sessionStorage.setItem('dashboard-section', id);
    window.location.hash = id;
  }

  useEffect(() => {
    if (!isStaff || STAFF_SECTION_IDS.has(activeSection)) return;
    setActiveSection('events');
    sessionStorage.setItem('dashboard-section', 'events');
    window.location.hash = 'events';
  }, [activeSection, isStaff]);

  useEffect(() => {
    const fetchUserAndForms = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { window.location.href = '/auth'; return; }
      setUser(session.user);

      const [{ data: { user } }, { data: studentData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('students').select('*').eq('id', session.user.id).single(),
      ]);

      if (!user) { window.location.href = '/auth'; return; }

      if (studentData?.role === 'student') { window.location.href = '/student'; return; }

      setUser(user);
      if (studentData) { setProfile(studentData); _cache.profile = studentData; }
      _cache.user = user;

      // Query all content tables
      const isStaffUser = studentData?.role === 'staff';
      const [{ data: coursesData }, { data: eventsData }, { data: vesData }] = await Promise.all([
        isStaffUser ? Promise.resolve({ data: [] }) : supabase.from('courses').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        isStaffUser ? supabase.from('events').select('*').order('created_at', { ascending: false }) : supabase.from('events').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        isStaffUser ? Promise.resolve({ data: [] }) : supabase.from('virtual_experiences').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      ]);

      // Fetch response counts
      const courseIds = (coursesData ?? []).map((c: any) => c.id);
      const veIds     = (vesData ?? []).map((v: any) => v.id);
      const eventIds  = (eventsData ?? []).map((e: any) => e.id);
      const [{ data: responsesData }, { data: regData }] = await Promise.all([
        courseIds.length || veIds.length
          ? supabase.from('responses').select('form_id').in('form_id', [...courseIds, ...veIds])
          : Promise.resolve({ data: [] }),
        eventIds.length
          ? supabase.from('event_registrations').select('event_id').in('event_id', eventIds)
          : Promise.resolve({ data: [] }),
      ]);
      const responseCounts: Record<string, number> = {};
      for (const r of responsesData ?? []) responseCounts[r.form_id] = (responseCounts[r.form_id] ?? 0) + 1;
      for (const r of regData ?? [])       responseCounts[r.event_id] = (responseCounts[r.event_id] ?? 0) + 1;

      // Build normalized form objects with reconstructed config
      const allRows: any[] = [];

      for (const c of coursesData ?? []) {
        allRows.push({ ...c, _response_count: responseCounts[c.id] ?? 0, content_type: 'course', config: {
          isCourse: true, title: c.title, description: c.description,
          questions: c.questions ?? [], fields: c.fields ?? [],
          passmark: c.passmark, courseTimer: c.course_timer,
          learnOutcomes: c.learn_outcomes,
          // Partial by design: see app/[id]/page.tsx -- normalizing to a full
          pointsSystem: pointsSystemFromCourseRow(c),
          postSubmission: c.post_submission,
          coverImage: c.cover_image, deadline_days: c.deadline_days,
          theme: c.theme, mode: c.mode, font: c.font, customAccent: c.custom_accent,
        }});
      }
      for (const e of eventsData ?? []) {
        allRows.push({ ...e, _response_count: responseCounts[e.id] ?? 0, content_type: 'event', config: {
          title: e.title, description: e.description, fields: e.fields ?? [],
          eventDetails: { isEvent: true, date: e.event_date, time: e.event_time,
            timezone: e.timezone, location: e.location, eventType: e.event_type,
            capacity: e.capacity, meetingLink: e.meeting_link, isPrivate: e.is_private,
            speakers: e.speakers ?? [],
            recurrence: e.recurrence ?? 'once',
            recurrenceEndDate: e.recurrence_end_date ?? '',
            recurrenceDays: e.recurrence_days ?? [] },
          postSubmission: e.post_submission, coverImage: e.cover_image,
          deadline_days: e.deadline_days, theme: e.theme, mode: e.mode,
          font: e.font, customAccent: e.custom_accent,
        }});
      }
      for (const v of vesData ?? []) {
        allRows.push({ ...v, _response_count: responseCounts[v.id] ?? 0, content_type: 'virtual_experience', config: {
          isVirtualExperience: true, title: v.title, description: v.description,
          modules: v.modules ?? [], industry: v.industry, difficulty: v.difficulty,
          role: v.role, company: v.company, duration: v.duration, tools: v.tools, toolLogos: v.tool_logos ?? {},
          tagline: v.tagline, background: v.background, learnOutcomes: v.learn_outcomes,
          managerName: v.manager_name, managerTitle: v.manager_title,
          guideId: v.guide_id, guideSnapshot: v.guide_snapshot, dataset: v.dataset,
          coverImage: v.cover_image, deadline_days: v.deadline_days,
          theme: v.theme, mode: v.mode, font: v.font, customAccent: v.custom_accent,
          isShortCourse: !!v.is_short_course, badgeImageUrl: v.badge_image_url,
        }});
      }

      // Sort combined list by created_at descending
      allRows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      _cache.forms = allRows;
      setForms(allRows);
      setLoading(false);
    };
    fetchUserAndForms();
  }, []);

  const confirmDelete = async () => {
    if (!formToDelete) return;
    setIsDeleting(true);
    try {
      // Cloudinary + storage cleanup is handled server-side in /api/forms DELETE
      // Route deletion through the API (service role) so RLS does not block it
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/forms?id=${formToDelete}`, {
        method: 'DELETE',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        console.error('[delete] failed:', json.error);
        alert(json.error || 'Failed to delete. Please try again.');
        return;
      }
      setForms(forms.filter(f => f.id !== formToDelete));
    } finally { setIsDeleting(false); setFormToDelete(null); }
  };

  const handleSignOut = async () => {
    _cache.forms = null; _cache.profile = null; _cache.user = null;
    await supabase.auth.signOut();
    window.location.href = '/';
  };

  // -- Loading skeleton ---
  if (loading) {
    return (
      <div className="platform-font-scope min-h-screen animate-pulse" style={{ background: C.page }}>
        <div className="sticky top-0 z-20 border-b px-6 md:px-10 h-14 flex items-center justify-between backdrop-blur-md" style={{ background: C.nav, borderColor: C.navBorder }}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg" style={{ background: C.skeleton }}/>
            <div className="h-4 w-24 rounded-lg" style={{ background: C.skeleton }}/>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-8 w-28 rounded-lg" style={{ background: C.skeleton }}/>
            <div className="w-24 h-8 rounded-full" style={{ background: C.skeleton }}/>
          </div>
        </div>
        <div className="max-w-5xl mx-auto px-5 md:px-8 py-8 space-y-6">
          {[0, 1].map(s => (
            <div key={s} className="rounded-2xl p-5 sm:p-6" style={{ background: C.card }}>
              <div className="flex items-center justify-between mb-4">
                <div className="h-6 w-44 rounded-lg" style={{ background: C.skeleton }}/>
                <div className="flex gap-2">
                  <div className="w-9 h-9 rounded-full" style={{ background: C.skeleton }}/>
                  <div className="w-9 h-9 rounded-full" style={{ background: C.skeleton }}/>
                </div>
              </div>
              <div className="flex gap-6 overflow-hidden">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex-shrink-0 w-[300px]">
                    <div className="h-44 rounded-2xl" style={{ background: C.skeleton }}/>
                    <div className="h-4 w-3/4 rounded-lg mt-3" style={{ background: C.skeleton }}/>
                    <div className="h-3 w-1/2 rounded-lg mt-2" style={{ background: C.pill }}/>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // -- Main render ---
  const activeItem = NAV_ITEMS.find(n => n.id === activeSection)!;
  const courseCount = forms.filter(f => getFormType(f) === 'course').length;
  const eventCount  = forms.filter(f => getFormType(f) === 'event').length;

  return (
    <div className="platform-font-scope min-h-screen flex flex-col" style={{ background: C.page }}>

      {/* -- Navbar -- */}
      <nav className="sticky top-0 z-30 border-b h-14 flex items-center justify-between px-4 md:px-6 backdrop-blur-md flex-shrink-0"
        style={{ background: C.nav, borderColor: C.navBorder }}>
        <div className="flex items-center gap-3">
          {/* Mobile sidebar toggle */}
          <button onClick={() => setSidebarOpen(o => !o)}
            className="md:hidden p-2 rounded-lg transition-colors" style={{ color: C.faint }}>
            <Menu className="w-5 h-5"/>
          </button>
          <Link href="/dashboard" className="flex items-center gap-2">
            <img src={(theme === 'dark' ? logoDarkUrl || logoUrl : logoUrl) || undefined} alt="" className="h-8 w-auto" />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className="p-2 rounded-lg transition-colors flex-shrink-0" style={{ color: C.faint }}>
            {theme === 'dark' ? <Sun className="w-4 h-4"/> : <Moon className="w-4 h-4"/>}
          </button>
          <ProfileMenu user={user} profile={profile} onSignOut={handleSignOut}/>
        </div>
      </nav>

      {/* -- Body -- */}
      <div className="flex flex-1 relative">

        <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} C={C} profile={profile} user={user} isStaff={isStaff} activeSection={activeSection} goSection={goSection} navAccent={navAccent} theme={theme} />

        {/* -- Main content -- */}
        <main className="flex-1 min-w-0 px-4 md:px-10 py-6 sm:py-8">
          <motion.div
            key={activeSection}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {/* Section header */}
            <div className={`flex flex-wrap items-start sm:items-center justify-between gap-3 mb-6 sm:mb-8 ${activeSection === 'learning_paths' ? 'hidden' : ''}`}>
              <div>
                <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.text }}>{activeItem.label}</h1>
                {(activeSection === 'courses' || activeSection === 'events') && (
                  <p className="text-sm mt-1" style={{ color: C.faint }}>
                    {activeSection === 'courses' ? `${courseCount} course${courseCount !== 1 ? 's' : ''}` : `${eventCount} event${eventCount !== 1 ? 's' : ''}`}
                  </p>
                )}
              </div>
              {((!isStaff && activeSection === 'courses') || activeSection === 'events') && (
                <div className="flex flex-wrap items-center gap-2">
                  {!isStaff && activeSection === 'courses' && forms.filter(f => f.content_type === 'course').length > 0 && (
                    <button
                      onClick={() => exportAllInSection(forms, 'course', 'courses_bulk')}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                      style={{ background: C.card, color: C.muted }}>
                      <Download className="w-3.5 h-3.5" /> Export All
                    </button>
                  )}
                  {!isStaff && activeSection === 'courses' && SYNC_ENABLED && forms.filter(f => f.content_type === 'course').length > 0 && (
                    <PushAllButton
                      items={forms.filter(f => f.content_type === 'course').map(f => ({ type: 'course', id: f.id }))}
                      C={C}
                    />
                  )}
                  {!isStaff && activeSection === 'courses' && (
                    <ImportButton
                      types={['course']}
                      C={C}
                      onImported={r => router.push(`/dashboard/${r.id}`)}
                      onBulkDone={() => window.location.reload()}
                    />
                  )}
                  {!isStaff && activeSection === 'courses' && (
                    <CreateCourseMenu C={C} />
                  )}
                  {activeSection === 'events' && (
                    <Link
                      href="/create?type=event"
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
                      style={{ background: C.cta, color: C.ctaText }}>
                      <Plus className="w-4 h-4"/> New Event
                    </Link>
                  )}
                </div>
              )}
            </div>

            <IsStaffContext.Provider value={isStaff}>
              <SectionContent
                section={activeSection}
                forms={forms}
                shareMenuOpen={shareMenuOpen}
                setShareMenuOpen={setShareMenuOpen}
                setFormToDelete={setFormToDelete}
                onDuplicated={newForm => {
                  const updated = [newForm, ...forms];
                  _cache.forms = updated;
                  setForms(updated);
                }}
                C={C}
              />
            </IsStaffContext.Provider>
          </motion.div>
        </main>
      </div>

      {/* Delete modal */}
      <AnimatePresence>
        {formToDelete && (
          <motion.div key="delete-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="p-6 rounded-2xl max-w-md w-full"
              style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: '0 16px 48px rgba(0,0,0,0.15)' }}>
              <h3 className="text-lg font-semibold mb-2" style={{ color: C.text }}>Delete &ldquo;{deletingName}&rdquo;?</h3>
              <p className="text-sm mb-6" style={{ color: C.muted }}>This will permanently delete this item and all its responses. This cannot be undone.</p>
              <div className="flex items-center justify-end gap-3">
                <button onClick={() => setFormToDelete(null)} disabled={isDeleting}
                  className="px-4 py-2 text-sm font-medium rounded-lg transition-colors ff-hover"
                  style={{ color: C.muted }}>Cancel</button>
                <button onClick={confirmDelete} disabled={isDeleting}
                  className="px-4 py-2 text-sm font-medium rounded-lg flex items-center gap-2 transition-colors"
                  style={{ background: C.deleteBg, color: C.deleteText, border: `1px solid ${C.deleteBorder}` }}>
                  {isDeleting ? <Loader2 className="w-4 h-4 animate-spin"/> : <Trash2 className="w-4 h-4"/>}
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
