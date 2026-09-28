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

export function ApplicationRelatedCards({ items, C }: { items: ApplicationRelatedItem[]; C: ThemeColors }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(item => {
        const cover = resolveCoverUrl(item.coverImage);
        const description = toPlainText(item.description);
        const Icon = item.type === 'event' ? CalendarDays : BookOpen;
        return (
          <a key={`${item.type}:${item.id}`} href={`/${item.slug || item.id}`} className="group block overflow-hidden rounded-xl" style={{ background: C.input, color: C.text }}>
            <div className="relative h-40 overflow-hidden sm:h-52" style={{ background: C.pill }}>
              {cover
                ? <img src={cover} alt={`${item.title} cover`} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                : <div className="grid h-full place-items-center"><span className="grid h-14 w-14 place-items-center rounded-2xl" style={{ background: C.card, color: C.cta }}><Icon className="h-6 w-6" /></span></div>}
              <span className="absolute left-4 top-4 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ background: C.card, color: C.muted }}>{itemLabel(item)}</span>
            </div>
            <div className="p-4 sm:p-5">
              <h3 className="text-base font-bold leading-6 sm:text-lg" style={{ color: C.text }}>{item.title}</h3>
              {description && <p className="mt-2 line-clamp-2 text-sm leading-6" style={{ color: C.muted }}>{description}</p>}
              <div className="mt-4 flex items-center justify-between gap-3 rounded-xl px-3 py-2.5" style={{ background: C.card }}>
                <span className="text-xs font-semibold" style={{ color: C.muted }}>{itemMeta(item)}</span>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-transform group-hover:translate-x-0.5" style={{ background: C.accent, color: C.ctaText }}><ArrowRight className="h-4 w-4" /></span>
              </div>
            </div>
          </a>
        );
      })}
    </div>
  );
}
