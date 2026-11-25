'use client';

import { useEffect, useState } from 'react';
import { resolveLessonIconKey, toolIconName } from '@/lib/lesson-icons';
import { useToolIcons } from '@/lib/use-tool-icons';

type IconMap = typeof import('@/components/lesson/lessonIconMap').LESSON_ICON_COMPONENTS;

// The icon set is one shared chunk, fetched the first time any lesson icon renders. A failed fetch
// is not kept, so the next icon to mount tries again.
let loaded: IconMap | null = null;
let loading: Promise<IconMap | null> | null = null;

export function useLessonIconMap(): { map: IconMap | null; failed: boolean } {
  const [map, setMap] = useState<IconMap | null>(loaded);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (map) return;
    let live = true;
    loading ??= import('@/components/lesson/lessonIconMap')
      .then((m) => (loaded = m.LESSON_ICON_COMPONENTS))
      .catch(() => { loading = null; return null; });
    void loading.then((m) => {
      if (!live) return;
      if (m) setMap(m); else setFailed(true);
    });
    return () => { live = false; };
  }, [map]);
  return { map, failed };
}

/** A tool's own logo, in its colours. Nothing (or `fallback`) when the tool has no logo. */
function ToolLogo({ name, size, className, fallback }: { name: string; size: number; className?: string; fallback: React.ReactNode }) {
  const toolIcon = useToolIcons();
  const src = toolIcon(name);
  if (!src) return <>{fallback}</>;
  return <img src={src} alt="" width={size} height={size} className={`lesson-tool-logo ${className ?? ''}`.trim()} draggable={false} />;
}

/**
 * A lesson icon by its stored key, in the duotone weight, or a tool's logo for a `tool:` value.
 * Renders nothing for an empty or unknown key, and an empty box of the same size while the set
 * loads so the layout does not jump. If the set cannot load, `fallback` shows instead (a
 * callout's own icon), or nothing.
 */
export function LessonIcon({ name, size = 18, className, fallback = null }: {
  name: unknown;
  size?: number;
  className?: string;
  fallback?: React.ReactNode;
}) {
  const key = resolveLessonIconKey(name);
  const { map, failed } = useLessonIconMap();
  if (!key) return null;
  const tool = toolIconName(key);
  if (tool) return <ToolLogo name={tool} size={size} className={className} fallback={fallback} />;
  if (failed) return <>{fallback}</>;
  const Icon = map?.[key as keyof typeof map];
  if (!Icon) return <span className={className} style={{ display: 'inline-block', width: size, height: size }} aria-hidden="true" />;
  return <Icon weight="duotone" width={size} height={size} className={className} aria-hidden="true" />;
}
