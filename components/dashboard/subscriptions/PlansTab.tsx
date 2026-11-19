'use client';

import { useState, type ReactNode } from 'react';
import {
  Archive, Award, BookOpen, Briefcase, Check, ChevronDown, FileSpreadsheet, Layers3, Pencil, Plus, Route, Search,
  ShieldCheck, Star, Tag, Trash2,
} from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import {
  Card, DISPLAY_FONT, IconChip, Lines, Pill, btnClass, btnSmClass, btnStyle, palette, plural,
} from './ui';
import type { PlanSummary } from './types';

const TYPES: { table: string; label: string; plural: string; icon: ReactNode }[] = [
  { table: 'courses', label: 'Course', plural: 'Courses', icon: <BookOpen className="w-4 h-4" /> },
  { table: 'virtual_experiences', label: 'Virtual experience', plural: 'Virtual experiences', icon: <Briefcase className="w-4 h-4" /> },
  { table: 'certifications', label: 'Certification', plural: 'Certifications', icon: <Award className="w-4 h-4" /> },
  { table: 'learning_paths', label: 'Learning path', plural: 'Learning paths', icon: <Route className="w-4 h-4" /> },
];

function planStatus(plan: any, C: ThemeColors) {
  if (plan.archived_at) return <Pill tone="mute" C={C}>Archived</Pill>;
  if (plan.status !== 'active') return <Pill tone="mute" dot C={C}>Draft</Pill>;
  return <Pill tone="good" dot C={C}>On sale</Pill>;
}

export function PlansTab({
  C, summaries, selectedPlan, onSelect, showArchived, setShowArchived, busy, menuOpen, setMenuOpen,
  onCreate, onEdit, onToggle, onBulk, onRecommend, onArchive, onDelete,
  planContent, contentOptions, selectedContentKeys, setSelectedContentKeys, toggleContentKey, contentSearch, setContentSearch, onSaveContent,
}: {
  C: ThemeColors;
  summaries: PlanSummary[];
  selectedPlan: any;
  onSelect: (plan: any) => void;
  showArchived: boolean;
  setShowArchived: (value: boolean) => void;
  busy: boolean;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  onCreate: () => void;
  onEdit: (plan: any) => void;
  onToggle: (plan: any) => void;
  onBulk: (plan: any) => void;
  onRecommend: (plan: any, recommended: boolean) => void;
  onArchive: (plan: any, archived: boolean) => void;
  onDelete: (plan: any) => void;
  planContent: any[];
  contentOptions: any[];
  selectedContentKeys: string[];
  setSelectedContentKeys: (update: (current: string[]) => string[]) => void;
  toggleContentKey: (key: string) => void;
  contentSearch: string;
  setContentSearch: (value: string) => void;
  onSaveContent: () => void;
}) {
  const P = palette(C);
  const [pickerOpen, setPickerOpen] = useState(false);
  const archivedCount = summaries.filter(({ plan }) => plan.archived_at).length;
  const listed = summaries.filter(({ plan }) => showArchived || !plan.archived_at);
  const summary = selectedPlan ? summaries.find(({ plan }) => plan.id === selectedPlan.id) : undefined;
  const plan = summary?.plan;

  const titles = new Map(contentOptions.map((item) => [`${item.content_table}:${item.id}`, item.title]));
  const savedKeys = planContent.map((item) => `${item.content_table}:${item.content_id}`);
  const unchanged = selectedContentKeys.length === savedKeys.length && selectedContentKeys.every((key) => savedKeys.includes(key));
  const saveDisabled = busy || new Set(selectedContentKeys).size !== selectedContentKeys.length || unchanged;

  const menuItems: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean; title?: string; danger?: boolean }[] = plan ? [
    {
      label: plan.status === 'active' ? 'Deactivate plan' : 'Activate plan',
      icon: <ShieldCheck className="w-4 h-4" />,
      onClick: () => onToggle(plan),
      // Archived means put away. Switching it back on here would put it on sale while it stays hidden.
      disabled: busy || !!plan.archived_at,
      title: plan.archived_at ? 'Restore this plan before switching it back on.' : undefined,
    },
    {
      label: 'Bulk add students',
      icon: <FileSpreadsheet className="w-4 h-4" />,
      onClick: () => onBulk(plan),
      disabled: busy || plan.status !== 'active',
    },
    {
      label: plan.recommended ? 'Remove best value' : 'Mark as best value',
      icon: <Star className="w-4 h-4" />,
      onClick: () => onRecommend(plan, !plan.recommended),
      // Only a plan visitors can actually see: inactive keeps it off the pricing page as surely as archived.
      disabled: busy || (!plan.recommended && (!!plan.archived_at || plan.status !== 'active')),
      title: plan.archived_at
        ? 'An archived plan is not shown to visitors.'
        : plan.status !== 'active' ? 'Activate this plan before marking it as best value.' : undefined,
    },
    {
      label: plan.archived_at ? 'Restore plan' : 'Archive plan',
      icon: <Archive className="w-4 h-4" />,
      onClick: () => onArchive(plan, !plan.archived_at),
      disabled: busy || (!plan.archived_at && plan.status === 'active'),
      title: !plan.archived_at && plan.status === 'active'
        ? 'Deactivate this plan first, so nobody loses a plan that is still on sale.'
        : undefined,
    },
    { label: 'Delete plan', icon: <Trash2 className="w-4 h-4" />, onClick: () => onDelete(plan), disabled: busy, danger: true },
  ] : [];

  return (
    <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
      <div className="grid gap-2">
        {listed.map((item) => {
          const selected = item.plan.id === selectedPlan?.id;
          return (
            <button
              key={item.plan.id}
              type="button"
              onClick={() => { setPickerOpen(false); onSelect(item.plan); }}
              aria-current={selected}
              className="grid gap-2 p-4 rounded-2xl text-left"
              style={{ background: C.card, boxShadow: selected ? `inset 0 0 0 2px ${C.cta}` : 'none' }}
            >
              <span className="flex items-center gap-2 flex-wrap text-sm font-bold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>
                {item.plan.name}
                {item.plan.recommended && <Pill tone="gold" C={C}>Best Value</Pill>}
              </span>
              <span className="text-xs" style={{ color: C.muted }}>
                {item.priceCount ? `${item.priceText}, ${plural(item.priceCount, 'price')}` : item.priceText}
              </span>
              <span className="flex flex-wrap gap-2">
                {planStatus(item.plan, C)}
                {item.offer && <Pill tone="warn" C={C}>{item.offer}</Pill>}
                <Pill tone="mute" C={C}>{item.live} active</Pill>
              </span>
            </button>
          );
        })}
        {summaries.length === 0 && (
          <Card C={C}><p className="p-4 text-sm" style={{ color: C.muted }}>No plans yet. Create one to start selling access.</p></Card>
        )}
        <button type="button" onClick={onCreate} className={btnClass} style={btnStyle('sec', C)}>
          <Plus className="w-4 h-4" />
          Create plan
        </button>
        {archivedCount > 0 && (
          <label className="flex items-center gap-2 px-1 py-1 text-xs" style={{ color: C.muted }}>
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            Show archived plans ({archivedCount})
          </label>
        )}
      </div>

      <Card C={C} className="min-w-0">
        {!summary || !plan ? (
          <div className="min-h-[320px] grid place-items-center p-8 text-center">
            <div>
              <div className="flex justify-center"><IconChip color={C.cta} background={P.ctaSoft}><Layers3 className="w-4 h-4" /></IconChip></div>
              <p className="text-sm font-semibold mt-3" style={{ color: C.text }}>Select a plan to manage it</p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3 p-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-[22px] leading-7 font-bold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{plan.name}</h3>
                  {plan.recommended && <Pill tone="gold" C={C}>Best Value</Pill>}
                  {planStatus(plan, C)}
                  {!summary.priceCount || !planContent.length ? <Pill tone="warn" C={C}>Needs setup</Pill> : null}
                </div>
                <p className="text-sm mt-1" style={{ color: C.muted }}>{plan.description || 'No description has been added yet.'}</p>
              </div>
              <div className="relative flex items-center gap-2">
                <button type="button" onClick={() => onEdit(plan)} disabled={busy} className={btnSmClass} style={btnStyle('sec', C)}>
                  <Pencil className="w-4 h-4" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setMenuOpen(!menuOpen)}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                  className={btnSmClass}
                  style={btnStyle('sec', C)}
                >
                  More
                  <ChevronDown className="w-4 h-4" />
                </button>
                {menuOpen && (
                  <>
                    <button type="button" aria-label="Close plan actions" className="fixed inset-0 z-[70] cursor-default" onClick={() => setMenuOpen(false)} />
                    <div
                      role="menu"
                      className="absolute right-0 top-10 z-[75] w-64 rounded-2xl p-2 grid"
                      style={{ background: C.card, boxShadow: `0 12px 32px rgba(16,24,40,0.16), 0 0 0 1px ${C.divider}` }}
                    >
                      {menuItems.map((item) => (
                        <button
                          key={item.label}
                          type="button"
                          role="menuitem"
                          onClick={item.onClick}
                          disabled={item.disabled}
                          title={item.title}
                          className="w-full flex items-center gap-3 rounded-xl px-2 py-2 text-left text-sm font-semibold disabled:opacity-50"
                          style={{ color: item.danger ? P.bad : C.text }}
                        >
                          <IconChip color={item.danger ? P.bad : C.cta} background={item.danger ? P.badSoft : P.ctaSoft}>{item.icon}</IconChip>
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
              {[
                [String(summary.live), 'Active subscribers'],
                [summary.priceCount ? summary.priceText.replace(/^From /, '') : '--', 'Starting price'],
                [String(planContent.length), 'Items included'],
              ].map(([value, label], index) => (
                <div key={label} className="px-4 sm:px-5 py-4 min-w-0" style={index ? { borderLeft: `1px solid ${C.divider}` } : undefined}>
                  <b className="block text-base sm:text-[22px] leading-6 sm:leading-7 font-bold tabular-nums break-words" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{value}</b>
                  <span className="block text-xs" style={{ color: C.muted }}>{label}</span>
                </div>
              ))}
            </div>

            {summary.offerDetail && (
              <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
                <IconChip color={P.warn} background={P.warnSoft}><Tag className="w-4 h-4" /></IconChip>
                <Lines C={C} title={summary.offerDetail} sub="Shown on the pricing page, course pages and My Plan" />
                <button type="button" onClick={() => onEdit(plan)} disabled={busy} className={btnSmClass} style={btnStyle('ghost', C)}>Edit offer</button>
              </div>
            )}

            <div className="px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <h4 className="text-sm font-bold" style={{ color: C.text }}>Prices</h4>
                <button type="button" onClick={() => onEdit(plan)} className="text-xs font-semibold" style={{ color: C.cta }}>Edit prices</button>
              </div>
              {summary.prices.length ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {summary.prices.map((price) => (
                    <div key={price.id} className="rounded-xl p-3" style={{ background: C.page }}>
                      <p className="text-xs" style={{ color: C.muted }}>{price.duration}</p>
                      <p className="text-[22px] leading-7 font-bold tabular-nums" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{price.now}</p>
                      {price.list
                        ? <s className="text-xs" style={{ color: C.faint }}>{price.list}</s>
                        : <span className="text-xs" style={{ color: C.muted }}>Full price</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs" style={{ color: P.warn }}>No price yet. Add a price before publishing.</p>
              )}
            </div>

            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <h4 className="text-sm font-bold" style={{ color: C.text }}>Included content ({planContent.length})</h4>
                <button type="button" onClick={() => setPickerOpen(!pickerOpen)} className={btnSmClass} style={btnStyle('ghost', C)}>
                  {pickerOpen ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  {pickerOpen ? 'Done' : 'Add or remove'}
                </button>
              </div>

              {!pickerOpen && (
                planContent.length ? (
                  <div className="grid md:grid-cols-2 gap-2">
                    {planContent.map((item) => {
                      const type = TYPES.find((row) => row.table === item.content_table);
                      return (
                        <div key={`${item.content_table}:${item.content_id}`} className="flex items-center gap-3 rounded-xl p-3" style={{ background: C.page }}>
                          <IconChip color={C.cta} background={P.ctaSoft}>{type?.icon ?? <Layers3 className="w-4 h-4" />}</IconChip>
                          <Lines
                            C={C}
                            title={<span className="truncate">{titles.get(`${item.content_table}:${item.content_id}`) ?? 'Unpublished item'}</span>}
                            sub={type?.label ?? 'Content'}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs" style={{ color: C.muted }}>Nothing is included yet. Use Add or remove to choose content.</p>
                )
              )}

              {pickerOpen && (
                <div className="grid gap-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <label
                      className="flex items-center gap-2 h-10 px-3 rounded-xl flex-1"
                      style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: C.faint }}
                    >
                      <Search className="w-4 h-4 flex-shrink-0" />
                      <input
                        value={contentSearch}
                        onChange={(event) => setContentSearch(event.target.value)}
                        placeholder="Search published content"
                        className="bg-transparent outline-none text-sm w-full"
                        style={{ color: C.text }}
                      />
                    </label>
                    <span className="text-xs font-semibold" style={{ color: C.muted }}>{selectedContentKeys.length} selected</span>
                    <button type="button" onClick={onSaveContent} disabled={saveDisabled} className={btnClass} style={btnStyle('pri', C)}>
                      <Check className="w-4 h-4" />
                      {busy ? 'Saving' : 'Save selection'}
                    </button>
                  </div>
                  <p className="text-xs" style={{ color: C.muted }}>Select several items, then save once. Changes apply to every subscriber.</p>
                  {TYPES.map((type) => {
                    const items = contentOptions.filter((item) =>
                      item.content_table === type.table
                      && (!contentSearch || item.title.toLowerCase().includes(contentSearch.toLowerCase())));
                    if (!items.length) return null;
                    const groupKeys = items.map((item) => `${item.content_table}:${item.id}`);
                    const allSelected = groupKeys.every((key) => selectedContentKeys.includes(key));
                    return (
                      <div key={type.table}>
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold" style={{ color: C.muted }}>
                            {type.plural}, {groupKeys.filter((key) => selectedContentKeys.includes(key)).length} of {items.length} selected
                          </p>
                          <button
                            type="button"
                            onClick={() => setSelectedContentKeys((current) =>
                              allSelected ? current.filter((key) => !groupKeys.includes(key)) : [...new Set([...current, ...groupKeys])])}
                            className="text-xs font-semibold"
                            style={{ color: C.cta }}
                          >
                            {allSelected ? 'Clear group' : 'Select all'}
                          </button>
                        </div>
                        <div className="grid md:grid-cols-2 gap-2">
                          {items.map((item) => {
                            const key = `${item.content_table}:${item.id}`;
                            const selected = selectedContentKeys.includes(key);
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => toggleContentKey(key)}
                                aria-pressed={selected}
                                className="flex items-center gap-3 rounded-xl px-3 py-3 text-left"
                                style={{ background: selected ? P.ctaSoft : C.page, boxShadow: selected ? `inset 0 0 0 1px ${C.cta}` : 'none' }}
                              >
                                <span
                                  className="w-5 h-5 rounded-full flex-shrink-0 grid place-items-center"
                                  style={{ background: selected ? C.cta : C.card, border: `1px solid ${selected ? C.cta : C.divider}` }}
                                >
                                  {selected && <Check className="w-3 h-3" style={{ color: '#ffffff' }} />}
                                </span>
                                <span className="text-sm font-semibold truncate" style={{ color: C.text }}>{item.title}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {contentOptions.length === 0 && (
                    <p className="text-sm py-6 text-center" style={{ color: C.muted }}>No published content is available.</p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
