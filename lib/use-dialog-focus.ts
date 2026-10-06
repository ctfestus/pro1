'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard behaviour for a modal dialog: focus moves into it when it opens, Tab and Shift+Tab
 * stay inside it, Escape closes it, and focus returns to whatever opened it once it closes.
 * `returnFocus` names a fallback for when the opener has gone, such as an item in a menu that
 * closed as the dialog opened.
 */
export function useDialogFocus(dialogRef: RefObject<HTMLElement | null>, onClose: () => void, returnFocus?: () => HTMLElement | null) {
  // Latest callbacks, read by the listener below without re-running the focus setup.
  const closeRef = useRef(onClose);
  const returnRef = useRef(returnFocus);
  useEffect(() => {
    closeRef.current = onClose;
    returnRef.current = returnFocus;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(element => element.offsetParent !== null);
    (focusable()[0] ?? dialog)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab' || !dialog) return;
      const items = focusable();
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || !dialog.contains(active))) { event.preventDefault(); first.focus(); }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // The opener may be inside a menu that has since closed; only refocus what is still there.
      if (opener?.isConnected && opener !== document.body) opener.focus();
      else returnRef.current?.()?.focus();
    };
  }, [dialogRef]);
}
