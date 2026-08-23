// Student dashboard navigation contract: the section list, sidebar groups, and the
// SectionId union derived from them. Shared between the orchestrator (app/student/page.tsx)
// and sections that navigate (e.g. OverviewSection's onNavigate), so SectionId has a single
// source of truth that lives outside the route file.

import {
  LayoutDashboard, Film, Layers, Briefcase, Database, CalendarDays, ClipboardList,
  CalendarCheck, Users, Megaphone, Calendar, Video, Trophy, Award, Medal, CreditCard,
  Sparkles, ShieldCheck, Compass,
} from 'lucide-react';

export const NAV_ITEMS = [
  { id: 'overview',          label: 'Dashboard',           Icon: LayoutDashboard },
  { id: 'courses',           label: 'My Learning',         Icon: Film            },
  { id: 'learning_paths',    label: 'Learning Paths',      Icon: Layers          },
  { id: 'virtual_experiences', label: 'Virtual Experiences', Icon: Briefcase     },
  { id: 'certifications',    label: 'Certifications',       Icon: ShieldCheck     },
  { id: 'explore',           label: 'Explore',             Icon: Compass         },
  { id: 'data_center',       label: 'Data Playground',      Icon: Database        },
  { id: 'events',            label: 'Live Sessions',        Icon: CalendarDays    },
  { id: 'assignments',       label: 'Assignments',         Icon: ClipboardList   },
  { id: 'calendar',          label: 'Calendar',            Icon: CalendarCheck   },
  { id: 'community',         label: 'Community',           Icon: Users           },
  { id: 'announcements',     label: 'Tech Blog',            Icon: Megaphone       },
  { id: 'schedule',          label: 'Schedule',            Icon: Calendar        },
  { id: 'recordings',       label: 'Recordings',          Icon: Video           },
  { id: 'leaderboard',       label: 'Leaderboard',         Icon: Trophy          },
  { id: 'certificates',      label: 'Certificates',        Icon: Award           },
  { id: 'badges',            label: 'Badges',              Icon: Medal           },
  { id: 'ai_toolkit',        label: 'AI Toolkit',          Icon: Sparkles, badge: 'New' },
  { id: 'payments',          label: 'Payments',            Icon: CreditCard      },
] as const;
export type SectionId = typeof NAV_ITEMS[number]['id'];

export const NAV_GROUPS: { label: string; items: SectionId[] }[] = [
  // Dashboard and My Learning are NOT grouped: no heading above them. They are where a student
  // lands and what they are actually doing, so the two most-used items should not sit under a
  // category word. An empty label is the signal to render items without a heading -- see the nav
  // in app/student/page.tsx.
  { label: '',            items: ['overview', 'courses'] },
  { label: 'Learn',       items: ['explore', 'certifications', 'data_center'] },
  { label: 'Activities',  items: ['events', 'assignments', 'calendar', 'schedule', 'recordings'] },
  { label: 'Community',   items: ['community', 'announcements'] },
  { label: 'Achievements', items: ['leaderboard', 'certificates', 'badges', 'ai_toolkit'] },
  { label: 'Account',     items: ['payments'] },
];
