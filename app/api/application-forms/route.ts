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
  listApplicationForms,
  saveApplicationForm,
} from '@/lib/application-form-store';
import { appendApplicationAudit, countSubmittedApplicationsByForm, listApplicationFormIdsForReviewer } from '@/lib/application-submissions';
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
    const all = await listApplicationForms();
    let forms = all;
    if (auth.role === 'instructor') forms = all.filter(form => form.ownerId === auth.actor.id);
    if (auth.role === 'staff') {
      const assignedFormIds = new Set(await listApplicationFormIdsForReviewer(auth.actor.id));
      forms = all.filter(form => assignedFormIds.has(form.id));
    }
    // Counts are a convenience for the list; a failure here must not hide the forms.
    let submissionCounts: Record<string, number> | undefined;
    try {
      submissionCounts = await countSubmittedApplicationsByForm(forms.map(form => form.id), auth.role === 'staff' ? auth.actor.id : undefined);
    } catch (error) {
      console.error('[application-forms/get/counts]', error);
    }
    return NextResponse.json({ forms, ...(submissionCounts ? { submissionCounts } : {}) });
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
    try {
      await appendApplicationAudit({
        id: newApplicationId('audit'), entityType: 'form', entityId: form.id,
        action: source ? 'duplicated' : 'created', actorId: auth.actor.id,
        actorEmail: auth.actor.email ?? '', occurredAt: now, details: source ? { sourceId: source.id } : { template: body.template ?? 'custom' },
      });
    } catch (error) {
      console.error('[application-forms/create-audit]', error);
    }
    return NextResponse.json({ form });
  } catch (error) {
    console.error('[application-forms/post]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not create application form.' }, { status: 503 });
  }
}
