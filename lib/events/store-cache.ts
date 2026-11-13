import { revalidateTag } from 'next/cache';

/** Cache tag for the public events pages (lib/events/store.ts). */
export const EVENTS_STORE_TAG = 'events-store';

/**
 * Drop the cached events after an event is saved or deleted, so /events shows the
 * change straight away instead of within the minute. Best effort: outside a
 * Next request there is no cache to drop, and a failure here must never fail the save.
 */
export function refreshEventsStore(): void {
  try {
    revalidateTag(EVENTS_STORE_TAG);
  } catch {
    /* no request cache to drop */
  }
}
