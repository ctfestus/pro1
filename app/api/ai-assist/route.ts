import { generateJSON } from '@/lib/ai';
import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { getRedis } from '@/lib/redis';
import { bumpRateLimit } from '@/lib/rate-limit';
import {
  ALLOWED_ACTIONS, INTERACTIVE_ACTIONS, BLOCK_KIND_SET, MAX_TEXT, MAX_INSTRUCTION, MAX_CONTEXT,
  BLOCK_CALL_OPTS, TEXT_SCHEMA,
  buildTextPrompt, buildBlockPrompt, buildInstructionPrompt, usableBlocks, type BlockKind,
} from '@/lib/ai-assist-server';

// Inline "Ask AI" assistant for the authoring editors (lesson / VE / assignment).
// Acts on a SELECTION the instructor made -- distinct from the bulk generators
// (/api/ai-course, /api/ai-guided-project) which scaffold whole fields. Instructor/admin only.
//
// Text actions return { result: string }. Interactive actions return { kind: 'blocks',
// blocks: AiBlock[] } -- the shared lesson block tree (lib/lesson-blocks), so one response
// can carry any node the lesson editor supports, nested. A free instruction ("custom")
// answers either way when the caller sets allowBlocks, which only the lesson editor does;
// the contentEditable surfaces have nowhere to put a block, so they stay text-only.
// Prompt construction, schemas, and validation live in lib/ai-assist-server (unit-tested).

async function checkRateLimit(userId: string): Promise<NextResponse | null> {
  const redis = getRedis();
  if (!redis) {
    // Fail closed -- AI is a paid feature, don't allow through if limiter is down
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  try {
    if (await bumpRateLimit(redis, `rate:ai-assist:${userId}`, 40, 3600)) {
      return NextResponse.json(
        { error: 'AI assist limit reached. You can make up to 40 edits per hour.' },
        { status: 429 },
      );
    }
  } catch {
    // Redis error -- fail closed
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  return null;
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;

  const limited = await checkRateLimit(auth.user.id);
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? '');
  if (!ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  }

  const text = String(body?.text ?? '');
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: 'Selection is too long. Select a smaller passage.' }, { status: 413 });
  }
  if (action !== 'continue' && !text.trim()) {
    return NextResponse.json({ error: 'Nothing selected.' }, { status: 400 });
  }

  const instruction = String(body?.instruction ?? '').slice(0, MAX_INSTRUCTION);
  if (action === 'custom' && !instruction.trim()) {
    return NextResponse.json({ error: 'Enter an instruction.' }, { status: 400 });
  }
  const context = String(body?.contextText ?? '').slice(0, MAX_CONTEXT);
  const allowBlocks = body?.allowBlocks === true;

  const blockError = 'Could not build that block from the selection. Try a longer or different passage.';

  try {
    if (INTERACTIVE_ACTIONS.has(action)) {
      const kind = action.replace('make_', '');
      if (!BLOCK_KIND_SET.has(kind)) {
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
      }
      const raw = await generateJSON(buildBlockPrompt(kind as BlockKind, text, context), undefined, BLOCK_CALL_OPTS);
      const blocks = usableBlocks(raw?.blocks);
      if (!blocks) return NextResponse.json({ error: blockError }, { status: 502 });
      return NextResponse.json({ kind: 'blocks', blocks });
    }

    // A free instruction on the lesson editor may ask for a block instead of a rewrite.
    if (action === 'custom' && allowBlocks) {
      const out = await generateJSON(buildInstructionPrompt(text, instruction, context), undefined, BLOCK_CALL_OPTS);
      if (String(out?.mode ?? '').trim() === 'blocks') {
        const blocks = usableBlocks(out?.blocks);
        if (blocks) return NextResponse.json({ kind: 'blocks', blocks });
      }
      const written = String(out?.result ?? '').trim();
      if (written) return NextResponse.json({ result: written });
      return NextResponse.json({ error: blockError }, { status: 502 });
    }

    const out = await generateJSON(buildTextPrompt(action, text, instruction, context), TEXT_SCHEMA, { temperature: action === 'grammar' ? 0.2 : 0.6 });
    const result = String(out?.result ?? '').trim();
    if (!result) {
      return NextResponse.json({ error: 'No result generated. Please try again.' }, { status: 502 });
    }
    return NextResponse.json({ result });
  } catch (e) {
    console.warn('[ai-assist] failed:', (e as Error).message);
    return NextResponse.json({ error: 'Generation failed. Please try again.' }, { status: 502 });
  }
}
