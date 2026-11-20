'use client';

// The admin Virtual experiences page: every experience, grouped by industry, with search and
// filters, as cards in the same style as Courses.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, Briefcase, Copy, Download, Pencil, Plus, Send, Trash2 } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import { supabase } from '@/lib/supabase';
import { DARK_C, LIGHT_C } from '@/lib/theme';
import { SYNC_ENABLED } from '@/lib/sync';
import { exportContent, exportAllInSection } from '@/lib/dashboard-export';
import { PushAllButton, usePushStatus, PushStatusPill } from '@/components/dashboard/primitives';
import { ImportButton } from '@/components/dashboard/ImportButton';
import { Card, btnClass, btnStyle, plural } from '@/components/dashboard/subscriptions/ui';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { CARD_GRID, ContentCard, GroupHeading, Kpis, PageHeader, StatusChips, contentKpis, matchesFilters, useReach, type Reach, type Status } from '@/components/dashboard/content/kit';

// Group VEs by industry; named industries alphabetical, "Other" last
function groupVEsByIndustry(forms: any[]): [string, any[]][] {
  const groups = new Map<string, any[]>();
  for (const f of forms) {
    const key = (f.config?.industry ?? f.industry ?? '').trim() || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === 'Other') return 1;
    if (b[0] === 'Other') return -1;
    return a[0].localeCompare(b[0]);
  });
}

/** "HR" for a short code, "Health care" style otherwise. */
function industryLabel(key: string) {
  if (key === 'Other') return key;
  return key.length <= 3 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1).replaceAll('_', ' ');
}

function VECard({ form, reach, handleDuplicate, setFormToDelete, C }: {
  form: any; reach: Reach | null; handleDuplicate: (f: any) => void; setFormToDelete: (id: string) => void; C: typeof LIGHT_C;
}) {
  const router = useRouter();
  const { state: pushState, msg: pushMsg, push } = usePushStatus('virtual_experience', form.id);
  const cfg = form.config || {};
  const totalLessons = (cfg.modules || []).reduce((a: number, m: any) => a + (m.lessons?.length || 0), 0);
  const detail = [cfg.company, plural(totalLessons, 'lesson'), cfg.difficulty ? String(cfg.difficulty).toLowerCase() : ''].filter(Boolean).join(', ');
  const open = () => router.push(`/dashboard/${form.id}`);
  return (
    <ContentCard item={form} cover={cfg.coverImage} Icon={Briefcase} detail={detail} reach={reach} onOpen={open} C={C}
      overlay={<PushStatusPill state={pushState} msg={pushMsg} className="top-3 left-3" />}
      menu={(close) => [
        { label: 'Report', sub: 'Learners, progress and reviews', icon: BarChart3, onClick: () => { close(); open(); } },
        { label: 'Edit', sub: 'Brief, modules and lessons', icon: Pencil, onClick: () => { close(); router.push(`/create/guided-project?id=${form.id}`); } },
        { label: 'Duplicate', sub: 'A draft copy', icon: Copy, onClick: () => { close(); handleDuplicate(form); } },
        { label: 'Export', sub: 'Download as a file', icon: Download, onClick: () => { close(); exportContent(form); } },
        ...(SYNC_ENABLED ? [{ label: 'Push to platform', sub: 'Send the latest version', icon: Send, onClick: () => { close(); push(); } }] : []),
        null,
        { label: 'Delete', sub: 'Asks first', icon: Trash2, danger: true, onClick: () => { close(); setFormToDelete(form.id); } },
      ]} />
  );
}

export function VirtualExperiencesManageSection({ C: theme, forms, setFormToDelete, onDuplicated }: { C: typeof LIGHT_C; forms: any[]; setFormToDelete: (id: string) => void; onDuplicated: (newForm: any) => void }) {
  // As on the other admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [industry, setIndustry] = useState('all');
  const [status, setStatus] = useState<Status>('all');
  const reach = useReach('virtual_experiences');
  const gpForms = forms.filter(f => f.content_type === 'virtual_experience' || f.content_type === 'guided_project' || f.config?.isVirtualExperience || f.config?.isGuidedProject);
  const handleDuplicate = async (form: any) => {
    if (duplicatingId) return;
    setDuplicatingId(form.id);
    try {
      const { data: original } = await supabase
        .from('virtual_experiences')
        .select('*')
        .eq('id', form.id)
        .single();
      if (!original) return;

      const slugBase = (original.slug || original.id).replace(/-copy(-\d+)?$/, '');
      const newSlug  = `${slugBase}-copy-${Date.now().toString(36)}`;

      const { data: newVe, error } = await supabase
        .from('virtual_experiences')
        .insert({
          user_id:       original.user_id,
          title:         `${original.title} (Copy)`,
          slug:          newSlug,
          description:   original.description,
          industry:      original.industry,
          difficulty:    original.difficulty,
          role:          original.role,
          company:       original.company,
          duration:      original.duration,
          tools:         original.tools,
          tool_logos:    original.tool_logos,
          tagline:       original.tagline,
          background:    original.background,
          learn_outcomes: original.learn_outcomes,
          manager_name:  original.manager_name,
          manager_title: original.manager_title,
          guide_id:      original.guide_id,
          guide_snapshot: original.guide_snapshot,
          modules:       original.modules,
          dataset:       original.dataset,
          cover_image:   original.cover_image,
          deadline_days: original.deadline_days,
          theme:         original.theme,
          mode:          original.mode,
          font:          original.font,
          custom_accent: original.custom_accent,
          is_short_course: original.is_short_course,
          badge_image_url: original.badge_image_url,
          status:        'draft',
          cohort_ids:    [],
        })
        .select('*')
        .single();

      if (error || !newVe) { console.error('[duplicate VE]', error); return; }

      // Normalise to the same shape the dashboard uses
      const normalised = { ...newVe, content_type: 'virtual_experience', config: {
        title: newVe.title, description: newVe.description,
        isVirtualExperience: true, modules: newVe.modules ?? [],
        industry: newVe.industry, difficulty: newVe.difficulty,
        role: newVe.role, company: newVe.company, duration: newVe.duration,
        tools: newVe.tools, toolLogos: newVe.tool_logos ?? {}, tagline: newVe.tagline, background: newVe.background,
        learnOutcomes: newVe.learn_outcomes, managerName: newVe.manager_name,
        managerTitle: newVe.manager_title, guideId: newVe.guide_id,
        guideSnapshot: newVe.guide_snapshot, dataset: newVe.dataset,
        coverImage: newVe.cover_image, deadline_days: newVe.deadline_days,
        theme: newVe.theme, mode: newVe.mode, font: newVe.font, customAccent: newVe.custom_accent,
        badgeImageUrl: newVe.badge_image_url,
      }};
      onDuplicated(normalised);
    } finally {
      setDuplicatingId(null);
    }
  };

  const groups = groupVEsByIndustry(gpForms);
  const industries = groups.map(([name]) => name);
  const term = search.trim().toLowerCase();
  const shown = groups
    .filter(([name]) => industry === 'all' || name === industry)
    .map(([name, list]) => [name, list.filter((f) => matchesFilters(f, status, term, [f.title, f.config?.company]))] as const)
    .filter(([, list]) => list.length);
  const names = industries.map(industryLabel);
  const nameList = names.length <= 4 ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;

  return (
    <div className="space-y-5 pb-12">
      <PageHeader title="Virtual experiences" sub={`${plural(gpForms.length, 'experience')}${industries.length ? ` in ${industries.length} ${industries.length === 1 ? 'industry' : 'industries'}` : ''}.`} C={C} actions={<>
        <ImportButton types={['virtual_experience']} C={C} className={btnClass} style={btnStyle('sec', C)}
          onImported={r => { window.location.href = `/create/guided-project?id=${r.id}`; }} onBulkDone={() => window.location.reload()} />
        {gpForms.length > 0 && (
          <button type="button" onClick={() => exportAllInSection(gpForms, 'virtual_experience', 'virtual_experiences_bulk')} className={btnClass} style={btnStyle('sec', C)}>
            <Download className="w-4 h-4" />
            Export all
          </button>
        )}
        {SYNC_ENABLED && gpForms.length > 0 && (
          <PushAllButton items={gpForms.map(f => ({ type: 'virtual_experience', id: f.id }))} C={C} className={btnClass} style={btnStyle('sec', C)} />
        )}
        <Link href="/create/guided-project" className={`${btnClass} no-underline`} style={btnStyle('pri', C)}>
          <Plus className="w-4 h-4" />
          New experience
        </Link>
      </>} />

      {gpForms.length === 0 ? (
        <Card C={C} className="px-5 py-16 text-center">
          <p className="text-sm font-semibold" style={{ color: C.text }}>No virtual experiences yet</p>
          <p className="text-sm mt-1" style={{ color: C.muted }}>Create your first industry project, or import one.</p>
        </Card>
      ) : (
        <>
          <Kpis items={contentKpis({ items: gpForms, reach, noun: ['experience', 'virtual experiences'], totalSub: industries.length ? nameList : 'None yet', C })} C={C} />
          <div className="flex flex-wrap items-center gap-2">
            <SearchBox value={search} onChange={setSearch} placeholder="Search experiences" C={C} />
            <MenuSelect searchable fixed label="Filter by industry" value={industry} onChange={setIndustry}
              options={[{ value: 'all', label: 'All industries' }, ...industries.map((t) => ({ value: t, label: industryLabel(t) }))]} C={C} />
            <StatusChips value={status} onChange={setStatus} C={C} />
          </div>
          {duplicatingId && <p className="text-xs" style={{ color: C.muted }}>Making a copy...</p>}
          {shown.length === 0 ? (
            <Card C={C} className="px-5 py-12 text-center"><p className="text-sm" style={{ color: C.muted }}>No experiences match these filters.</p></Card>
          ) : shown.map(([name, list]) => (
            <section key={name}>
              <GroupHeading name={industryLabel(name)} count={list.length} noun="experience" C={C} />
              <div className={CARD_GRID}>
                {list.map((f) => <VECard key={f.id} form={f} reach={reach} handleDuplicate={handleDuplicate} setFormToDelete={setFormToDelete} C={C} />)}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
