'use client';

// Renders glossary-term definitions as a body-portaled tooltip.
//
// The glossary is a TipTap mark (plain DOM spans), not a node view, so it can't host
// its own React popover. A pure-CSS ::after tooltip also gets clipped by the lesson
// card's overflow (scroll / rounded corners). This component listens for hover/focus
// on any `.lesson-term` element via event delegation and portals a fixed, positioned
// tooltip to <body> -- never clipped, freely styled.
//
// Both LessonRenderer and LessonEditor mount it, and a page can show several lessons
// at once, so a module-level registry elects a single OWNER instance: only the owner
// attaches the document listeners and renders the portal. Ownership passes to the next
// instance when the owner unmounts (tracked via useSyncExternalStore).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowSquareOut, BookOpen } from '@phosphor-icons/react';

interface TipState {
  term: string;
  definition: string;
  pronunciation: string;
  example: string;
  learnMoreUrl: string;
  accent: string;
  x: number;
  y: number;
  placement: 'top' | 'bottom';
  dark: boolean;
}

const GAP = 10; // px between the term and the tooltip

function safeLearnMoreUrl(value: string) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

const registry: symbol[] = [];
const subscribers = new Set<() => void>();
function emitOwnership() { subscribers.forEach((cb) => cb()); }
function subscribeOwnership(cb: () => void) { subscribers.add(cb); return () => { subscribers.delete(cb); }; }

export function GlossaryTooltip() {
  const idRef = useRef<symbol | null>(null);
  if (idRef.current === null) idRef.current = Symbol('glossary-tooltip');
  const [tip, setTip] = useState<TipState | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }, []);

  const hideSoon = useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => setTip(null), 140);
  }, [cancelHide]);

  // Register for this instance's lifetime; recompute every instance's ownership on change.
  useEffect(() => {
    const id = idRef.current!;
    registry.push(id);
    emitOwnership();
    return () => {
      const i = registry.indexOf(id);
      if (i >= 0) registry.splice(i, 1);
      emitOwnership();
    };
  }, []);

  const isOwner = useSyncExternalStore(
    subscribeOwnership,
    () => registry[0] === idRef.current,
    () => false, // server: no tooltip
  );

  // Only the owner wires up the (single) set of document listeners.
  useEffect(() => {
    if (!isOwner) return undefined;
    const show = (el: HTMLElement) => {
      const def = el.getAttribute('data-definition');
      if (!def) return;
      cancelHide();
      const r = el.getBoundingClientRect();
      const placement: 'top' | 'bottom' = r.top > Math.min(260, window.innerHeight * 0.48) ? 'top' : 'bottom';
      const half = Math.min(180, (window.innerWidth - 16) / 2);
      const x = Math.min(Math.max(r.left + r.width / 2, half + 8), window.innerWidth - half - 8);
      setTip({
        term: el.textContent?.trim() || 'Definition',
        definition: def,
        pronunciation: el.getAttribute('data-pronunciation') || '',
        example: el.getAttribute('data-example') || '',
        learnMoreUrl: safeLearnMoreUrl(el.getAttribute('data-learn-more-url') || ''),
        accent: getComputedStyle(el).getPropertyValue('--lesson-accent-base').trim() || '#10b981',
        x,
        y: placement === 'top' ? r.top - GAP : r.bottom + GAP,
        placement,
        dark: !!el.closest('.lesson-content.dark'),
      });
    };
    const term = (t: EventTarget | null): HTMLElement | null =>
      t instanceof HTMLElement ? (t.closest('.lesson-term') as HTMLElement | null) : null;
    const onOver = (e: MouseEvent) => { const el = term(e.target); if (el) show(el); };
    const onOut = (e: MouseEvent) => { if (term(e.target)) hideSoon(); };
    const onFocus = (e: FocusEvent) => { const el = term(e.target); if (el) show(el); };
    const onBlur = (e: FocusEvent) => { if (term(e.target)) hideSoon(); };
    const hide = () => { cancelHide(); setTip(null); };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', onBlur);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      cancelHide();
      setTip(null); // clear when ownership is lost or on unmount
    };
  }, [cancelHide, hideSoon, isOwner]);

  if (!isOwner || !tip || typeof document === 'undefined') return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: tip.x,
        top: tip.y,
        transform: tip.placement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
        zIndex: 2000,
        pointerEvents: 'auto',
        '--lesson-accent-base': tip.accent,
      } as React.CSSProperties}
      onMouseEnter={cancelHide}
      onMouseLeave={hideSoon}
      onFocus={cancelHide}
      onBlur={hideSoon}
    >
      <div className="lesson-term-tip" data-placement={tip.placement} data-theme={tip.dark ? 'dark' : 'light'} role="tooltip">
        <div className="lesson-term-tip__head">
          <span className="lesson-term-tip__icon"><BookOpen weight="duotone" width={14} height={14} /></span>
          <span>
            <strong>{tip.term}</strong>
            {tip.pronunciation ? <small>{tip.pronunciation}</small> : null}
          </span>
        </div>
        <p>{tip.definition}</p>
        {tip.example ? <div className="lesson-term-tip__example"><span>Example</span>{tip.example}</div> : null}
        {tip.learnMoreUrl ? (
          <a href={tip.learnMoreUrl} target="_blank" rel="noopener noreferrer">Learn more <ArrowSquareOut weight="bold" width={11} height={11} /></a>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
