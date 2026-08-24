import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { LEGACY_RUNTIME_POINTS_SYSTEM, normalizeFormConfig, normalizePointsSystem } from '@/lib/course-schema';
import { compareResults, SQLResult, SQLTableConfig } from '@/lib/sql-engine';
import { computeServerSqlResult } from '@/lib/sql-engine-server';
import { ExperienceGuideResolutionError, resolveTransferredExperienceGuide } from '@/lib/experience-guide';

export const dynamic = 'force-dynamic';

function shortSlug() {
  return randomBytes(5).toString('base64url').slice(0, 7).toLowerCase();
}

function splitOrderExpressions(orderByClause: string): string[] {
  const expressions: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | '`' | null = null;

  for (let i = 0; i < orderByClause.length; i += 1) {
    const ch = orderByClause[i];
    if (quote) {
      current += ch;
      if (ch === quote && orderByClause[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (current.trim()) expressions.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }

  if (current.trim()) expressions.push(current.trim());
  return expressions;
}

function getOrderByExpressions(sql: string): string[] {
  const compact = sql.replace(/\s+/g, ' ').trim();
  const match = compact.match(/\border\s+by\s+(.+?)(?:\blimit\b|\boffset\b|\bfetch\b|$)/i);
  return match ? splitOrderExpressions(match[1]) : [];
}

function getLimitValue(sql: string): number | null {
  const match = sql.match(/\blimit\s+(\d+)\b/i);
  if (!match) return null;
  const limit = Number(match[1]);
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

function withoutLimit(sql: string) {
  return sql.replace(/\blimit\s+\d+\b/i, '').replace(/;\s*$/, '');
}

function orderExpressionColumn(expression: string) {
  const cleaned = expression
    .replace(/\s+(asc|desc)\b/ig, '')
    .replace(/\s+nulls\s+(first|last)\b/ig, '')
    .trim();
  const match = cleaned.match(/^(?:"?([a-z_][a-z0-9_]*)"?\.)?"?([a-z_][a-z0-9_]*)"?$/i);
  return match?.[2] ?? null;
}

function valuesTie(a: unknown, b: unknown) {
  if (a == null || b == null) return a == null && b == null;
  if (Number.isFinite(Number(a)) && Number.isFinite(Number(b))) return Number(a) === Number(b);
  return String(a).trim() === String(b).trim();
}

function questionLabel(question: any, index: number) {
  const preview = question.question?.replace(/\s+/g, ' ').trim().slice(0, 80);
  return `Q${index + 1}${preview ? `: ${preview}` : ''}`;
}

async function cutoffTieWarning(tables: SQLTableConfig[], question: any, index: number): Promise<string | null> {
  const sql = question.sqlSolution ?? '';
  const limit = getLimitValue(sql);
  if (!limit || !/\border\s+by\b/i.test(sql)) return null;

  const expressions = getOrderByExpressions(sql);
  if (expressions.length !== 1) return null;

  const orderColumn = orderExpressionColumn(expressions[0]);
  if (!orderColumn) return null;

  try {
    const fullResult = await computeServerSqlResult(tables, withoutLimit(sql));
    if (fullResult.rows.length <= limit) return null;
    const columnIndex = fullResult.columns.findIndex(column => column.toLowerCase() === orderColumn.toLowerCase());
    if (columnIndex < 0) return null;
    const cutoffRow = fullResult.rows[limit - 1];
    const nextRow = fullResult.rows[limit];
    if (!valuesTie(cutoffRow?.[columnIndex], nextRow?.[columnIndex])) return null;

    const idColumn = fullResult.columns.find(column => /\b(id|_id)\b/i.test(column)) ?? fullResult.columns[0] ?? 'an id column';
    return `${questionLabel(question, index)}: rows ${limit} and ${limit + 1} tie on ${orderColumn}, so LIMIT ${limit} may select different rows depending on database row order. Consider adding a secondary sort such as ORDER BY ${expressions[0]}, ${idColumn} ASC, then recompute the expected result.`;
  } catch {
    return null;
  }
}

async function preflightImportedCourseSql(cfg: any): Promise<{ config: any; warnings: string[] }> {
  const questions = Array.isArray(cfg?.questions) ? cfg.questions : [];
  const sqlQuestions = questions.filter((question: any) => question?.type === 'sql_exercise');
  if (!sqlQuestions.length) return { config: cfg, warnings: [] };

  const tableMap = new Map<string, SQLTableConfig>();
  for (const question of sqlQuestions) {
    for (const table of question.sqlTables ?? []) {
      const key = `${table.tableName}|${table.fileUrl || table.csvUrl || table.seedSql || ''}`;
      if (table.tableName && !tableMap.has(key)) tableMap.set(key, table);
    }
  }
  const tables = Array.from(tableMap.values());
  const updatedQuestions = [...questions];
  const warnings: string[] = [];

  for (let i = 0; i < updatedQuestions.length; i += 1) {
    const question = updatedQuestions[i];
    if (question?.type !== 'sql_exercise') continue;
    const label = questionLabel(question, i);

    if (!question.sqlSolution?.trim()) {
      warnings.push(`${label}: missing solution query. Student SQL answers cannot be validated until a solution query is added.`);
      continue;
    }

    const tieWarning = await cutoffTieWarning(tables, question, i);
    if (tieWarning) warnings.push(tieWarning);

    let recomputed: SQLResult;
    try {
      recomputed = await computeServerSqlResult(tables, question.sqlSolution);
    } catch (err: any) {
      warnings.push(`${label}: solution query failed during import preflight: ${err?.message || 'unknown SQL error'}. The course was imported, but review this SQL exercise before assigning it.`);
      continue;
    }

    if (!question.sqlExpectedResult) {
      updatedQuestions[i] = { ...question, sqlExpectedResult: recomputed };
      continue;
    }

    const comparison = compareResults(recomputed, question.sqlExpectedResult, {
      ordered: !!question.sqlResultOrdered,
      numericTolerance: Number(question.sqlNumericTolerance ?? 0),
    });
    if (!comparison.passed) {
      warnings.push(`${label}: saved expected result does not match the current solution query. ${comparison.message} Recompute the expected result before assigning this course.`);
    }
  }

  return { config: { ...cfg, questions: updatedQuestions }, warnings };
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { exportVersion, type } = body;
  if (exportVersion !== 1)
    return NextResponse.json({ error: 'Unsupported export version' }, { status: 400 });
  if (!['course', 'virtual_experience', 'assignment'].includes(type))
    return NextResponse.json({ error: 'Invalid content type' }, { status: 400 });

  const importMode: 'create' | 'sync' = body.mode === 'sync' ? 'sync' : 'create';

  // -- Course ---
  if (type === 'course') {
    if (!body.config) return NextResponse.json({ error: 'config required' }, { status: 400 });
    // Ingest boundary: imported files may carry legacy aliases (timer, points_enabled, ...).
    // Collapse them to the canonical shape once, here, so the writes below read only canonical keys.
    let cfg: any = normalizeFormConfig(body.config);

    const sqlPreflight = await preflightImportedCourseSql(cfg);
    cfg = sqlPreflight.config;
    const sqlWarnings = sqlPreflight.warnings;

    const title = body.title || cfg.title || 'Imported Course';

    if (importMode === 'sync') {
      const { data: existing } = await supabase
        .from('courses').select('id, slug').eq('user_id', user.id).eq('title', title).maybeSingle();
      if (existing) {
        const { error: upErr } = await supabase.from('courses').update({
          description:     cfg.description ?? null,
          cover_image:     cfg.coverImage ?? null,
          deadline_days:   cfg.deadline_days ?? null,
          theme:           cfg.theme ?? null,
          mode:            cfg.mode ?? null,
          font:            cfg.font ?? null,
          custom_accent:   cfg.customAccent ?? null,
          questions:       cfg.questions ?? [],
          fields:          cfg.fields ?? [],
          passmark:        cfg.passmark ?? 50,
          course_timer:    cfg.courseTimer ?? null,
          learn_outcomes:  cfg.learnOutcomes ?? [],
          points_enabled:  cfg.pointsSystem?.enabled ?? true,
          points_base:     cfg.pointsSystem?.basePoints ?? 50,
          points_system:   normalizePointsSystem(cfg.pointsSystem ?? { enabled: true, basePoints: 50 }, LEGACY_RUNTIME_POINTS_SYSTEM),
          post_submission: cfg.postSubmission ?? null,
        }).eq('id', existing.id);
        if (upErr) {
          console.error('[content-import] course update:', upErr.message);
          return NextResponse.json({ error: 'Failed to update course.' }, { status: 500 });
        }
        return NextResponse.json({ id: existing.id, slug: existing.slug, type: 'course', action: 'updated', sqlWarnings });
      }
    }

    let attempt = 0, slug = shortSlug();
    while (attempt < 3) {
      if (attempt > 0) slug = shortSlug();
      const { data, error } = await supabase.from('courses').insert({
        user_id:         user.id,
        title,
        slug,
        description:     cfg.description ?? null,
        status:          'draft',
        cohort_ids:      [],
        cover_image:     cfg.coverImage ?? null,
        deadline_days:   cfg.deadline_days ?? null,
        theme:           cfg.theme ?? null,
        mode:            cfg.mode ?? null,
        font:            cfg.font ?? null,
        custom_accent:   cfg.customAccent ?? null,
        questions:       cfg.questions ?? [],
        fields:          cfg.fields ?? [],
        passmark:        cfg.passmark ?? 50,
        course_timer:    cfg.courseTimer ?? null,
        learn_outcomes:  cfg.learnOutcomes ?? [],
        points_enabled:  cfg.pointsSystem?.enabled ?? true,
        points_base:     cfg.pointsSystem?.basePoints ?? 50,
        points_system:   normalizePointsSystem(cfg.pointsSystem ?? { enabled: true, basePoints: 50 }, LEGACY_RUNTIME_POINTS_SYSTEM),
        post_submission: cfg.postSubmission ?? null,
      }).select('id, slug').single();
      if (!error) return NextResponse.json({ id: data.id, slug: data.slug, type: 'course', action: 'created', sqlWarnings });
      if (error.code === '23505') { attempt++; continue; }
      console.error('[content-import] course:', error.message);
      return NextResponse.json({ error: `Failed to import course: ${error.message}` }, { status: 500 });
    }
    return NextResponse.json({ error: 'Could not generate unique slug.' }, { status: 409 });
  }

  // -- Virtual Experience ---
  if (type === 'virtual_experience') {
    const cfg = body.config;
    if (!cfg) return NextResponse.json({ error: 'config required' }, { status: 400 });

    const title = body.title || cfg.title || 'Imported Virtual Experience';
    const verifyGuide = async (publishing: boolean) => {
      try {
        return await resolveTransferredExperienceGuide({
          db: supabase,
          ownerId: user.id,
          requestedGuideId: cfg.guideId,
          publishing,
        });
      } catch (error) {
        if (error instanceof ExperienceGuideResolutionError) {
          // Only a consent/status block can reach here: a guide ID this install does not know
          // is dropped as a transfer artefact. Label it so the importer sees a consent
          // decision rather than a malformed-file error.
          console.error(`[content-import] guide consent block on "${title}":`, error.message);
          return NextResponse.json({ error: error.message, code: 'guide_consent_required' }, { status: 400 });
        }
        throw error;
      }
    };

    if (importMode === 'sync') {
      const { data: existing } = await supabase
        .from('virtual_experiences').select('id, slug, status').eq('user_id', user.id).eq('title', title).maybeSingle();
      if (existing) {
        const verifiedGuide = await verifyGuide(existing.status === 'published');
        if (verifiedGuide instanceof NextResponse) return verifiedGuide;
        const { error: upErr } = await supabase.from('virtual_experiences').update({
          description:    cfg.description ?? null,
          industry:       cfg.industry ?? null,
          difficulty:     cfg.difficulty ?? null,
          role:           cfg.role ?? null,
          company:        cfg.company ?? null,
          duration:       cfg.duration ?? null,
          tools:          cfg.tools ?? [],
          tool_logos:     cfg.toolLogos ?? {},
          tagline:        cfg.tagline ?? null,
          background:     cfg.background ?? null,
          learn_outcomes: cfg.learnOutcomes ?? [],
          manager_name:   cfg.managerName ?? null,
          manager_title:  cfg.managerTitle ?? null,
          guide_id:       verifiedGuide.guideId,
          guide_snapshot: verifiedGuide.snapshot,
          modules:        cfg.modules ?? [],
          dataset:        cfg.dataset ?? null,
          cover_image:    cfg.coverImage ?? null,
          deadline_days:  cfg.deadline_days ?? null,
          theme:          cfg.theme ?? null,
          mode:           cfg.mode ?? null,
          font:           cfg.font ?? null,
          custom_accent:  cfg.customAccent ?? null,
          is_short_course: !!cfg.isShortCourse,
          badge_image_url: cfg.badgeImageUrl ?? null,
        }).eq('id', existing.id);
        if (upErr) {
          console.error('[content-import] VE update:', upErr.message);
          return NextResponse.json({ error: 'Failed to update virtual experience.' }, { status: 500 });
        }
        return NextResponse.json({ id: existing.id, slug: existing.slug, type: 'virtual_experience', action: 'updated' });
      }
    }

    const verifiedGuide = await verifyGuide(false);
    if (verifiedGuide instanceof NextResponse) return verifiedGuide;
    let attempt = 0, slug = shortSlug();
    while (attempt < 3) {
      if (attempt > 0) slug = shortSlug();
      const { data, error } = await supabase.from('virtual_experiences').insert({
        user_id:        user.id,
        title,
        slug,
        description:    cfg.description ?? null,
        status:         'draft',
        cohort_ids:     [],
        industry:       cfg.industry ?? null,
        difficulty:     cfg.difficulty ?? null,
        role:           cfg.role ?? null,
        company:        cfg.company ?? null,
        duration:       cfg.duration ?? null,
        tools:          cfg.tools ?? [],
        tool_logos:     cfg.toolLogos ?? {},
        tagline:        cfg.tagline ?? null,
        background:     cfg.background ?? null,
        learn_outcomes: cfg.learnOutcomes ?? [],
        manager_name:   cfg.managerName ?? null,
        manager_title:  cfg.managerTitle ?? null,
        guide_id:       verifiedGuide.guideId,
        guide_snapshot: verifiedGuide.snapshot,
        modules:        cfg.modules ?? [],
        dataset:        cfg.dataset ?? null,
        cover_image:    cfg.coverImage ?? null,
        deadline_days:  cfg.deadline_days ?? null,
        theme:          cfg.theme ?? null,
        mode:           cfg.mode ?? null,
        font:           cfg.font ?? null,
        custom_accent:  cfg.customAccent ?? null,
        is_short_course: !!cfg.isShortCourse,
        badge_image_url: cfg.badgeImageUrl ?? null,
      }).select('id, slug').single();
      if (!error) return NextResponse.json({ id: data.id, slug: data.slug, type: 'virtual_experience', action: 'created' });
      if (error.code === '23505') { attempt++; continue; }
      console.error('[content-import] VE:', error.message);
      return NextResponse.json({ error: 'Failed to import virtual experience.' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Could not generate unique slug.' }, { status: 409 });
  }

  // -- Assignment ---
  if (type === 'assignment') {
    const d = body.data;
    if (!d) return NextResponse.json({ error: 'data required' }, { status: 400 });

    const title = d.title || 'Imported Assignment';
    const resources: any[] = body.resources ?? [];

    if (importMode === 'sync') {
      const { data: existing } = await supabase
        .from('assignments').select('id').eq('created_by', user.id).eq('title', title).maybeSingle();
      if (existing) {
        // Capture old resource IDs before touching anything
        const { data: oldRows } = await supabase
          .from('assignment_resources').select('id').eq('assignment_id', existing.id);
        const oldIds = (oldRows ?? []).map((r: any) => r.id);

        const { error: upErr } = await supabase.from('assignments').update({
          scenario:                d.scenario ?? null,
          brief:                   d.brief ?? null,
          tasks:                   d.tasks ?? null,
          requirements:            d.requirements ?? null,
          submission_instructions: d.submission_instructions ?? null,
          cover_image:             d.cover_image ?? null,
          type:                    d.type ?? null,
          config:                  d.config ?? null,
        }).eq('id', existing.id);
        if (upErr) {
          console.error('[content-import] assignment update:', upErr.message);
          return NextResponse.json({ error: 'Failed to update assignment.' }, { status: 500 });
        }

        // Insert new resources before deleting old ones
        if (resources.length) {
          const { error: insErr } = await supabase.from('assignment_resources').insert(
            resources.map(r => ({
              assignment_id: existing.id,
              name:          r.name,
              url:           r.url,
              resource_type: r.resource_type || 'link',
            }))
          );
          if (insErr) {
            console.error('[content-import] resource insert:', insErr.message);
            return NextResponse.json({ error: 'Failed to update assignment resources.' }, { status: 500 });
          }
        }

        // Now delete only the previously captured IDs
        if (oldIds.length) {
          await supabase.from('assignment_resources').delete().in('id', oldIds);
        }

        return NextResponse.json({ id: existing.id, type: 'assignment', action: 'updated' });
      }
    }

    const { data: assignment, error: aErr } = await supabase.from('assignments').insert({
      created_by:              user.id,
      title,
      scenario:                d.scenario ?? null,
      brief:                   d.brief ?? null,
      tasks:                   d.tasks ?? null,
      requirements:            d.requirements ?? null,
      submission_instructions: d.submission_instructions ?? null,
      cover_image:             d.cover_image ?? null,
      status:                  'draft',
      cohort_ids:              [],
      deadline_date:           null,
      type:                    d.type ?? null,
      config:                  d.config ?? null,
    }).select('id').single();

    if (aErr) {
      console.error('[content-import] assignment:', aErr.message);
      return NextResponse.json({ error: 'Failed to import assignment.' }, { status: 500 });
    }

    if (resources.length) {
      await supabase.from('assignment_resources').insert(
        resources.map(r => ({
          assignment_id: assignment.id,
          name:          r.name,
          url:           r.url,
          resource_type: r.resource_type || 'link',
        }))
      );
    }

    return NextResponse.json({ id: assignment.id, type: 'assignment', action: 'created' });
  }

  return NextResponse.json({ error: 'Unhandled type' }, { status: 400 });
}
