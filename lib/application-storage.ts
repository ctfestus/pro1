import { createHash } from 'crypto';
import { adminClient } from '@/lib/admin-client';
import type { ApplicationAnswer, ApplicationFileAnswer, ApplicationFormRecord } from '@/lib/application-forms';

export const APPLICATION_UPLOAD_BUCKET = 'application-uploads';
export const APPLICATION_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const APPLICATION_UPLOAD_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'jpg', 'jpeg', 'png', 'webp', 'zip',
]);

export async function deleteApplicationFormFiles(formId: string): Promise<void> {
  const bucket = adminClient().storage.from(APPLICATION_UPLOAD_BUCKET);
  const paths: string[] = [];
  const listAll = async (folder: string) => {
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(folder, { limit: 100, offset });
      if (error) throw new Error(`Could not list application files: ${error.message}`);
      const entries = data ?? [];
      for (const entry of entries) {
        if (entry.id) paths.push(`${folder}/${entry.name}`);
        else await listAll(`${folder}/${entry.name}`);
      }
      if (entries.length < 100) break;
    }
  };
  await listAll(formId);
  for (let start = 0; start < paths.length; start += 100) {
    const { error } = await bucket.remove(paths.slice(start, start + 100));
    if (error) throw new Error(`Could not remove application files: ${error.message}`);
  }
}

export function applicationQuestionFilePrefix(questionId: string): string {
  return createHash('sha256').update(questionId).digest('hex').slice(0, 12);
}

export function applicationFilePath(publicId: string, formId: string, submissionId: string, questionId: string): string | null {
  const prefix = `supabase/${formId}/${submissionId}/`;
  if (!publicId.startsWith(prefix)) return null;
  const name = publicId.slice(prefix.length);
  if (!new RegExp(`^${applicationQuestionFilePrefix(questionId)}-[a-f0-9-]{36}\\.[a-z0-9]{2,5}$`).test(name)) return null;
  return `${formId}/${submissionId}/${name}`;
}

export async function normalizeApplicationStorageAnswers(
  form: ApplicationFormRecord,
  submissionId: string,
  answers: Record<string, ApplicationAnswer>,
): Promise<{ answers: Record<string, ApplicationAnswer>; errors: Record<string, string> }> {
  const normalized = { ...answers };
  const errors: Record<string, string> = {};
  const bucket = adminClient().storage.from(APPLICATION_UPLOAD_BUCKET);
  await Promise.all(form.config.questions.filter(question => question.type === 'file' && answers[question.id]).map(async question => {
    const supplied = answers[question.id] as ApplicationFileAnswer;
    const path = applicationFilePath(supplied?.publicId ?? '', form.id, submissionId, question.id);
    if (!path) {
      errors[question.id] = 'Upload a valid file for this application.';
      return;
    }
    const { data, error } = await bucket.info(path);
    const size = Number(data?.size ?? 0);
    const type = String(data?.contentType ?? 'application/octet-stream');
    if (error || !data || size <= 0 || size > APPLICATION_UPLOAD_MAX_BYTES
      || ['image/svg+xml', 'text/html', 'application/javascript', 'text/javascript'].includes(type)) {
      errors[question.id] = 'Upload a valid file for this application.';
      return;
    }
    normalized[question.id] = {
      url: '',
      publicId: supplied.publicId,
      name: String(supplied.name ?? 'Uploaded file').slice(0, 180),
      size,
      type,
    };
  }));
  return { answers: normalized, errors };
}
