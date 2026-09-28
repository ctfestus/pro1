import { createHash, randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { applicationFileContentType, applicationFileTypesLabel, formAvailability } from '@/lib/application-forms';
import { getApplicationForm } from '@/lib/application-form-store';
import { getApplicationSubmissionByTokenHash } from '@/lib/application-submissions';
import { hashApplicationAccessToken } from '@/lib/application-access';
import { APPLICATION_UPLOAD_BUCKET, APPLICATION_UPLOAD_MAX_BYTES, applicationQuestionFilePrefix } from '@/lib/application-storage';
import { adminClient } from '@/lib/admin-client';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

type UploadRequest = { questionId?: string; name?: string; size?: number; type?: string };

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const tokenHash = hashApplicationAccessToken(token);
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'File uploads are temporarily unavailable.' }, { status: 503 });
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const key = createHash('sha256').update(`${tokenHash}:${ip}`).digest('hex').slice(0, 32);
    const ipKey = createHash('sha256').update(ip).digest('hex').slice(0, 32);
    if (await bumpRateLimit(redis, `application-upload:${key}`, 20, 60 * 60)
      || await bumpRateLimit(redis, `application-upload-ip:${ipKey}`, 60, 60 * 60)) {
      return NextResponse.json({ error: 'Too many upload attempts. Please try again later.' }, { status: 429 });
    }
  } catch {
    return NextResponse.json({ error: 'File uploads are temporarily unavailable.' }, { status: 503 });
  }

  const submission = await getApplicationSubmissionByTokenHash(tokenHash).catch(() => null);
  if (!submission) return NextResponse.json({ error: 'This application link is invalid or expired.' }, { status: 404 });
  const form = await getApplicationForm(submission.formId).catch(() => null);
  if (!form || submission.state !== 'draft' || formAvailability(form) !== 'open'
    || Date.now() - new Date(submission.createdAt).getTime() > 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'This application is not accepting uploads.' }, { status: 409 });
  }

  const body = await req.json().catch(() => null) as UploadRequest | null;
  const question = form.config.questions.find(item => item.id === body?.questionId && item.type === 'file');
  if (!question || !body?.name || body.name.length > 180 || !Number.isInteger(body.size)) {
    return NextResponse.json({ error: 'Select a valid file question and file.' }, { status: 400 });
  }
  if (body.size! <= 0 || body.size! > APPLICATION_UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: 'Files must be 10 MB or smaller.' }, { status: 413 });
  }
  // The content type comes from the extension the question allows, not from the browser, so
  // the stored object always matches the bucket's allowed types and the submit-time check.
  const contentType = applicationFileContentType(question, body.name);
  if (!contentType) {
    return NextResponse.json({ error: `This question accepts ${applicationFileTypesLabel(question)} files only.` }, { status: 400 });
  }
  const extension = body.name.toLowerCase().split('.').pop() ?? '';

  const path = `${form.id}/${submission.id}/${applicationQuestionFilePrefix(question.id)}-${randomUUID()}.${extension}`;
  try {
    const { data, error } = await adminClient().storage.from(APPLICATION_UPLOAD_BUCKET).createSignedUploadUrl(path);
    if (error || !data?.token) throw error ?? new Error('No upload token returned.');
    return NextResponse.json({
      bucket: APPLICATION_UPLOAD_BUCKET,
      path,
      uploadToken: data.token,
      contentType,
      file: {
        url: '', publicId: `supabase/${path}`, name: body.name,
        size: body.size, type: contentType,
      },
    });
  } catch (error) {
    console.error('[public/application-upload]', error);
    return NextResponse.json({ error: 'Could not prepare this upload.' }, { status: 503 });
  }
}
