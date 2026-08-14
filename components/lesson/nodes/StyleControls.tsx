'use client';

// Small, shared styling controls used inside interactive-block node views
// (image / callout / accordion). They appear only in the editor; the player just
// reflects the resulting attrs. Free color picking is intentional here -- authors
// style their own lesson content (the editor chrome itself stays on-brand).

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, MoreHorizontal, MoreVertical } from 'lucide-react';
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
          <RotateCcw width={11} height={11} />
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
 * Grid of icon choices for a block that shows one. `value` empty means "use the block's default",
 * which the first option should represent so an author can always get back to it.
 */
export function IconPicker<T extends string>({ options, value, onChange }: {
  options: { value: T; label: string; Icon: React.ComponentType<{ width?: number; height?: number }> }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <span className="lesson-style__icons">
      {options.map((o) => (
        <button
          key={o.value || 'default'}
          type="button"
          title={o.label}
          aria-label={o.label}
          aria-pressed={o.value === value}
          data-active={o.value === value ? 'true' : 'false'}
          onMouseDown={(e) => { e.preventDefault(); onChange(o.value); }}
        >
          <o.Icon width={14} height={14} />
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
export function StyleMenu({ children, width = 240, triggerLabel, accentColor }: { children: React.ReactNode; width?: number; triggerLabel?: string; accentColor?: string }) {
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    if (open) { setOpen(false); return; }
    const r = triggerRef.current?.getBoundingClientRect();
    const panelWidth = Math.min(width, window.innerWidth - 16);
    if (r) setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - panelWidth, window.innerWidth - panelWidth - 8)) });
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
    const onMove = () => setOpen(false);
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
  }, [open]);

  return (
    <span className="lesson-style-menu" contentEditable={false}>
      <button
        ref={triggerRef}
        type="button"
        className="lesson-style-menu__trigger"
        aria-label={triggerLabel || 'Formatting options'}
        data-open={open ? 'true' : 'false'}
        data-theme={dark ? 'dark' : 'light'}
        onMouseDown={toggle}
      >
        {triggerLabel ? <><MoreHorizontal width={15} height={15} /><span>{triggerLabel}</span></> : <MoreVertical width={15} height={15} />}
      </button>
      {open && pos && createPortal(
        <div
          ref={panelRef}
          className={`lesson-content lesson-style-menu__panel ${dark ? 'dark' : ''}`}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width, maxWidth: 'calc(100vw - 16px)', ...(accentColor ? { '--lesson-accent-base': accentColor } : {}) } as React.CSSProperties}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {children}
        </div>,
        document.body,
      )}
    </span>
  );
}
