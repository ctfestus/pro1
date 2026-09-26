import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { applicationSubmissionsCsv } from '@/lib/application-export';
import { getApplicationForm, listApplicationSubmissions } from '@/lib/application-sheets';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { id } = await context.params;
  try {
    const form = await getApplicationForm(id);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    if (auth.role === 'instructor' && form.ownerId !== auth.actor.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    let submissions = (await listApplicationSubmissions(id)).filter(item => item.state === 'submitted');
    if (auth.role === 'staff') submissions = submissions.filter(item => item.assignedReviewerId === auth.actor.id);
    const stage = req.nextUrl.searchParams.get('stage');
    const reviewer = req.nextUrl.searchParams.get('reviewer');
    const query = req.nextUrl.searchParams.get('q')?.trim().toLowerCase();
    if (stage) submissions = submissions.filter(item => item.stageId === stage);
    if (reviewer) submissions = submissions.filter(item => item.assignedReviewerId === reviewer);
    if (query) submissions = submissions.filter(item => `${item.email} ${item.reference}`.toLowerCase().includes(query));
    submissions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (req.nextUrl.searchParams.get('format') === 'csv') {
      return new NextResponse(applicationSubmissionsCsv(form, submissions), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${form.slug}-applications.csv"`,
          'Cache-Control': 'private, no-store',
        },
      });
    }
    return NextResponse.json({
      submissions: submissions.map(({ tokenHash: _tokenHash, ...item }) => item),
    });
  } catch (error) {
    console.error('[application-submissions/get]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not load submissions.' }, { status: 503 });
  }
}
