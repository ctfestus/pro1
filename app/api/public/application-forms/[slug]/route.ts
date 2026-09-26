import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  formAvailability,
  publicApplicationForm,
  validateApplicationAnswers,
  type ApplicationAnswer,
  type ApplicationFormRecord,
  type ApplicationSubmissionRecord,
} from '@/lib/application-forms';
import {
  appendApplicationAudit,
  getApplicationFormBySlug,
  getApplicationSubmissionByTokenHash,
  listApplicationSubmissions,
  saveApplicationSubmission,
} from '@/lib/application-sheets';
import {
  hashApplicationAccessToken,
  newApplicationAccessToken,
  newApplicationId,
  newApplicationReference,
} from '@/lib/application-access';
import { sendApplicationConfirmationEmail } from '@/lib/application-email';
import { resolveApplicationRelatedItems } from '@/lib/application-related';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type PublicActionBody = {
  action?: 'session' | 'submit';
  email?: string;
  answers?: Record<string, ApplicationAnswer>;
  sessionToken?: string;
};

function clientKey(req: NextRequest, email: string): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return createHash('sha256').update(`${ip}:${email}`).digest('hex').slice(0, 32);
}

function availabilityError(form: ApplicationFormRecord): string | null {
  const availability = formAvailability(form);
  if (availability === 'open') return null;
  if (availability === 'not_open') return 'Applications have not opened yet.';
  if (availability === 'paused') return 'This application form is temporarily paused.';
  return 'Applications are closed.';
}

function newDraft(form: ApplicationFormRecord, email: string, tokenHash: string): ApplicationSubmissionRecord {
  const now = new Date().toISOString();
  return {
    id: newApplicationId('submission'),
    formId: form.id,
    reference: newApplicationReference(),
    email,
    state: 'draft',
    stageId: form.config.stages[0]?.id ?? 'submitted',
    assignedReviewerId: '',
    assignedReviewerEmail: '',
    score: null,
    createdAt: now,
    updatedAt: now,
    submittedAt: '',
    tokenHash,
    answers: {},
    privateNotes: [],
    statusHistory: [],
    messages: [],
  };
}

function publicSubmission(form: ApplicationFormRecord, submission: ApplicationSubmissionRecord) {
  const stage = form.config.stages.find(item => item.id === submission.stageId);
  return {
    id: submission.id,
    reference: submission.reference,
    email: submission.email,
    state: submission.state,
    answers: submission.answers,
    submittedAt: submission.submittedAt,
    status: stage?.applicantLabel || stage?.name || 'Application received',
    updatedAt: submission.updatedAt,
  };
}

export async function GET(_req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const form = await getApplicationFormBySlug(slug);
    if (!form || !['published', 'paused', 'closed'].includes(form.status)) {
      return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    }
    return NextResponse.json({ form: publicApplicationForm(form) });
  } catch (error) {
    console.error('[public/application-form/get]', error);
    return NextResponse.json({ error: 'This application form is temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await req.json().catch(() => null) as PublicActionBody | null;
  const action = body?.action ?? 'submit';
  const email = body?.email?.trim().toLowerCase() ?? '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (action === 'submit' && (!body?.answers || JSON.stringify(body.answers).length > 250_000)) {
    return NextResponse.json({ error: 'The application answers are invalid or too large.' }, { status: 400 });
  }

  const redis = getRedis();
  if (redis) {
    try {
      const limited = await bumpRateLimit(redis, `application-submit:${clientKey(req, email)}`, 10, 60 * 15);
      if (limited) return NextResponse.json({ error: 'Too many attempts. Please try again later.' }, { status: 429 });
    } catch {
      return NextResponse.json({ error: 'Applications are temporarily unavailable.' }, { status: 503 });
    }
  }

  try {
    const form = await getApplicationFormBySlug(slug);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    const unavailable = availabilityError(form);
    if (unavailable) return NextResponse.json({ error: unavailable }, { status: 409 });

    const allSubmissions = await listApplicationSubmissions(form.id);
    const duplicate = allSubmissions.find(item => item.email === email && item.state === 'submitted');
    if (duplicate) {
      return NextResponse.json({ error: 'An application has already been submitted for this email address.' }, { status: 409 });
    }

    if (action === 'session') {
      const token = newApplicationAccessToken();
      const submission = newDraft(form, email, hashApplicationAccessToken(token));
      await saveApplicationSubmission(submission);
      return NextResponse.json({ ok: true, token });
    }

    let token = body?.sessionToken?.trim() ?? '';
    let submission = token
      ? await getApplicationSubmissionByTokenHash(hashApplicationAccessToken(token))
      : null;
    if (!submission || submission.formId !== form.id || submission.state !== 'draft') {
      token = newApplicationAccessToken();
      submission = newDraft(form, email, hashApplicationAccessToken(token));
    }

    const allowed = new Set(form.config.questions.map(item => item.id));
    const answers = Object.fromEntries(Object.entries(body!.answers!).filter(([id]) => allowed.has(id)));
    const errors = validateApplicationAnswers(form.config, answers);
    for (const question of form.config.questions.filter(item => item.type === 'file')) {
      const value = answers[question.id];
      if (value && typeof value === 'object' && !Array.isArray(value) && 'publicId' in value) {
        const prefix = `applications/${form.id}/${submission.id}/`;
        if (!String(value.publicId).startsWith(prefix)) errors[question.id] = 'Upload a valid file for this application.';
      }
    }
    if (Object.keys(errors).length) {
      return NextResponse.json({ error: 'Complete the required questions.', errors }, { status: 400 });
    }

    const now = new Date().toISOString();
    const firstStage = form.config.stages[0] ?? { id: 'submitted', name: 'Submitted' };
    const submitted: ApplicationSubmissionRecord = {
      ...submission,
      email,
      answers,
      state: 'submitted',
      stageId: firstStage.id,
      submittedAt: now,
      updatedAt: now,
      statusHistory: [...submission.statusHistory, {
        id: newApplicationId('status'),
        stageId: firstStage.id,
        stageName: firstStage.name,
        actorEmail: email,
        occurredAt: now,
      }],
    };
    await saveApplicationSubmission(submitted);
    await appendApplicationAudit({
      id: newApplicationId('audit'),
      entityType: 'submission',
      entityId: submitted.id,
      action: 'submitted',
      actorId: '',
      actorEmail: email,
      occurredAt: now,
      details: { formId: form.id, reference: submitted.reference },
    });

    let emailSent = true;
    try {
      await sendApplicationConfirmationEmail({
        email,
        formTitle: form.config.title,
        reference: submitted.reference,
        token,
        confirmationMessage: form.config.confirmationMessage,
        baseUrl: new URL(req.url).origin,
      });
    } catch (error) {
      emailSent = false;
      console.error('[public/application-form/confirmation-email]', error);
    }

    return NextResponse.json({
      ok: true,
      emailSent,
      token,
      submission: publicSubmission(form, submitted),
      postSubmission: form.config.postSubmission,
      relatedItems: await resolveApplicationRelatedItems(form.config),
    });
  } catch (error) {
    console.error('[public/application-form/submit]', error);
    return NextResponse.json({ error: 'Could not submit this application.' }, { status: 503 });
  }
}
