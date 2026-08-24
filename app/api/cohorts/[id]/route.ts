import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase, role } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { id } = await params;

  const payload: Record<string, string | null> = {};
  if ('name' in body) {
    const name = String(body.name ?? '').trim();
    if (!name) return NextResponse.json({ error: 'Cohort name is required.' }, { status: 400 });
    payload.name = name;
  }
  if ('description' in body) payload.description = String(body.description ?? '').trim() || null;
  if ('start_date' in body) payload.start_date = body.start_date ? String(body.start_date) : null;
  if ('end_date' in body) payload.end_date = body.end_date ? String(body.end_date) : null;

  if (!Object.keys(payload).length) {
    return NextResponse.json({ error: 'No editable cohort fields provided.' }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from('cohorts')
    .select('id, created_by')
    .eq('id', id)
    .single();
  if (!existing) return NextResponse.json({ error: 'Cohort not found.' }, { status: 404 });
  if (role === 'instructor' && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await supabase
    .from('cohorts')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[api/cohorts] update error:', error.message);
    return NextResponse.json({ error: 'Failed to update cohort.' }, { status: 500 });
  }

  return NextResponse.json({ cohort: data });
}
