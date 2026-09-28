import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { getApplicationSubmission } from '@/lib/application-submissions';
import { getApplicationForm } from '@/lib/application-form-store';
import { APPLICATION_UPLOAD_BUCKET, applicationFilePath } from '@/lib/application-storage';
import { adminClient } from '@/lib/admin-client';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string; questionId: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { id, questionId } = await context.params;
  try {
    const submission = await getApplicationSubmission(id);
    if (!submission) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    const form = await getApplicationForm(submission.formId);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    const canReview = auth.role === 'admin'
      || form.ownerId === auth.actor.id
      || submission.assignedReviewerId === auth.actor.id;
    if (!canReview) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const file = submission.answers[questionId];
    const path = file && typeof file === 'object' && !Array.isArray(file)
      ? applicationFilePath(file.publicId ?? '', form.id, submission.id, questionId)
      : null;
    if (!path) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    const { data, error } = await adminClient().storage.from(APPLICATION_UPLOAD_BUCKET)
      .createSignedUrl(path, 60);
    if (error || !data?.signedUrl) throw error ?? new Error('No download URL returned.');
    return NextResponse.json({ url: data.signedUrl }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[application-submission/file]', error);
    return NextResponse.json({ error: 'Could not open this file.' }, { status: 503 });
  }
}
