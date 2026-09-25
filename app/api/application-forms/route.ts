import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import {
  newApplicationFormConfig,
  slugifyApplicationTitle,
  validateApplicationForm,
  type ApplicationFormConfig,
  type ApplicationTemplateKey,
} from '@/lib/application-forms';
import {
  appendApplicationAudit,
  listApplicationForms,
  listApplicationSubmissions,
  saveApplicationForm,
} from '@/lib/application-sheets';
import { newApplicationId } from '@/lib/application-access';

export const dynamic = 'force-dynamic';

async function uniqueSlug(seed: string): Promise<string> {
  const base = slugifyApplicationTitle(seed);
  const existing = new Set((await listApplicationForms()).map(form => form.slug));
  if (!existing.has(base)) return base;
  for (let index = 2; index < 1000; index += 1) {
    if (!existing.has(`${base}-${index}`)) return `${base}-${index}`;
  }
  return `${base}-${Date.now()}`;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  try {
    const forms = await listApplicationForms();
    if (auth.role === 'admin') return NextResponse.json({ forms });
    if (auth.role === 'instructor') return NextResponse.json({ forms: forms.filter(form => form.ownerId === auth.actor.id) });
    const assignedFormIds = new Set((await listApplicationSubmissions())
      .filter(item => item.assignedReviewerId === auth.actor.id)
      .map(item => item.formId));
    return NextResponse.json({ forms: forms.filter(form => assignedFormIds.has(form.id)) });
  } catch (error) {
    console.error('[application-forms/get]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not load application forms.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const body = await req.json().catch(() => null) as null | {
    template?: ApplicationTemplateKey;
    sourceId?: string;
    config?: ApplicationFormConfig;
  };
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  try {
    const all = await listApplicationForms();
    const source = body.sourceId ? all.find(form => form.id === body.sourceId) : null;
    if (body.sourceId && !source) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    if (source && auth.role !== 'admin' && source.ownerId !== auth.actor.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const config = body.config ?? (source
      ? { ...structuredClone(source.config), title: `${source.config.title} copy` }
      : newApplicationFormConfig(body.template ?? 'bootcamp'));
    const errors = validateApplicationForm(config);
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    const now = new Date().toISOString();
    const form = {
      id: newApplicationId('form'), ownerId: auth.actor.id, ownerEmail: auth.actor.email ?? '',
      slug: await uniqueSlug(config.title), status: 'draft' as const, createdAt: now, updatedAt: now, config,
    };
    await saveApplicationForm(form);
    await appendApplicationAudit({
      id: newApplicationId('audit'), entityType: 'form', entityId: form.id,
      action: source ? 'duplicated' : 'created', actorId: auth.actor.id,
      actorEmail: auth.actor.email ?? '', occurredAt: now, details: source ? { sourceId: source.id } : { template: body.template ?? 'custom' },
    });
    return NextResponse.json({ form });
  } catch (error) {
    console.error('[application-forms/post]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not create application form.' }, { status: 503 });
  }
}
