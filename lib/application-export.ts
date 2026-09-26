import type { ApplicationAnswer, ApplicationFormRecord, ApplicationSubmissionRecord } from '@/lib/application-forms';

function answerValue(value: ApplicationAnswer | undefined): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return value.url || value.name || '';
  return String(value);
}

function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function applicationSubmissionsCsv(
  form: ApplicationFormRecord,
  submissions: ApplicationSubmissionRecord[],
): string {
  const fixedHeaders = ['Reference', 'Email', 'Stage', 'Submitted at', 'Assigned reviewer', 'Score'];
  const headers = [...fixedHeaders, ...form.config.questions.map(question => question.label)];
  const rows = submissions.map(submission => {
    const stage = form.config.stages.find(item => item.id === submission.stageId);
    return [
      submission.reference,
      submission.email,
      stage?.name ?? submission.stageId,
      submission.submittedAt,
      submission.assignedReviewerEmail,
      submission.score ?? '',
      ...form.config.questions.map(question => answerValue(submission.answers[question.id])),
    ];
  });
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
}
