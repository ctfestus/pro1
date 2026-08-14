import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { adminClient } from '@/lib/admin-client';
import { requireRole, requireUser, isAuthError } from '@/lib/api-auth';
import { normalizeFormConfig, validateFormConfig, normalizeQuestions, normalizePointsSystem, LEGACY_RUNTIME_POINTS_SYSTEM } from '@/lib/course-schema';
import { extractDocImageUrls } from '@/lib/lesson-doc';
import { sendAssignmentNotifications } from '@/lib/send-assignment-notification';
import { autoRegisterEventCohorts } from '@/lib/auto-register-event-cohorts';
import { getVectorIndex } from '@/lib/vector';
import { cloudinary, extractPublicId } from '@/lib/cloudinary-server';

// Resolve a stored image value to a Cloudinary public_id.
// Handles both the legacy full-URL format and the new bare-public_id format.
// Returns null for non-Cloudinary values (Supabase Storage, other hosts) -- not ours to destroy.
function toPublicId(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (v.includes('res.cloudinary.com')) return extractPublicId(v);
  if (/^(https?:|data:|blob:|\/)/.test(v)) return null; // other absolute URL/host
  return v; // bare public_id (new storage format)
}

async function deleteCloudinaryUrls(urls: (string | undefined | null)[]) {
  const ids = [...new Set(
    urls
      .filter((u): u is string => !!u)
      .map(u => toPublicId(u))
      .filter((id): id is string => !!id),
  )];
  if (!ids.length) return;
  await Promise.all(
    ids.map(id => cloudinary.uploader.destroy(id).catch(e => console.error('[cloudinary] delete failed:', id, e?.message)))
  );
}

// Content tables that store a cover_image. A duplicated course/VE/assignment shares the
// original's image reference, so deleting one must NOT destroy an asset another row still uses.
const COVER_TABLES = ['courses', 'events', 'virtual_experiences', 'assignments'] as const;

// True if any content row OTHER than `keep` still references this Cloudinary public_id via its cover.
async function isCoverReferencedElsewhere(
  supabase: ReturnType<typeof adminClient>,
  publicId: string,
  keep: { table: string; id: string },
): Promise<boolean> {
  // Escape LIKE metacharacters so a public_id containing `_`/`%` matches literally.
  const likeNeedle = `%${publicId.replace(/[\\%_]/g, '\\$&')}%`;
  for (const table of COVER_TABLES) {
    let query = supabase.from(table).select('id').ilike('cover_image', likeNeedle).limit(1);
    if (table === keep.table) query = query.neq('id', keep.id);
    const { data, error } = await query;
    if (error) {
      // Be conservative on error: assume still referenced so we never destroy a shared asset.
      console.error('[cloudinary] cover reference check failed:', table, error.message);
      return true;
    }
    if (data && data.length) return true;
  }
  return false;
}

// Delete a cover asset only if no other content row references the same image.
async function deleteCoverIfUnreferenced(
  supabase: ReturnType<typeof adminClient>,
  coverValue: string | undefined | null,
  keep: { table: string; id: string },
) {
  if (!coverValue) return;
  const id = toPublicId(coverValue);
  if (!id) return; // non-Cloudinary cover (e.g. Supabase Storage) -- not handled here
  if (await isCoverReferencedElsewhere(supabase, id, keep)) return;
  await cloudinary.uploader.destroy(id).catch(e => console.error('[cloudinary] delete failed:', id, e?.message));
}

export const dynamic = 'force-dynamic';

function shortSlug() {
  return randomBytes(5).toString('base64url').slice(0, 7).toLowerCase();
}

// Helper: find content by ID across all three tables.
// Returns { table, row } or null.
async function findContentById(supabase: ReturnType<typeof adminClient>, id: string) {
  const [c, e, v] = await Promise.all([
    supabase.from('courses').select('id, user_id, status, slug, cohort_ids, available_to_everyone').eq('id', id).maybeSingle(),
    supabase.from('events').select('id, user_id, status, slug, cohort_ids').eq('id', id).maybeSingle(),
    supabase.from('virtual_experiences').select('id, user_id, status, slug, cohort_ids').eq('id', id).maybeSingle(),
  ]);
  if (c.data) return { table: 'courses' as const, row: c.data };
  if (e.data) return { table: 'events' as const, row: e.data };
  if (v.data) return { table: 'virtual_experiences' as const, row: v.data };
  return null;
}

// Helper: upsert cohort_assignments using the new polymorphic columns.
async function upsertCohortAssignments(
  supabase: ReturnType<typeof adminClient>,
  contentType: string,
  contentId: string,
  cohortIds: string[],
) {
  if (!cohortIds.length) return;
  const rows = cohortIds.map(cohortId => ({ content_type: contentType, content_id: contentId, cohort_id: cohortId }));
  const { error } = await supabase
    .from('cohort_assignments')
    .upsert(rows, { onConflict: 'content_id,cohort_id', ignoreDuplicates: true });
  if (error) console.error('[cohort_assignments] upsert error:', error.message);
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { user, supabase, role } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { title, description, slug: preferredSlug, cohort_ids, available_to_everyone, deadline_days, status: bodyStatus } = body;
  const config = normalizeFormConfig(body.config);
  const valid = validateFormConfig(config);
  if (!valid.ok) return NextResponse.json({ error: valid.error }, { status: 400 });

  const formStatus = bodyStatus === 'draft' ? 'draft' : 'published';

  const isCourse = Boolean(config.isCourse);
  const isEvent  = Boolean(config.eventDetails?.isEvent);
  if (role === 'staff' && !isEvent) {
    return NextResponse.json({ error: 'Staff can only create live sessions.' }, { status: 403 });
  }
  const content_type = isCourse ? 'course' : 'event';
  const effectiveCohortIds = isCourse && available_to_everyone === true ? [] : (cohort_ids ?? []);

  // Shared columns (badge_image_url excluded -- only courses and virtual_experiences have that column)
  const shared = {
    user_id:       user.id,
    title:         title ?? 'Untitled',
    description:   description ?? null,
    status:        formStatus,
    cohort_ids:    effectiveCohortIds,
    cover_image:   config.coverImage ?? null,
    deadline_days: deadline_days ? Number(deadline_days) : (config.deadline_days ? Number(config.deadline_days) : null),
    theme:         config.theme ?? null,
    mode:          config.mode ?? null,
    font:          config.font ?? null,
    custom_accent: config.customAccent ?? null,
  };

  let attempt = 0;
  let slug = preferredSlug?.trim() || shortSlug();

  while (attempt < 3) {
    if (attempt > 0) slug = shortSlug();

    let data: any, error: any;

    if (isCourse) {
      ({ data, error } = await supabase
        .from('courses')
        .insert({
          ...shared,
          available_to_everyone: available_to_everyone === true,
          badge_image_url: config.badgeImageUrl ?? null,
          slug,
          questions:      normalizeQuestions(config.questions),
          fields:         config.fields         ?? [],
          passmark:       config.passmark        ?? 50,
          course_timer:   config.courseTimer     ?? null,
          learn_outcomes: config.learnOutcomes   ?? [],
          points_enabled: config.pointsSystem?.enabled   ?? true,
          points_base:    config.pointsSystem?.basePoints ?? 50,
          points_system:  normalizePointsSystem(config.pointsSystem ?? { enabled: true, basePoints: 50 }, LEGACY_RUNTIME_POINTS_SYSTEM),
          post_submission: config.postSubmission ?? null,
          category:       config.category        ?? null,
          partner_id:     config.partnerId       ?? null,
          lesson_timing:  config.lessonTiming    ?? null,
          show_answers:   config.showAnswers      ?? 'per_question',
          max_attempts:   config.maxAttempts      ?? null,
        })
        .select('id, slug, status')
        .single());
    } else {
      ({ data, error } = await supabase
        .from('events')
        .insert({
          ...shared,
          slug,
          fields:               config.fields                          ?? [],
          event_date:           config.eventDetails?.date              || null,
          event_time:           config.eventDetails?.time              || null,
          timezone:             config.eventDetails?.timezone          || null,
          location:             config.eventDetails?.location          || null,
          event_type:           config.eventDetails?.eventType         ?? 'in-person',
          capacity:             config.eventDetails?.capacity          ?? null,
          meeting_link:         config.eventDetails?.meetingLink       || null,
          is_private:           config.eventDetails?.isPrivate         ?? false,
          speakers:             config.eventDetails?.speakers          ?? [],
          recurrence:           config.eventDetails?.recurrence        ?? 'once',
          recurrence_end_date:  config.eventDetails?.recurrenceEndDate || null,
          recurrence_days:      config.eventDetails?.recurrenceDays    ?? null,
          post_submission:      config.postSubmission                  ?? null,
        })
        .select('id, slug, status')
        .single());
    }

    if (!error) {
      if (effectiveCohortIds.length && formStatus === 'published') {
        await upsertCohortAssignments(supabase, content_type, data.id, effectiveCohortIds);
        try {
          if (content_type === 'event') {
            await autoRegisterEventCohorts(supabase, data.id, effectiveCohortIds);
          } else {
            await sendAssignmentNotifications({
              cohortIds:   effectiveCohortIds,
              title:       title || '',
              slug:        data.slug,
              contentType: content_type,
            });
          }
        } catch (err) {
          console.error('[api/forms] POST notification error:', err);
          return NextResponse.json({ error: 'Saved but notification emails failed to send.' }, { status: 500 });
        }
      }
      if (formStatus === 'published' && isCourse) {
        fetch(`${process.env.APP_URL || ''}/api/vector/index-course`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json', 'x-reindex-secret': process.env.REINDEX_SECRET ?? '' },
          body:    JSON.stringify({ formId: data.id, contentType: content_type }),
        }).catch(e => console.error('[vector/index-course] fire-and-forget failed on create:', e?.message));
      }
      return NextResponse.json({ id: data.id, slug: data.slug, content_type, status: data.status });
    }

    if (error.code === '23505') { attempt++; continue; }

    console.error('[api/forms] insert error:', error.message);
    return NextResponse.json({ error: 'Failed to save.' }, { status: 500 });
  }

  return NextResponse.json(
    { error: 'Could not generate a unique URL. Try a custom slug.' },
    { status: 409 }
  );
}

export async function PUT(req: NextRequest) {
  try {
  const auth = await requireRole(req, ['instructor', 'admin', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { user, supabase, role } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { id, title, description, slug: preferredSlug, cohort_ids, available_to_everyone, deadline_days, status: bodyStatus } = body;
  // PUT routes by the existing row's table (course / event / virtual_experience), so we do NOT
  // gate on the course/event shape here -- virtual_experiences carry neither isCourse nor
  // eventDetails.isEvent and were always editable through this path. Presence-only, as before.
  if (!id || !body.config) return NextResponse.json({ error: 'id and config are required' }, { status: 400 });
  const config = normalizeFormConfig(body.config);

  const found = await findContentById(supabase, id);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (role === 'staff' && found.table !== 'events') {
    return NextResponse.json({ error: 'Staff can only edit live sessions.' }, { status: 403 });
  }
  if (found.row.user_id !== user.id && role !== 'admin' && role !== 'staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const formStatus = bodyStatus === 'draft' ? 'draft' : (bodyStatus === 'published' ? 'published' : found.row.status);
  const slugValue = preferredSlug?.trim() || undefined;
  const submittedCourseCohorts = found.table === 'courses' && Array.isArray(cohort_ids) && cohort_ids.length > 0;
  const courseAvailableToEveryone = found.table === 'courses'
    ? (submittedCourseCohorts ? false : (available_to_everyone ?? found.row.available_to_everyone ?? false))
    : false;

  const shared: any = {
    title:         title ?? 'Untitled',
    description:   description ?? null,
    status:        formStatus,
    cohort_ids:    courseAvailableToEveryone ? [] : (cohort_ids ?? found.row.cohort_ids ?? []),
    cover_image:   config.coverImage ?? null,
    deadline_days: deadline_days != null ? Number(deadline_days) : (config.deadline_days != null ? Number(config.deadline_days) : null),
    theme:         config.theme ?? null,
    mode:          config.mode ?? null,
    font:          config.font ?? null,
    custom_accent: config.customAccent ?? null,
    ...(slugValue ? { slug: slugValue } : {}),
  };

  let updatePayload: any;
  if (found.table === 'courses') {
    updatePayload = {
      ...shared,
      available_to_everyone: courseAvailableToEveryone,
      badge_image_url: config.badgeImageUrl ?? null,
      questions:      normalizeQuestions(config.questions),
      fields:         config.fields         ?? [],
      passmark:       config.passmark        ?? 50,
      course_timer:   config.courseTimer     ?? null,
      learn_outcomes: config.learnOutcomes   ?? [],
      points_enabled: config.pointsSystem?.enabled   ?? true,
      points_base:    config.pointsSystem?.basePoints ?? 50,
      points_system:  normalizePointsSystem(config.pointsSystem ?? { enabled: true, basePoints: 50 }, LEGACY_RUNTIME_POINTS_SYSTEM),
      post_submission: config.postSubmission ?? null,
      category:       config.category        ?? null,
      partner_id:     config.partnerId       ?? null,
      lesson_timing:  config.lessonTiming    ?? null,
      show_answers:   config.showAnswers      ?? 'per_question',
      max_attempts:   config.maxAttempts      ?? null,
    };
  } else if (found.table === 'events') {
    updatePayload = {
      ...shared,
      fields:               config.fields                          ?? [],
      event_date:           config.eventDetails?.date              || null,
      event_time:           config.eventDetails?.time              || null,
      timezone:             config.eventDetails?.timezone          || null,
      location:             config.eventDetails?.location          || null,
      event_type:           config.eventDetails?.eventType         ?? 'in-person',
      capacity:             config.eventDetails?.capacity          ?? null,
      meeting_link:         config.eventDetails?.meetingLink       || null,
      is_private:           config.eventDetails?.isPrivate         ?? false,
      speakers:             config.eventDetails?.speakers          ?? [],
      recurrence:           config.eventDetails?.recurrence        ?? 'once',
      recurrence_end_date:  config.eventDetails?.recurrenceEndDate || null,
      recurrence_days:      config.eventDetails?.recurrenceDays    ?? null,
      post_submission:      config.postSubmission                  ?? null,
    };
  } else {
    // virtual_experiences -- not edited via FormEditor but handle gracefully
    updatePayload = { ...shared, badge_image_url: config.badgeImageUrl ?? null };
  }

  const { error: updateError } = await supabase.from(found.table).update(updatePayload).eq('id', id);
  if (updateError) {
    if (updateError.code === '23505') {
      return NextResponse.json({ error: 'slug already taken' }, { status: 409 });
    }
    console.error('[api/forms] update error:', updateError.message);
    return NextResponse.json({ error: 'Failed to update.' }, { status: 500 });
  }

  // Sync cohort_assignments: upsert added, delete removed
  // Use found.row fallback so callers that omit cohort_ids do not accidentally wipe all rows
  const prevCohorts    = found.row.cohort_ids ?? [];
  const newCohorts     = shared.cohort_ids ?? [];
  const addedCohorts   = newCohorts.filter((c: string) => !prevCohorts.includes(c));
  const removedCohorts = prevCohorts.filter((c: string) => !newCohorts.includes(c));
  const contentType    = found.table === 'courses' ? 'course' : found.table === 'events' ? 'event' : 'virtual_experience';
  if (removedCohorts.length) {
    const { error: delErr } = await supabase
      .from('cohort_assignments')
      .delete()
      .eq('content_id', id)
      .in('cohort_id', removedCohorts);
    if (delErr) console.error('[api/forms] cohort_assignments delete error:', delErr);
  }
  if (found.table === 'events') {
    // On first publish, all current cohorts need to be synced (not just newly added ones),
    // because cohorts selected during draft never triggered registration.
    const isFirstPublish = found.row.status !== 'published';
    const cohortsToSync = formStatus === 'published' && isFirstPublish ? newCohorts : addedCohorts;
    if (cohortsToSync.length) {
      await upsertCohortAssignments(supabase, 'event', id, cohortsToSync);
    }
    if (formStatus === 'published' && cohortsToSync.length) {
      try {
        await autoRegisterEventCohorts(supabase, id, cohortsToSync);
      } catch (err) {
        console.error('[api/forms] event auto-register error:', err);
        return NextResponse.json({ ok: true, registrationWarning: 'Cohorts assigned but student auto-registration failed. Re-save to retry.' });
      }
    }
  } else if (addedCohorts.length) {
    await upsertCohortAssignments(supabase, contentType, id, addedCohorts);
  }

  if (formStatus === 'published' && found.table === 'courses') {
    fetch(`${process.env.APP_URL || ''}/api/vector/index-course`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-reindex-secret': process.env.REINDEX_SECRET ?? '' },
      body:    JSON.stringify({ formId: id, contentType: 'course' }),
    }).catch(e => console.error('[vector/index-course] fire-and-forget failed on update:', e?.message));
  }

  return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[api/forms] PUT unhandled error:', e?.message, e?.stack);
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin', 'staff']);
  if (isAuthError(auth)) return auth.error;
  const { user, supabase, role } = auth;

  let formId: string, status: string;
  try {
    ({ formId, status } = await req.json());
    if (!formId || !['draft', 'published'].includes(status)) throw new Error();
  } catch {
    return NextResponse.json({ error: 'formId and status required' }, { status: 400 });
  }

  const found = await findContentById(supabase, formId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (role === 'staff' && found.table !== 'events') {
    return NextResponse.json({ error: 'Staff can only publish live sessions.' }, { status: 403 });
  }
  if (found.row.user_id !== user.id && role !== 'admin' && role !== 'staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error: updateError } = await supabase.from(found.table).update({ status }).eq('id', formId);
  if (updateError) return NextResponse.json({ error: 'Failed to update status' }, { status: 500 });

  if (status === 'published') {
    if (found.table === 'courses') {
      fetch(`${process.env.APP_URL || ''}/api/vector/index-course`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-reindex-secret': process.env.REINDEX_SECRET ?? '' },
        body:    JSON.stringify({ formId, contentType: 'course' }),
      }).catch(e => console.error('[vector/index-course] fire-and-forget failed on status change:', e?.message));
    } else if (found.table === 'events' && found.row.status !== 'published') {
      const cohortIds = found.row.cohort_ids ?? [];
      if (cohortIds.length) {
        await upsertCohortAssignments(supabase, 'event', formId, cohortIds);
        try {
          await autoRegisterEventCohorts(supabase, formId, cohortIds);
        } catch (err) {
          console.error('[api/forms] PATCH event auto-register error:', err);
          return NextResponse.json({ ok: true, registrationWarning: 'Published but student auto-registration failed. Toggle back to draft and re-publish to retry.' });
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, supabase } = auth;

  const { searchParams } = new URL(req.url);
  const formId = searchParams.get('id');
  if (!formId) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const found = await findContentById(supabase, formId);
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: profile } = await supabase.from('students').select('role').eq('id', user.id).single();
  if (profile?.role === 'staff') {
    return NextResponse.json({ error: 'Staff cannot delete content.' }, { status: 403 });
  }
  const isAdmin = profile?.role === 'admin';
  if (found.row.user_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Clean up Cloudinary images and Supabase Storage files before deleting
  if (found.table === 'courses') {
    const { data: row } = await supabase.from('courses').select('cover_image, questions').eq('id', formId).single();
    // Cover may be shared by a duplicated course -- only destroy it if no other row references it.
    await deleteCoverIfUnreferenced(supabase, row?.cover_image, { table: 'courses', id: formId });
    const urls = [
      ...(row?.questions ?? []).map((q: any) => q.imageUrl),
      ...(row?.questions ?? []).flatMap((q: any) => [q.lesson?.imageUrl]),
      // inline images stored inside interactive lesson docs (lesson.doc)
      ...(row?.questions ?? []).flatMap((q: any) => extractDocImageUrls(q.lesson?.doc)),
    ];
    await deleteCloudinaryUrls(urls);
  }

  if (found.table === 'events') {
    const { data: row } = await supabase.from('events').select('cover_image, speakers').eq('id', formId).single();
    await deleteCoverIfUnreferenced(supabase, row?.cover_image, { table: 'events', id: formId });
    const urls = [
      ...(row?.speakers ?? []).map((s: any) => s.avatar_url),
    ];
    await deleteCloudinaryUrls(urls);
  }

  if (found.table === 'virtual_experiences') {
    const { data: row } = await supabase.from('virtual_experiences').select('cover_image, dataset, modules').eq('id', formId).single();
    await deleteCoverIfUnreferenced(supabase, row?.cover_image, { table: 'virtual_experiences', id: formId });
    // inline images stored inside interactive lesson docs across all module lessons
    const docImageUrls = ((row?.modules ?? []) as any[]).flatMap((m: any) =>
      ((m?.lessons ?? []) as any[]).flatMap((l: any) => extractDocImageUrls(l?.doc)));
    await deleteCloudinaryUrls(docImageUrls);
    const datasetUrl = row?.dataset?.url;
    if (datasetUrl?.includes('/storage/v1/object/public/datasets/')) {
      const storagePath = datasetUrl.split('/storage/v1/object/public/datasets/')[1];
      if (storagePath) {
        await supabase.storage.from('datasets').remove([storagePath])
          .catch(e => console.error('[api/forms] dataset storage cleanup failed:', e));
      }
    }
  }

  // Delete from the correct table -- FKs cascade to course_attempts / guided_project_attempts
  const { error: deleteError } = await supabase.from(found.table).delete().eq('id', formId);
  if (deleteError) {
    console.error('[api/forms] delete error:', deleteError.message);
    return NextResponse.json({ error: 'Failed to delete.' }, { status: 500 });
  }

  // Clean up cohort_assignments (no FK cascade)
  await supabase.from('cohort_assignments').delete().eq('content_id', formId);

  // Also clean up event responses (no cascade from events table)
  if (found.table === 'events') {
    await supabase.from('responses').delete().eq('form_id', formId);
  }

  // Remove from vector index
  const index = getVectorIndex();
  if (index) index.delete([formId]).catch(e => console.error('[vector/delete] cleanup failed:', e?.message));

  return NextResponse.json({ ok: true });
}
