'use client';

// The admin Courses page: every course, grouped by tool, with search and filters.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Download, ExternalLink, Eye, Pencil, Send, Share2, Trash2 } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import { exportAllInSection, exportContent } from '@/lib/dashboard-export';
import { SYNC_ENABLED } from '@/lib/sync';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { ImportButton } from '@/components/dashboard/ImportButton';
import { PushAllButton, PushStatusPill, usePushStatus } from '@/components/dashboard/primitives';
import { CreateCourseMenu, ShareMenu, groupFormsByCategory } from '@/components/dashboard/content-cards';
import { Card, btnClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { CARD_GRID, ContentCard, GroupHeading, Kpis, PageHeader, StatusChips, contentKpis, matchesFilters, useReach, type Reach, type Status } from '@/components/dashboard/content/kit';

function CourseCard({ course, reach, onDelete, C }: { course: any; reach: Reach | null; onDelete: (id: string) => void; C: ThemeColors }) {
  const router = useRouter();
  const [shareFrom, setShareFrom] = useState<DOMRect | null>(null);
  const { state: pushState, msg: pushMsg, push } = usePushStatus('course', course.id);
  const open = () => router.push(`/dashboard/${course.id}`);
  return (
    <ContentCard item={course} cover={course.config?.coverImage} Icon={BookOpen} reach={reach} onOpen={open} C={C}
      overlay={<PushStatusPill state={pushState} msg={pushMsg} className="top-3 left-3" />}
      menu={(close, from) => [
        { label: 'Open', sub: 'Lessons, learners and results', icon: Eye, onClick: () => { close(); open(); } },
        { label: 'Settings', sub: 'Cohorts, pass mark, look', icon: Pencil, onClick: () => { close(); router.push(`/dashboard/${course.id}?tab=settings`); } },
        { label: 'Preview', sub: 'As a learner sees it', icon: ExternalLink, onClick: () => { close(); window.open(`/${course.slug || course.id}`, '_blank', 'noopener'); } },
        // Share opens by the menu's own button.
        { label: 'Share', sub: 'Link and social posts', icon: Share2, onClick: () => { setShareFrom(from); close(); } },
        { label: 'Export', sub: 'Download as a file', icon: Download, onClick: () => { close(); exportContent(course); } },
        ...(SYNC_ENABLED ? [{ label: 'Push to platform', sub: 'Send the latest version', icon: Send, onClick: () => { close(); push(); } }] : []),
        null,
        { label: 'Delete', sub: 'Asks first', icon: Trash2, danger: true, onClick: () => { close(); onDelete(course.id); } },
      ]}>
      {shareFrom && <ShareMenu form={course} triggerRect={shareFrom} onClose={() => setShareFrom(null)} />}
    </ContentCard>
  );
}

export function CoursesSection({ courses, setFormToDelete, C: theme }: { courses: any[]; setFormToDelete: (id: string) => void; C: ThemeColors }) {
  // As on the other admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [tool, setTool] = useState('all');
  const [status, setStatus] = useState<Status>('all');
  const reach = useReach('courses');

  const groups = groupFormsByCategory(courses);
  const tools = groups.map(([name]) => name);
  const term = search.trim().toLowerCase();
  const shown = groups
    .filter(([name]) => tool === 'all' || name === tool)
    .map(([name, list]) => [name, list.filter((c) => matchesFilters(c, status, term))] as const)
    .filter(([, list]) => list.length);
  const toolList = (names: string[]) => names.length <= 4 ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

  const kpis = contentKpis({ items: courses, reach, noun: ['course', 'courses'], totalSub: tools.length ? toolList(tools) : 'None yet', C });

  return (
    <div className="space-y-5 pb-12">
      <PageHeader title="Courses" sub={`${plural(courses.length, 'course')}${tools.length ? ` in ${plural(tools.length, 'tool')}` : ''}.`} C={C} actions={<>
        <ImportButton types={['course']} C={C} className={btnClass} style={btnStyle('sec', C)}
          onImported={(r) => router.push(`/dashboard/${r.id}`)} onBulkDone={() => window.location.reload()} />
        {courses.length > 0 && (
          <button type="button" onClick={() => exportAllInSection(courses, 'course', 'courses_bulk')} className={btnClass} style={btnStyle('sec', C)}>
            <Download className="w-4 h-4" />
            Export all
          </button>
        )}
        {SYNC_ENABLED && courses.length > 0 && (
          <PushAllButton items={courses.map((c) => ({ type: 'course', id: c.id }))} C={C} className={btnClass} style={btnStyle('sec', C)} />
        )}
        <CreateCourseMenu C={C} />
      </>} />

      {courses.length === 0 ? (
        <Card C={C} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>No courses yet</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Create your first course, or import one.</p>
        </Card>
      ) : (
        <>
          <Kpis items={kpis} C={C} />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search courses" C={C} />
            <MenuSelect searchable fixed label="Filter by tool" value={tool} onChange={setTool}
              options={[{ value: 'all', label: 'All tools' }, ...tools.map((t) => ({ value: t, label: t }))]} C={C} />
            <StatusChips value={status} onChange={setStatus} C={C} />
          </div>
          {shown.length === 0 ? (
            <Card C={C} className="px-5 py-12 text-center"><p className="text-sm" style={{ color: C.muted }}>No courses match these filters.</p></Card>
          ) : shown.map(([name, list]) => (
            <section key={name}>
              <GroupHeading name={name} count={list.length} noun="course" C={C} />
              <div className={CARD_GRID}>
                {list.map((c) => <CourseCard key={c.id} course={c} reach={reach} onDelete={setFormToDelete} C={C} />)}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
