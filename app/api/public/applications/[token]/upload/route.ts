import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { formAvailability } from '@/lib/application-forms';
import { getApplicationForm } from '@/lib/application-form-store';
import { getApplicationSubmissionByTokenHash, getApplicationUploadsFolderId } from '@/lib/application-sheets';
import { hashApplicationAccessToken } from '@/lib/application-access';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';
import { getGoogleDriveClient } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'webp', 'zip']);

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const tokenHash = hashApplicationAccessToken(token);
  const redis = getRedis();
  if (!redis) return NextResponse.json({ error: 'File uploads are temporarily unavailable.' }, { status: 503 });
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const key = createHash('sha256').update(`${tokenHash}:${ip}`).digest('hex').slice(0, 32);
    if (await bumpRateLimit(redis, `application-upload:${key}`, 20, 60 * 60)) {
      return NextResponse.json({ error: 'Too many upload attempts. Please try again later.' }, { status: 429 });
    }
  } catch {
    return NextResponse.json({ error: 'File uploads are temporarily unavailable.' }, { status: 503 });
  }
  const submission = await getApplicationSubmissionByTokenHash(tokenHash).catch(() => null);
  if (!submission) return NextResponse.json({ error: 'This application link is invalid or expired.' }, { status: 404 });
  const form = await getApplicationForm(submission.formId).catch(() => null);
  if (!form || submission.state === 'submitted' || formAvailability(form) !== 'open') {
    return NextResponse.json({ error: 'This application is not accepting uploads.' }, { status: 409 });
  }
  const data = await req.formData();
  const file = data.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'Select a file to upload.' }, { status: 400 });
  if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'Files must be 10 MB or smaller.' }, { status: 413 });
  const extension = file.name.toLowerCase().split('.').pop() ?? '';
  if (!ALLOWED_EXTENSIONS.has(extension) || file.type === 'image/svg+xml') {
    return NextResponse.json({ error: 'This file type is not supported.' }, { status: 400 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 24);
    const uploadsFolderId = await getApplicationUploadsFolderId(form);
    const safeName = file.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180) || 'upload';
    const uploaded = await getGoogleDriveClient().files.create({
      supportsAllDrives: true,
      requestBody: {
        name: `${submission.reference} - ${safeName}`,
        parents: [uploadsFolderId],
        appProperties: {
          applicationFormId: form.id,
          applicationSubmissionId: submission.id,
          contentDigest: digest,
        },
      },
      media: {
        mimeType: file.type || 'application/octet-stream',
        body: Readable.from(buffer),
      },
      fields: 'id,webViewLink',
    });
    const fileId = uploaded.data.id;
    if (!fileId) throw new Error('Google Drive did not return the uploaded file ID.');
    return NextResponse.json({
      file: {
        url: uploaded.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
        publicId: `drive/${form.id}/${submission.id}/${fileId}`,
        name: file.name.slice(0, 180),
        size: file.size,
        type: file.type,
      },
    });
  } catch (error) {
    console.error('[public/application-upload]', error);
    return NextResponse.json({ error: 'Could not upload this file.' }, { status: 500 });
  }
}
