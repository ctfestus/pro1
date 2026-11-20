'use client';

// Choosing what a plan unlocks. Shared by step 2 of Create plan and the Plans tab.

import { useState, type ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { CONTENT_TYPES } from './drafts';
import { palette } from './ui';

export function ContentPicker({ options, selected, onChange, aside, note, empty, C }: {
  /** Published items, each with content_table, id and title. */
  options: any[];
  /** Chosen items as "table:id" keys. */
  selected: string[];
  onChange: (next: string[]) => void;
  /** Shown beside the search box, such as a count and a save button. */
  aside?: ReactNode;
  /** A line of help under the search box. */
  note?: string;
  /** Shown when there is nothing published to choose from. */
  empty: string;
  C: ThemeColors;
}) {
  const P = palette(C);
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();

  return (
    <div className="grid gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <label className="flex items-center gap-2 h-10 px-3 rounded-xl flex-1" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: C.faint }}>
          <Search className="w-4 h-4 flex-shrink-0" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search published content"
            className="bg-transparent outline-none text-sm w-full"
            style={{ color: C.text }}
          />
        </label>
        {aside}
      </div>
      {note && <p className="text-xs" style={{ color: C.muted }}>{note}</p>}
      {CONTENT_TYPES.map((type) => {
        const items = options.filter((item) => item.content_table === type.value && (!term || String(item.title).toLowerCase().includes(term)));
        if (!items.length) return null;
        const groupKeys = items.map((item) => `${item.content_table}:${item.id}`);
        const allSelected = groupKeys.every((key) => selected.includes(key));
        return (
          <div key={type.value}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold" style={{ color: C.muted }}>
                {type.plural}, {groupKeys.filter((key) => selected.includes(key)).length} of {items.length} selected
              </p>
              <button
                type="button"
                onClick={() => onChange(allSelected ? selected.filter((key) => !groupKeys.includes(key)) : [...new Set([...selected, ...groupKeys])])}
                className="text-xs font-semibold"
                style={{ color: C.text }}
              >
                {allSelected ? 'Clear group' : 'Select all'}
              </button>
            </div>
            <div className="rounded-xl overflow-hidden" style={{ background: C.page }}>
              {items.map((item, index) => {
                const key = `${item.content_table}:${item.id}`;
                const on = selected.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onChange(on ? selected.filter((value) => value !== key) : [...selected, key])}
                    aria-pressed={on}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left"
                    style={{ background: on ? P.ctaSoft : 'transparent', borderTop: index ? `1px solid ${C.divider}` : undefined }}
                  >
                    <span className="w-5 h-5 rounded-full flex-shrink-0 grid place-items-center" style={{ background: on ? P.sel : C.card, border: `1px solid ${on ? P.sel : C.divider}` }}>
                      {on && <Check className="w-3 h-3" style={{ color: P.onSel }} />}
                    </span>
                    <span className="text-sm font-semibold truncate" style={{ color: C.text }}>{item.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {options.length === 0 && <p className="text-sm py-6 text-center" style={{ color: C.muted }}>{empty}</p>}
    </div>
  );
}
