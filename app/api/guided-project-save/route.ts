import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/admin-client';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { sendAssignmentNotifications } from '@/lib/send-assignment-notification';
import { validateVirtualExperienceForPublish } from '@/lib/virtual-experience-validation';
import { ExperienceGuideResolutionError, resolveExperienceGuide } from '@/lib/experience-guide';

export const dynamic = 'force-dynamic';

async function upsertCohortAssignments(supabase: ReturnType<typeof adminClient>, veId: string, cohortIds: string[]) {
  if (!cohortIds.length) return;
  const rows = cohortIds.map(cohortId => ({
    content_type: 'virtual_experience',
    content_id:   veId,
    cohort_id:    cohortId,
  }));
  const { error } = await supabase
    .from('cohort_assignments')
    .upsert(rows, { onConflict: 'content_id,cohort_id', ignoreDuplicates: true });
  if (error) console.error('[cohort_assignments] upsert error:', error.message, error.code);
}

export async function POST(req: NextRequest) {
  // VE authoring is an instructor tool: creates/updates rows with the service-role
  // client (RLS bypassed) and can assign published VEs to any cohort, so it must
  // not be reachable by students.
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const { user, supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { editId, title, config, coverImage, cohort_ids, group_ids, deadline_days, status: bodyStatus, is_short_course } = body;
  const formStatus = bodyStatus === 'draft' ? 'draft' : 'published';
  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  if (!config)        return NextResponse.json({ error: 'Config is required' }, { status: 400 });

  if (formStatus === 'published') {
    const readinessIssues = validateVirtualExperienceForPublish(config);
    if (readinessIssues.length) {
      return NextResponse.json({ error: readinessIssues[0].message, issues: readinessIssues }, { status: 400 });
    }
  }

  // Guide identity and consent are server-owned facts. Never persist a browser-supplied
  // snapshot directly: resolve the selected record, verify access, and build the public
  // snapshot from canonical data so names, photos and consent cannot be forged.
  let verifiedGuide;
  try {
    verifiedGuide = await resolveExperienceGuide({
      db: supabase,
      ownerId: user.id,
      requestedGuideId: config.guideId,
      publishing: formStatus === 'published',
    });
  } catch (error) {
    if (error instanceof ExperienceGuideResolutionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  const newCohortIds: string[] = Array.isArray(cohort_ids) ? cohort_ids : [];
  // Standalone VEs are cohort-only. Group targeting applies only through the assignment system
  // (assignments.config.ve_form_id). Persisting group_ids here would create VEs that RLS hides
  // from students (migration 100_remove_ve_group_rls.sql removed group visibility).

  // Shared payload mapped to virtual_experiences columns
  const payload: any = {
    title:          title.trim(),
    description:    config.tagline || '',
    status:         formStatus,
    cohort_ids:     newCohortIds,
    group_ids:      [],
    cover_image:    coverImage || config.coverImage || null,
    deadline_days:  deadline_days ? Number(deadline_days) : (config.deadline_days ? Number(config.deadline_days) : null),
    theme:          config.theme         ?? null,
    mode:           config.mode          ?? null,
    font:           config.font          ?? null,
    custom_accent:  config.customAccent  ?? null,
    modules:        config.modules       ?? [],
    industry:       config.industry      ?? null,
    difficulty:     config.difficulty    ?? null,
    role:           config.role          ?? null,
    company:        config.company       ?? null,
    duration:       config.duration      ?? null,
    tools:          config.tools         ?? [],
    tool_logos:     config.toolLogos     ?? {},
    tagline:        config.tagline       ?? null,
    background:     config.background    ?? null,
    learn_outcomes: config.learnOutcomes ?? [],
    manager_name:   config.managerName   ?? null,
    manager_title:  config.managerTitle  ?? 'Manager',
    guide_id:       verifiedGuide.guideId,
    guide_snapshot: verifiedGuide.snapshot,
    is_short_course: is_short_course ?? false,
    badge_image_url: config.badgeImageUrl ?? null,
    dataset:        null, // set below after optional GitHub upload
  };

  // Upload CSV to GitHub if csvContent is present, then strip it from DB payload
  if (config.dataset) {
    const { csvContent, ...datasetMeta } = config.dataset as any;
    if (csvContent?.trim() && !datasetMeta.url) {
      if (Buffer.byteLength(csvContent, 'utf-8') > 50 * 1024 * 1024) {
        return NextResponse.json({ error: 'Dataset file too large (max 50 MB).' }, { status: 413 });
      }
      try {
        const ghToken  = process.env.GITHUB_TOKEN;
        const ghOwner  = process.env.GITHUB_REPO_OWNER;
        const ghRepo   = process.env.GITHUB_REPO_NAME;
        const ghBranch = process.env.GITHUB_REPO_BRANCH ?? 'main';
        if (ghToken && ghOwner && ghRepo) {
          const safeName = (datasetMeta.filename || 'dataset.csv').replace(/[^a-zA-Z0-9._-]/g, '_');
          const filePath = `ve-datasets/${Date.now()}_${safeName}`;
          const base64   = Buffer.from(csvContent, 'utf-8').toString('base64');
          const ghRes = await fetch(`https://api.github.com/repos/${ghOwner}/${ghRepo}/contents/${filePath}`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${ghToken}`,
              'Content-Type': 'application/json',
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
            },
            body: JSON.stringify({ message: `Upload VE dataset: ${safeName}`, content: base64, branch: ghBranch }),
          });
          if (ghRes.ok) {
            datasetMeta.url = `https://raw.githubusercontent.com/${ghOwner}/${ghRepo}/${ghBranch}/${filePath}`;
          } else {
            const err = await ghRes.json().catch(() => ({}));
            console.error('[guided-project-save] GitHub dataset upload error:', err.message ?? ghRes.status);
            return NextResponse.json({ error: err.message || 'Dataset upload to GitHub failed.' }, { status: 502 });
          }
        } else {
          console.error('[guided-project-save] GitHub env vars not configured; dataset not uploaded.');
          return NextResponse.json({ error: 'GitHub integration not configured. Add GITHUB_TOKEN, GITHUB_REPO_OWNER and GITHUB_REPO_NAME to .env' }, { status: 500 });
        }
      } catch (e) {
        console.error('[guided-project-save] dataset upload exception:', e);
        return NextResponse.json({ error: 'Dataset upload to GitHub failed.' }, { status: 500 });
      }
    }
    payload.dataset = Object.keys(datasetMeta).length ? datasetMeta : null;
  }

  if (editId) {
    // Fetch current cohort_ids/status before updating so we can detect newly added cohorts and first publish
    const { data: existing } = await supabase
      .from('virtual_experiences')
      .select('cohort_ids, slug, status')
      .eq('id', editId)
      .eq('user_id', user.id)
      .single();

    if (!existing) return NextResponse.json({ error: 'Virtual experience not found.' }, { status: 404 });

    const { error } = await supabase
      .from('virtual_experiences')
      .update(payload)
      .eq('id', editId)
      .eq('user_id', user.id);

    if (error) {
      console.error('[guided-project-save] update error:', error);
      return NextResponse.json({ error: 'Failed to save project.' }, { status: 500 });
    }

    const oldCohortIds: string[] = Array.isArray(existing?.cohort_ids) ? existing.cohort_ids : [];
    const addedCohortIds   = newCohortIds.filter(id => !oldCohortIds.includes(id));
    const removedCohortIds = oldCohortIds.filter(id => !newCohortIds.includes(id));
    const isFirstPublish = existing?.status !== 'published' && formStatus === 'published';
    const notifyCohortIds = isFirstPublish ? newCohortIds : addedCohortIds;

    if (formStatus === 'published') {
      await upsertCohortAssignments(supabase, editId, newCohortIds);
    }

    if (formStatus === 'published') {
      if (removedCohortIds.length) {
        const { error: delErr } = await supabase
          .from('cohort_assignments')
          .delete()
          .eq('content_id', editId)
          .in('cohort_id', removedCohortIds);
        if (delErr) console.error('[guided-project-save] cohort_assignments delete error:', delErr);
      }
    } else {
      const { error: delErr } = await supabase
        .from('cohort_assignments')
        .delete()
        .eq('content_id', editId);
      if (delErr) console.error('[guided-project-save] draft cohort_assignments cleanup error:', delErr);
    }

    let registrationWarning: string | undefined;
    if (formStatus === 'published' && notifyCohortIds.length && existing.slug) {
      try {
        await sendAssignmentNotifications({
          cohortIds:   notifyCohortIds,
          title:       title.trim(),
          slug:        existing.slug,
          contentType: 'virtual_experience',
        });
      } catch (err) {
        console.error('[guided-project-save] notification error (edit):', err);
        registrationWarning = 'The experience was saved, but some notification emails could not be sent.';
      }
    }

    if (formStatus === 'published') {
      fetch(`${process.env.APP_URL || ''}/api/vector/index-course`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-reindex-secret': process.env.REINDEX_SECRET ?? '' },
        body:    JSON.stringify({ formId: editId, contentType: 'virtual_experience' }),
      }).catch(() => {});
    }

    return NextResponse.json({ id: editId, slug: existing.slug, registrationWarning });
  }

  // Generate slug for new VE
  const base = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const slug  = `${base}-${Math.random().toString(36).slice(2, 8)}`;

  const { data, error } = await supabase
    .from('virtual_experiences')
    .insert({ ...payload, slug, user_id: user.id })
    .select('id, slug')
    .single();

  if (error) {
    console.error('[guided-project-save] insert error:', error);
    return NextResponse.json({ error: 'Failed to save project.' }, { status: 500 });
  }

  if (formStatus === 'published') {
    await upsertCohortAssignments(supabase, data.id, newCohortIds);
  }

  let registrationWarning: string | undefined;
  if (formStatus === 'published' && newCohortIds.length) {
    try {
      await sendAssignmentNotifications({
        cohortIds:   newCohortIds,
        title:       title.trim(),
        slug:        data.slug,
        contentType: 'virtual_experience',
      });
    } catch (err) {
      console.error('[guided-project-save] notification error (create):', err);
      registrationWarning = 'The experience was saved, but some notification emails could not be sent.';
    }
  }

  if (formStatus === 'published') {
    fetch(`${process.env.APP_URL || ''}/api/vector/index-course`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-reindex-secret': process.env.REINDEX_SECRET ?? '' },
      body:    JSON.stringify({ formId: data.id, contentType: 'virtual_experience' }),
    }).catch(() => {});
  }

  return NextResponse.json({ id: data.id, slug: data.slug, registrationWarning });
}
