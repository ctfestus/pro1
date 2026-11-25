'use client';

// The one icon picker for lesson blocks: a search box, the icons in groups, and a "no icon"
// choice. `LessonIconPanel` sits inside a block's existing style menu; `LessonIconButton` opens it
// from its own button (step cards, timeline events, tabs, collapsible sections).
//
// Choices act on click, so Enter and Space work from the keyboard; mousedown only keeps the
// editor's selection where it was.

import { useMemo, useState } from 'react';
import { MagnifyingGlass, Shapes } from '@phosphor-icons/react';
import { LESSON_ICONS, LESSON_ICON_GROUPS, LESSON_ICON_KEYS, resolveLessonIconKey, type LessonIconKey } from '@/lib/lesson-icons';
import { LessonIcon, useLessonIconMap } from '@/components/lesson/LessonIcon';
import { StyleMenu } from '@/components/lesson/nodes/StyleControls';

const keepSelection = (e: React.MouseEvent) => e.preventDefault();

export function LessonIconPanel({ value, onChange, noneLabel = 'No icon', otherChoice = false, autoFocus = false }: {
  value: unknown;
  onChange: (key: LessonIconKey | '') => void;
  /** What the empty choice means for this block, e.g. "Match the style" on a callout. */
  noneLabel?: string;
  /** A choice outside the panel is in use (a flip card's own image), so nothing here is selected. */
  otherChoice?: boolean;
  /** Only when the panel is the whole popover; inside a bigger style menu it would steal focus. */
  autoFocus?: boolean;
}) {
  const { map } = useLessonIconMap();
  const [query, setQuery] = useState('');
  const selected = otherChoice ? null : resolveLessonIconKey(value);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = LESSON_ICON_KEYS.filter((key) => {
      if (!q) return true;
      const { label, words } = LESSON_ICONS[key];
      return `${key} ${label} ${words}`.toLowerCase().includes(q);
    });
    return LESSON_ICON_GROUPS
      .map((group) => ({ ...group, keys: matches.filter((key) => LESSON_ICONS[key].group === group.id) }))
      .filter((group) => group.keys.length);
  }, [query]);

  return (
    <div className="lesson-icon-picker">
      <div className="lesson-icon-picker__top">
        <label className="lesson-icon-picker__search">
          <MagnifyingGlass weight="bold" width={14} height={14} aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search icons"
            aria-label="Search icons"
            autoFocus={autoFocus}
          />
        </label>
        <button
          type="button"
          className="lesson-icon-picker__none"
          aria-pressed={selected === ''}
          data-active={selected === '' ? 'true' : 'false'}
          onMouseDown={keepSelection}
          onClick={() => onChange('')}
        >
          {noneLabel}
        </button>
      </div>
      <div className="lesson-icon-picker__list">
        {groups.map((group) => (
          <div key={group.id} className="lesson-icon-picker__group">
            <p className="lesson-icon-picker__group-name">{group.name}</p>
            <div className="lesson-icon-picker__grid">
              {group.keys.map((key) => {
                const Icon = map?.[key];
                return (
                  <button
                    key={key}
                    type="button"
                    className="lesson-icon-picker__icon"
                    title={LESSON_ICONS[key].label}
                    aria-label={LESSON_ICONS[key].label}
                    aria-pressed={key === selected}
                    data-active={key === selected ? 'true' : 'false'}
                    onMouseDown={keepSelection}
                    onClick={() => onChange(key)}
                  >
                    {Icon && <Icon weight="duotone" width={20} height={20} aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!groups.length && <p className="lesson-icon-picker__empty">No icon matches that search.</p>}
      </div>
    </div>
  );
}

/**
 * A small button showing the current icon (or a faint shape when there is none) that opens the
 * picker in a popover, and closes it once an icon is chosen.
 */
export function LessonIconButton({ value, onChange, className, title }: {
  value: unknown;
  onChange: (key: LessonIconKey | '') => void;
  className: string;
  /** What the icon is for, e.g. "Step icon"; the current icon's name is added to it. */
  title: string;
}) {
  const key = resolveLessonIconKey(value);
  return (
    <StyleMenu
      width={340}
      triggerClassName={className}
      triggerTitle={key ? `${title}: ${LESSON_ICONS[key].label}` : title}
      trigger={key
        ? <LessonIcon name={key} size={15} className="lesson-icon-btn__icon" />
        : <Shapes weight="duotone" width={15} height={15} aria-hidden="true" />}
    >
      {(close) => <LessonIconPanel value={key} autoFocus onChange={(next) => { onChange(next); close(); }} />}
    </StyleMenu>
  );
}
