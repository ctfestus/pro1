import { adminClient } from '@/lib/admin-client';
import type { ApplicationFormConfig } from '@/lib/application-forms';

export interface ApplicationRelatedItem {
  id: string;
  title: string;
  slug: string;
  type: 'course' | 'event';
  description: string;
  coverImage: string;
  category?: string;
  date?: string;
  eventType?: string;
  location?: string;
}

export async function resolveApplicationRelatedItems(config: ApplicationFormConfig): Promise<ApplicationRelatedItem[]> {
  const ids = config.postSubmission?.type === 'events' ? (config.postSubmission.relatedEventIds ?? []) : [];
  if (!ids.length) return [];
  const db = adminClient();
  const [{ data: courses }, { data: events }] = await Promise.all([
    db.from('courses').select('id, title, slug, status, description, cover_image, category').in('id', ids),
    db.from('events').select('id, title, slug, status, description, cover_image, event_date, event_type, location').in('id', ids),
  ]);
  const combined: ApplicationRelatedItem[] = [
    ...(courses ?? []).filter(item => item.status === 'published').map(item => ({
      id: item.id, title: item.title, slug: item.slug, type: 'course' as const,
      description: item.description ?? '', coverImage: item.cover_image ?? '', category: item.category ?? '',
    })),
    ...(events ?? []).filter(item => item.status === 'published').map(item => ({
      id: item.id, title: item.title, slug: item.slug, type: 'event' as const,
      description: item.description ?? '', coverImage: item.cover_image ?? '', date: item.event_date ?? '',
      eventType: item.event_type ?? '', location: item.location ?? '',
    })),
  ];
  return combined.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
}
