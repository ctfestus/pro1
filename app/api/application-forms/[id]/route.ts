import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { validateApplicationForm, type ApplicationFormConfig, type ApplicationFormStatus } from '@/lib/application-forms';
import { deleteApplicationForm, getApplicationForm, listApplicationForms, saveApplicationForm } from '@/lib/application-form-store';
import { appendApplicationAudit, countSubmittedApplicationsByForm, listApplicationFormIdsForReviewer, listApplicationSubmissions } from '@/lib/application-submissions';
import { newApplicationId } from '@/lib/application-access';
import { countApplicationFormFiles, deleteApplicationFormFiles } from '@/lib/application-storage';

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
      const assigned = (await listApplicationFormIdsForReviewer(auth.actor.id)).includes(form.id);
      if (!assigned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (new URL(req.url).searchParams.get('deleteImpact') === '1') {
      if (auth.role === 'staff') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      const [submissions, fileCount] = await Promise.all([
        listApplicationSubmissions(id),
        countApplicationFormFiles(id),
      ]);
      return NextResponse.json({ form, deletionImpact: { submissionCount: submissions.length, fileCount } });
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
  const body = await req.json().catch(() => null) as null | { config?: ApplicationFormConfig; slug?: string; status?: ApplicationFormStatus; replacedQuestions?: boolean };
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  try {
    const form = await getApplicationForm(id);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    if (auth.role !== 'admin' && form.ownerId !== auth.actor.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const slug = body.slug?.trim() ?? form.slug;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 64) {
      return NextResponse.json({ error: 'The registration URL must use lowercase letters, numbers, and single hyphens only.' }, { status: 400 });
    }
    if (slug !== form.slug) {
      const taken = (await listApplicationForms()).some(item => item.id !== form.id && item.slug === slug);
      if (taken) return NextResponse.json({ error: 'That registration URL is already in use.' }, { status: 409 });
    }
    const next = { ...form, slug, config: body.config ?? form.config, status: body.status ?? form.status, updatedAt: new Date().toISOString() };
    const errors = validateApplicationForm(next.config, next.status);
    if (errors.length) return NextResponse.json({ error: errors[0], errors }, { status: 400 });
    if (body.config && body.replacedQuestions === true) {
      // The builder only offers Replace on a form with no applications, but its count was read
      // when the forms list loaded. Recheck now, so an application that arrived meanwhile never
      // loses its questions to a replace. Deleting single questions is unaffected.
      const nextQuestionIds = new Set(next.config.questions.map(question => question.id));
      const removesQuestions = form.config.questions.some(question => !nextQuestionIds.has(question.id));
      if (removesQuestions && ((await countSubmittedApplicationsByForm([id]))[id] ?? 0) > 0) {
        return NextResponse.json({ error: 'This form has received applications, so its questions cannot be replaced. Reload the form, then import again and add the questions to the end instead.' }, { status: 409 });
      }
    }
    if (body.config) {
      const nextStageIds = new Set(next.config.stages.map(stage => stage.id));
      const removedStages = form.config.stages.filter(stage => !nextStageIds.has(stage.id));
      if (removedStages.length) {
        const submissions = await listApplicationSubmissions(id);
        for (const stage of removedStages) {
          const count = submissions.filter(item => item.stageId === stage.id).length;
          if (count) {
            return NextResponse.json({ error: `${count} applicant${count === 1 ? ' is' : 's are'} in ${stage.name}. Move them first.` }, { status: 409 });
          }
        }
      }
    }
    await saveApplicationForm(next);
    const details = {
      ...(body.status && body.status !== form.status ? { from: form.status, to: body.status } : {}),
      ...(slug !== form.slug ? { fromSlug: form.slug, toSlug: slug } : {}),
    };
    try {
      await appendApplicationAudit({
        id: newApplicationId('audit'), entityType: 'form', entityId: form.id,
        action: body.status && body.status !== form.status ? `status:${body.status}` : 'updated',
        actorId: auth.actor.id, actorEmail: auth.actor.email ?? '', occurredAt: next.updatedAt,
        details,
      });
    } catch (error) {
      console.error('[application-forms/id/audit]', error);
    }
    return NextResponse.json({ form: next });
  } catch (error) {
    console.error('[application-forms/id/patch]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not update application form.' }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const { id } = await context.params;
  try {
    const form = await getApplicationForm(id);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    if (auth.role !== 'admin' && form.ownerId !== auth.actor.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const submissionCount = (await listApplicationSubmissions(id)).length;
    try {
      await appendApplicationAudit({
        id: newApplicationId('audit'), entityType: 'form', entityId: form.id,
        action: 'deleted', actorId: auth.actor.id, actorEmail: auth.actor.email ?? '', occurredAt: new Date().toISOString(),
        details: { title: form.config.title, slug: form.slug, submissionCount },
      });
    } catch (error) {
      console.error('[application-forms/id/delete-audit]', error);
    }
    const deleted = await deleteApplicationForm(id);
    if (!deleted) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    let uploadsRemoved = true;
    try {
      await deleteApplicationFormFiles(id);
    } catch (error) {
      uploadsRemoved = false;
      console.error('[application-forms/id/delete-uploads]', error);
    }
    return NextResponse.json({ deleted: true, submissionCount, uploadsRemoved });
  } catch (error) {
    console.error('[application-forms/id/delete]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not delete application form.' }, { status: 503 });
  }
}
