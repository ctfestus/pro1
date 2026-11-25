'use client';

import { useEffect, useState } from 'react';
import { resolveLessonIconKey } from '@/lib/lesson-icons';

type IconMap = typeof import('@/components/lesson/lessonIconMap').LESSON_ICON_COMPONENTS;

// The icon set is one shared chunk, fetched the first time any lesson icon renders.
let loaded: IconMap | null = null;
let loading: Promise<IconMap> | null = null;

export function useLessonIconMap(): IconMap | null {
  const [map, setMap] = useState<IconMap | null>(loaded);
  useEffect(() => {
    if (map) return;
    let live = true;
    loading ??= import('@/components/lesson/lessonIconMap').then((m) => (loaded = m.LESSON_ICON_COMPONENTS));
    void loading.then((m) => { if (live) setMap(m); });
    return () => { live = false; };
  }, [map]);
  return map;
}

/**
 * A lesson icon by its stored key, in the duotone weight. Renders nothing for an empty or unknown
 * key, and an empty box of the same size while the set loads so the layout does not jump.
 */
export function LessonIcon({ name, size = 18, className }: { name: unknown; size?: number; className?: string }) {
  const key = resolveLessonIconKey(name);
  const map = useLessonIconMap();
  if (!key) return null;
  const Icon = map?.[key];
  if (!Icon) return <span className={className} style={{ display: 'inline-block', width: size, height: size }} aria-hidden="true" />;
  return <Icon weight="duotone" width={size} height={size} className={className} aria-hidden="true" />;
}
