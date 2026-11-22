// Student dashboard navigation contract: the section list, sidebar groups, and the
// SectionId union derived from them. Shared between the orchestrator (app/student/page.tsx)
// and sections that navigate (e.g. OverviewSection's onNavigate), so SectionId has a single
// source of truth that lives outside the route file.

// Phosphor icons: the menu draws them duotone, and solid for the open page.
import {
  SquaresFour, PlayCircle, Stack, Briefcase, Database, CalendarDots, ClipboardText,
  CalendarCheck, UsersThree, Megaphone, Calendar, VideoCamera, Trophy, Certificate, Medal, CreditCard,
  Sparkle, SealCheck, Compass, Path, Package,
} from '@phosphor-icons/react';

export const NAV_ITEMS = [
  { id: 'overview',          label: 'Dashboard',           Icon: SquaresFour },
  { id: 'my_program',        label: 'My Bootcamp',         Icon: Path           },
  { id: 'courses',           label: 'My Learning',         Icon: PlayCircle            },
  { id: 'learning_paths',    label: 'Learning Paths',      Icon: Stack          },
  { id: 'virtual_experiences', label: 'Virtual Experiences', Icon: Briefcase     },
  { id: 'certifications',    label: 'Certifications',       Icon: SealCheck     },
  { id: 'explore',           label: 'Explore',             Icon: Compass         },
  { id: 'data_center',       label: 'Data Playground',      Icon: Database        },
  { id: 'products',          label: 'My Products',            Icon: Package         },
  { id: 'events',            label: 'Live Sessions',        Icon: CalendarDots    },
  { id: 'assignments',       label: 'Assignments',         Icon: ClipboardText   },
  { id: 'calendar',          label: 'Calendar',            Icon: CalendarCheck   },
  { id: 'community',         label: 'Community',           Icon: UsersThree           },
  { id: 'announcements',     label: 'Tech Blog',            Icon: Megaphone       },
  { id: 'schedule',          label: 'Schedule',            Icon: Calendar        },
  { id: 'recordings',       label: 'Recordings',          Icon: VideoCamera           },
  { id: 'leaderboard',       label: 'Leaderboard',         Icon: Trophy          },
  { id: 'certificates',      label: 'My Certificates',     Icon: Certificate           },
  { id: 'badges',            label: 'Badges',              Icon: Medal           },
  { id: 'ai_toolkit',        label: 'AI Toolkit',          Icon: Sparkle        },
  { id: 'payments',          label: 'My Plan',             Icon: CreditCard      },
] as const;
export type SectionId = typeof NAV_ITEMS[number]['id'];

export const NAV_GROUPS: { label: string; items: SectionId[] }[] = [
  // Dashboard, My Program and My Learning are NOT grouped: no heading above them. They are where a
  // student lands, where they stand, and what they are actually doing, so the most-used items
  // should not sit under a category word. My Program is cohort-only (COHORT_ONLY_SECTIONS in
  // app/student/page.tsx). An empty label is the signal to render items without a heading -- see the nav
  // in app/student/page.tsx.
  { label: '',            items: ['overview', 'my_program', 'courses'] },
  { label: 'Learn',       items: ['explore', 'certifications', 'products', 'data_center'] },
  { label: 'Activities',  items: ['events', 'assignments', 'calendar', 'schedule', 'recordings'] },
  { label: 'Community',   items: ['community', 'announcements'] },
  { label: 'Achievements', items: ['leaderboard', 'certificates', 'badges', 'ai_toolkit'] },
  { label: 'Account',     items: ['payments'] },
];
