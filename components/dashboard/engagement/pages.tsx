'use client';

// Announcements, Promotions, Community and Schedule: the same table page with their own columns.

import { PROMO_PLACEMENTS, promoStatus } from '@/lib/promotions';
import { deleteFromCloudinary } from '@/lib/uploadToCloudinary';
import type { ThemeColors } from '@/lib/theme';
import { Pill, plural, shortDate, type Tone } from '@/components/dashboard/subscriptions/ui';
import { ListPage } from './ListPage';

function TitleCell({ title, sub, C }: { title: string; sub?: string | null; C: ThemeColors }) {
  return (
    <div className="min-w-0">
      <p className="font-semibold truncate" style={{ color: C.text }}>{title || 'Untitled'}</p>
      {sub && <p className="text-xs truncate" style={{ color: C.muted }}>{sub}</p>}
    </div>
  );
}

const cohorts = (item: any) => (item.cohort_ids?.length ? plural(item.cohort_ids.length, 'cohort') : null);
const dates = (from?: string | null, to?: string | null) =>
  from && to ? `${shortDate(from)} to ${shortDate(to)}` : from ? `From ${shortDate(from)}` : to ? `Until ${shortDate(to)}` : null;

const STATUS: Record<string, [string, Tone]> = {
  published: ['Published', 'good'], draft: ['Draft', 'warn'], archived: ['Archived', 'mute'], active: ['Active', 'good'],
};
function StatusPill({ status, C }: { status: string; C: ThemeColors }) {
  const [label, tone] = STATUS[status] ?? [String(status || 'Draft').replace(/^./, (x) => x.toUpperCase()), 'mute' as Tone];
  return <Pill tone={tone} dot={tone === 'good'} C={C}>{label}</Pill>;
}

export function AnnouncementsSection({ C }: { C: ThemeColors }) {
  return (
    <ListPage table="announcements" title="Announcements" sub="News for learners, newest first." noun={['announcement', 'announcements']}
      createHref="/create/announcement" createLabel="New announcement" C={C}
      nameOf={(i) => i.title} searchText={(i) => `${i.title} ${i.subtitle ?? ''}`}
      chips={[{ label: 'Pinned', test: (i) => !!i.is_pinned }]}
      columns={[
        { label: 'Announcement', width: '58%', cell: (i) => <TitleCell title={i.title} sub={i.subtitle} C={C} /> },
        { label: 'Published', width: '18%', cell: (i) => shortDate(i.published_at) },
        { label: 'Pinned', width: '16%', cell: (i) => (i.is_pinned ? <Pill tone="mute" C={C}>Pinned</Pill> : null) },
      ]} />
  );
}

const PROMO_TONE: Record<string, Tone> = { Live: 'good', Scheduled: 'mute', Paused: 'warn', Ended: 'mute' };

export function PromotionsSection({ C }: { C: ThemeColors }) {
  return (
    <ListPage table="promotions" title="Promotions" sub="Banners and event spotlights shown to learners and visitors." noun={['promotion', 'promotions']}
      createHref="/create/promotion" createLabel="New promotion" C={C}
      nameOf={(i) => i.title} searchText={(i) => i.title ?? ''}
      columns={[
        { label: 'Promotion', width: '36%', cell: (i) => <TitleCell title={i.title} sub={[i.kind === 'events' ? 'Event' : '', dates(i.starts_at, i.ends_at)].filter(Boolean).join(', ')} C={C} /> },
        { label: 'Shown on', width: '24%', cell: (i) => (i.placements ?? []).map((p: string) => PROMO_PLACEMENTS.find((x) => x.id === p)?.label ?? p).join(', ') || null },
        { label: 'Audience', width: '16%', cell: (i) => cohorts(i) ?? 'Everyone' },
        { label: 'Status', width: '16%', cell: (i) => { const s = promoStatus(i); return <Pill tone={PROMO_TONE[s]} dot={s === 'Live'} C={C}>{s}</Pill>; } },
      ]} />
  );
}

export function CommunitySection({ C }: { C: ThemeColors }) {
  return (
    <ListPage table="communities" title="Community" sub="Groups learners join, such as WhatsApp communities." noun={['community', 'communities']}
      createHref="/create/community" createLabel="New community" C={C}
      nameOf={(i) => i.name} searchText={(i) => `${i.name} ${i.description ?? ''}`}
      columns={[
        { label: 'Community', width: '56%', cell: (i) => <TitleCell title={i.name} sub={i.description} C={C} /> },
        { label: 'Cohorts', width: '18%', cell: (i) => cohorts(i) ?? <span style={{ color: C.muted }}>None</span> },
        { label: 'Status', width: '18%', cell: (i) => <StatusPill status={i.status} C={C} /> },
      ]} />
  );
}

export function SchedulesSection({ C }: { C: ThemeColors }) {
  return (
    <ListPage table="schedules" title="Schedule" sub="Week by week plans with topics and resources." noun={['schedule', 'schedules']}
      createHref="/create/schedule" createLabel="New schedule" C={C}
      nameOf={(i) => i.title} searchText={(i) => i.title ?? ''}
      deleteBody="Its topics and resources are removed too. This cannot be undone."
      // The cover image is removed from Cloudinary first, as before.
      beforeDelete={async (i) => { if (i.cover_image?.includes('res.cloudinary.com')) await deleteFromCloudinary(i.cover_image); }}
      columns={[
        { label: 'Schedule', width: '52%', cell: (i) => <TitleCell title={i.title} sub={dates(i.start_date, i.end_date)} C={C} /> },
        { label: 'Cohorts', width: '20%', cell: (i) => cohorts(i) ?? <span style={{ color: C.muted }}>None</span> },
        { label: 'Status', width: '20%', cell: (i) => <StatusPill status={i.status} C={C} /> },
      ]} />
  );
}
