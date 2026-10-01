import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const [{ data: reviewers, error }, { data: courses }, { data: events }, { data: cohorts }, { data: feeSettings }] = await Promise.all([
    auth.serviceDb.from('students').select('id, email, full_name, role').in('role', ['admin', 'instructor', 'staff']).order('full_name').limit(500),
    auth.serviceDb.from('courses').select('id, title, slug, user_id, status, description, cover_image, category').eq('status', 'published').limit(500),
    auth.serviceDb.from('events').select('id, title, slug, user_id, status, description, cover_image, event_date, event_type, location').eq('status', 'published').limit(500),
    // Bootcamp cohorts an application form can admit into (not plan or legacy cohorts).
    auth.serviceDb.from('cohorts').select('id, name, start_date').eq('cohort_kind', 'bootcamp').neq('status', 'archived').order('start_date', { ascending: false }).limit(500),
    auth.serviceDb.from('cohort_payment_settings').select('cohort_id, total_fee, currency').limit(1000),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const items = [
    ...(courses ?? []).map(item => ({ ...item, type: 'course' as const })),
    ...(events ?? []).map(item => ({ ...item, type: 'event' as const })),
  ];
  const visible = auth.role === 'admin' ? items : items.filter(item => item.user_id === auth.actor.id);
  const fees = new Map((feeSettings ?? []).map(row => [row.cohort_id, row]));
  return NextResponse.json({
    reviewers: reviewers ?? [],
    // `ready` mirrors what admitting requires: a start date and a fee on the cohort.
    cohorts: (cohorts ?? []).map(cohort => {
      const fee = fees.get(cohort.id);
      return { id: cohort.id, name: cohort.name, startDate: cohort.start_date ?? '', ready: Boolean(cohort.start_date) && Number(fee?.total_fee) > 0 };
    }),
    relatedItems: visible.map(item => item.type === 'course'
      ? { id: item.id, title: item.title, slug: item.slug, type: item.type, description: item.description ?? '', coverImage: item.cover_image ?? '', category: item.category ?? '' }
      : { id: item.id, title: item.title, slug: item.slug, type: item.type, description: item.description ?? '', coverImage: item.cover_image ?? '', date: item.event_date ?? '', eventType: item.event_type ?? '', location: item.location ?? '' }),
  });
}
