'use client';

// Open/close state for the grow-from-card hover previews (rendered by HoverPreviewCard in
// components/student/shared). Every carousel that had one carried its own copy of this logic,
// and each copy opened the moment the pointer touched a card -- so sweeping the mouse across a
// row on the way to something else flashed a large panel over every card it crossed. This is
// the one copy, with the behaviour all of them were missing:
//
// - Intent delay: the preview opens only once the pointer has rested on a card. While a preview
//   is already up, moving to the next card swaps it at once, so browsing a row stays quick.
// - Scrolling the page or the carousel, resizing the window, or pressing Escape closes it, so it
//   never floats away from the card it belongs to.
// - Hover-capable pointers only. On touch there is no hover to close it; the card is the way in.

import { useCallback, useEffect, useRef, useState } from 'react';

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 120;
const DEFAULT_WIDTH = 320;

export type HoverPreview<T> = {
  item: T;
  left: number;
  top: number;
  originX: number;
  originY: number;
  /** The width the placement was computed for. Pass it on to HoverPreviewCard so the two agree. */
  width: number;
};

/** Size estimate used for the first placement; HoverPreviewCard corrects top from the real height. */
export type HoverPreviewSize = { width?: number; height: number };

function place<T>(item: T, el: HTMLElement, { width = DEFAULT_WIDTH, height }: HoverPreviewSize): HoverPreview<T> {
  const r = el.getBoundingClientRect();
  const left = Math.max(12, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 12));
  const top  = Math.max(12, Math.min(r.top - 20, window.innerHeight - height - 12));
  // Grow from the hovered card: transform-origin = the card's center relative to the popover box
  const originX = Math.max(0, Math.min(r.left + r.width / 2 - left, width));
  const originY = Math.max(0, Math.min(r.top + r.height / 2 - top, height));
  return { item, left, top, originX, originY, width };
}

export function useHoverPreview<T>() {
  const [hover, setHover] = useState<HoverPreview<T> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside the timers and handlers, which would otherwise see a stale `hover`.
  const isOpen = useRef(false);

  const clearOpen = useCallback(() => {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null; }
  }, []);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  }, []);

  const close = useCallback(() => {
    clearOpen();
    cancelClose();
    isOpen.current = false;
    setHover(null);
  }, [clearOpen, cancelClose]);

  /** Card mouseleave / popover mouseleave: close after a short grace, unless the pointer arrives. */
  const scheduleClose = useCallback(() => {
    clearOpen();
    cancelClose();
    closeTimer.current = setTimeout(close, CLOSE_DELAY_MS);
  }, [clearOpen, cancelClose, close]);

  /** Card mouseenter. */
  const open = useCallback((item: T, el: HTMLElement, size: HoverPreviewSize) => {
    if (typeof window === 'undefined' || !window.matchMedia('(hover: hover)').matches) return;
    cancelClose();
    clearOpen();
    const show = () => {
      openTimer.current = null;
      isOpen.current = true;
      // Measured when it opens, not when the pointer arrived: the card may have moved since.
      setHover(place(item, el, size));
    };
    if (isOpen.current) show();
    else openTimer.current = setTimeout(show, OPEN_DELAY_MS);
  }, [cancelClose, clearOpen]);

  const showing = hover !== null;
  useEffect(() => {
    if (!showing) return;
    const onScroll = (e: Event) => {
      // A preview taller than the screen scrolls inside itself; that is not the page moving.
      if (e.target instanceof Element && e.target.closest('[data-hover-preview]')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    // Capture, so a carousel's own horizontal scroll is caught as well as the page's.
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [showing, close]);

  useEffect(() => () => { clearOpen(); cancelClose(); }, [clearOpen, cancelClose]);

  return { hover, open, scheduleClose, cancelClose, close };
}
