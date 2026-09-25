import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { validateApplicationForm, type ApplicationFormConfig, type ApplicationFormStatus } from '@/lib/application-forms';
import { appendApplicationAudit, getApplicationForm, listApplicationSubmissions, saveApplicationForm } from '@/lib/application-sheets';
import { newApplicationId } from '@/lib/application-access';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { id } = await context.params;
  try {
    const form = await getApplicationForm(id);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    if (auth.role === 'instructor' && form.ownerId !== auth.actor.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (auth.role === 'staff') {
      const assigned = (await listApplicationSubmissions(form.id)).some(item => item.assignedReviewerId === auth.actor.id);
      if (!assigned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ form });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || 'Could not load application form.' }, { status: 503 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { id } = await context.params;
  const body = await req.json().catch(() => null) as null | { config?: ApplicationFormConfig; status?: ApplicationFormStatus };
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  try {
    const form = await getApplicationForm(id);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    if (auth.role !== 'admin' && form.ownerId !== auth.actor.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const next = { ...form, config: body.config ?? form.config, status: body.status ?? form.status, updatedAt: new Date().toISOString() };
    const errors = validateApplicationForm(next.config, next.status);
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    await saveApplicationForm(next);
    await appendApplicationAudit({
      id: newApplicationId('audit'), entityType: 'form', entityId: form.id,
      action: body.status && body.status !== form.status ? `status:${body.status}` : 'updated',
      actorId: auth.actor.id, actorEmail: auth.actor.email ?? '', occurredAt: next.updatedAt,
      details: body.status && body.status !== form.status ? { from: form.status, to: body.status } : {},
    });
    return NextResponse.json({ form: next });
  } catch (error) {
    console.error('[application-forms/id/patch]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not update application form.' }, { status: 503 });
  }
}
