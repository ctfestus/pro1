'use client';

// The Content section of a cohort: every course, path, experience and assignment with a switch
// that puts it in the cohort or takes it out.

import { useState } from 'react';
import type { ThemeColors } from '@/lib/theme';
import { accessToken } from '../subscriptions/api';
import { Switch } from '../subscriptions/PlanForm';
import { Card, Pill, palette } from '../subscriptions/ui';
import { ConfirmModal } from './CohortModals';
import { SearchBox } from './StudentsTab';
import { CONTENT_TYPES, type ContentType } from './shared';

export type ContentItem = { id: string; title: string; status: string; cohort_ids: string[] | null; available_to_everyone?: boolean; _type: ContentType };

export function ContentTab({ cohort, items, onChanged, notify, C }: {
  cohort: any;
  items: ContentItem[];
  /** Applies the saved change to the page's copy of the item. */
  onChanged: (item: ContentItem, patch: Partial<ContentItem>) => void;
  notify: (ok: boolean, text: string) => void;
  C: ThemeColors;
}) {
  const P = palette(C);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'all' | ContentType>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ item: ContentItem; question: string } | null>(null);
  const term = search.trim().toLowerCase();
  const shown = items.filter((i) => (type === 'all' || i._type === type) && (!term || (i.title ?? '').toLowerCase().includes(term)));
  const inCohort = (i: ContentItem) => Array.isArray(i.cohort_ids) && i.cohort_ids.includes(cohort.id);
  const assigned = items.filter(inCohort).length;

  async function toggle(item: ContentItem, confirmRestriction = false) {
    const already = inCohort(item);
    const table = CONTENT_TYPES[item._type].table;
    setBusyId(item.id);
    try {
      const res = await fetch('/api/cohort-content-assignment', {
        method: already ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await accessToken()}` },
        body: JSON.stringify({ contentId: item.id, contentTable: table, cohortId: cohort.id, confirmRestriction }),
      });
      const json = await res.json().catch(() => ({}));
      // The server asks first when adding a course to a cohort would take it away from everyone else.
      if (res.status === 409 && json.requiresConfirmation) { setAsk({ item, question: json.error }); return; }
      if (!res.ok) { notify(false, json.error || (already ? 'Failed to remove from cohort.' : 'Failed to add to cohort.')); return; }
      const ids = item.cohort_ids ?? [];
      const next = already ? ids.filter((id) => id !== cohort.id) : Array.isArray(json.cohortIds) ? json.cohortIds : [...ids, cohort.id];
      onChanged(item, { cohort_ids: next, ...(table === 'courses' && !already ? { available_to_everyone: false } : {}) });
      if (json.notifyError) notify(false, json.notifyError);
      else notify(true, `${item.title || 'Untitled'} ${already ? 'removed from' : 'added to'} ${cohort.name}`);
    } catch {
      notify(false, 'Network error. Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  const chips: ['all' | ContentType, string][] = [['all', 'All'], ...(Object.keys(CONTENT_TYPES) as ContentType[]).map((t): [ContentType, string] => [t, CONTENT_TYPES[t].plural])];

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Search content" C={C} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
          {chips.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={type === id} onClick={() => setType(id)} className="h-8 px-3 rounded-full text-xs font-semibold"
              style={type === id ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <Card C={C} className="overflow-hidden">
        {shown.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>{items.length ? 'No content matches.' : 'No content yet.'}</p>
        ) : shown.map((item, i) => {
          const on = inCohort(item);
          const published = item.status === 'published';
          return (
            <div key={`${item._type}-${item.id}`} className="flex flex-wrap items-center gap-3 px-5 py-4" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="text-sm font-semibold truncate" style={{ color: published ? C.text : C.muted }}>{item.title || 'Untitled'}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="text-xs px-2 rounded-lg leading-5" style={{ background: C.pill, color: C.muted }}>{CONTENT_TYPES[item._type].label}</span>
                  {!published && <Pill tone="warn" C={C}>Draft</Pill>}
                  {item._type === 'course' && item.available_to_everyone === true && <span className="text-xs px-2 rounded-lg leading-5" style={{ background: C.pill, color: C.muted }}>Everyone</span>}
                </div>
              </div>
              <span className="flex items-center gap-3 text-xs" style={{ color: C.muted }}>
                {!published ? 'Publish it first' : busyId === item.id ? 'Saving...' : on ? 'In cohort' : 'Not in cohort'}
                <span style={!published || busyId === item.id ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
                  <Switch on={on} onChange={() => toggle(item)} label={`${item.title || 'Untitled'} in ${cohort.name}`} C={C} />
                </span>
              </span>
            </div>
          );
        })}
      </Card>
      {items.length > 0 && (
        <p className="text-xs" style={{ color: C.muted }}>{assigned} of {items.length} in this cohort. Switching one on gives every learner in the cohort access straight away.</p>
      )}
      {ask && (
        <ConfirmModal
          title="Limit this course to cohorts?"
          eyebrow={ask.item.title}
          body={ask.question}
          action="Add to cohort"
          onClose={() => setAsk(null)}
          onConfirm={() => { const item = ask.item; setAsk(null); toggle(item, true); }}
          C={C}
        />
      )}
    </div>
  );
}
