import { NextRequest, NextResponse } from 'next/server';
import { publicApplicationForm } from '@/lib/application-forms';
import { getApplicationSubmissionByTokenHash } from '@/lib/application-sheets';
import { getApplicationForm } from '@/lib/application-form-store';
import { hashApplicationAccessToken } from '@/lib/application-access';
import { resolveApplicationRelatedItems } from '@/lib/application-related';

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
