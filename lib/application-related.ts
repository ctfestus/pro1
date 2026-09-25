import { adminClient } from '@/lib/admin-client';
import type { ApplicationFormConfig } from '@/lib/application-forms';

export interface ApplicationRelatedItem {
  id: string;
  title: string;
  slug: string;
  type: 'course' | 'event';
}

export async function resolveApplicationRelatedItems(config: ApplicationFormConfig): Promise<ApplicationRelatedItem[]> {
  const ids = config.postSubmission?.type === 'events' ? (config.postSubmission.relatedEventIds ?? []) : [];
  if (!ids.length) return [];
  const db = adminClient();
  const [{ data: courses }, { data: events }] = await Promise.all([
    db.from('courses').select('id, title, slug, status').in('id', ids),
    db.from('events').select('id, title, slug, status').in('id', ids),
  ]);
  const combined: ApplicationRelatedItem[] = [
    ...(courses ?? []).filter(item => item.status === 'published').map(item => ({ id: item.id, title: item.title, slug: item.slug, type: 'course' as const })),
    ...(events ?? []).filter(item => item.status === 'published').map(item => ({ id: item.id, title: item.title, slug: item.slug, type: 'event' as const })),
  ];
  return combined.sort((left, right) => ids.indexOf(left.id) - ids.indexOf(right.id));
}
