import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';
import { createClient } from '@supabase/supabase-js';
import { validatePublicDatasetUrl } from '@/lib/dataset-url-safety';

export const dynamic = 'force-dynamic';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Supabase service role key not configured');
  return createClient(url, key);
}

function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  if (!url || !key) throw new Error('Supabase anon key not configured');
  return createClient(url, key);
}

// What a learner or visitor sees. Staff also get the publishing fields their editor needs; the
// author's id and the draft flag are not for the public grid.
const PUBLIC_FIELDS = 'id,title,description,cover_image_url,cover_image_alt,tags,category,sample_questions,sample_question_types,analyst_sections,file_url,file_name,files,row_count,source,source_url,scenario,disclaimer,table_type,sql_workbench_enabled,created_at';
const FIELDS = `${PUBLIC_FIELDS},is_published,created_by`;

async function validateDatasetFileInputs(fileUrl: unknown, files: unknown): Promise<NextResponse | null> {
  const urls: string[] = [];
  if (typeof fileUrl === 'string' && fileUrl.trim()) urls.push(fileUrl.trim());
  if (Array.isArray(files)) {
    for (const file of files) {
      const record = file && typeof file === 'object' ? file as Record<string, unknown> : null;
      const url = typeof record?.url === 'string' ? record.url.trim() : '';
      if (url) urls.push(url);
    }
  }
  for (const url of urls) {
    const check = await validatePublicDatasetUrl(url);
    if (!check.ok) {
      return NextResponse.json({ error: `Invalid dataset file URL: ${check.error}` }, { status: 400 });
    }
  }
  return null;
}


// GET - list datasets
// Public (no auth): published only
// Authenticated student: published only
// Authenticated staff: all (including drafts)
export async function GET(req: NextRequest) {
  // Optional auth: staff (admin/instructor) see drafts; everyone else (students,
  // anonymous, invalid token) sees published only.
  const staffAuth = await requireRole(req, ['admin', 'instructor']);
  const showAll = !isAuthError(staffAuth);
  const db = showAll ? adminClient() : publicClient();
  let query = db
    .from('data_center_datasets')
    .select(showAll ? FIELDS : PUBLIC_FIELDS)
    .order('created_at', { ascending: false });

  if (!showAll) {
    query = query.eq('is_published', true);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ datasets: data });
}

// POST - create dataset (staff only)
export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const sessionUser = { id: auth.user.id };

  const body = await req.json();
  const {
    title, description, cover_image_url, cover_image_alt,
    tags, category, sample_questions, sample_question_types, analyst_sections, file_url, file_name, files,
    row_count, column_info, source, source_url, scenario, disclaimer, table_type, sql_workbench_enabled, is_published,
  } = body;

  if (!title?.trim()) return NextResponse.json({ error: 'Title is required' }, { status: 400 });
  const urlError = await validateDatasetFileInputs(file_url, files);
  if (urlError) return urlError;

  const { data, error } = await adminClient()
    .from('data_center_datasets')
    .insert({
      title: title.trim(),
      description: description?.trim() ?? null,
      cover_image_url: cover_image_url ?? null,
      cover_image_alt: cover_image_alt ?? null,
      tags: tags ?? [],
      category: category?.trim() ?? null,
      sample_questions: sample_questions ?? [],
      sample_question_types: sample_question_types ?? [],
      analyst_sections: Array.isArray(analyst_sections) ? analyst_sections : [],
      file_url: file_url?.trim() ?? null,
      file_name: file_name?.trim() ?? null,
      files: Array.isArray(files) ? files : [],
      row_count: row_count ?? null,
      column_info: column_info ?? [],
      source: source?.trim() ?? null,
      source_url: source_url?.trim() ?? null,
      scenario: scenario ?? null,
      disclaimer: disclaimer?.trim() ?? null,
      table_type: table_type ?? null,
      sql_workbench_enabled: sql_workbench_enabled ?? true,
      is_published: is_published ?? false,
      created_by: sessionUser.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ dataset: data });
}

// PUT - update dataset (staff only)
export async function PUT(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const sessionUser = { id: auth.user.id };

  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const allowed = [
    'title', 'description', 'cover_image_url', 'cover_image_alt',
    'tags', 'category', 'sample_questions', 'sample_question_types', 'analyst_sections', 'file_url', 'file_name', 'files',
    'row_count', 'column_info', 'source', 'source_url', 'scenario', 'disclaimer', 'table_type', 'sql_workbench_enabled', 'is_published',
  ];
  const update: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in fields) update[key] = fields[key];
  }
  if (update.title && typeof update.title === 'string') update.title = update.title.trim();
  const urlError = await validateDatasetFileInputs(
    Object.prototype.hasOwnProperty.call(update, 'file_url') ? update.file_url : undefined,
    Object.prototype.hasOwnProperty.call(update, 'files') ? update.files : undefined,
  );
  if (urlError) return urlError;

  const { data, error } = await adminClient()
    .from('data_center_datasets')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ dataset: data });
}

// DELETE - delete dataset (staff only)
export async function DELETE(req: NextRequest) {
  const auth = await requireRole(req, ['admin', 'instructor']);
  if (isAuthError(auth)) return auth.error;
  const sessionUser = { id: auth.user.id };

  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await adminClient()
    .from('data_center_datasets')
    .delete()
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
