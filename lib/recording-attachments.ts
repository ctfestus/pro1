// Per-session resources on a class recording: the workbook, the slide deck, the
// follow-up reading an instructor hands out with that week's video. Stored as a jsonb
// array on recording_entries.attachments (migration 210).
//
// Two shapes share one row: a file the instructor uploaded (kind 'file', lives in the
// public form-assets bucket like lesson files do) and an external link they pasted
// (kind 'link'). Only the kind differs at the edges -- a file offers a download and
// shows its size, a link opens in a new tab -- so both surfaces read one list.
//
// Display helpers are deliberately shared with lesson attachments rather than copied:
// the same extension badge, size format and storage download trick apply here.

import {
  attachmentDownloadUrl, attachmentExtension, fileNameFromUrl, safeAttachmentUrl,
} from '@/lib/lesson-attachment';

export type RecordingAttachmentKind = 'file' | 'link';

export interface RecordingAttachment {
  id: string;
  name: string;
  url: string;
  kind: RecordingAttachmentKind;
  /** Bytes, for uploads only. Null for links and for rows saved before sizes were kept. */
  size: number | null;
}

/** Uploads land in this project's own public bucket; anything else was pasted by hand. */
export function isUploadedAttachmentUrl(url: string): boolean {
  return url.includes('/storage/v1/object/public/');
}

/**
 * Read a stored `attachments` value into typed rows, dropping anything that cannot be
 * rendered safely. Runs on every read because the column is jsonb: an older row, a
 * hand-edited row and a row from a future shape all arrive through the same path.
 */
export function normalizeRecordingAttachments(raw: unknown): RecordingAttachment[] {
  if (!Array.isArray(raw)) return [];
  const rows: RecordingAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const url = safeAttachmentUrl(typeof entry.url === 'string' ? entry.url : '');
    if (!url) continue;
    const name = (typeof entry.name === 'string' ? entry.name.trim() : '')
      || fileNameFromUrl(url) || 'Attached file';
    const size = typeof entry.size === 'number' && Number.isFinite(entry.size) && entry.size > 0
      ? entry.size : null;
    rows.push({
      id: typeof entry.id === 'string' && entry.id ? entry.id : `${rows.length}-${url}`,
      name,
      url,
      kind: entry.kind === 'link' || entry.kind === 'file'
        ? entry.kind
        : (isUploadedAttachmentUrl(url) ? 'file' : 'link'),
      size,
    });
  }
  return rows;
}

/** What the student's button points at: a real download for uploads, the page for links. */
export function recordingAttachmentHref(attachment: RecordingAttachment): string {
  return attachment.kind === 'file'
    ? attachmentDownloadUrl(attachment.url, attachment.name)
    : attachment.url;
}

/** Short badge for the resource row: the file type, or LINK when there is no extension. */
export function recordingAttachmentBadge(attachment: RecordingAttachment): string {
  return attachmentExtension(attachment.name, attachment.url) || (attachment.kind === 'file' ? 'FILE' : 'LINK');
}
