import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { getApplicationSubmission, getApplicationUploadsFolderId } from '@/lib/application-sheets';
import { getApplicationForm } from '@/lib/application-form-store';
import { getGoogleDriveClient } from '@/lib/sheets';

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
    const prefix = `drive/${form.id}/${submission.id}/`;
    if (!file || typeof file !== 'object' || Array.isArray(file) || !file.publicId?.startsWith(prefix)) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }
    const fileId = file.publicId.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    const drive = getGoogleDriveClient();
    const folderId = await getApplicationUploadsFolderId(form);
    const metadata = await drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: 'id,name,size,mimeType,parents,appProperties,trashed',
    });
    if (metadata.data.trashed
      || !metadata.data.parents?.includes(folderId)
      || metadata.data.appProperties?.applicationFormId !== form.id
      || metadata.data.appProperties?.applicationSubmissionId !== submission.id) {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }
    const media = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' });
    const body = new Uint8Array(media.data as ArrayBuffer);
    const safeName = String(file.name || metadata.data.name || 'application-file').replace(/[\r\n"\\]/g, '_');
    return new NextResponse(body, {
      headers: {
        'Content-Type': metadata.data.mimeType || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('[application-submission/file]', error);
    return NextResponse.json({ error: 'Could not open this file.' }, { status: 503 });
  }
}
