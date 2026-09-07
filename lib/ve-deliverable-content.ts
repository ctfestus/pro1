import type { LessonDoc } from '@/lib/lesson-doc';

export type DeliverableDescriptionFormat = 'rich' | undefined;

interface DeliverableDescription {
  type?: string;
  description?: string;
  descriptionFormat?: DeliverableDescriptionFormat;
  descriptionDoc?: LessonDoc;
}

function isDeliverable(requirement: DeliverableDescription): boolean {
  return requirement.type === 'task' || requirement.type === 'deliverable';
}

export function attachDeliverableDescriptionDoc<T extends DeliverableDescription>(
  requirement: T,
  htmlToDoc: (html: string) => LessonDoc,
): T {
  if (!isDeliverable(requirement)) return requirement;
  const withoutStaleDoc = { ...requirement, descriptionDoc: undefined };
  if (!requirement.description) return withoutStaleDoc;
  try {
    return { ...withoutStaleDoc, descriptionDoc: htmlToDoc(requirement.description) };
  } catch {
    return withoutStaleDoc;
  }
}

/**
 * Global VE Improve only receives the readable HTML fallback, which cannot represent interactive
 * node settings. Keep canonical deliverable instructions unchanged when they already exist; the
 * embedded interactive editor has its own AI tools for safe, document-aware changes.
 */
export function reconcileImprovedDeliverableDescription<T extends DeliverableDescription>(
  incoming: T,
  prior: DeliverableDescription | undefined,
  htmlToDoc: (html: string) => LessonDoc,
): T {
  if (!isDeliverable(incoming)) {
    return { ...incoming, descriptionFormat: undefined, descriptionDoc: undefined };
  }
  if (prior && isDeliverable(prior) && prior.descriptionDoc) {
    return {
      ...incoming,
      description: prior.description,
      descriptionFormat: prior.descriptionFormat,
      descriptionDoc: prior.descriptionDoc,
    };
  }
  return attachDeliverableDescriptionDoc(incoming, htmlToDoc);
}

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
  descriptionDoc?: unknown;
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
    descriptionDoc: undefined,
  };
}
