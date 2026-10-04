// Instructor-written report on one uploaded file in a standalone virtual experience.
//
// Stored per requirement id under guided_project_attempts.review.reports, next to the attempt-level
// score and feedback. The shape mirrors the AI reviewers' structured report so students see the
// same layout (components/AiStructuredReviewReport). An instructor may start from an AI draft, but
// what is saved is whatever they published, so every field is re-validated here on the server.

export type InstructorFindingSeverity = 'error' | 'warning' | 'suggestion';

export interface InstructorFinding {
  location: string;
  severity: InstructorFindingSeverity;
  title: string;
  detail: string;
  fix: string;
}

export interface InstructorCategory {
  name: string;
  score: number;
  summary: string;
  strengths: string[];
  gaps: string[];
}

export interface InstructorFileReport {
  score: number;
  summary: string;
  findings: InstructorFinding[];
  categories: InstructorCategory[];
  recommendations: string[];
  aiDrafted?: boolean;
  // The uploaded file this report reviewed. Every upload is stored under a new timestamped path, so
  // a replaced file has a different URL and the report can be recognised as describing an older one.
  fileUrl?: string;
}

// What the editor holds: the score is null until the instructor enters one.
export type InstructorReportDraft = Omit<InstructorFileReport, 'score'> & { score: number | null };

export const INSTRUCTOR_SEVERITY_LABELS: Record<InstructorFindingSeverity, string> = {
  error: 'Critical',
  warning: 'Improvement',
  suggestion: 'Suggestion',
};

// How many rows a report keeps. Exported so the editor stops adding rows where the server stops keeping them.
export const REPORT_COUNTS = { findings: 30, categories: 8, listItems: 10 } as const;
const MAX_FINDINGS = REPORT_COUNTS.findings;
const MAX_CATEGORIES = REPORT_COUNTS.categories;
const MAX_LIST = REPORT_COUNTS.listItems;

// Field length limits. Exported so the editor can stop typing at the same point the server trims.
export const REPORT_LIMITS = {
  location: 120, title: 200, detail: 2000, fix: 2000,
  categoryName: 80, categorySummary: 1000, listItem: 500,
  summary: 2000, recommendation: 1000,
} as const;

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// 0-100, one decimal; anything not a number becomes 0.
export function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
}

function strList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(v => str(v, maxLen)).filter(Boolean).slice(0, maxItems);
}

// Accepts the AI vocabulary (critical/improvement/suggestion) as well as the stored one.
function severityOf(value: unknown): InstructorFindingSeverity {
  if (value === 'error' || value === 'critical') return 'error';
  if (value === 'warning' || value === 'improvement') return 'warning';
  return 'suggestion';
}

export function emptyInstructorReport(): InstructorReportDraft {
  return { score: null, summary: '', findings: [], categories: [], recommendations: [] };
}

// True when the report has any written content. A score alone is not content.
export function hasReportContent(r: InstructorReportDraft): boolean {
  return !!(r.summary.trim() || r.findings.some(f => f.title.trim()) || r.categories.some(c => c.name.trim()) || r.recommendations.some(x => x.trim()));
}

// A missing score (null, blank, not a number). 0 is a real score, not a missing one.
function scoreOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? clampScore(n) : null;
}

// Coerce untrusted input (request body or model output) into a valid report. Rows without a title
// or name are dropped, so a half-filled editor row is not published as a blank card. A report must
// carry a score (0 included); written content is optional. The editor will not submit a report
// without a score, so returning null here never loses work silently.
export function normalizeInstructorReport(raw: unknown): InstructorFileReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, any>;

  const findings: InstructorFinding[] = (Array.isArray(r.findings) ? r.findings : [])
    .map((f: any) => ({
      location: str(f?.location, REPORT_LIMITS.location),
      severity: severityOf(f?.severity),
      title:    str(f?.title, REPORT_LIMITS.title),
      detail:   str(f?.detail, REPORT_LIMITS.detail),
      fix:      str(f?.fix, REPORT_LIMITS.fix),
    }))
    .filter((f: InstructorFinding) => f.title)
    .slice(0, MAX_FINDINGS);

  const categories: InstructorCategory[] = (Array.isArray(r.categories) ? r.categories : [])
    .map((c: any) => ({
      name:      str(c?.name, REPORT_LIMITS.categoryName),
      score:     clampScore(c?.score),
      summary:   str(c?.summary, REPORT_LIMITS.categorySummary),
      strengths: strList(c?.strengths, MAX_LIST, REPORT_LIMITS.listItem),
      gaps:      strList(c?.gaps, MAX_LIST, REPORT_LIMITS.listItem),
    }))
    .filter((c: InstructorCategory) => c.name)
    .slice(0, MAX_CATEGORIES);

  const score = scoreOrNull(r.score);
  if (score === null) return null;

  const report: InstructorFileReport = {
    score,
    summary:         str(r.summary, REPORT_LIMITS.summary),
    findings,
    categories,
    recommendations: strList(r.recommendations, MAX_LIST, REPORT_LIMITS.recommendation),
  };
  if (r.aiDrafted === true) report.aiDrafted = true;
  if (typeof r.fileUrl === 'string' && r.fileUrl.trim()) report.fileUrl = r.fileUrl.trim().slice(0, 2000);

  return report;
}

// Validate a { [reqId]: report } map against the requirement ids that may carry a report.
export function normalizeInstructorReports(raw: unknown, allowedReqIds: Set<string>): Record<string, InstructorFileReport> {
  const out: Record<string, InstructorFileReport> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [reqId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowedReqIds.has(reqId)) continue;
    const report = normalizeInstructorReport(value);
    if (report) out[reqId] = report;
  }
  return out;
}

// Requirement ids in a VE whose file the instructor can report on: File Upload steps, and
// deliverables, whose older email-style version still lets students attach a file. Whether a file
// is actually there is checked per attempt by the callers.
export function reportableRequirementIds(modules: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(modules)) return ids;
  for (const m of modules) {
    for (const l of (m as any)?.lessons ?? []) {
      for (const req of l?.requirements ?? []) {
        if ((req?.type === 'upload' || req?.type === 'deliverable') && typeof req.id === 'string') ids.add(req.id);
      }
    }
  }
  return ids;
}

// True when the report reviewed a different file from the one the student has uploaded now.
// A report without a recorded file (none exist yet, but older data could) is not called stale.
export function isReportStale(report: { fileUrl?: string } | null | undefined, currentFileUrl: string | null | undefined): boolean {
  return !!report?.fileUrl && report.fileUrl !== (currentFileUrl || '');
}

// Content equality that ignores object key order. A report read back from a jsonb column comes with
// its keys reordered, so comparing JSON.stringify output would call every saved report "changed".
export function sameReportContent(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value as object).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
    }
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
