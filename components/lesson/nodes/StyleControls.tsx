'use client';

// Small, shared styling controls used inside interactive-block node views
// (image / callout / accordion). They appear only in the editor; the player just
// reflects the resulting attrs. Free color picking is intentional here -- authors
// style their own lesson content (the editor chrome itself stays on-brand).

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowCounterClockwise, DotsThree, DotsThreeVertical } from '@phosphor-icons/react';
import { useTheme } from '@/components/ThemeProvider';

const DEFAULT_SWATCH = '#10b981';

/** Native color picker with a reset-to-default control. Empty value = "use default". */
export function ColorField({ value, onChange, title = 'Color' }: {
  value?: string;
  onChange: (value: string) => void;
  title?: string;
}) {
  return (
    <span className="lesson-style__color" title={title}>
      <input
        type="color"
        value={value || DEFAULT_SWATCH}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={(e) => e.stopPropagation()}
        aria-label={title}
      />
      {value ? (
        <button
          type="button"
          className="lesson-style__color-reset"
          title="Reset to default"
          onMouseDown={(e) => { e.preventDefault(); onChange(''); }}
        >
          <ArrowCounterClockwise weight="bold" width={11} height={11} />
        </button>
      ) : null}
    </span>
  );
}

/** Compact segmented control for a small set of choices (align / size / border style). */
export function Segmented<T extends string>({ options, value, onChange, title }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  title?: string;
}) {
  return (
    <span className="lesson-style__seg" title={title}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-active={o.value === value ? 'true' : 'false'}
          onMouseDown={(e) => { e.preventDefault(); onChange(o.value); }}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/**
 * Inline style + class that give ONE block its own accent colour.
 *
 * Setting `--lesson-accent-base` alone is not enough: the derived shades (`--lesson-accent`,
 * `--lesson-accent-ink`, `--lesson-accent-ring`) are computed where they are declared, on
 * `.lesson-content`, so a descendant that overrides only the base keeps inheriting the
 * container's shades. `.lesson-accent-scope` re-declares the whole set from the local base
 * (see LessonContentStyles), which is why the class travels with the variable.
 *
 * Returns nothing when no colour is set, so an unstyled block is untouched and keeps following
 * the tenant accent.
 */
export function accentScope(color: string | undefined | null): { className: string; style: React.CSSProperties } {
  const value = (color || '').trim();
  if (!value) return { className: '', style: {} };
  return {
    className: 'lesson-accent-scope',
    style: { '--lesson-accent-base': value } as React.CSSProperties,
  };
}

export type BorderStyle = 'none' | 'solid' | 'dashed';

export const BORDER_STYLE_OPTIONS: { value: BorderStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'none', label: 'None' },
];

/** Inline border CSS from a block's borderStyle + borderColor attrs. */
export function borderCss(style: BorderStyle | undefined, color: string | undefined, fallbackColor: string): React.CSSProperties {
  if (style === 'none') return { border: 'none' };
  return { borderStyle: style || 'solid', borderWidth: 1, borderColor: color || fallbackColor };
}

/** A labeled row inside a StyleMenu popover. */
export function MenuRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="lesson-style-menu__row">
      <span className="lesson-style-menu__row-label">{label}</span>
      <div className="lesson-style-menu__row-control">{children}</div>
    </div>
  );
}

/**
 * A compact "..." trigger that opens a small floating formatting popover. Replaces
 * always-visible inline control bars so multiple blocks in a lesson stay uncluttered.
 * The panel is portaled to <body> (so a block's overflow:hidden can't clip it) and
 * carries `lesson-content` so the shared control styles still apply. Editor-only.
 */
export function StyleMenu({ children, width = 240, triggerLabel, accentColor, trigger, triggerClassName, triggerTitle }: {
  /** A function child gets `close`, for a menu that should shut once a choice is made. */
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  width?: number;
  triggerLabel?: string;
  accentColor?: string;
  /** Custom trigger content in place of the dots, with its own class and accessible name. */
  trigger?: React.ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
}) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Under the trigger, right-aligned to it and kept on screen. False once the trigger is out of view.
  const place = useCallback((): boolean => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r || r.bottom < 0 || r.top > window.innerHeight) return false;
    const panelWidth = Math.min(width, window.innerWidth - 16);
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - panelWidth, window.innerWidth - panelWidth - 8)) });
    return true;
  }, [width]);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (open) { setOpen(false); return; }
    place();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // The panel follows its trigger when the page or the editor scrolls (the editor can scroll on
    // the very click that opens it), and closes once the trigger has scrolled out of view.
    // Scrolling a list inside the panel moves nothing.
    const onMove = (e: Event) => {
      if (e.target instanceof globalThis.Node && panelRef.current?.contains(e.target)) return;
      if (!place()) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, place]);

  return (
    <span className="lesson-style-menu" contentEditable={false}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName || 'lesson-style-menu__trigger'}
        aria-label={triggerTitle || triggerLabel || 'Formatting options'}
        title={triggerTitle}
        data-open={open ? 'true' : 'false'}
        data-theme={dark ? 'dark' : 'light'}
        onMouseDown={toggle}
      >
        {trigger ?? (triggerLabel ? <><DotsThree weight="bold" width={15} height={15} /><span>{triggerLabel}</span></> : <DotsThreeVertical weight="bold" width={15} height={15} />)}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          className={`lesson-content lesson-style-menu__panel ${dark ? 'dark' : ''}`}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width, maxWidth: 'calc(100vw - 16px)', ...(accentColor ? { '--lesson-accent-base': accentColor } : {}) } as React.CSSProperties}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>,
        document.body,
      )}
    </span>
  );
}
