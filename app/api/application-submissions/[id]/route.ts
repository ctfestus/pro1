import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import {
  appendApplicationAudit,
  getApplicationForm,
  getApplicationSubmission,
  saveApplicationSubmission,
} from '@/lib/application-sheets';
import {
  hashApplicationAccessToken,
  newApplicationAccessToken,
  newApplicationId,
} from '@/lib/application-access';
import { sendApplicationDecisionEmail } from '@/lib/application-email';

export const dynamic = 'force-dynamic';

type ReviewBody = {
  stageId?: string;
  assignedReviewerId?: string;
  assignedReviewerEmail?: string;
  score?: number | null;
  note?: string;
  message?: { type: 'interview' | 'acceptance' | 'waitlist' | 'decline' | 'custom'; subject: string; body: string };
};

type ApplicationMessageType = NonNullable<ReviewBody['message']>['type'];

function messageStageId(form: NonNullable<Awaited<ReturnType<typeof getApplicationForm>>>, type: ApplicationMessageType): string | undefined {
  if (!type || type === 'custom') return undefined;
  const aliases: Record<string, string[]> = {
    interview: ['interview'],
    acceptance: ['accepted', 'acceptance', 'admitted'],
    waitlist: ['waitlisted', 'waitlist'],
    decline: ['declined', 'decline', 'rejected'],
  };
  const candidates = aliases[type] ?? [];
  return form.config.stages.find(stage => {
    const values = [stage.id, stage.name, stage.applicantLabel].map(value => value.toLowerCase());
    return candidates.some(candidate => values.some(value => value === candidate || value.includes(candidate)));
  })?.id;
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(req, ['admin', 'instructor', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { id } = await context.params;
  const body = await req.json().catch(() => null) as ReviewBody | null;
  if (!body) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  try {
    const submission = await getApplicationSubmission(id);
    if (!submission) return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    const form = await getApplicationForm(submission.formId);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    const owner = form.ownerId === auth.actor.id;
    const assigned = submission.assignedReviewerId === auth.actor.id;
    if (auth.role !== 'admin' && !owner && !assigned) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (auth.role === 'staff' && (body.assignedReviewerId !== undefined || body.assignedReviewerEmail !== undefined)) {
      return NextResponse.json({ error: 'Only an administrator or form owner can assign reviewers.' }, { status: 403 });
    }
    if (body.score !== undefined && body.score !== null && (!Number.isFinite(body.score) || body.score < 0 || body.score > 100)) {
      return NextResponse.json({ error: 'Score must be between 0 and 100.' }, { status: 400 });
    }
    const nextStageId = body.stageId ?? (body.message ? messageStageId(form, body.message.type) : undefined);
    if (nextStageId && !form.config.stages.some(stage => stage.id === nextStageId)) {
      return NextResponse.json({ error: 'Select a valid application stage.' }, { status: 400 });
    }
    if (body.note !== undefined && (!body.note.trim() || body.note.length > 5000)) {
      return NextResponse.json({ error: 'Private notes must be between 1 and 5000 characters.' }, { status: 400 });
    }
    if (body.message && (!body.message.subject.trim() || !body.message.body.trim() || body.message.body.length > 10_000)) {
      return NextResponse.json({ error: 'Message subject and body are required.' }, { status: 400 });
    }
    const now = new Date().toISOString();
    let updated = { ...submission, updatedAt: now };
    if (body.assignedReviewerId !== undefined) updated.assignedReviewerId = body.assignedReviewerId;
    if (body.assignedReviewerEmail !== undefined) updated.assignedReviewerEmail = body.assignedReviewerEmail;
    if (body.score !== undefined) updated.score = body.score;
    if (body.note) updated.privateNotes = [...updated.privateNotes, {
      id: newApplicationId('note'), body: body.note.trim(), authorEmail: auth.actor.email ?? '', createdAt: now,
    }];
    if (nextStageId && nextStageId !== submission.stageId) {
      const stage = form.config.stages.find(item => item.id === nextStageId)!;
      updated.stageId = stage.id;
      updated.statusHistory = [...updated.statusHistory, {
        id: newApplicationId('status'), stageId: stage.id, stageName: stage.name,
        actorEmail: auth.actor.email ?? '', occurredAt: now, messageType: body.message?.type,
      }];
    }
    if (body.message) {
      const messageId = newApplicationId('message');
      const token = newApplicationAccessToken();
      const hash = hashApplicationAccessToken(token);
      updated.tokenHash = [...updated.tokenHash.split(',').filter(Boolean), hash].slice(-5).join(',');
      await saveApplicationSubmission(updated);
      await sendApplicationDecisionEmail({
        email: updated.email, subject: body.message.subject.trim(), body: body.message.body.trim(), token, messageId,
        baseUrl: new URL(req.url).origin,
      });
      updated.messages = [...updated.messages, {
        id: messageId, type: body.message.type, subject: body.message.subject.trim(), body: body.message.body.trim(),
        sentAt: now, sentBy: auth.actor.email ?? '',
      }];
    }
    await saveApplicationSubmission(updated);
    await appendApplicationAudit({
      id: newApplicationId('audit'), entityType: 'submission', entityId: updated.id,
      action: body.message ? `message:${body.message.type}` : nextStageId ? 'stage_changed' : body.note ? 'private_note_added' : 'review_updated',
      actorId: auth.actor.id, actorEmail: auth.actor.email ?? '', occurredAt: now,
      details: { stageId: updated.stageId, reviewerId: updated.assignedReviewerId, score: updated.score },
    });
    const { tokenHash: _tokenHash, ...safe } = updated;
    return NextResponse.json({ submission: safe });
  } catch (error) {
    console.error('[application-submission/review]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not update this application.' }, { status: 503 });
  }
}
