import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { cloudinary } from '@/lib/cloudinary-server';
import { formAvailability } from '@/lib/application-forms';
import { getApplicationForm, getApplicationSubmissionByTokenHash } from '@/lib/application-sheets';
import { hashApplicationAccessToken } from '@/lib/application-access';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'webp', 'zip']);

export async function POST(req: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const submission = await getApplicationSubmissionByTokenHash(hashApplicationAccessToken(token)).catch(() => null);
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
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 });
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 24);
    const folder = `applications/${form.id}/${submission.id}`;
    const result = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        { folder, public_id: digest, resource_type: 'auto', overwrite: false, use_filename: false },
        (error, value) => error || !value ? reject(error ?? new Error('Upload failed')) : resolve(value as { secure_url: string; public_id: string }),
      ).end(buffer);
    });
    return NextResponse.json({
      file: { url: result.secure_url, publicId: result.public_id, name: file.name.slice(0, 180), size: file.size, type: file.type },
    });
  } catch (error) {
    console.error('[public/application-upload]', error);
    return NextResponse.json({ error: 'Could not upload this file.' }, { status: 500 });
  }
}
