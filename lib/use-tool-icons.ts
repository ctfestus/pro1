'use client';

/**
 * Read access to the merged tool-icon set: the uploaded rows (table `tool_icons`) layered over
 * the built-in defaults.
 *
 * One fetch per page load, shared by every consumer through a module-level cache. Tool logos are
 * decoration on five different surfaces, several of which render many at once -- a per-component
 * fetch would mean a burst of identical requests for a handful of 16-pixel images.
 *
 * A failed read is never fatal: consumers fall back to the built-in defaults, so a logo can go
 * missing but a page cannot break, and the next mount retries.
 */
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_TOOL_ICONS, resolveToolIcon } from '@/lib/tool-icons';

type IconMap = Record<string, string>;

let cache: IconMap | null = null;
let inFlight: Promise<IconMap> | null = null;
const listeners = new Set<(icons: IconMap) => void>();

function load(): Promise<IconMap> {
  if (cache) return Promise.resolve(cache);
  if (!inFlight) {
    inFlight = fetch('/api/tool-icons')
      .then(res => (res.ok ? res.json() : { icons: [] }))
      .then(({ icons }) => {
        const merged: IconMap = { ...DEFAULT_TOOL_ICONS };
        for (const row of icons ?? []) {
          if (row?.name && row?.image) merged[row.name] = row.image;
        }
        cache = merged;
        listeners.forEach(notify => notify(merged));
        return merged;
      })
      .catch(() => {
        // Clear the in-flight promise rather than caching the failure, so the next mount tries
        // again instead of showing defaults for the rest of the session.
        inFlight = null;
        return DEFAULT_TOOL_ICONS;
      });
  }
  return inFlight;
}

/**
 * Drop the cache after the set changes, and refetch immediately if anything is listening, so
 * a mounted surface shows the new logo rather than the old one until it happens to remount.
 */
export function refreshToolIcons() {
  cache = null;
  inFlight = null;
  if (listeners.size) void load();
}

/**
 * Returns a lookup: pass the typed tool name, get a deliverable icon URL or undefined.
 *
 * Renders with the defaults immediately and re-renders once the uploaded set arrives, so a page
 * never waits on a decorative image to show its content.
 */
export function useToolIcons(): (name: string) => string | undefined {
  const icons = useToolIconMap();
  return useCallback((name: string) => resolveToolIcon(icons, name), [icons]);
}

/**
 * The whole set, for the one caller that needs to OFFER tools rather than draw one: a picker has
 * to know what exists. Everywhere else wants the lookup above.
 */
export function useToolIconMap(): IconMap {
  const [icons, setIcons] = useState<IconMap>(cache ?? DEFAULT_TOOL_ICONS);

  useEffect(() => {
    let alive = true;
    const notify = (next: IconMap) => { if (alive) setIcons(next); };
    listeners.add(notify);
    load().then(notify);
    return () => { alive = false; listeners.delete(notify); };
  }, []);

  return icons;
}
