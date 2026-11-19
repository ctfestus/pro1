'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Briefcase, Copy, Download, Trash2, Plus, Edit2, BarChart3, Send } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { SYNC_ENABLED } from '@/lib/sync';
import { exportContent, exportAllInSection } from '@/lib/dashboard-export';
import { PushAllButton, usePushStatus, PushStatusPill } from '@/components/dashboard/primitives';
import { ImportButton } from '@/components/dashboard/ImportButton';
import { CardActionsMenu, type CardAction } from '@/components/dashboard/content-cards';

const GP_IND_COLORS: Record<string, string> = {
  fintech: '#6366f1', marketing: '#f59e0b', hr: '#10b981', finance: '#3b82f6',
  edtech: '#8b5cf6', healthcare: '#ef4444', ecommerce: '#f97316', consulting: '#14b8a6',
};

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

// A single VE management card: click-to-report thumbnail, kebab actions, and a
// push-status pill that surfaces on the thumbnail while/after a sync push.
function VECard({ form, handleDuplicate, setFormToDelete, C }: {
  form: any; handleDuplicate: (f: any) => void; setFormToDelete: (id: string) => void; C: typeof LIGHT_C;
}) {
  const router = useRouter();
  const { state: pushState, msg: pushMsg, push } = usePushStatus('virtual_experience', form.id);
  const cfg = form.config || {};
  const color = GP_IND_COLORS[cfg.industry] || '#6366f1';
  const totalLessons = (cfg.modules || []).reduce((a: number, m: any) => a + (m.lessons?.length || 0), 0);

  const actions: CardAction[] = [
    { key: 'report', label: 'Report', Icon: BarChart3, href: `/dashboard/${form.id}` },
    { key: 'edit', label: 'Edit', Icon: Edit2, href: `/create/guided-project?id=${form.id}` },
    { key: 'duplicate', label: 'Duplicate', Icon: Copy, onClick: () => handleDuplicate(form) },
    { key: 'export', label: 'Export', Icon: Download, onClick: () => exportContent(form) },
    ...(SYNC_ENABLED ? [{ key: 'push', label: 'Push to platform', Icon: Send, onClick: push } as CardAction] : []),
    { key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onClick: () => setFormToDelete(form.id) },
  ];

  return (
    <div className="group relative flex-shrink-0 w-[300px] snap-start rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
      <div className="absolute top-2 right-2 z-10" onClick={e => e.stopPropagation()}>
        <CardActionsMenu form={form} actions={actions}/>
      </div>
      <PushStatusPill state={pushState} msg={pushMsg}/>
      {/* Thumbnail (click -> report/detail) */}
      <div role="button" tabIndex={0}
        onClick={() => router.push(`/dashboard/${form.id}`)}
        onKeyDown={e => e.key === 'Enter' && router.push(`/dashboard/${form.id}`)}
        className="cursor-pointer">
        {cfg.coverImage
          ? <img src={resolveCoverUrl(cfg.coverImage)} alt="" loading="lazy" className="w-full h-28 object-cover group-hover:opacity-90 transition-opacity" onError={e => (e.currentTarget.style.display = 'none')} />
          : <div className="w-full h-28 flex items-center justify-center" style={{ background: `${color}18` }}>
              <Briefcase className="w-8 h-8" style={{ color }} />
            </div>}
      </div>
      <div className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: `${color}18`, color }}>{cfg.industry || 'Project'}</span>
          <span className="text-[11px]" style={{ color: C.faint }}>{cfg.difficulty}</span>
          {form.status === 'draft' && (
            <span className="text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full" style={{ background: 'rgba(251,191,36,0.12)', color: '#f59e0b' }}>Draft</span>
          )}
        </div>
        <Link href={`/dashboard/${form.id}`} className="block">
          <p className="font-semibold text-sm hover:opacity-70 transition-opacity" style={{ color: C.text }}>{form.title}</p>
        </Link>
        <p className="text-xs" style={{ color: C.faint }}>{cfg.company} · {totalLessons} lesson{totalLessons !== 1 ? 's' : ''}</p>
      </div>
    </div>
  );
}

// One industry group rendered as a titled carousel of VE management cards
function VEIndustryRow({ industry, forms, handleDuplicate, setFormToDelete, C }: {
  industry: string; forms: any[]; handleDuplicate: (f: any) => void; setFormToDelete: (id: string) => void; C: typeof LIGHT_C;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 340, behavior: 'smooth' });
  return (
    <section className="rounded-2xl p-5 sm:p-6 mb-6" style={{ ...cardStyle(C) }}>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-base sm:text-[22px] font-bold truncate leading-6" style={{ color: C.text }}>{industry.replace(/\b\w/g, c => c.toUpperCase())}</h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => scrollByCards(-1)} aria-label="Scroll left"
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <ChevronLeft className="w-4 h-4"/>
          </button>
          <button onClick={() => scrollByCards(1)} aria-label="Scroll right"
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <ChevronRight className="w-4 h-4"/>
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex gap-4 overflow-x-auto pb-2 snap-x" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {forms.map(form => (
          <VECard key={form.id} form={form} handleDuplicate={handleDuplicate} setFormToDelete={setFormToDelete} C={C}/>
        ))}
      </div>
    </section>
  );
}

export function VirtualExperiencesManageSection({ C, forms, setFormToDelete, onDuplicated }: { C: typeof LIGHT_C; forms: any[]; setFormToDelete: (id: string) => void; onDuplicated: (newForm: any) => void }) {
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
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

  if (gpForms.length === 0) {
    return (
      <div className="text-center py-24 rounded-3xl" style={{ ...cardStyle(C) }}>
        <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: '#6366f120' }}>
          <Briefcase className="w-6 h-6" style={{ color: '#6366f1' }} />
        </div>
        <p className="font-semibold text-base mb-1" style={{ color: C.text }}>No virtual experiences yet</p>
        <p className="text-sm mb-6" style={{ color: C.faint }}>Create your first AI-generated industry project.</p>
        <Link href="/create/guided-project"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl text-sm font-semibold"
          style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-4 h-4" /> New Virtual Experience
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold" style={{ color: C.text }}>{gpForms.length} Virtual Experience{gpForms.length !== 1 ? 's' : ''}</p>
        <div className="flex items-center gap-2">
          {gpForms.length > 0 && (
            <button onClick={() => exportAllInSection(gpForms, 'virtual_experience', 'virtual_experiences_bulk')}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ background: C.pill, color: C.muted }}>
              <Download className="w-3.5 h-3.5" /> Export All
            </button>
          )}
          {SYNC_ENABLED && gpForms.length > 0 && (
            <PushAllButton
              items={gpForms.map(f => ({ type: 'virtual_experience', id: f.id }))}
              C={C}
            />
          )}
          <ImportButton
            types={['virtual_experience']}
            C={C}
            onImported={r => { window.location.href = `/create/guided-project?id=${r.id}`; }}
            onBulkDone={() => window.location.reload()}
          />
          <Link href="/create/guided-project"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold hover:opacity-80 transition-opacity"
            style={{ background: C.cta, color: C.ctaText }}>
            <Plus className="w-4 h-4" /> New
          </Link>
        </div>
      </div>
      {groupVEsByIndustry(gpForms).map(([industry, list]) => (
        <VEIndustryRow key={industry} industry={industry} forms={list}
          handleDuplicate={handleDuplicate} setFormToDelete={setFormToDelete} C={C}/>
      ))}
    </div>
  );
}
