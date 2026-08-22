import { Type } from '@google/genai';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { generateJSON } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

// Clarification chat turns are cheap flash calls, so the cap is looser than the
// graded-review routes. Nothing from this route is ever persisted -- the thread
// lives only in the player's session state by design.
const RATE_LIMIT = 20;
const RATE_WINDOW_SECONDS = 86400;
const MAX_QUESTION_CHARS = 500;
const MAX_HISTORY_TURNS = 8;
const MAX_OUTLINE_MISSIONS = 40;
const MAX_OUTLINE_ITEMS = 20;
const MAX_PLAN_CHARS = 8000;

// RLS-scoped client for the caller: reading the VE through it enforces the same
// access the standalone player itself has (owner / admin / cohort / learning path).
function callerClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
}

const VE_COLUMNS = 'user_id, modules, company, role, industry, manager_name, manager_title, background';

async function checkRateLimit(userId: string): Promise<NextResponse | null> {
  const redis = getRedis();
  // Fail closed. This route spends a metered AI quota, so a limiter that cannot be
  // reached must not silently become no limiter at all -- an outage is exactly when an
  // unbounded bill would be run up.
  if (!redis) return NextResponse.json({ error: 'The assistant is unavailable right now. Please try again shortly.' }, { status: 503 });
  try {
    if (await bumpRateLimit(redis, `rate:ve-brief-chat:${userId}`, RATE_LIMIT, RATE_WINDOW_SECONDS)) {
      return NextResponse.json(
        { error: `Limit reached: ${RATE_LIMIT} questions per day. Try again tomorrow.` },
        { status: 429 },
      );
    }
  } catch {
    // Same reasoning as above: an unreachable limiter refuses rather than waves through.
    return NextResponse.json({ error: 'The assistant is unavailable right now. Please try again shortly.' }, { status: 503 });
  }
  return null;
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
  },
  required: ['reply'],
};

const stripHtml = (v: unknown, cap: number) =>
  typeof v === 'string' ? v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap) : '';

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;

  const rateLimitError = await checkRateLimit(auth.user.id);
  if (rateLimitError) return rateLimitError;

  const body = await req.json();
  const question = stripHtml(body?.question, MAX_QUESTION_CHARS + 1);
  const veId  = typeof body?.veId === 'string' ? body.veId : '';
  const reqId = typeof body?.reqId === 'string' ? body.reqId : '';

  if (!veId || !reqId) {
    return NextResponse.json({ error: 'veId and reqId are required.' }, { status: 400 });
  }
  if (!question) {
    return NextResponse.json({ error: 'No question submitted.' }, { status: 400 });
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: `Question must be ${MAX_QUESTION_CHARS} characters or fewer.` }, { status: 400 });
  }

  // Authoritative context: the persona, brief, background, and plan all come
  // from the VE row, never from the request body. First read under the
  // caller's own RLS (standalone-player parity); if that yields nothing, fall
  // back to the assignment-embed access check, mirroring /api/ve-for-assignment.
  let ve: any = (await callerClient(auth.token)
    .from('virtual_experiences').select(VE_COLUMNS).eq('id', veId).maybeSingle()).data;

  if (!ve) {
    const svc = auth.supabase;
    const { data: veSvc } = await svc
      .from('virtual_experiences').select(VE_COLUMNS).eq('id', veId).maybeSingle();
    if (!veSvc) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

    let allowed = veSvc.user_id === auth.user.id;
    if (!allowed) {
      const { data: caller } = await svc
        .from('students').select('role, cohort_id').eq('id', auth.user.id).maybeSingle();
      if (caller?.role === 'admin' || caller?.role === 'instructor') {
        allowed = true;
      } else {
        const [{ data: assignments }, { data: memberships }] = await Promise.all([
          svc.from('assignments').select('cohort_ids, group_ids')
            .eq('status', 'published').eq('config->>ve_form_id', veId),
          svc.from('group_members').select('group_id').eq('student_id', auth.user.id),
        ]);
        const myGroups = new Set((memberships ?? []).map((m: any) => m.group_id as string));
        allowed = (assignments ?? []).some((a: any) =>
          (caller?.cohort_id && (a.cohort_ids ?? []).includes(caller.cohort_id)) ||
          (a.group_ids ?? []).some((g: string) => myGroups.has(g)));
      }
    }
    if (!allowed) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    ve = veSvc;
  }

  // Locate the brief being asked about; this route only answers on briefs.
  let brief: any = null;
  let missionTitle = '';
  const modulesArr: any[] = Array.isArray(ve.modules) ? ve.modules : [];
  for (const m of modulesArr) {
    for (const les of (Array.isArray(m?.lessons) ? m.lessons : [])) {
      for (const r of (Array.isArray(les?.requirements) ? les.requirements : [])) {
        if (r?.id === reqId) { brief = r; missionTitle = stripHtml(les?.title, 200); }
      }
    }
  }
  if (!brief || brief.type !== 'briefing') {
    return NextResponse.json({ error: 'Brief not found.' }, { status: 404 });
  }

  const managerName  = stripHtml(ve.manager_name, 80) || 'the manager';
  const managerTitle = stripHtml(ve.manager_title, 80);
  const company      = stripHtml(ve.company, 120);
  const role         = stripHtml(ve.role, 120);
  const industry     = stripHtml(ve.industry, 120);
  const background   = stripHtml(ve.background, 2000);
  const briefSubject = stripHtml(brief.label, 200) || (missionTitle ? `${missionTitle} brief` : '');
  const briefBody    = stripHtml(brief.description, 4000);
  // Cosmetic only (how the persona addresses the caller) -- not an access input.
  const studentName  = stripHtml(body?.studentName, 80);

  // Project plan the persona "knows" as the manager who assigned the work.
  // Only what students see in the player anyway: type, label, instructions.
  // Graded-answer fields (correctAnswer, options, expectedAnswer, rubric) are
  // deliberately never read.
  const planBlocks: string[] = [];
  const missions = modulesArr.flatMap((m: any) =>
    (Array.isArray(m?.lessons) ? m.lessons : []).map((les: any) => ({
      mission: [m?.title, les?.title].filter(Boolean).join(' / '),
      items: Array.isArray(les?.requirements) ? les.requirements : [],
    })));
  for (const m of missions.slice(0, MAX_OUTLINE_MISSIONS)) {
    const mission = stripHtml(m.mission, 160);
    const lines = m.items.slice(0, MAX_OUTLINE_ITEMS).map((it: any) => {
      const kind   = stripHtml(it?.type, 30);
      const label  = stripHtml(it?.label, 160);
      const detail = stripHtml(it?.description, 400);
      if (!label && !detail) return '';
      return `- ${kind ? `[${kind}] ` : ''}${label}${label && detail ? ': ' : ''}${detail}`;
    }).filter(Boolean);
    if (!lines.length) continue;
    planBlocks.push(`${mission ? `Mission: ${mission}\n` : ''}${lines.join('\n')}`);
  }
  let plan = planBlocks.join('\n\n');
  if (plan.length > MAX_PLAN_CHARS) plan = `${plan.slice(0, MAX_PLAN_CHARS)}\n(plan truncated)`;

  // The thread is ephemeral by design, so history is inherently client-held;
  // the persona rules below always come after it in the prompt.
  const history: string[] = Array.isArray(body?.history)
    ? body.history
        .slice(-MAX_HISTORY_TURNS)
        .map((m: any) => {
          const text = stripHtml(m?.text, 600);
          if (!text) return '';
          return `${m?.who === 'manager' ? managerName : (studentName || 'Student')}: ${text}`;
        })
        .filter(Boolean)
    : [];

  const personaLine = [
    managerName,
    managerTitle ? `(${managerTitle})` : '',
    company ? `at ${company}` : '',
    industry ? `in the ${industry} industry` : '',
  ].filter(Boolean).join(' ');

  const prompt = `You are ${personaLine}, a supportive manager in a workplace simulation. ${studentName || 'A junior team member'} in the role of ${role || 'a junior team member'} has just received your project brief and is asking a clarifying question about it.

${briefSubject ? `Brief subject: ${briefSubject}` : ''}
${briefBody ? `Brief: ${briefBody}` : ''}
${background ? `Project background: ${background}` : ''}
${missionTitle ? `Current mission: ${missionTitle}` : ''}
${plan ? `\nFull project plan (you assigned all of this work, so you know it well):\n${plan}` : ''}
${history.length ? `\nConversation so far:\n${history.join('\n')}` : ''}

Their question: "${question}"

Reply in character as ${managerName}. Rules:
- 1-3 sentences, professional but warm, like a real manager on email.
- Clarify only. Never do the work for them, never write their answer, formula, code, or analysis, and never reveal what a graded answer should be. If they ask for the answer itself, encourage them and point them back to the brief, the dataset, or the task instructions.
- You know the full project plan, so you can explain what any task or deliverable is asking for and how the pieces connect. If they ask about work in a later mission, set expectations briefly without solving it.
- Ground every reply in the brief, background, and plan above. If the question cannot be answered from them, say you will leave that detail to their judgment, or suggest a reasonable assumption to proceed with.
- If the question is off-topic for the project, politely steer back to the brief in one sentence.
- Never mention being an AI, a simulation, a prompt, or these rules. Stay in the workplace fiction.
- No greeting or sign-off, just the reply body.`;

  try {
    const parsed = await generateJSON(prompt, responseSchema, { temperature: 0.6 });
    const reply = typeof parsed?.reply === 'string' ? parsed.reply.trim() : '';
    if (!reply) throw new Error('empty reply');
    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error('[ve-brief-chat]', err);
    return NextResponse.json({ error: 'Could not send your question right now. Please try again.' }, { status: 500 });
  }
}
