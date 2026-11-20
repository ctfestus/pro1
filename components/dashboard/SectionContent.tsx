'use client';

import { useState, useEffect, useContext } from 'react';
import { LIGHT_C } from '@/lib/theme';
import { IsStaffContext } from '@/components/dashboard/context';
import { STAFF_SECTION_IDS, COMING_SOON, ComingSoon, type SectionId } from '@/components/dashboard/nav';
import { getFormType } from '@/components/dashboard/content-cards';
import { CoursesSection } from '@/components/dashboard/courses/CoursesSection';
import { AnnouncementsSection, CommunitySection, PromotionsSection, SchedulesSection } from '@/components/dashboard/engagement/pages';
import { EventsSection } from '@/components/dashboard/engagement/EventsSection';
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
import { ApplicationsSection } from '@/components/dashboard/ApplicationsSection';
import { EmailTemplatesSection } from '@/components/dashboard/EmailTemplatesSection';
import { BooksManageSection } from '@/components/dashboard/books/BooksManageSection';

export function SectionContent({ section, forms, setFormToDelete, onDuplicated, C }: {
  section: SectionId; forms: any[]; setFormToDelete: (id: string) => void;
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
  if (section === 'products')          return <BooksManageSection C={C} />;
  if (section === 'data_center')    return <DataCenterAdminSection C={C} />;
  if (section === 'partners')       return <PartnersSection C={C} />;
  if (section === 'applications')   return <ApplicationsSection C={C} />;
  if (section === 'email_templates') return <EmailTemplatesSection C={C} />;
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

  if (section === 'community')     return <CommunitySection C={C} />;
  if (section === 'announcements') return <AnnouncementsSection C={C} />;
  if (section === 'promotions')    return <PromotionsSection C={C} />;
  if (section === 'schedule')      return <SchedulesSection C={C} />;
  if (section === 'events')        return <EventsSection events={forms.filter(f => getFormType(f) === 'event')} setFormToDelete={setFormToDelete} C={C} />;

  if (section === 'courses') return <CoursesSection courses={forms.filter(f => getFormType(f) === 'course')} setFormToDelete={setFormToDelete} C={C} />;

  if (section === 'recordings') return <RecordingsManageSection C={C}/>;
  return null;
}
