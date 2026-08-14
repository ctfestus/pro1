// Shared, pure helpers for AI review submission records.
//
// All review flows persist a single "latest report" as JSON. The canonical envelope is:
// { type, count, submittedAt, report, documentReviewMode? }
// where `type` is the review question type and `report` is the full AI report.
//
// These helpers also read two legacy shapes so existing data keeps working:
// - a bare report object (no envelope), and
// - an array of lean summaries (oldest VE/assignment format).
//
// No React or component imports here, so both the players and the admin renderer can import it
// without creating a module cycle.

export interface ReviewRecord {
  type?: string;
  count?: number;
  submittedAt?: string;
  report: any;
  imageUrl?: string;
  documentReviewMode?: string;
  answerText?: string;   // written_response: the text the student submitted
}

// Infer the review type from a report's shape -- only used as a fallback when the stored record
// has no explicit `type` (legacy data). Excel vs Code is distinguished by the cell-vs-line field
// on issues; an Excel report with no issues can't be told apart this way, which is exactly why new
// data stores `type` explicitly.
export function inferReviewType(report: any): string | null {
  if (!report || typeof report !== 'object') return null;
  if (report.audit || Array.isArray(report.elements)) return 'dashboard_critique';
  if (Array.isArray(report.sections)) return 'document_review';
  if (Array.isArray(report.issues)) return (report.issues[0] && typeof report.issues[0].cell === 'string') ? 'excel_review' : 'code_review';
  return null;
}

// True only when `report` has the arrays the full-report player will iterate, so we never feed a
// partial/legacy summary into a player that calls .filter()/.map() on missing fields.
export function isFullReport(type: string | null | undefined, report: any): boolean {
  if (!type || !report || typeof report !== 'object') return false;
  if (type === 'code_review' || type === 'excel_review') return Array.isArray(report.issues) && Array.isArray(report.categories);
  if (type === 'document_review' || type === 'written_response') return Array.isArray(report.sections) && Array.isArray(report.categories);
  if (type === 'dashboard_critique') return Array.isArray(report.elements) || !!report.audit;
  return false;
}

// Normalize a stored notes / response_text string into a ReviewRecord (or null if unusable).
// Handles the current envelope, a legacy bare report, and a legacy array of lean summaries.
export function parseReviewNotes(notes?: string | null): ReviewRecord | null {
  if (!notes) return null;
  let p: any;
  try { p = JSON.parse(notes); } catch { return null; }
  if (!p || typeof p !== 'object') return null;
  if (Array.isArray(p)) {
    const last = p[p.length - 1];
    return last && typeof last === 'object' ? { report: last } : null;
  }
  if (p.report && typeof p.report === 'object') {
    return {
      type: typeof p.type === 'string' ? p.type : undefined,
      count: typeof p.count === 'number' ? p.count : undefined,
      submittedAt: typeof p.submittedAt === 'string' ? p.submittedAt : undefined,
      report: p.report,
      imageUrl: typeof p.imageUrl === 'string' ? p.imageUrl : undefined,
      documentReviewMode: typeof p.documentReviewMode === 'string' ? p.documentReviewMode : undefined,
      answerText: typeof p.answerText === 'string' ? p.answerText : undefined,
    };
  }
  return { report: p }; // legacy bare report
}

// Build the canonical envelope for a new submission, incrementing the attempt count from whatever
// was previously stored (envelope, legacy array, or bare report treated as count 0).
export function buildReviewNotes(
  type: string,
  report: any,
  prevNotes?: string | null,
  extra?: { documentReviewMode?: string },
): string {
  const prev = parseReviewNotes(prevNotes);
  const count = (prev?.count ?? 0) + 1;
  return JSON.stringify({
    type,
    count,
    submittedAt: new Date().toISOString(),
    report,
    ...(extra?.documentReviewMode ? { documentReviewMode: extra.documentReviewMode } : {}),
  });
}
