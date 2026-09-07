export type DeliverableDescriptionFormat = 'rich' | undefined;

export function htmlToPlainText(html: string): string {
  return (html || '')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<\/p>\s*(?=<(?:ol|ul)\b)/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .trim();
}

export function plainTextToRichHtml(text: string): string {
  const escaped = (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped
    .split(/\n{2,}/)
    .map(paragraph => `<p>${paragraph.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function convertLegacyEmailDeliverable(requirement: {
  description?: string;
  descriptionFormat?: DeliverableDescriptionFormat;
  emailBody?: string;
}) {
  const description = requirement.emailBody?.trim()
    ? requirement.emailBody
    : requirement.descriptionFormat === 'rich'
      ? requirement.description || ''
      : plainTextToRichHtml(requirement.description || '');

  return {
    emailFrame: false as const,
    emailBody: undefined,
    description,
    descriptionFormat: 'rich' as const,
  };
}
