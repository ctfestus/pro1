'use client';

import { useState, useEffect, useContext } from 'react';
import Link from 'next/link';
import { BookOpen, CalendarDays, Plus, Users, Megaphone } from 'lucide-react';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { GenericListSection } from '@/components/dashboard/primitives';
import { IsStaffContext } from '@/components/dashboard/context';
import { STAFF_SECTION_IDS, COMING_SOON, ComingSoon, type SectionId } from '@/components/dashboard/nav';
import { getFormType, groupFormsByCategory, CreateCourseMenu, EventCard, CourseToolRow } from '@/components/dashboard/content-cards';
import { SchedulesManageSection } from '@/components/dashboard/SchedulesManageSection';
import { RecordingsManageSection } from '@/components/dashboard/RecordingsManageSection';
import { VirtualExperiencesManageSection } from '@/components/dashboard/VirtualExperiencesManageSection';
import { CertificationsManageSection } from '@/components/dashboard/CertificationsManageSection';
import { AttendanceReportSection } from '@/components/dashboard/AttendanceReportSection';
import { AssignmentsManageSection } from '@/components/dashboard/AssignmentsManageSection';
import { CertificatesSection } from '@/components/dashboard/CertificatesSection';
import { BadgesSection } from '@/components/dashboard/BadgesSection';
import { PaymentsSection } from '@/components/dashboard/PaymentsSection';
import { LeaderboardSection } from '@/components/dashboard/LeaderboardSection';
import { StudentsSection } from '@/components/dashboard/StudentsSection';
import { SubscriptionsSection } from '@/components/dashboard/SubscriptionsSection';
import { StudentTrackingSection } from '@/components/dashboard/StudentTrackingSection';
import { LearningPathsSection } from '@/components/dashboard/LearningPathsSection';
import { BrandingSection } from '@/components/dashboard/BrandingSection';
import { SiteSettingsSection } from '@/components/dashboard/SiteSettingsSection';
import { CohortsSection } from '@/components/dashboard/CohortsSection';
import { PartnersSection } from '@/components/dashboard/PartnersSection';
import { DataCenterAdminSection } from '@/components/dashboard/DataCenterAdminSection';

export function SectionContent({ section, forms, shareMenuOpen, setShareMenuOpen, setFormToDelete, onDuplicated, C }: {
  section: SectionId; forms: any[]; shareMenuOpen: string | null;
  setShareMenuOpen: (id: string | null) => void; setFormToDelete: (id: string) => void;
  onDuplicated: (newForm: any) => void; C: typeof LIGHT_C;
}) {
  const isStaff = useContext(IsStaffContext);
  const [page, setPage] = useState(1);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [section]);

  if (isStaff && !STAFF_SECTION_IDS.has(section)) return <ComingSoon id="events" C={C} />;
  if (COMING_SOON.includes(section)) return <ComingSoon id={section} C={C} />;
  if (section === 'branding')     return <BrandingSection C={C} />;
  if (section === 'site')         return <SiteSettingsSection C={C} />;
  if (section === 'learning_paths') return <LearningPathsSection C={C} forms={forms} />;
  if (section === 'data_center')    return <DataCenterAdminSection C={C} />;
  if (section === 'partners')       return <PartnersSection C={C} />;
  if (section === 'certificates') return <CertificatesSection C={C} />;
  if (section === 'students')     return <StudentsSection C={C} />;
  if (section === 'subscriptions') return <SubscriptionsSection C={C} />;
  if (section === 'cohorts')      return <CohortsSection C={C} />;
  if (section === 'payments')     return <PaymentsSection C={C} />;
  if (section === 'tracking')     return <StudentTrackingSection C={C} />;
  if (section === 'attendance')   return <AttendanceReportSection C={C} />;
  if (section === 'leaderboard')  return <LeaderboardSection C={C} />;
  if (section === 'badges')       return <BadgesSection C={C} />;

  if (section === 'assignments') return <AssignmentsManageSection C={C}/>;

  if (section === 'virtual_experiences') return <VirtualExperiencesManageSection C={C} forms={forms} setFormToDelete={setFormToDelete} onDuplicated={onDuplicated} />;

  if (section === 'certifications') return <CertificationsManageSection C={C} />;

  if (section === 'community') return <GenericListSection table="communities" label="Communities" createHref="/create/community" createLabel="New Community" Icon={Users} C={C} renderRow={item => (
    <div className="min-w-0">
      <p className="font-semibold text-sm truncate" style={{ color: C.text }}>{item.name}</p>
      {item.description && <p className="text-xs mt-0.5 truncate" style={{ color: C.faint }}>{item.description}</p>}
      <span className="inline-flex text-xs px-2 py-1 rounded-lg mt-2" style={{ background: C.pill, color: C.muted }}>{item.status}</span>
    </div>
  )}/>;

  if (section === 'announcements') return <GenericListSection table="announcements" label="Announcements" createHref="/create/announcement" createLabel="New Announcement" Icon={Megaphone} C={C} renderRow={item => (
    <div className="min-w-0">
      <p className="font-semibold text-sm truncate" style={{ color: C.text }}>{item.title}</p>
      <p className="text-xs mt-0.5" style={{ color: C.faint }}>{new Date(item.published_at).toLocaleDateString()}{item.is_pinned ? ' · Pinned' : ''}</p>
    </div>
  )}/>;

  if (section === 'schedule')    return <SchedulesManageSection C={C}/>;
  if (section === 'recordings') return <RecordingsManageSection C={C}/>;

  const filtered = section === 'courses'
    ? forms.filter(f => getFormType(f) === 'course')
    : forms.filter(f => getFormType(f) === 'event');

  if (filtered.length === 0) {
    const href = section === 'courses' ? '/create?type=course' : '/create?type=event';
    const label = section === 'courses' ? 'course' : 'event';
    return (
      <div className="text-center py-24 rounded-3xl" style={{ ...cardStyle(C) }}>
        <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: C.lime }}>
          {section === 'courses' ? <BookOpen className="w-7 h-7" style={{ color: C.green }}/> : <CalendarDays className="w-7 h-7" style={{ color: C.green }}/>}
        </div>
        <h2 className="text-base font-semibold mb-1" style={{ color: C.text }}>No {label}s yet</h2>
        <p className="text-sm mb-5" style={{ color: C.faint }}>Create your first {label} to get started.</p>
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {section === 'courses' ? (
            <CreateCourseMenu C={C} />
          ) : (
            <Link href={href} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: C.cta, color: C.ctaText }}>
              <Plus className="w-4 h-4"/> New {label}
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (section === 'events') {
    const sorted = [...filtered].sort((a, b) => {
      const da = a.config?.eventDetails?.date ? new Date(a.config.eventDetails.date).getTime() : 0;
      const db = b.config?.eventDetails?.date ? new Date(b.config.eventDetails.date).getTime() : 0;
      return db - da;
    });
    return (
      <div>{sorted.map((form, i) => (
        <EventCard key={form.id} form={form} index={i} isLast={i === sorted.length - 1}
          shareMenuOpen={shareMenuOpen} setShareMenuOpen={setShareMenuOpen} setFormToDelete={setFormToDelete}/>
      ))}</div>
    );
  }

  return (
    <div>
      {groupFormsByCategory(filtered).map(([tool, list]) => (
        <CourseToolRow key={tool} tool={tool} forms={list}
          shareMenuOpen={shareMenuOpen} setShareMenuOpen={setShareMenuOpen} setFormToDelete={setFormToDelete}/>
      ))}
    </div>
  );
}
