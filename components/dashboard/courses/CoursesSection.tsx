'use client';

// The admin Courses page: every course, grouped by tool, with search and filters.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, Download, ExternalLink, Eye, MoreHorizontal, Pencil, Send, Share2, Trash2 } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { exportAllInSection, exportContent } from '@/lib/dashboard-export';
import { supabase } from '@/lib/supabase';
import { SYNC_ENABLED } from '@/lib/sync';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { ImportButton } from '@/components/dashboard/ImportButton';
import { PushAllButton, PushStatusPill, usePushStatus } from '@/components/dashboard/primitives';
import { CreateCourseMenu, ShareMenu, groupFormsByCategory } from '@/components/dashboard/content-cards';
import { FloatingMenu, menuPosition, type MenuItem, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Card, DISPLAY_FONT, btnClass, btnStyle, palette, plural } from '@/components/dashboard/subscriptions/ui';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';

type Status = 'all' | 'published' | 'draft';
const CHIPS: [Status, string][] = [['all', 'All'], ['published', 'Published'], ['draft', 'Draft']];

/** How many subscription plans and learning paths include each course, by course id. */
type Reach = { plans: Record<string, number>; paths: Record<string, number> };

/** Every way learners can reach the course: open to everyone, cohorts, plans and paths. */
function audience(course: any, reach: Reach | null) {
  if (course.available_to_everyone) return 'Free';
  const parts = [
    course.cohort_ids?.length ? plural(course.cohort_ids.length, 'cohort') : '',
    reach?.plans[course.id] ? plural(reach.plans[course.id], 'plan') : '',
    reach?.paths[course.id] ? plural(reach.paths[course.id], 'path') : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function CourseCard({ course, reach, onDelete, C }: { course: any; reach: Reach | null; onDelete: (id: string) => void; C: ThemeColors }) {
  const router = useRouter();
  const [coverError, setCoverError] = useState(false);
  // The menu's position, and its button's box so Share can open by the same button.
  const [menu, setMenu] = useState<{ position: MenuPosition; from: DOMRect } | null>(null);
  const [shareFrom, setShareFrom] = useState<DOMRect | null>(null);
  const { state: pushState, msg: pushMsg, push } = usePushStatus('course', course.id);
  const cover = course.config?.coverImage;
  const open = () => router.push(`/dashboard/${course.id}`);
  const P = palette(C);
  const reachText = audience(course, reach);
  // The status sits on the cover: a see-through, blurred background keeps it readable over any image.
  const glass = C.page === DARK_C.page ? 'rgba(30,31,38,0.72)' : 'rgba(255,255,255,0.78)';
  const tag = (text: string, color: string, dot = false) => (
    <span className="inline-flex items-center gap-2 rounded-full px-2 text-xs font-semibold leading-6 whitespace-nowrap backdrop-blur-md" style={{ background: glass, color }}>
      {dot && <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'currentColor' }} />}
      {text}
    </span>
  );
  const status = course.status === 'draft' ? tag('Draft', P.warn)
    : course.status === 'archived' ? tag('Archived', C.muted)
    : tag('Published', P.good, true);

  const items: (MenuItem | null)[] = [
    { label: 'Open', sub: 'Lessons, learners and results', icon: Eye, onClick: () => { setMenu(null); open(); } },
    { label: 'Settings', sub: 'Cohorts, pass mark, look', icon: Pencil, onClick: () => { setMenu(null); router.push(`/dashboard/${course.id}?tab=settings`); } },
    { label: 'Preview', sub: 'As a learner sees it', icon: ExternalLink, onClick: () => { setMenu(null); window.open(`/${course.slug || course.id}`, '_blank', 'noopener'); } },
    { label: 'Share', sub: 'Link and social posts', icon: Share2, onClick: () => { setShareFrom(menu?.from ?? null); setMenu(null); } },
    { label: 'Export', sub: 'Download as a file', icon: Download, onClick: () => { setMenu(null); exportContent(course); } },
    ...(SYNC_ENABLED ? [{ label: 'Push to platform', sub: 'Send the latest version', icon: Send, onClick: () => { setMenu(null); push(); } }] : []),
    null,
    { label: 'Delete', sub: 'Asks first', icon: Trash2, danger: true, onClick: () => { setMenu(null); onDelete(course.id); } },
  ];

  return (
    <Card C={C} className="overflow-hidden flex flex-col">
      <div role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open(); }} className="relative aspect-video cursor-pointer grid place-items-center" style={{ background: C.pill }}>
        {cover && !coverError
          ? <img src={resolveCoverUrl(cover)} alt="" loading="lazy" onError={() => setCoverError(true)} className="absolute inset-0 w-full h-full object-cover" />
          : <BookOpen className="w-8 h-8" style={{ color: C.faint }} />}
        <PushStatusPill state={pushState} msg={pushMsg} className="top-3 left-3" />
        <div className="absolute left-3 bottom-3">{status}</div>
        <button type="button" aria-label={`Actions for ${course.title}`}
          onClick={(e) => { e.stopPropagation(); setMenu(menu ? null : { position: menuPosition(e.currentTarget, 400), from: e.currentTarget.getBoundingClientRect() }); }}
          className="absolute top-3 right-3 w-8 h-8 rounded-[10px] grid place-items-center"
          style={menu ? { background: C.text, color: C.card } : { background: C.card, color: C.muted }}>
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>
      <button type="button" onClick={open} className="text-left px-4 pt-3 pb-4 grid gap-1">
        <span className="text-sm font-semibold line-clamp-2" style={{ color: C.text }}>{course.title || 'Untitled'}</span>
        {reachText
          ? <span className="text-xs" style={{ color: C.muted }}>{reachText}</span>
          : reach && <span className="text-xs font-semibold" style={{ color: P.warn }}>Not assigned</span>}
      </button>
      {menu && <FloatingMenu position={menu.position} label="course actions" items={items} onClose={() => setMenu(null)} C={C} />}
      {shareFrom && <ShareMenu form={course} triggerRect={shareFrom} onClose={() => setShareFrom(null)} />}
    </Card>
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
  const [reach, setReach] = useState<Reach | null>(null);

  // Plans and paths also give learners a course. Until they are read (or if reading fails) a
  // course is only judged on cohorts and open access, so nothing is flagged that may be reachable.
  useEffect(() => {
    let live = true;
    Promise.all([
      supabase.from('subscription_plan_content').select('content_id').eq('content_table', 'courses'),
      supabase.from('learning_paths').select('item_ids'),
    ]).then(([plans, paths]) => {
      if (!live || plans.error || paths.error) return;
      const count = (ids: string[]) => ids.reduce<Record<string, number>>((acc, id) => { acc[id] = (acc[id] ?? 0) + 1; return acc; }, {});
      setReach({
        plans: count((plans.data ?? []).map((r: any) => r.content_id)),
        paths: count((paths.data ?? []).flatMap((r: any) => [...new Set<string>(r.item_ids ?? [])])),
      });
    });
    return () => { live = false; };
  }, []);

  const groups = groupFormsByCategory(courses);
  const tools = groups.map(([name]) => name);
  const published = courses.filter((c) => c.status === 'published').length;
  const drafts = courses.filter((c) => c.status === 'draft').length;
  const notReachable = reach ? courses.filter((c) => !audience(c, reach)).length : null;
  const term = search.trim().toLowerCase();
  const shown = groups
    .filter(([name]) => tool === 'all' || name === tool)
    .map(([name, list]) => [name, list.filter((c) => (status === 'all' || c.status === status) && (!term || (c.title ?? '').toLowerCase().includes(term)))] as const)
    .filter(([, list]) => list.length);
  const toolList = (names: string[]) => names.length <= 4 ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

  const kpis = [
    { label: 'Courses', n: courses.length, sub: tools.length ? toolList(tools) : 'None yet', color: C.text },
    { label: 'Published', n: published, sub: drafts ? `${drafts} still in draft` : 'No drafts', color: published ? P.good : C.text },
    { label: 'Not assigned', n: notReachable ?? '--', sub: notReachable ? 'No cohort, plan, path or open access' : notReachable === 0 ? 'Every course reaches learners' : 'Checking plans and paths', color: notReachable ? P.warn : C.text },
  ];

  return (
    <div className="space-y-5 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* The dashboard hides its own section title here, so this is the page heading. */}
          <h1 className="text-[28px] leading-9 font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Courses</h1>
          <p className="text-sm mt-1" style={{ color: C.muted }}>{plural(courses.length, 'course')}{tools.length ? ` in ${plural(tools.length, 'tool')}` : ''}.</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

      {courses.length === 0 ? (
        <Card C={C} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>No courses yet</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Create your first course, or import one.</p>
        </Card>
      ) : (
        <>
          <div className="grid sm:grid-cols-3 gap-3">
            {kpis.map((k) => (
              <Card key={k.label} C={C} className="p-4 grid gap-2 content-start">
                <p className="text-2xl sm:text-[28px] leading-8 sm:leading-9 tabular-nums" style={{ color: k.color, fontFamily: DISPLAY_FONT }}>{k.n}</p>
                <p className="text-sm font-semibold" style={{ color: C.text }}>{k.label}</p>
                <p className="text-xs" style={{ color: C.muted }}>{k.sub}</p>
              </Card>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search courses" C={C} />
            <MenuSelect searchable fixed label="Filter by tool" value={tool} onChange={setTool}
              options={[{ value: 'all', label: 'All tools' }, ...tools.map((t) => ({ value: t, label: t }))]} C={C} />
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
              {CHIPS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)} className="h-8 px-3 rounded-full text-xs font-semibold"
                  style={status === id ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <Card C={C} className="px-5 py-12 text-center"><p className="text-sm" style={{ color: C.muted }}>No courses match these filters.</p></Card>
          ) : shown.map(([name, list]) => (
            <section key={name}>
              <div className="flex items-baseline gap-2 mb-3">
                <h2 className="text-lg font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{name}</h2>
                <span className="text-xs" style={{ color: C.muted }}>{plural(list.length, 'course')}</span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map((c) => <CourseCard key={c.id} course={c} reach={reach} onDelete={setFormToDelete} C={C} />)}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
