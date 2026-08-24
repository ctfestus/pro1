import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { adminClient } from '@/lib/admin-client';
import { requireRole, requireUser, isAuthError } from '@/lib/api-auth';
import { normalizeQuestions } from '@/lib/course-schema';
import { cloudinary, extractPublicId } from '@/lib/cloudinary-server';

export const dynamic = 'force-dynamic';

function shortSlug() {
  return randomBytes(5).toString('base64url').slice(0, 7).toLowerCase();
}

// Resolve a stored image value to a Cloudinary public_id (null for non-Cloudinary values).
function toPublicId(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.includes('res.cloudinary.com')) return extractPublicId(v);
  if (/^(https?:|data:|blob:|\/)/.test(v)) return null;
  return v;
}

async function deleteCloudinaryUrls(urls: (string | undefined | null)[]) {
  const ids = [...new Set(
    urls.filter((u): u is string => !!u).map(toPublicId).filter((id): id is string => !!id),
  )];
  await Promise.all(ids.map(id =>
    cloudinary.uploader.destroy(id).catch(e => console.error('[certifications] cloudinary delete failed:', id, e?.message)),
  ));
}

// Shared runnable-playground data: keep only well-formed table/dataset entries and the setup strings.
// No answer keys live here, so it is safe to store and later ship to the client with the exam.
function normalizePlaygroundData(pd: any) {
  if (!pd || typeof pd !== 'object') return {};
  const sqlTables = Array.isArray(pd.sqlTables)
    ? pd.sqlTables
        .filter((t: any) => t?.tableName && (t.fileUrl || t.csvUrl || t.seedSql))
        .map((t: any) => ({ id: t.id, tableName: String(t.tableName), fileName: t.fileName, fileUrl: t.fileUrl, csvUrl: t.csvUrl, seedSql: t.seedSql }))
    : [];
  const pythonDatasets = Array.isArray(pd.pythonDatasets)
    ? pd.pythonDatasets
        .filter((d: any) => d?.variableName && (d.fileUrl || d.csvUrl))
        .map((d: any) => ({ id: d.id, variableName: String(d.variableName), fileName: d.fileName, fileUrl: d.fileUrl, csvUrl: d.csvUrl }))
    : [];
  const out: any = {};
  if (sqlTables.length) out.sqlTables = sqlTables;
  if (pythonDatasets.length) out.pythonDatasets = pythonDatasets;
  if (String(pd.setupSql ?? '').trim()) out.setupSql = String(pd.setupSql);
  if (String(pd.setupPython ?? '').trim()) out.setupPython = String(pd.setupPython);
  return out;
}

// Map a normalized CertificationConfig (client) into certifications table columns.
function toRow(config: any) {
  return {
    cert_type:       config.certType === 'career' ? 'career' : 'technology',
    cover_image:     config.coverImage ?? null,
    badge_image_url: config.badgeImageUrl ?? null,
    questions:       normalizeQuestions(config.questions),
    practice_questions: normalizeQuestions(Array.isArray(config.practiceQuestions) ? config.practiceQuestions : []),
    // Clamp to satisfy the DB CHECK constraints regardless of client input.
    passmark:        Math.max(0, Math.min(100, Number.isFinite(Number(config.passmark)) ? Number(config.passmark) : 70)),
    time_limit:      Number(config.timeLimit) > 0 ? Number(config.timeLimit) : null,  // 0 / blank = untimed
    max_attempts:    Math.max(0, Number.isFinite(Number(config.maxAttempts)) ? Number(config.maxAttempts) : 1),
    retake_cooldown_hours: Math.max(0, Number.isFinite(Number(config.retakeCooldownHours)) ? Number(config.retakeCooldownHours) : 24),
    exam_protection: config.examProtection !== false,
    deadline_days:   config.deadline_days != null ? Number(config.deadline_days) : null,
    learn_outcomes:  config.learnOutcomes ?? [],
    // Foundation assets
    skill_areas:           Array.isArray(config.skillAreas)
      ? config.skillAreas.filter((s: any) => s?.id && String(s?.name ?? '').trim()).map((s: any) => ({ id: String(s.id), name: String(s.name).trim() }))
      : [],
    scenarios:             Array.isArray(config.scenarios)
      ? config.scenarios.filter((s: any) => s?.id && (String(s?.title ?? '').trim() || String(s?.content ?? '').trim()))
          .map((s: any) => ({ id: String(s.id), title: String(s.title ?? '').trim(), content: String(s.content ?? '') }))
      : [],
    study_guide_url:       config.studyGuideUrl ?? null,
    study_guide_name:      config.studyGuideName ?? null,
    study_guide_published: config.studyGuidePublished === true,
    poster_url:            config.posterUrl ?? null,
    poster_published:      config.posterPublished === true,
    practice_test_url:     config.practiceTestUrl?.trim() || null,
    prep_items:            Array.isArray(config.prepItems)
      ? config.prepItems
          .filter((p: any) => p?.id && (p?.type === 'course' || p?.type === 'path'))
          .map((p: any) => ({ id: String(p.id), type: p.type }))
      : [],
    playground_data:       normalizePlaygroundData(config.playgroundData),
    randomize_questions:   config.randomizeQuestions === true,
    shuffle_options:       config.shuffleOptions === true,
    question_pool_size:    Number(config.questionPoolSize) > 0 ? Math.floor(Number(config.questionPoolSize)) : null,
    theme:           config.theme ?? null,
    mode:            config.mode ?? null,
    font:            config.font ?? null,
    custom_accent:   config.customAccent ?? null,
  };
}

// Certifications may only contain auto-gradable exam types. Notably sql_exercise is rejected: its
// expected result would have to ship to the client (self-gradeable), and AI-review types aren't exams.
const EXAM_QUESTION_TYPES = new Set(['multiple_choice', 'fill_blank', 'arrange', 'image', 'image_choice', 'code', 'python_exercise']);
function invalidExamType(questions: any): string | null {
  for (const q of (Array.isArray(questions) ? questions : [])) {
    const type = q?.type ?? 'multiple_choice';
    if (!EXAM_QUESTION_TYPES.has(type)) return type;
  }
  return null;
}

async function upsertCohortAssignments(
  supabase: ReturnType<typeof adminClient>,
  contentId: string,
  cohortIds: string[],
) {
  if (!cohortIds.length) return;
  const rows = cohortIds.map(cohortId => ({ content_type: 'certification', content_id: contentId, cohort_id: cohortId }));
  const { error } = await supabase
    .from('cohort_assignments')
    .upsert(rows, { onConflict: 'content_id,cohort_id', ignoreDuplicates: true });
  if (error) console.error('[certifications] cohort_assignments upsert error:', error.message);
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { title, description, slug: preferredSlug, cohort_ids, available_to_everyone, status: bodyStatus } = body;
  const config = body.config ?? {};
  const badType = invalidExamType(config.questions) || invalidExamType(config.practiceQuestions);
  if (badType) return NextResponse.json({ error: `Unsupported question type for certifications: ${badType}` }, { status: 400 });
  const status = bodyStatus === 'draft' ? 'draft' : 'published';

  const base = {
    user_id:     user.id,
    title:       title ?? config.title ?? 'Untitled',
    description: description ?? config.description ?? null,
    status,
    cohort_ids:  available_to_everyone === true ? [] : (cohort_ids ?? []),
    available_to_everyone: available_to_everyone === true,
    ...toRow(config),
  };

  let attempt = 0;
  let slug = preferredSlug?.trim() || shortSlug();
  while (attempt < 3) {
    if (attempt > 0) slug = shortSlug();
    const { data, error } = await supabase
      .from('certifications')
      .insert({ ...base, slug })
      .select('id, slug, status')
      .single();

    if (!error) {
      if (base.cohort_ids.length && status === 'published') {
        await upsertCohortAssignments(supabase, data.id, base.cohort_ids);
      }
      return NextResponse.json({ id: data.id, slug: data.slug, status: data.status });
    }
    if (error.code === '23505') { attempt++; continue; }
    console.error('[certifications] insert error:', error.message);
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 });
  }
  return NextResponse.json({ error: 'Could not generate a unique URL. Try a custom slug.' }, { status: 409 });
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase, role } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { id, title, description, slug: preferredSlug, cohort_ids, available_to_everyone, status: bodyStatus } = body;
  if (!id || !body.config) return NextResponse.json({ error: 'id and config are required' }, { status: 400 });

  const { data: existing } = await supabase
    .from('certifications').select('id, user_id, status, cohort_ids, available_to_everyone').eq('id', id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.user_id !== user.id && role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const config = body.config ?? {};
  const badType = invalidExamType(config.questions) || invalidExamType(config.practiceQuestions);
  if (badType) return NextResponse.json({ error: `Unsupported question type for certifications: ${badType}` }, { status: 400 });
  const status = bodyStatus === 'draft' ? 'draft' : (bodyStatus === 'published' ? 'published' : existing.status);
  const slugValue = preferredSlug?.trim() || undefined;
  const submittedCohorts = Array.isArray(cohort_ids) && cohort_ids.length > 0;
  const effectiveAvailableToEveryone = submittedCohorts
    ? false
    : (available_to_everyone ?? existing.available_to_everyone ?? false);

  const payload: any = {
    title:       title ?? config.title ?? 'Untitled',
    description: description ?? config.description ?? null,
    status,
    cohort_ids:  effectiveAvailableToEveryone ? [] : (cohort_ids ?? existing.cohort_ids ?? []),
    available_to_everyone: effectiveAvailableToEveryone,
    ...toRow(config),
    ...(slugValue ? { slug: slugValue } : {}),
  };

  const { error } = await supabase.from('certifications').update(payload).eq('id', id);
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'slug already taken' }, { status: 409 });
    console.error('[certifications] update error:', error.message);
    return NextResponse.json({ error: 'Failed to update.' }, { status: 500 });
  }

  // Sync cohort_assignments: add new, remove dropped
  const prev = existing.cohort_ids ?? [];
  const next = payload.cohort_ids ?? [];
  const removed = prev.filter((c: string) => !next.includes(c));
  const added = next.filter((c: string) => !prev.includes(c));
  if (removed.length) {
    await supabase.from('cohort_assignments').delete().eq('content_id', id).in('cohort_id', removed);
  }
  if (added.length && status === 'published') {
    await upsertCohortAssignments(supabase, id, added);
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase, role } = auth;

  let id: string, status: string;
  try {
    ({ id, status } = await req.json());
    if (!id || !['draft', 'published', 'archived'].includes(status)) throw new Error();
  } catch {
    return NextResponse.json({ error: 'id and status required' }, { status: 400 });
  }

  const { data: existing } = await supabase.from('certifications').select('user_id').eq('id', id).maybeSingle();
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (existing.user_id !== user.id && role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error } = await supabase.from('certifications').update({ status }).eq('id', id);
  if (error) return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { data: row } = await supabase
    .from('certifications').select('user_id, cover_image, poster_url, study_guide_url, questions, practice_questions').eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: profile } = await supabase.from('students').select('role').eq('id', user.id).single();
  if (row.user_id !== user.id && profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Clean up Cloudinary cover + poster + study-guide PDF + question images (single imageUrl and
  // image-question optionImages) before deleting (cascade removes attempts).
  const allQuestions = [...((row.questions ?? []) as any[]), ...((row.practice_questions ?? []) as any[])];
  await deleteCloudinaryUrls([
    row.cover_image,
    row.poster_url,
    row.study_guide_url,
    ...allQuestions.map(q => q?.imageUrl),
    ...allQuestions.flatMap(q => Array.isArray(q?.optionImages) ? q.optionImages : []),
  ]);

  const { error } = await supabase.from('certifications').delete().eq('id', id);
  if (error) {
    console.error('[certifications] delete error:', error.message);
    return NextResponse.json({ error: 'Failed to delete.' }, { status: 500 });
  }
  await supabase.from('cohort_assignments').delete().eq('content_id', id);
  return NextResponse.json({ ok: true });
}
