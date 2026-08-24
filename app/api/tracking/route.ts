// GET /api/tracking -- the Student Tracking table.
//
// Returns one page of rows plus the aggregates the page cannot describe on its own: the KPI strip
// counts the whole cohort, not the fifty rows on screen. Scoping and status classification live in
// lib/tracking-report so this report and the bulk-message segments it feeds cannot drift apart.
//
// Known limit: rows are enumerated for the whole filtered set before one page is sliced, because a
// row's status is computed rather than stored and cannot be filtered or counted in SQL. The heavy
// jsonb is kept out of that pass -- only the page about to be rendered pays for progress
// percentages -- but a genuinely O(page) query would need the enumeration pushed into a Postgres
// function, which is a migration rather than a route change.

import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import {
  attachProgress, buildStatusRows, loadCohortNames, loadStudents, loadTrackedContent,
} from '@/lib/tracking-report';

export const dynamic = 'force-dynamic';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const zeroStats = () => ({
  total: 0, not_started: 0, in_progress: 0, stalled: 0, failed: 0, completed: 0, at_risk: 0,
});

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase, role } = auth;

  const url = new URL(req.url);
  const cohortFilter = url.searchParams.get('cohortId') ?? 'all';
  const typeFilter   = url.searchParams.get('contentType') ?? 'all';
  const statusFilter = url.searchParams.get('status') ?? 'all';
  const search       = (url.searchParams.get('search') ?? '').trim().toLowerCase();
  // CSV export needs the whole filtered set rather than the page on screen.
  const wantsAll     = url.searchParams.get('all') === '1';
  const page         = Math.max(1, Math.floor(Number(url.searchParams.get('page')) || 1));
  const pageSize     = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(url.searchParams.get('pageSize')) || DEFAULT_PAGE_SIZE)));

  const empty = (cohorts: { id: string; name: string }[]) =>
    NextResponse.json({ rows: [], total: 0, page, pageSize, stats: zeroStats(), cohorts });

  // The tracking table is a read-only report, so admins and staff see all published content.
  const items = await loadTrackedContent(supabase, { userId: user.id, role, typeFilter });
  if (!items.length) return empty([]);

  const allCohortIds = [...new Set(items.flatMap(i => i.cohortIds))];
  if (!allCohortIds.length) return empty([]);

  const activeCohortIds = cohortFilter === 'all'
    ? allCohortIds
    : allCohortIds.filter(id => id === cohortFilter);

  // The cohort list always spans every cohort this caller's content reaches, never just the
  // filtered one: the dashboard rebuilds its cohort dropdown from it, so narrowing it dropped
  // every other option the moment a cohort was picked. Only the students narrow.
  const [cohorts, students] = await Promise.all([
    loadCohortNames(supabase, allCohortIds),
    loadStudents(supabase, activeCohortIds),
  ]);
  if (!students.length) return empty(cohorts);

  const rows = await buildStatusRows(supabase, {
    items,
    students,
    cohortNames: new Map(cohorts.map(c => [c.id, c.name])),
    activeCohortIds,
  });

  // KPI strip. Scoped to the cohort and content type -- the filters that reload the view -- and
  // deliberately not to status or search, so clicking a KPI to filter the table cannot rewrite the
  // very numbers being clicked.
  const stats = zeroStats();
  stats.total = rows.length;
  for (const row of rows) {
    (stats as any)[row.status] += 1;
    if (row.isAtRisk) stats.at_risk += 1;
  }

  // Status and search run here rather than in the browser: the browser now holds only a page, so
  // filtering there would search that page and report the wrong totals.
  const matching = rows.filter(row => {
    if (statusFilter === 'at_risk') { if (!row.isAtRisk) return false; }
    else if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (search) {
      const haystack = `${row.studentName} ${row.studentEmail} ${row.formTitle}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  // A total order, so a row cannot slip between pages or repeat across them. Student name leads
  // because paging a report ordered by anything else is not navigable.
  matching.sort((a, b) =>
    (a.studentName || a.studentEmail).localeCompare(b.studentName || b.studentEmail)
    || a.formTitle.localeCompare(b.formTitle)
    || a.formId.localeCompare(b.formId));

  const start = (page - 1) * pageSize;
  const pageRows = wantsAll ? matching : matching.slice(start, start + pageSize);

  // Only the rows going out get their progress percentages resolved.
  await attachProgress(supabase, pageRows, items);

  return NextResponse.json({ rows: pageRows, total: matching.length, page, pageSize, stats, cohorts });
}
