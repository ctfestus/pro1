import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const [{ data: reviewers, error }, { data: courses }, { data: events }] = await Promise.all([
    auth.serviceDb.from('students').select('id, email, full_name, role').in('role', ['admin', 'instructor', 'staff']).order('full_name').limit(500),
    auth.serviceDb.from('courses').select('id, title, slug, user_id, status, description, cover_image, category').eq('status', 'published').limit(500),
    auth.serviceDb.from('events').select('id, title, slug, user_id, status, description, cover_image, event_date, event_type, location').eq('status', 'published').limit(500),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const items = [
    ...(courses ?? []).map(item => ({ ...item, type: 'course' as const })),
    ...(events ?? []).map(item => ({ ...item, type: 'event' as const })),
  ];
  const visible = auth.role === 'admin' ? items : items.filter(item => item.user_id === auth.actor.id);
  return NextResponse.json({
    reviewers: reviewers ?? [],
    relatedItems: visible.map(item => item.type === 'course'
      ? { id: item.id, title: item.title, slug: item.slug, type: item.type, description: item.description ?? '', coverImage: item.cover_image ?? '', category: item.category ?? '' }
      : { id: item.id, title: item.title, slug: item.slug, type: item.type, description: item.description ?? '', coverImage: item.cover_image ?? '', date: item.event_date ?? '', eventType: item.event_type ?? '', location: item.location ?? '' }),
  });
}
