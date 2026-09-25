import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';
import { formAvailability, publicApplicationForm } from '@/lib/application-forms';
import {
  getApplicationFormBySlug,
  getApplicationSubmissionByEmail,
  saveApplicationSubmission,
} from '@/lib/application-sheets';
import {
  hashApplicationAccessToken,
  newApplicationAccessToken,
  newApplicationId,
  newApplicationReference,
} from '@/lib/application-access';
import { sendApplicationAccessEmail } from '@/lib/application-email';

export const dynamic = 'force-dynamic';

function clientKey(req: NextRequest, email: string): string {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return createHash('sha256').update(`${ip}:${email}`).digest('hex').slice(0, 32);
}

export async function GET(_req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  try {
    const form = await getApplicationFormBySlug(slug);
    if (!form || !['published', 'paused', 'closed'].includes(form.status)) {
      return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    }
    return NextResponse.json({ form: publicApplicationForm(form) });
  } catch (error) {
    console.error('[public/application-form/get]', error);
    return NextResponse.json({ error: 'This application form is temporarily unavailable.' }, { status: 503 });
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const body = await req.json().catch(() => null) as null | { email?: string };
  const email = body?.email?.trim().toLowerCase() ?? '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Application email access is not configured.' }, { status: 503 });
  }
  const redis = getRedis();
  if (redis) {
    try {
      if (await bumpRateLimit(redis, `application-start:${clientKey(req, email)}`, 5, 60 * 15)) {
        return NextResponse.json({ error: 'Too many link requests. Please try again later.' }, { status: 429 });
      }
    } catch {
      return NextResponse.json({ error: 'Application access is temporarily unavailable.' }, { status: 503 });
    }
  }
  try {
    const form = await getApplicationFormBySlug(slug);
    if (!form) return NextResponse.json({ error: 'Application form not found.' }, { status: 404 });
    const existing = await getApplicationSubmissionByEmail(form.id, email);
    const availability = formAvailability(form);
    if (existing?.state === 'submitted') {
      const now = new Date().toISOString();
      const token = newApplicationAccessToken();
      const tokenHash = hashApplicationAccessToken(token);
      const updated = { ...existing, tokenHash: [...existing.tokenHash.split(',').filter(Boolean), tokenHash].slice(-5).join(','), updatedAt: now };
      await saveApplicationSubmission(updated);
      await sendApplicationAccessEmail({ email, formTitle: form.config.title, token, existing: true });
      return NextResponse.json({ ok: true, message: 'Check your email for a secure application link.' });
    }
    if (availability !== 'open') {
      const message = availability === 'not_open' ? 'Applications have not opened yet.'
        : availability === 'paused' ? 'This application form is temporarily paused.'
          : 'Applications are closed.';
      return NextResponse.json({ error: message }, { status: 409 });
    }
    const now = new Date().toISOString();
    const token = newApplicationAccessToken();
    const tokenHash = hashApplicationAccessToken(token);
    const submission = existing ? {
      ...existing,
      tokenHash: [...existing.tokenHash.split(',').filter(Boolean), tokenHash].slice(-5).join(','),
      updatedAt: now,
    } : {
      id: newApplicationId('submission'), formId: form.id, reference: newApplicationReference(), email,
      state: 'draft' as const, stageId: form.config.stages[0]?.id ?? 'submitted', assignedReviewerId: '',
      assignedReviewerEmail: '', score: null, createdAt: now, updatedAt: now, submittedAt: '', tokenHash,
      answers: {}, privateNotes: [], statusHistory: [], messages: [],
    };
    await saveApplicationSubmission(submission);
    await sendApplicationAccessEmail({ email, formTitle: form.config.title, token, existing: Boolean(existing) });
    return NextResponse.json({ ok: true, message: 'Check your email for a secure application link.' });
  } catch (error) {
    console.error('[public/application-form/start]', error);
    return NextResponse.json({ error: (error as Error).message || 'Could not send the application link.' }, { status: 503 });
  }
}
