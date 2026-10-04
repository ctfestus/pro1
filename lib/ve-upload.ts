export const VE_SUBMISSION_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp,.ppt,.pptx,.zip,.py,.js,.ts,.sql,.html,.css';
export const VE_SUBMISSION_MAX_BYTES = 25 * 1024 * 1024;

const ALLOWED = new Set(VE_SUBMISSION_ACCEPT.split(','));

export function validateVeSubmissionFile(file: File): string | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : '';
  if (!ALLOWED.has(ext)) return 'This file type is not supported. Upload a document, image, spreadsheet, presentation, code file, or ZIP archive.';
  if (file.size > VE_SUBMISSION_MAX_BYTES) return 'This file is larger than the 25 MB upload limit.';
  if (file.size === 0) return 'This file is empty. Choose a file that contains your work.';
  return null;
}

export function safeVeUploadName(name: string): string {
  return name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'submission';
}

// Folder for a learner's VE submission files. Their account id: an email address needs escaping in
// a storage path, and an escaped one breaks the public URL (see repairVeSubmissionUrl).
export function veSubmissionFolder(formId: string, userId: string): string {
  return `submissions/${formId}/${userId}`;
}

// Fix a VE submission link saved by the standalone player between 2026-08-07 and the fix above.
//
// Those uploads went into a folder named after the learner's email, escaped with
// encodeURIComponent (alice@x.com -> alice%40x.com). Storage decoded that on upload, so the file is
// stored under alice@x.com/... and is fine. But getPublicUrl runs encodeURI over the path, which
// escapes the % again (%40 -> %2540), and storage decodes a request only once: it is asked for
// "alice%40x.com/...", a key containing %, and answers 400 InvalidKey. Every such saved link is broken.
//
// Undoing the second escape restores a working link. Only the storage path of our own
// form-assets bucket is touched, and safeVeUploadName strips % from file names, so a "%25" there can
// only be this double escape. The saved value is left as it is (it identifies the file version a
// report was written for); repair it wherever it is opened or fetched.
export function repairVeSubmissionUrl(url: string): string {
  const marker = '/storage/v1/object/public/form-assets/';
  const at = url.indexOf(marker);
  if (at < 0) return url;
  const head = url.slice(0, at + marker.length);
  return head + url.slice(head.length).replace(/%25([0-9A-Fa-f]{2})/g, '%$1');
}
