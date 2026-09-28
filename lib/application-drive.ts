import type { ApplicationAnswer, ApplicationFileAnswer, ApplicationFormRecord } from '@/lib/application-forms';
import { getApplicationUploadsFolderId } from '@/lib/application-sheets';
import { getGoogleDriveClient } from '@/lib/sheets';

export async function normalizeApplicationDriveAnswers(
  form: ApplicationFormRecord,
  submissionId: string,
  answers: Record<string, ApplicationAnswer>,
): Promise<{ answers: Record<string, ApplicationAnswer>; errors: Record<string, string> }> {
  const fileQuestions = form.config.questions.filter(question => question.type === 'file' && answers[question.id]);
  if (!fileQuestions.length) return { answers, errors: {} };
  const folderId = await getApplicationUploadsFolderId(form);
  const drive = getGoogleDriveClient();
  const normalized = { ...answers };
  const errors: Record<string, string> = {};

  await Promise.all(fileQuestions.map(async question => {
    const value = answers[question.id] as ApplicationFileAnswer;
    const prefix = `drive/${form.id}/${submissionId}/`;
    const fileId = value?.publicId?.startsWith(prefix) ? value.publicId.slice(prefix.length) : '';
    if (!/^[A-Za-z0-9_-]{10,}$/.test(fileId)) {
      errors[question.id] = 'Upload a valid file for this application.';
      return;
    }
    try {
      const result = await drive.files.get({
        fileId,
        supportsAllDrives: true,
        fields: 'id,name,size,mimeType,webViewLink,parents,appProperties,trashed',
      });
      const properties = result.data.appProperties ?? {};
      if (result.data.trashed
        || !result.data.parents?.includes(folderId)
        || properties.applicationFormId !== form.id
        || properties.applicationSubmissionId !== submissionId) {
        errors[question.id] = 'Upload a valid file for this application.';
        return;
      }
      const storedName = String(result.data.name ?? value.name);
      const nameSeparator = storedName.indexOf(' - ');
      normalized[question.id] = {
        url: result.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
        publicId: `${prefix}${fileId}`,
        name: nameSeparator >= 0 ? storedName.slice(nameSeparator + 3) : storedName,
        size: Number(result.data.size ?? value.size ?? 0),
        type: result.data.mimeType ?? value.type ?? 'application/octet-stream',
      };
    } catch {
      errors[question.id] = 'Upload a valid file for this application.';
    }
  }));

  return { answers: normalized, errors };
}
