'use client';

// Phosphor icons: the menu draws them duotone, and solid for the open page.
import {
  PlayCircle, ClipboardText, CalendarDots, UsersThree, Megaphone, SealPercent, Briefcase, SealCheck,
  Calendar, VideoCamera, Stack, Package, Database, Certificate, Trophy, Medal, ChartLineUp, CheckCircle,
  Student, CurrencyCircleDollar, GraduationCap, CreditCard, Handshake, FileText, EnvelopeSimple, Palette,
  Globe, IdentificationBadge,
} from '@phosphor-icons/react';
import { LIGHT_C } from '@/lib/theme';

// --- Sidebar navigation ---
export const NAV_ITEMS = [
  { id: 'courses',       label: 'Courses',       Icon: PlayCircle,         adminOnly: false },
  { id: 'assignments',   label: 'Assignments',    Icon: ClipboardText, adminOnly: false },
  { id: 'events',        label: 'Events',         Icon: CalendarDots,  adminOnly: false },
  { id: 'community',     label: 'Community',      Icon: UsersThree,         adminOnly: false },
  { id: 'announcements', label: 'Announcements',  Icon: Megaphone,     adminOnly: false },
  { id: 'promotions',    label: 'Promotions',     Icon: SealPercent,  adminOnly: false },
  { id: 'virtual_experiences',  label: 'Virtual Experiences',  Icon: Briefcase,   adminOnly: false },
  { id: 'certifications', label: 'Certifications',  Icon: SealCheck,   adminOnly: false },
  { id: 'schedule',         label: 'Schedule',         Icon: Calendar, adminOnly: false },
  { id: 'recordings',      label: 'Recordings',       Icon: VideoCamera,   adminOnly: false },
  { id: 'learning_paths', label: 'Learning Paths',  Icon: Stack,      adminOnly: false },
  { id: 'products',      label: 'Digital Products',          Icon: Package,       adminOnly: false },
  { id: 'data_center',   label: 'Data Playground', Icon: Database,      adminOnly: false },
  { id: 'certificates',  label: 'Certificates',   Icon: Certificate,         adminOnly: false },
  { id: 'leaderboard',   label: 'Leaderboard',    Icon: Trophy,        adminOnly: false },
  { id: 'badges',        label: 'Badges',         Icon: Medal,         adminOnly: false },
  { id: 'tracking',      label: 'Tracking',       Icon: ChartLineUp,      adminOnly: false },
  { id: 'attendance',    label: 'Live Sessions',  Icon: CheckCircle,  adminOnly: false },
  { id: 'students',      label: 'Students',       Icon: Student,         adminOnly: false },
  { id: 'subscriptions', label: 'Subscriptions',  Icon: CurrencyCircleDollar, adminOnly: false },
  { id: 'cohorts',       label: 'Cohorts',        Icon: GraduationCap, adminOnly: false },
  { id: 'payments',      label: 'Payments',       Icon: CreditCard,    adminOnly: false },
  { id: 'partners',      label: 'Partners',       Icon: Handshake,     adminOnly: false },
  { id: 'applications',  label: 'Applications',   Icon: FileText,      adminOnly: false },
  { id: 'email_templates', label: 'Email Templates', Icon: EnvelopeSimple,       adminOnly: false },
  { id: 'branding',      label: 'Platform',       Icon: Palette,       adminOnly: false },
  { id: 'site',          label: 'Site',           Icon: Globe,      adminOnly: false },
] as const;
export type SectionId = typeof NAV_ITEMS[number]['id'];
export const STAFF_SECTION_IDS = new Set<SectionId>(['events', 'recordings', 'tracking', 'cohorts', 'applications']);

export const COMING_SOON: SectionId[] = [];

export const NAV_GROUPS: { label: string; items: SectionId[] }[] = [
  { label: 'Content',    items: ['courses', 'assignments', 'virtual_experiences', 'certifications', 'learning_paths', 'products', 'data_center'] },
  { label: 'Engagement', items: ['events', 'community', 'announcements', 'promotions', 'schedule', 'recordings'] },
  { label: 'Insights',   items: ['tracking', 'attendance', 'leaderboard', 'badges', 'certificates'] },
  { label: 'Admin',      items: ['students', 'subscriptions', 'cohorts', 'payments', 'partners', 'applications', 'email_templates', 'branding', 'site'] },
];

// External-page nav links (rendered with same styling as NAV_ITEMS but as <Link> elements)
export const NAV_LINK_GROUPS = [
  { label: 'Credentials', items: [
    { id: 'open_certificates', label: 'Open Certificates', Icon: IdentificationBadge, href: '/admin/open-certificates' },
  ]},
] as const;

// --- Coming Soon placeholder ---
export function ComingSoon({ id, C }: { id: SectionId; C: typeof LIGHT_C }) {
  const item = NAV_ITEMS.find(n => n.id === id)!;
  return (
    <div className="flex flex-col items-center justify-center py-28 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4" style={{ background: C.pill }}>
        <item.Icon className="w-7 h-7" style={{ color: C.faint }}/>
      </div>
      <h2 className="text-base font-semibold mb-1" style={{ color: C.text }}>{item.label}</h2>
      <p className="text-sm max-w-xs" style={{ color: C.faint }}>This section is coming soon. We are building something great.</p>
      <span className="mt-4 text-[11px] font-semibold px-3 py-2 rounded-full"
        style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>Coming Soon</span>
    </div>
  );
}
