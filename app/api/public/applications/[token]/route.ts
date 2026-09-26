import { NextRequest, NextResponse } from 'next/server';
import { formAvailability, publicApplicationForm, validateApplicationAnswers, type ApplicationAnswer } from '@/lib/application-forms';
import {
  appendApplicationAudit,
  getApplicationForm,
  getApplicationSubmissionByTokenHash,
  listApplicationSubmissions,
  saveApplicationSubmission,
} from '@/lib/application-sheets';
import { hashApplicationAccessToken, newApplicationId } from '@/lib/application-access';
import { resolveApplicationRelatedItems } from '@/lib/application-related';
import { sendApplicationConfirmationEmail } from '@/lib/application-email';

export const dynamic = 'force-dynamic';

async function resolve(token: string) {
  const submission = await getApplicationSubmissionByTokenHash(hashApplicationAccessToken(token));
  if (!submission) return null;
  const form = await getApplicationForm(submission.formId);
  return form ? { form, submission } : null;
}

function publicSubmission(form: NonNullable<Awaited<ReturnType<typeof getApplicationForm>>>, submission: NonNullable<Awaited<ReturnType<typeof getApplicationSubmissionByTokenHash>>>) {
  const stage = form.config.stages.find(item => item.id === submission.stageId);
  return {
    id: submission.id, reference: submission.reference, email: submission.email, state: submission.state,
    answers: submission.answers, submittedAt: submission.submittedAt,
    status: stage?.applicantLabel || stage?.name || 'Application received',
    updatedAt: submission.updatedAt,
  };
}

export async function GET(_req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    const found = await resolve(token);
    if (!found) return NextResponse.json({ error: 'This application link is invalid or expired.' }, { status: 404 });
    return NextResponse.json({
      form: publicApplicationForm(found.form), submission: publicSubmission(found.form, found.submission),
      relatedItems: found.submission.state === 'submitted' ? await resolveApplicationRelatedItems(found.form.config) : [],
    });
  } catch (error) {
    console.error('[public/applications/get]', error);
    return NextResponse.json({ error: 'This application is temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const body = await req.json().catch(() => null) as null | { answers?: Record<string, ApplicationAnswer> };
  if (!body?.answers || JSON.stringify(body.answers).length > 250_000) {
    return NextResponse.json({ error: 'The application answers are invalid or too large.' }, { status: 400 });
  }
  try {
    const found = await resolve(token);
    if (!found) return NextResponse.json({ error: 'This application link is invalid or expired.' }, { status: 404 });
    if (found.submission.state === 'submitted') return NextResponse.json({ error: 'This application has already been submitted.' }, { status: 409 });
    if (formAvailability(found.form) !== 'open') return NextResponse.json({ error: 'The application deadline has passed or the form is not open.' }, { status: 409 });
    const allowed = new Set(found.form.config.questions.map(item => item.id));
    const answers = Object.fromEntries(Object.entries(body.answers).filter(([id]) => allowed.has(id)));
    const errors = validateApplicationAnswers(found.form.config, answers);
    for (const question of found.form.config.questions.filter(item => item.type === 'file')) {
      const value = answers[question.id];
      if (value && typeof value === 'object' && !Array.isArray(value) && 'publicId' in value) {
        const prefix = `applications/${found.form.id}/${found.submission.id}/`;
        if (!String(value.publicId).startsWith(prefix)) errors[question.id] = 'Upload a valid file for this application.';
      }
    }
    if (Object.keys(errors).length) return NextResponse.json({ error: 'Complete the required questions.', errors }, { status: 400 });
    const duplicate = (await listApplicationSubmissions(found.form.id)).find(item =>
      item.id !== found.submission.id && item.email === found.submission.email && item.state === 'submitted');
    if (duplicate) return NextResponse.json({ error: 'An application has already been submitted for this email address.' }, { status: 409 });
    const now = new Date().toISOString();
    const firstStage = found.form.config.stages[0] ?? { id: 'submitted', name: 'Submitted' };
    const updated = {
      ...found.submission, answers, state: 'submitted' as const, stageId: firstStage.id,
      submittedAt: now, updatedAt: now,
      statusHistory: [...found.submission.statusHistory, {
        id: newApplicationId('status'), stageId: firstStage.id, stageName: firstStage.name,
        actorEmail: found.submission.email, occurredAt: now,
      }],
    };
    await saveApplicationSubmission(updated);
    await appendApplicationAudit({
      id: newApplicationId('audit'), entityType: 'submission', entityId: updated.id, action: 'submitted',
      actorId: '', actorEmail: updated.email, occurredAt: now, details: { formId: found.form.id, reference: updated.reference },
    });
    let emailSent = true;
    try {
      await sendApplicationConfirmationEmail({
        email: updated.email, formTitle: found.form.config.title, reference: updated.reference,
        token, confirmationMessage: found.form.config.confirmationMessage,
      });
    } catch (error) {
      emailSent = false;
      console.error('[public/applications/confirmation-email]', error);
    }
    return NextResponse.json({
      ok: true, emailSent, submission: publicSubmission(found.form, updated),
      relatedItems: await resolveApplicationRelatedItems(found.form.config),
    });
  } catch (error) {
    console.error('[public/applications/submit]', error);
    return NextResponse.json({ error: 'Could not submit this application.' }, { status: 503 });
  }
}
