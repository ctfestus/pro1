'use client';

import {
  CalendarDays, Settings, BookOpen, GraduationCap, ClipboardList, Award, Users,
  Megaphone, Trophy, CheckCircle2, Briefcase, Activity, CreditCard, Palette, Video,
  PlayCircle, Database, ShieldCheck, Handshake, BadgeDollarSign,
} from 'lucide-react';
import { LIGHT_C } from '@/lib/theme';

// --- Sidebar navigation ---
export const NAV_ITEMS = [
  { id: 'courses',       label: 'Courses',       Icon: Video,         adminOnly: false },
  { id: 'assignments',   label: 'Assignments',    Icon: ClipboardList, adminOnly: false },
  { id: 'events',        label: 'Events',         Icon: CalendarDays,  adminOnly: false },
  { id: 'community',     label: 'Community',      Icon: Users,         adminOnly: false },
  { id: 'announcements', label: 'Announcements',  Icon: Megaphone,     adminOnly: false },
  { id: 'virtual_experiences',  label: 'Virtual Experiences',  Icon: Briefcase,   adminOnly: false },
  { id: 'certifications', label: 'Certifications',  Icon: ShieldCheck,   adminOnly: false },
  { id: 'schedule',         label: 'Schedule',         Icon: CalendarDays, adminOnly: false },
  { id: 'recordings',      label: 'Recordings',       Icon: PlayCircle,   adminOnly: false },
  { id: 'learning_paths', label: 'Learning Paths',  Icon: BookOpen,      adminOnly: false },
  { id: 'data_center',   label: 'Data Playground', Icon: Database,      adminOnly: false },
  { id: 'certificates',  label: 'Certificates',   Icon: Award,         adminOnly: false },
  { id: 'leaderboard',   label: 'Leaderboard',    Icon: Trophy,        adminOnly: false },
  { id: 'badges',        label: 'Badges',         Icon: Award,         adminOnly: false },
  { id: 'tracking',      label: 'Tracking',       Icon: Activity,      adminOnly: false },
  { id: 'attendance',    label: 'Live Sessions',  Icon: CheckCircle2,  adminOnly: false },
  { id: 'students',      label: 'Students',       Icon: Users,         adminOnly: false },
  { id: 'subscriptions', label: 'Subscriptions',  Icon: BadgeDollarSign, adminOnly: false },
  { id: 'cohorts',       label: 'Cohorts',        Icon: GraduationCap, adminOnly: false },
  { id: 'payments',      label: 'Payments',       Icon: CreditCard,    adminOnly: false },
  { id: 'partners',      label: 'Partners',       Icon: Handshake,     adminOnly: false },
  { id: 'branding',      label: 'Platform',       Icon: Palette,       adminOnly: false },
  { id: 'site',          label: 'Site',           Icon: Settings,      adminOnly: false },
] as const;
export type SectionId = typeof NAV_ITEMS[number]['id'];
export const STAFF_SECTION_IDS = new Set<SectionId>(['events', 'recordings', 'tracking', 'cohorts']);

export const COMING_SOON: SectionId[] = [];

export const NAV_GROUPS: { label: string; items: SectionId[] }[] = [
  { label: 'Content',    items: ['courses', 'assignments', 'virtual_experiences', 'certifications', 'learning_paths', 'data_center'] },
  { label: 'Engagement', items: ['events', 'community', 'announcements', 'schedule', 'recordings'] },
  { label: 'Insights',   items: ['tracking', 'attendance', 'leaderboard', 'badges', 'certificates'] },
  { label: 'Admin',      items: ['students', 'subscriptions', 'cohorts', 'payments', 'partners', 'branding', 'site'] },
];

// External-page nav links (rendered with same styling as NAV_ITEMS but as <Link> elements)
export const NAV_LINK_GROUPS = [
  { label: 'Credentials', items: [
    { id: 'open_certificates', label: 'Open Certificates', Icon: Award, href: '/admin/open-certificates' },
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
      <span className="mt-4 text-[11px] font-semibold px-3 py-1.5 rounded-full"
        style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>Coming Soon</span>
    </div>
  );
}
