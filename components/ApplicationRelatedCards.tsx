'use client';

import { ArrowRight, BookOpen, CalendarDays } from 'lucide-react';
import type { ApplicationRelatedItem } from '@/lib/application-related';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { toPlainText } from '@/lib/plain-text';
import type { ThemeColors } from '@/lib/theme';

function itemLabel(item: ApplicationRelatedItem): string {
  if (item.type === 'event') return item.eventType === 'virtual' ? 'Virtual event' : item.eventType === 'in-person' ? 'In-person event' : 'Event';
  return item.category?.trim() || 'Course';
}

function itemMeta(item: ApplicationRelatedItem): string {
  if (item.type === 'event' && item.date) {
    const date = new Date(item.date);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return item.type === 'event' ? item.location?.trim() || 'View programme' : 'Explore course';
}

// Matches the platform's course cards (16:9 cover, content below). The confirmation page is
// only max-w-3xl wide, so two columns at most: three made each card a tall, narrow sliver.
export function ApplicationRelatedCards({ items, C }: { items: ApplicationRelatedItem[]; C: ThemeColors }) {
  return (
    <div className="grid grid-cols-1 gap-4 min-[520px]:grid-cols-2">
      {items.map(item => {
        const cover = resolveCoverUrl(item.coverImage);
        const description = toPlainText(item.description);
        const Icon = item.type === 'event' ? CalendarDays : BookOpen;
        return (
          <a key={`${item.type}:${item.id}`} href={`/${item.slug || item.id}`} className="group flex h-full flex-col overflow-hidden rounded-xl transition-transform duration-300 hover:-translate-y-0.5" style={{ background: C.input, color: C.text }}>
            <div className="relative aspect-video w-full overflow-hidden" style={{ background: C.pill }}>
              {cover
                ? <img src={cover} alt={`${item.title} cover`} loading="lazy" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                : <div className="grid h-full place-items-center"><span className="grid h-12 w-12 place-items-center rounded-xl" style={{ background: C.card, color: C.cta }}><Icon className="h-5 w-5" /></span></div>}
              <span className="absolute left-3 top-3 max-w-[calc(100%-1.5rem)] truncate rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: C.card, color: C.muted }}>{itemLabel(item)}</span>
            </div>
            <div className="flex flex-1 flex-col p-4">
              <h3 className="line-clamp-2 text-[15px] font-bold leading-snug" style={{ color: C.text }}>{item.title}</h3>
              {description && <p className="mt-1.5 line-clamp-2 text-xs leading-5" style={{ color: C.muted }}>{description}</p>}
              <div className="mt-auto flex items-center justify-between gap-3 pt-4">
                <span className="min-w-0 truncate text-xs font-semibold" style={{ color: C.muted }}>{itemMeta(item)}</span>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-transform group-hover:translate-x-0.5" style={{ background: C.accent, color: C.ctaText }}><ArrowRight className="h-4 w-4" /></span>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
