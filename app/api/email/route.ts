import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireRole, isAuthError } from '@/lib/api-auth';
import { Resend } from 'resend';
import { createClient } from '@supabase/supabase-js';
import { confirmationEmail, reminderEmail, courseResultEmail, blastEmail } from '@/lib/email-templates';
import { getVectorIndex, buildCourseEmbedText } from '@/lib/vector';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { studentsStillInCohorts } from '@/lib/cohort-roster';

const resend     = new Resend(process.env.RESEND_API_KEY);
const BATCH_SIZE = 100; // Resend batch limit

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

const getAdminSupabase = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key);
};

// Returns the authenticated user from a Bearer token, or null.
async function getAuthUser(req: NextRequest) {
  const auth = await requireUser(req);
  return isAuthError(auth) ? null : auth.user;
}

// Kept for blast/reminder paths that only need the user ID.
async function getCreatorId(req: NextRequest): Promise<string | null> {
  const user = await getAuthUser(req);
  return user?.id ?? null;
}

// An event's recipient list cannot be read straight from event_registrations: those rows are
// written once, when the event is assigned to a cohort, and never removed, so they still name
// students who have since moved to another cohort or onto a subscription. Narrow to whoever is
// still in one of the event's cohorts. See lib/cohort-roster.
async function eventRegistrantsStillEnrolled(
  supabase: ReturnType<typeof getAdminSupabase>,
  eventId: string,
  columns: string,
): Promise<any[]> {
  const [{ data: event, error: eventError }, { data: regs, error: regsError }] = await Promise.all([
    supabase.from('events').select('cohort_ids').eq('id', eventId).maybeSingle(),
    supabase.from('event_registrations').select(columns).eq('event_id', eventId),
  ]);
  // Throwing rather than carrying on: an unreadable event means an unknown audience, and an
  // unknown audience read as "no cohorts" would keep every stale registration -- exactly the send
  // this function exists to prevent. An event that genuinely names no cohorts is a different case
  // and still passes through. The caller's catch turns this into a visible, retryable failure.
  if (eventError || !event) {
    throw new Error(`[email] event lookup failed for ${eventId}: ${eventError?.message ?? 'not found'}`);
  }
  if (regsError) {
    throw new Error(`[email] registration lookup failed for ${eventId}: ${regsError.message}`);
  }
  // An event assigned to no cohort is an event nobody can open, so it has no audience. The roster
  // helper reads an empty cohort list as "cannot tell, keep everyone", which is right for reading
  // back an attendance record but wrong for a send -- it would mail every stale registration. The
  // reminder cron skips such an event; this returns nobody, and the callers already answer that
  // with "No valid recipients found".
  const cohortIds: string[] = Array.isArray((event as any).cohort_ids) ? (event as any).cohort_ids : [];
  if (!cohortIds.length) return [];

  const rows: any[] = regs ?? [];
  const stillEnrolled = await studentsStillInCohorts(
    supabase,
    rows.map((r: any) => r.student_id as string),
    cohortIds,
  );
  return rows.filter((r: any) => stillEnrolled.has(r.student_id));
}

async function requireEmailTester(req: NextRequest): Promise<boolean> {
  const auth = await requireRole(req, ['admin', 'instructor']);
  return !isAuthError(auth);
}

// Returns true if creatorId owns the given content item (across courses, events, virtual_experiences).
async function ownsForm(creatorId: string, formId: string): Promise<boolean> {
  const supabase = getAdminSupabase();
  const [{ data: c }, { data: e }, { data: v }] = await Promise.all([
    supabase.from('courses').select('id').eq('id', formId).eq('user_id', creatorId).maybeSingle(),
    supabase.from('events').select('id').eq('id', formId).eq('user_id', creatorId).maybeSingle(),
    supabase.from('virtual_experiences').select('id').eq('id', formId).eq('user_id', creatorId).maybeSingle(),
  ]);
  return !!(c ?? e ?? v);
}


async function sendBatch(emails: string[], subject: string, html: string, from: string) {
  const unique = [...new Set(emails.filter(e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
  if (!unique.length) return;
  for (let i = 0; i < unique.length; i += 100) {
    await resend.batch.send(
      unique.slice(i, i + 100).map(to => ({ from, to, subject, html }))
    );
  }
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function resolveName(data: Record<string, any>) {
  const fullName = String(data.full_name || data.name || '').trim();
  if (fullName) return fullName;
  const firstName = String(data.first_name || '').trim();
  const lastName = String(data.last_name || '').trim();
  return [firstName, lastName].filter(Boolean).join(' ').trim();
}

function applyMergeTags(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, key) => {
    const normalizedKey = String(key).toLowerCase();
    return values[normalizedKey] ?? '';
  });
}

export async function POST(req: NextRequest) {
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: 'Email service not configured' }, { status: 503 });
  }

  try {
    const t        = await getTenantSettings();
    const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
    const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

    const { type, to, data } = await req.json();

    if (!type || (!to && !data?.formId)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // -- Per-type authorization ---
    let blastCreatorId = '';

    if (type === 'blast') {
      // Requires authenticated creator who owns the form
      const creatorId = await getCreatorId(req);
      if (!creatorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      if (!data?.formId || !(await ownsForm(creatorId, data.formId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      blastCreatorId = creatorId;
    } else if (type === 'reminder') {
      // Cron path: x-cron-secret only accepted in non-production and requires timestamp
      const cronSecret     = process.env.CRON_SECRET;
      const cronHeader     = req.headers.get('x-cron-secret');
      const cronTs         = req.headers.get('x-cron-ts');
      const isProduction   = process.env.VERCEL_ENV === 'production';
      const tsNum          = Number(cronTs ?? '');
      const tsValid        = !isNaN(tsNum) && Math.abs(Math.floor(Date.now() / 1000) - tsNum) <= 300;
      const isCron = !isProduction && cronSecret && cronHeader === cronSecret && tsValid;

      if (!isCron) {
        // Creator path -- fully handled here, returns early
        const creatorId = await getCreatorId(req);
        if (!creatorId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

        if (!data?.formId) return NextResponse.json({ error: 'formId is required' }, { status: 400 });
        if (!(await ownsForm(creatorId, data.formId))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

        // Validate content is actually an event
        const supabase = getAdminSupabase();
        const { data: eventRow } = await supabase.from('events').select('id').eq('id', data.formId).maybeSingle();
        if (!eventRow) {
          return NextResponse.json({ error: 'This form is not an event' }, { status: 400 });
        }

        const reminderSubject = data.isOneHour ? `Starting in 1 hour: ${data.eventTitle}` : `Tomorrow: ${data.eventTitle}`;

        if (typeof to === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
          // Test mode: single address, no personal token needed
          const html = reminderEmail({ ...data, branding });
          await resend.emails.send({ from: FROM, to: to.trim(), subject: reminderSubject, html });
          return NextResponse.json({ success: true, test: true });
        }

        // Production mode: per-student email with their personal tracked join link
        const registrations = await eventRegistrantsStillEnrolled(
          supabase, data.formId, 'student_id, join_token, student:students(email, full_name)');

        const messages = registrations.flatMap((reg: any) => {
          const s     = Array.isArray(reg.student) ? reg.student[0] : reg.student;
          const email = normalizeEmail(s?.email);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [];
          const joinUrl = reg.join_token ? `${t.appUrl}/api/join?token=${reg.join_token}` : undefined;
          const html    = reminderEmail({ ...data, joinUrl, branding });
          return [{ from: FROM, to: email, subject: reminderSubject, html }];
        });

        if (!messages.length) return NextResponse.json({ error: 'No valid recipients found' }, { status: 400 });
        for (let i = 0; i < messages.length; i += 100) {
          await resend.batch.send(messages.slice(i, i + 100));
        }
        return NextResponse.json({ success: true, count: messages.length });
      }
      // Cron path: per-student personalization when formId is available
      if (data?.formId) {
        const supabase        = getAdminSupabase();
        const cronSubject     = data.isOneHour
          ? `Starting in 1 hour: ${data.eventTitle}`
          : `Tomorrow: ${data.eventTitle}`;
        const regs = await eventRegistrantsStillEnrolled(
          supabase, data.formId, 'student_id, join_token, student:students(email, full_name)');
        const msgs = regs.flatMap((reg: any) => {
          const s     = Array.isArray(reg.student) ? reg.student[0] : reg.student;
          const email = normalizeEmail(s?.email);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return [];
          const joinUrl = reg.join_token ? `${t.appUrl}/api/join?token=${reg.join_token}` : undefined;
          return [{ from: FROM, to: email, subject: cronSubject, html: reminderEmail({ ...data, joinUrl, branding }) }];
        });
        if (!msgs.length) return NextResponse.json({ error: 'No valid recipients found' }, { status: 400 });
        for (let i = 0; i < msgs.length; i += 100) await resend.batch.send(msgs.slice(i, i + 100));
        return NextResponse.json({ success: true, count: msgs.length });
      }
      // No formId: fall through to switch/send with a shared html
    } else if (type === 'confirmation') {
      // Confirmation emails are now sent server-side inside /api/event-register.
      // Test mode only is still supported here (creator previewing template).
      if (typeof to === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) && !data?.responseId) {
        if (!await requireEmailTester(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const html = confirmationEmail({ ...data, branding });
        await resend.emails.send({ from: FROM, to: to.trim(), subject: `You're registered: ${data?.eventTitle || 'Event'}`, html });
        return NextResponse.json({ success: true, test: true });
      }
      // Production sends are handled in /api/event-register -- reject anything else.
      return NextResponse.json({ error: 'Confirmation emails are sent server-side on registration' }, { status: 400 });

    } else if (type === 'course-result') {
      // Test mode: single email + no responseId -> creator-initiated test send
      if (typeof to === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim()) && !data?.responseId) {
        if (!await requireEmailTester(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        const html = courseResultEmail({ ...data, branding });
        const testSubject = data?.passed ? `🎉 Congratulations! Your certificate for ${data?.courseTitle || 'Course'} is ready.` : `Your result: ${data?.courseTitle || 'Course'}`;
        await resend.emails.send({ from: FROM, to: to.trim(), subject: testSubject, html });
        return NextResponse.json({ success: true, test: true });
      }

      // Production path: caller must be authenticated and their email must match
      // the address stored in the response row -- identity derived from JWT, not body.
      const callerUser = await getAuthUser(req);
      if (!callerUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      if (!data?.formId || !data?.responseId) {
        return NextResponse.json({ error: 'formId and responseId are required' }, { status: 400 });
      }

      const supabase = getAdminSupabase();
      const callerEmail = callerUser.email?.trim().toLowerCase() ?? '';
      if (!callerEmail) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

      const { data: response } = await supabase
        .from('responses')
        .select('data')
        .eq('id', data.responseId)
        .eq('form_id', data.formId)
        .single();
      if (!response) {
        return NextResponse.json({ error: 'Response not found' }, { status: 404 });
      }

      const storedEmail = String(response.data?.email ?? '').trim().toLowerCase();
      if (!storedEmail || storedEmail !== callerEmail) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // Idempotency: don't resend if already sent for this response + type
      const { data: alreadySent } = await supabase
        .from('sent_emails')
        .select('id')
        .eq('response_id', data.responseId)
        .eq('type', 'course-result')
        .maybeSingle();
      if (alreadySent) return NextResponse.json({ success: true, duplicate: true });
    }

    // For course-result, derive all content from the DB -- never trust client values
    let courseResultData: Record<string, any> | null = null;
    if (type === 'course-result') {
      const supabase = getAdminSupabase();

      const [[{ data: courseRow }, { data: veRow }], { data: cert }] = await Promise.all([
        Promise.all([
          supabase.from('courses').select('title, slug, questions, learn_outcomes, cover_image').eq('id', data.formId).maybeSingle(),
          supabase.from('virtual_experiences').select('title, slug, tagline').eq('id', data.formId).maybeSingle(),
        ]),
        supabase.from('certificates').select('id').eq('response_id', data.responseId).eq('revoked', false).maybeSingle(),
      ]);

      // Build a config-compatible shape for backward compat
      const form = courseRow ?? veRow
        ? {
            slug: (courseRow ?? veRow)!.slug,
            config: {
              title:    (courseRow ?? veRow)!.title,
              passmark: (courseRow as any)?.passmark ?? 50,
              cohort_ids: [],
            },
            cohort_ids: [] as string[],
          }
        : null;

      const { data: response } = await supabase
        .from('responses').select('data').eq('id', data.responseId).eq('form_id', data.formId).single();

      const appUrl = process.env.APP_URL || 'https://festforms.com';
      const formUrl = form?.slug ? `${appUrl}/${form.slug}` : `${appUrl}/${data.formId}`;
      const certUrl = cert?.id ? `${appUrl}/certificate/${cert.id}` : undefined;

      const studentEmail = response?.data?.email ?? '';
      const passed       = response?.data?.passed ?? false;

      // Fetch recommendations for passing students
      let recommendations: Array<{ title: string; slug: string; coverImage?: string | null }> = [];
      if (passed && studentEmail) {
        try {
          const index = getVectorIndex();
          if (index && form) {
            const { data: student } = await supabase
              .from('students').select('id, cohort_id').eq('email', studentEmail).maybeSingle();

            const { data: attempts } = student?.id
              ? await supabase.from('course_attempts').select('course_id').eq('student_id', student.id)
              : { data: [] };

            const seenIds = new Set((attempts ?? []).map((a: any) => a.course_id));
            seenIds.add(data.formId);

            const queryText = buildCourseEmbedText(form.config, form.config?.title || '');
            const results   = await index.query({ data: queryText, topK: 10, includeMetadata: true });

            const cohortId      = student?.cohort_id ?? null;
            recommendations = results
              .filter((r: any) => {
                const m = r.metadata;
                if (!m || m.status !== 'published') return false;
                if (seenIds.has(m.formId)) return false;
                if ((r.score ?? 0) < 0.6) return false;
                if (cohortId) return (m.cohortIds ?? []).includes(cohortId);
                return (m.cohortIds ?? []).some((c: string) => (form as any).cohort_ids?.includes(c));
              })
              .slice(0, 3)
              .map((r: any) => ({ title: r.metadata.title, slug: r.metadata.slug, coverImage: r.metadata.coverImage ?? null }));
          }
        } catch { /* non-critical -- don't block the email */ }
      }

      courseResultData = {
        name:        response?.data?.name,
        courseTitle: form?.config?.title || '',
        score:       response?.data?.score       ?? 0,
        total:       response?.data?.total       ?? 0,
        percentage:  response?.data?.percentage  ?? 0,
        passed,
        points:      response?.data?.points,
        passmark:    form?.config?.passmark       ?? 50,
        formUrl,
        certUrl,
        recommendations,
      };
    }

    let html = '';
    let subject = '';

    switch (type) {
      case 'confirmation':
        subject = `You're registered: ${data.eventTitle}`;
        html = confirmationEmail({ ...data, branding });
        break;

      case 'reminder':
        subject = data.isOneHour
          ? `Starting in 1 hour: ${data.eventTitle}`
          : `Tomorrow: ${data.eventTitle}`;
        html = reminderEmail({ ...data, branding });
        break;

      case 'course-result': {
        const d = courseResultData!;
        subject = d.passed ? `🎉 Congratulations! Your certificate for ${d.courseTitle} is ready.` : `Your result: ${d.courseTitle}`;
        html = courseResultEmail({ ...(d as Parameters<typeof courseResultEmail>[0]), branding });
        break;
      }

      case 'blast':
        if (!data.subject?.trim()) {
          return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
        }
        if (!data.formId) {
          return NextResponse.json({ error: 'formId is required for broadcast emails' }, { status: 400 });
        }
        break;

      default:
        return NextResponse.json({ error: 'Unknown email type' }, { status: 400 });
    }

    if (type === 'blast') {
      // -- Test mode: single email address provided -> send once, skip quota --
      if (typeof to === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to.trim())) {
        if (!data.subject?.trim()) {
          return NextResponse.json({ error: 'Subject is required' }, { status: 400 });
        }
        const testTo = to.trim();
        const mergeValues: Record<string, string> = {
          name: 'there', email: testTo,
          form_title: String(data.formTitle || ''),
          event_title: String(data.eventTitle || data.formTitle || ''),
          event_date: String(data.eventDate || ''),
          event_time: String(data.eventTime || ''),
          event_timezone: String(data.eventTimezone || ''),
          event_location: String(data.eventLocation || ''),
          meeting_link: String(data.meetingLink || ''),
          form_url: String(data.formUrl || ''),
        };
        const testSubject = applyMergeTags(String(data.subject || ''), mergeValues);
        const testBody = applyMergeTags(String(data.body || ''), mergeValues);
        const testHtml = blastEmail({ ...data, subject: testSubject, body: testBody, branding });
        await resend.emails.send({ from: FROM, to: testTo, subject: testSubject, html: testHtml });
        return NextResponse.json({ success: true, test: true });
      }

      // -- Daily blast quota ---
      const BLAST_DAILY_LIMIT = 10;
      const today = new Date().toISOString().split('T')[0];
      const supabase = getAdminSupabase();

      const { data: quota } = await supabase
        .from('blast_quotas')
        .select('count')
        .eq('creator_id', blastCreatorId)
        .eq('date', today)
        .maybeSingle();

      const currentCount = quota?.count ?? 0;
      if (currentCount >= BLAST_DAILY_LIMIT) {
        return NextResponse.json(
          { error: `Daily blast limit of ${BLAST_DAILY_LIMIT} reached. Try again tomorrow.` },
          { status: 429 }
        );
      }

      // Load content metadata -- never trust client-supplied recipient lists
      const [{ data: blastCourse }, { data: blastEvent }, { data: blastVe }] = await Promise.all([
        supabase.from('courses').select('cohort_ids').eq('id', data.formId).maybeSingle(),
        supabase.from('events').select('cohort_ids').eq('id', data.formId).maybeSingle(),
        supabase.from('virtual_experiences').select('cohort_ids').eq('id', data.formId).maybeSingle(),
      ]);

      const isEvent       = !!blastEvent;
      const isCourseBlast = !!blastCourse;
      // segment: 'all' | 'not_started' | 'in_progress' | 'completed'
      const segment: string  = data.segment  ?? 'all';
      const cohortId: string = data.cohortId ?? '';

      // Build deduplicated map of email -> merge data
      const responseByEmail = new Map<string, Record<string, any>>();

      if (isEvent) {
        // Events: send to registrants only
        const registrants = await eventRegistrantsStillEnrolled(
          supabase, data.formId, 'student_id, responses, student:students(full_name, email)');

        for (const reg of registrants) {
          const student = (reg as any).student;
          if (!student?.email) continue;
          const emailKey = normalizeEmail(student.email);
          if (emailKey && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailKey) && !responseByEmail.has(emailKey)) {
            const regResponses = (reg as any).responses ?? {};
            responseByEmail.set(emailKey, { name: student.full_name, email: student.email, ...regResponses });
          }
        }
      } else {
        // Courses / VEs: all enrolled cohort students, filtered by segment
        const blastContent = blastCourse ?? blastVe;
        const cohortIds: string[] = Array.isArray(blastContent?.cohort_ids) ? blastContent.cohort_ids : [];

        let enrolledStudents: { id: string; full_name: string | null; email: string | null }[] = [];
        if (cohortIds.length > 0) {
          const targetCohorts = cohortId ? [cohortId] : cohortIds;
          const { data: cohortStudents } = await supabase
            .from('students')
            .select('id, full_name, email')
            .in('cohort_id', targetCohorts)
            .eq('role', 'student');
          enrolledStudents = cohortStudents || [];
        }

        // Filter by progress segment when requested
        if (segment !== 'all' && enrolledStudents.length > 0) {
          const enrolledIds = enrolledStudents.map((s: any) => s.id);
          const attemptTable  = isCourseBlast ? 'course_attempts'           : 'guided_project_attempts';
          const foreignKey    = isCourseBlast ? 'course_id'                 : 've_id';

          const { data: attempts } = await supabase
            .from(attemptTable)
            .select('student_id, completed_at')
            .eq(foreignKey, data.formId)
            .in('student_id', enrolledIds);

          const startedIds   = new Set((attempts || []).map((a: any) => String(a.student_id)));
          const completedIds = new Set(
            (attempts || []).filter((a: any) => !!a.completed_at).map((a: any) => String(a.student_id))
          );

          enrolledStudents = enrolledStudents.filter((s: any) => {
            if (segment === 'not_started') return !startedIds.has(String(s.id));
            if (segment === 'in_progress') return startedIds.has(String(s.id)) && !completedIds.has(String(s.id));
            if (segment === 'completed')   return completedIds.has(String(s.id));
            return true;
          });
        }

        // Fallback: if no cohorts are configured, read legacy responses table (all segment only)
        if (enrolledStudents.length === 0 && cohortIds.length === 0 && segment === 'all') {
          const { data: responses } = await supabase.from('responses').select('data').eq('form_id', data.formId);
          for (const response of responses || []) {
            const rowData = (response as any)?.data || {};
            const emailKey = normalizeEmail(rowData.email);
            if (emailKey && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailKey) && !responseByEmail.has(emailKey)) {
              responseByEmail.set(emailKey, rowData);
            }
          }
        }

        for (const student of enrolledStudents) {
          const emailKey = normalizeEmail(student.email);
          if (emailKey && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailKey) && !responseByEmail.has(emailKey)) {
            responseByEmail.set(emailKey, { name: student.full_name, email: student.email });
          }
        }
      }

      if (!responseByEmail.size) {
        return NextResponse.json({ error: 'No valid recipients found for this form' }, { status: 400 });
      }

      // Build all personalized email payloads first, then batch send
      type EmailPayload = Parameters<typeof resend.batch.send>[0][number];
      const emailBatch: EmailPayload[] = [];

      for (const [recipient, rowData] of responseByEmail) {
        const mergeValues: Record<string, string> = {
          name: resolveName(rowData) || 'there',
          email: recipient,
          form_title: String(data.formTitle || ''),
          event_title: String(data.eventTitle || data.formTitle || ''),
          event_date: String(data.eventDate || ''),
          event_time: String(data.eventTime || ''),
          event_timezone: String(data.eventTimezone || ''),
          event_location: String(data.eventLocation || ''),
          meeting_link: String(data.meetingLink || ''),
          form_url: String(data.formUrl || ''),
        };

        const personalizedSubject = applyMergeTags(String(data.subject || ''), mergeValues);
        const personalizedBody = applyMergeTags(String(data.body || ''), mergeValues);
        const personalizedHtml = blastEmail({
          ...data,
          subject: personalizedSubject,
          body: personalizedBody,
          branding,
        });

        emailBatch.push({ from: FROM, to: recipient, subject: personalizedSubject, html: personalizedHtml });
      }

      for (const batch of chunk(emailBatch, BATCH_SIZE)) {
        await resend.batch.send(batch);
      }

      // Increment daily blast quota
      await supabase.from('blast_quotas').upsert(
        { creator_id: blastCreatorId, date: today, count: currentCount + 1 },
        { onConflict: 'creator_id,date' }
      );

      return NextResponse.json({ success: true, count: responseByEmail.size });
    } else if (Array.isArray(to)) {
      await sendBatch(to, subject, html, FROM);
    } else if (typeof to === 'string') {
      await resend.emails.send({ from: FROM, to, subject, html });
      // Record idempotency key so this confirmation/course-result isn't sent twice
      if ((type === 'confirmation' || type === 'course-result') && data?.responseId) {
        await getAdminSupabase().from('sent_emails').insert({ response_id: data.responseId, type });
      }
    } else {
      return NextResponse.json({ error: 'Invalid recipient' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[email]', err);
    return NextResponse.json({ error: 'Failed to send email. Please try again.' }, { status: 500 });
  }
}
