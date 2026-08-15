// Pure helpers for lesson file attachments: which extensions count as a download,
// how a file is named and sized for display, and how to ask the host for a real
// download rather than an inline view. Kept out of the node view so both the
// attachment block and the link stylesheet can share one list, and so the rules
// stay unit-testable.

import { safeCalloutActionUrl } from '@/lib/lesson-callout';

/**
 * Document / data / archive types a lesson treats as a file to keep rather than a page
 * to read. Drives both the attachment block's icon and the download glyph on plain
 * authored links. Media (images, audio, video) is deliberately absent: those have their
 * own blocks and play in place.
 */
export const ATTACHMENT_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx',
  'zip', 'txt', 'json', 'sql', 'ipynb', 'pbix',
];

/** Same policy as callout actions: https/http or a same-origin path, never javascript:. */
export function safeAttachmentUrl(raw: string): string | null {
  return safeCalloutActionUrl(raw);
}

/** Extension of a file, upper-cased for display ('XLSX'). Empty when there isn't one. */
export function attachmentExtension(fileName: string, href = ''): string {
  const suffix = (value: string) => value.split(/[?#]/)[0].match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? '';
  return (suffix(fileName) || suffix(href)).toUpperCase();
}

/** Last path segment of a URL, used when an upload or paste carries no author-set name. */
export function fileNameFromUrl(raw: string): string {
  const path = raw.split(/[?#]/)[0];
  try {
    return decodeURIComponent(path.split('/').filter(Boolean).pop() || '');
  } catch {
    return path.split('/').filter(Boolean).pop() || '';
  }
}

/** Human file size. Returns '' for unknown sizes so callers can omit the line entirely. */
export function formatAttachmentSize(bytes?: number | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Supabase Storage serves public objects inline, so a PDF opens in a tab instead of
 * saving. Its documented `?download=<name>` parameter sets the Content-Disposition
 * header, which also restores the author's filename in place of the timestamped
 * object key we upload under. Other hosts are returned untouched -- the HTML
 * `download` attribute is ignored cross-origin, so there is nothing else to do there.
 */
export function attachmentDownloadUrl(href: string, fileName = ''): string {
  if (!href.includes('/storage/v1/object/public/')) return href;
  try {
    const url = new URL(href);
    url.searchParams.set('download', fileName);
    return url.toString();
  } catch {
    return href;
  }
}
