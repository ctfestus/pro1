export const STUDENT_MODE_STORAGE_KEY = 'festman-student-mode';
export const STUDENT_MODE_HEADER = 'x-student-mode-session';

export interface StudentModeContext {
  sessionId: string;
  studentId: string;
  name: string;
  email: string;
  startedAt: string;
}

// Module state is isolated per browser tab. Local storage is only the handoff
// mechanism for links that open a course/player in a new tab.
let activeTabContext: StudentModeContext | null = null;

export function getStudentMode(): StudentModeContext | null {
  if (typeof window === 'undefined') return null;
  if (activeTabContext) return activeTabContext;
  try {
    const raw = window.localStorage.getItem(STUDENT_MODE_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StudentModeContext>;
    if (!value.sessionId || !value.studentId || !value.name || !value.email) {
      window.localStorage.removeItem(STUDENT_MODE_STORAGE_KEY);
      return null;
    }
    activeTabContext = {
      sessionId: value.sessionId,
      studentId: value.studentId,
      name: value.name,
      email: value.email,
      startedAt: value.startedAt || new Date().toISOString(),
    };
    return activeTabContext;
  } catch {
    return null;
  }
}

export function setStudentMode(context: Omit<StudentModeContext, 'startedAt'> & { startedAt?: string }) {
  if (typeof window === 'undefined') return;
  activeTabContext = {
    ...context,
    startedAt: context.startedAt || new Date().toISOString(),
  };
  window.localStorage.setItem(STUDENT_MODE_STORAGE_KEY, JSON.stringify(activeTabContext));
  window.dispatchEvent(new CustomEvent('student-mode-change'));
}

export function clearStudentMode() {
  if (typeof window === 'undefined') return;
  activeTabContext = null;
  window.localStorage.removeItem(STUDENT_MODE_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent('student-mode-change'));
}

/**
 * Adds the selected student to same-origin API requests made by student-facing
 * pages and players. The server still validates the authenticated actor and
 * target for every request; this header alone never grants access.
 */
export function installStudentModeFetchBridge(): () => void {
  if (typeof window === 'undefined') return () => {};
  const originalFetch = window.fetch;

  const bridgedFetch: typeof window.fetch = (input, init) => {
    const context = getStudentMode();
    if (!context) return originalFetch(input, init);

    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    let url: URL;
    try {
      url = new URL(rawUrl, window.location.origin);
    } catch {
      return originalFetch(input, init);
    }
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) {
      return originalFetch(input, init);
    }

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set(STUDENT_MODE_HEADER, context.sessionId);
    return originalFetch(input, { ...init, headers });
  };

  window.fetch = bridgedFetch;

  // Reassert this tab's context immediately before an internal link opens.
  // The newly opened tab can safely pick it up without changing the identity
  // already captured by any other open Student Mode tab.
  const handoffToNewTab = (event: MouseEvent) => {
    const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || !activeTabContext) return;
    try {
      const url = new URL(anchor.href, window.location.origin);
      if (url.origin === window.location.origin) {
        window.localStorage.setItem(STUDENT_MODE_STORAGE_KEY, JSON.stringify(activeTabContext));
      }
    } catch { /* ignore malformed links */ }
  };
  // If another tab clears Student Mode, drop this tab's cached context so its
  // fetches stop impersonating and handoffToNewTab cannot resurrect it.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STUDENT_MODE_STORAGE_KEY && !event.newValue) {
      activeTabContext = null;
    }
  };
  window.addEventListener('storage', onStorage);
  document.addEventListener('click', handoffToNewTab, true);
  return () => {
    if (window.fetch === bridgedFetch) window.fetch = originalFetch;
    document.removeEventListener('click', handoffToNewTab, true);
    window.removeEventListener('storage', onStorage);
  };
}
