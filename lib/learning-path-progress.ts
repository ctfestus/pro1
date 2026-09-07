import { Resend } from 'resend';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { ensureCertificate, sendCertificateEmailOnce } from '@/lib/issue-certificate';
import {
  learningPathCertificateEmail,
  courseCompletedNextUpEmail,
  learningPathAssignedEmail,
} from '@/lib/email-templates';

export async function updateLearningPathProgress(
  supabase: any,
  studentId: string,
  completedItemId: string,
) {
  try {
    const { data: student } = await supabase.from('students').select('cohort_id').eq('id', studentId).maybeSingle();
    if (!student) return;

    const pathQuery = supabase
      .from('learning_paths')
      .select('id, item_ids, title, next_path_id')
      .eq('status', 'published')
      .contains('item_ids', [completedItemId]);
    const { data: paths } = await (student.cohort_id
      ? pathQuery.or(`available_to_everyone.eq.true,cohort_ids.cs.{${student.cohort_id}}`)
      : pathQuery.eq('available_to_everyone', true));

    if (!paths?.length) return;

    const resend = new Resend(process.env.RESEND_API_KEY);

    for (const path of paths) {
      const { data: prog } = await supabase
        .from('learning_path_progress')
        .select('*')
        .eq('student_id', studentId)
        .eq('learning_path_id', path.id)
        .maybeSingle();

      const existingCompleted: string[] = prog?.completed_item_ids ?? [];
      if (existingCompleted.includes(completedItemId)) continue;

      const updatedCompleted = [...existingCompleted, completedItemId];
      const allDone = (path.item_ids ?? []).every((id: string) => updatedCompleted.includes(id));

      const upsertData: any = {
        student_id:         studentId,
        learning_path_id:   path.id,
        completed_item_ids: updatedCompleted,
        updated_at:         new Date().toISOString(),
      };
      if (allDone) upsertData.completed_at = new Date().toISOString();

      const { data: upserted } = await supabase
        .from('learning_path_progress')
        .upsert(upsertData, { onConflict: 'student_id,learning_path_id' })
        .select('id')
        .single();

      // Send "next up" email when a non-final item is completed
      if (!allDone) {
        const itemIds: string[] = path.item_ids ?? [];
        const completedIdx = itemIds.indexOf(completedItemId);
        const nextItemId   = completedIdx >= 0 && completedIdx + 1 < itemIds.length ? itemIds[completedIdx + 1] : null;
        if (nextItemId) {
          try {
            const { data: studentRow } = await supabase.from('students').select('full_name, email').eq('id', studentId).single();
            if (studentRow?.email) {
              const [{ data: courses }, { data: ves }, { data: certs }] = await Promise.all([
                supabase.from('courses').select('id, title, slug, cover_image, description').in('id', [completedItemId, nextItemId]),
                supabase.from('virtual_experiences').select('id, title, slug, cover_image, description').in('id', [completedItemId, nextItemId]),
                supabase.from('certifications').select('id, title, slug, cover_image, description').in('id', [completedItemId, nextItemId]),
              ]);
              const itemMap: Record<string, any> = {};
              for (const c of courses ?? []) itemMap[c.id] = { ...c, isVE: false };
              for (const v of ves   ?? []) itemMap[v.id] = { ...v, isVE: true };
              for (const x of certs ?? []) itemMap[x.id] = { ...x, isVE: false, isCert: true };
              const completedItem = itemMap[completedItemId];
              const nextItem      = itemMap[nextItemId];
              if (completedItem && nextItem) {
                const t    = await getTenantSettings();
                const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
                const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
                // Direct link for every type: a path item may not be listed in its own section
                // until attempted, so the email must land on the item itself (VEs resolve at /{slug}).
                const nextUrl = nextItem.isVE || nextItem.isCert
                  ? `${t.appUrl}/${nextItem.slug || nextItemId}`
                  : `${t.appUrl}/${nextItem.slug || nextItemId}?go=1`;
                // Resend reports API failures by resolving with { error }, not by throwing.
                const { error: nextUpErr } = await resend.emails.send({
                  from: FROM,
                  to:   studentRow.email,
                  subject: `You completed "${completedItem.title}": next up in ${path.title}`,
                  html: courseCompletedNextUpEmail({
                    name:            studentRow.full_name ?? 'there',
                    pathTitle:       path.title,
                    completedTitle:  completedItem.title,
                    completedNumber: completedIdx + 1,
                    totalItems:      itemIds.length,
                    nextTitle:       nextItem.title,
                    nextUrl,
                    nextCoverImage:  nextItem.cover_image ?? null,
                    nextIsVE:        nextItem.isVE,
                    nextIsCert:      nextItem.isCert === true,
                    nextDescription: nextItem.description ?? null,
                    branding,
                  }),
                });
                if (nextUpErr) console.error('[updateLearningPathProgress] next-up email failed', nextUpErr);
              }
            }
          } catch (err) {
            console.error('[updateLearningPathProgress] next-up email failed', err);
          }
        }
      }

      if (allDone) {
        await runPathCompletionEffects(supabase, studentId, student.cohort_id ?? null, path, upserted?.id, !!prog?.cert_id);
      }
    }
  } catch (err) {
    console.error('[updateLearningPathProgress]', err);
  }
}

// Reconcile a path whose items were all completed through historical attempts (items passed
// before the path existed or before they were added to it): the merged completion shown by
// get-student-paths never finalized the stored progress row, so no certificate, badge, or
// email was ever produced. Finalizes the row and runs the completion side effects exactly
// once. Never throws (called via after() from get-student-paths).
export async function reconcilePathCompletion(
  supabase: any,
  studentId: string,
  path: { id: string; title: string; item_ids?: string[]; next_path_id?: string | null },
  completedItemIds: string[],
) {
  try {
    const [{ data: student }, { data: prog }] = await Promise.all([
      supabase.from('students').select('cohort_id').eq('id', studentId).single(),
      supabase.from('learning_path_progress')
        .select('*')
        .eq('student_id', studentId)
        .eq('learning_path_id', path.id)
        .maybeSingle(),
    ]);
    // Fresh read: skip when another request already finalized this path.
    if (prog?.completed_at && prog?.cert_id) return;

    const { data: upserted } = await supabase
      .from('learning_path_progress')
      .upsert({
        student_id:         studentId,
        learning_path_id:   path.id,
        completed_item_ids: completedItemIds,
        completed_at:       prog?.completed_at ?? new Date().toISOString(),
        updated_at:         new Date().toISOString(),
      }, { onConflict: 'student_id,learning_path_id' })
      .select('id')
      .single();

    await runPathCompletionEffects(supabase, studentId, student?.cohort_id ?? null, path, upserted?.id, !!prog?.cert_id);
  } catch (err) {
    console.error('[reconcilePathCompletion]', err);
  }
}

// Completion side effects for a path the student has finished: auto-enroll the cohort into
// the chained next path (with email) and issue the path certificate + badge + certificate
// email exactly once. Shared by the incremental updater and the historical reconciliation.
// Every step is safe to repeat (idempotent writes; emails behind email_dedup locks), and the
// cert_id backfill runs last as the commit marker -- so a crash anywhere is retried by the
// next get-student-paths reconciliation without double-sending.
async function runPathCompletionEffects(
  supabase: any,
  studentId: string,
  cohortId: string | null,
  path: { id: string; title: string; next_path_id?: string | null },
  progressRowId: string | undefined,
  hadCertId: boolean,
) {
  // Emails must be settled (sent / already sent) before the cert_id commit marker is
  // written; a provider failure or a lock held by a live sender leaves the row
  // unfinalized so the next reconciliation retries.
  let emailsSettled = true;

  // Auto-enroll student's cohort into next path when this path is completed
  if (path.next_path_id && cohortId) {
    try {
      const { data: nextPath } = await supabase
        .from('learning_paths')
        .select('id, cohort_ids, title, description, item_ids')
        .eq('id', path.next_path_id)
        .single();
      if (nextPath) {
        const existingCohorts: string[] = nextPath.cohort_ids ?? [];
        if (!existingCohorts.includes(cohortId)) {
          // Atomic cohort add: the filter re-evaluates under the row lock, so a concurrent
          // duplicate updates zero rows instead of double-appending the cohort.
          await supabase.from('learning_paths')
            .update({ cohort_ids: [...existingCohorts, cohortId] })
            .eq('id', nextPath.id)
            .not('cohort_ids', 'cs', `{${cohortId}}`)
            .select('id');
        }
        // Enrollment email: per completing student, at most once, arbitrated by the
        // email_dedup insert-as-lock. Deliberately NOT gated on who performed the cohort
        // add -- a run that crashed between the add and the email can still send on retry.
        const { data: studentRow } = await supabase.from('students').select('full_name, email').eq('id', studentId).single();
        if (studentRow?.email) {
          try {
            const t    = await getTenantSettings();
            const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
            const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
            const itemIds: string[] = nextPath.item_ids ?? [];
            const [{ data: courseItems }, { data: veItems }, { data: certItems }] = itemIds.length
              ? await Promise.all([
                  supabase.from('courses').select('id, title, cover_image, description').in('id', itemIds),
                  supabase.from('virtual_experiences').select('id, title, cover_image, description').in('id', itemIds),
                  supabase.from('certifications').select('id, title, cover_image, description').in('id', itemIds),
                ])
              : [{ data: [] }, { data: [] }, { data: [] }];
            const itemMap: Record<string, any> = {};
            for (const c of courseItems ?? []) itemMap[c.id] = { ...c, isVE: false };
            for (const v of veItems     ?? []) itemMap[v.id] = { ...v, isVE: true };
            for (const x of certItems   ?? []) itemMap[x.id] = { ...x, isVE: false, isCert: true };
            const items = itemIds.map((id: string) => ({
              title:       itemMap[id]?.title       ?? 'Untitled',
              coverImage:  itemMap[id]?.cover_image ?? null,
              isVE:        itemMap[id]?.isVE        ?? false,
              isCert:      itemMap[id]?.isCert      ?? false,
              description: itemMap[id]?.description ?? undefined,
            }));
            const settled = await sendCertificateEmailOnce(supabase, {
              certId:     `${nextPath.id}:${studentId}`,
              dedupeType: 'learning-path-next-enroll',
              from:       FROM,
              to:         studentRow.email,
              subject:    `You've been enrolled in a new learning path: ${nextPath.title}`,
              html: learningPathAssignedEmail({
                name:            studentRow.full_name ?? 'there',
                pathTitle:       nextPath.title,
                pathDescription: nextPath.description ?? undefined,
                dashboardUrl:    `${t.appUrl}/student#learning_paths`,
                items,
                branding,
              }),
            });
            if (!settled) emailsSettled = false;
          } catch (emailErr) {
            emailsSettled = false;
            console.error('[runPathCompletionEffects] next-path email failed', emailErr);
          }
        }
      }
    } catch (nextErr) {
      console.error('[runPathCompletionEffects] next-path auto-enroll failed', nextErr);
    }
  }

  if (!hadCertId) {
    const { data: studentRow } = await supabase.from('students').select('full_name, email').eq('id', studentId).single();
    const studentName = studentRow?.full_name ?? 'Student';

    // Race-safe insert-or-fetch: the partial unique index on (learning_path_id, student_id)
    // (migration 140) makes a concurrent duplicate insert fail with 23505, which
    // ensureCertificate resolves by re-reading the winner's row.
    let certResult: { certId: string; isNew: boolean };
    try {
      certResult = await ensureCertificate(supabase, {
        column: 'learning_path_id', contentId: path.id, studentId, studentName,
      });
    } catch (certErr) {
      console.error('[runPathCompletionEffects] certificate issuance failed', certErr);
      return;
    }

    // Badge and email run on EVERY pass, not just isNew: a run that crashed after the
    // certificate insert must be able to finish them on retry. Both are safe to repeat --
    // the badge is idempotent upserts and the email is arbitrated by the email_dedup
    // insert-as-lock (a racing duplicate or an already-sent retry is a no-op).
    const { data: pathMeta } = await supabase.from('learning_paths').select('badge_image_url').eq('id', path.id).single();

    let lpBadgeName: string | undefined;
    if (pathMeta?.badge_image_url) {
      try {
        const badgeId = `lp_${path.id}`;
        await supabase.from('badges').upsert({
          id:          badgeId,
          name:        `${path.title} Badge`,
          description: `Awarded for completing ${path.title}`,
          icon:        'map',
          color:       '#6366f1',
          image_url:   pathMeta.badge_image_url,
          category:    'learning_path',
        }, { onConflict: 'id' });
        await supabase.from('student_badges').upsert({
          student_id: studentId,
          badge_id:   badgeId,
        }, { onConflict: 'student_id,badge_id', ignoreDuplicates: true });
        lpBadgeName = `${path.title} Badge`;
      } catch (badgeErr) {
        console.error('[runPathCompletionEffects] badge award failed', badgeErr);
      }
    }

    if (studentRow?.email) {
      try {
        const { data: fullPath } = await supabase
          .from('learning_paths')
          .select('title, description, item_ids')
          .eq('id', path.id)
          .single();

        const itemIds: string[] = fullPath?.item_ids ?? [];
        const [{ data: courseItems }, { data: veItems }, { data: certItems }] = await Promise.all([
          itemIds.length ? supabase.from('courses').select('id, title, cover_image, description').in('id', itemIds) : { data: [] },
          itemIds.length ? supabase.from('virtual_experiences').select('id, title, cover_image, description').in('id', itemIds) : { data: [] },
          itemIds.length ? supabase.from('certifications').select('id, title, cover_image, description').in('id', itemIds) : { data: [] },
        ]);
        const itemMap: Record<string, any> = {};
        for (const c of courseItems ?? []) itemMap[c.id] = { ...c, isVE: false };
        for (const v of veItems     ?? []) itemMap[v.id] = { ...v, isVE: true };
        for (const x of certItems   ?? []) itemMap[x.id] = { ...x, isVE: false, isCert: true };
        const items = itemIds.map((id: string) => {
          const item = itemMap[id];
          return {
            title:       item?.title       ?? 'Untitled',
            coverImage:  item?.cover_image ?? null,
            isVE:        item?.isVE        ?? false,
            isCert:      item?.isCert      ?? false,
            description: item?.description ?? null,
          };
        });

        const t    = await getTenantSettings();
        const FROM = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
        const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };
        const certUrl  = `${t.appUrl}/certificate/${certResult.certId}`;
        const settled = await sendCertificateEmailOnce(supabase, {
          certId:     certResult.certId,
          dedupeType: 'learning-path-certificate',
          from:       FROM,
          to:         studentRow.email,
          subject:    `Your Learning Path Certificate is ready: ${fullPath?.title ?? path.title}`,
          html: learningPathCertificateEmail({
            name:          studentName,
            pathTitle:     fullPath?.title ?? path.title,
            certUrl,
            items,
            branding,
            badgeName:     lpBadgeName,
            badgeImageUrl: pathMeta?.badge_image_url ?? undefined,
          }),
        });
        if (!settled) emailsSettled = false;
      } catch (emailErr) {
        emailsSettled = false;
        console.error('[runPathCompletionEffects] cert email failed', emailErr);
      }
    }

    // cert_id backfill LAST: it is the commit marker that stops get-student-paths from
    // scheduling another reconciliation. Any crash OR unsettled email before this line
    // leaves the row unfinalized, so the next dashboard load retries (dedup-guarded).
    if (progressRowId && emailsSettled) {
      await supabase.from('learning_path_progress')
        .update({ cert_id: certResult.certId })
        .eq('id', progressRowId);
    }
  }
}
