import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Supabase service role key not configured');
  return createClient(url, key);
}

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ username: string }> },
) {
  const { username } = await params;
  if (!username) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const supabase = adminClient();

  // 1. Look up student -- stable core columns only
  const { data: student, error } = await supabase
    .from('students')
    .select('id, full_name, avatar_url, bio, country, city, social_links, role, created_at, username')
    .ilike('username', username)
    .eq('status', 'active')
    .maybeSingle();

  if (error || !student) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // 2. Optional JSONB columns (gracefully default if migrations not run yet)
  const { data: extra } = await supabase
    .from('students')
    .select('education, work_experience, skills, portfolio_items')
    .eq('id', student.id)
    .maybeSingle();

  const education       = extra?.education       ?? [];
  const work_experience = extra?.work_experience ?? [];
  const skills          = extra?.skills          ?? [];
  const portfolio_items = extra?.portfolio_items ?? [];

  // 3. Certificates (by student_id, non-revoked)
  const { data: certsRaw } = await supabase
    .from('certificates')
    .select('id, course_id, ve_id, learning_path_id, certification_id, issued_at')
    .eq('student_id', student.id)
    .eq('revoked', false)
    .order('issued_at', { ascending: false });

  // 4. What each certificate is for: title, cover, and the tags and tools its instructor set
  //    (a learning path's skills). The portfolio shows them as the Explore cards do.
  const ids = (key: string) => [...new Set((certsRaw ?? []).map((c: any) => c[key]).filter(Boolean))];
  const courseIds = ids('course_id'), veIds = ids('ve_id'), pathIds = ids('learning_path_id'), certificationIds = ids('certification_id');
  const none = Promise.resolve({ data: [] as any[] });
  const [{ data: coursesRaw }, { data: vesRaw }, { data: pathsRaw }, { data: certificationsRaw }] = await Promise.all([
    courseIds.length ? supabase.from('courses').select('id, title, cover_image, tags, tools').in('id', courseIds) : none,
    veIds.length     ? supabase.from('virtual_experiences').select('id, title, cover_image, tags, tools').in('id', veIds) : none,
    pathIds.length   ? supabase.from('learning_paths').select('id, title, cover_image, skills, tools').in('id', pathIds) : none,
    certificationIds.length ? supabase.from('certifications').select('id, title, cover_image, tags').in('id', certificationIds) : none,
  ]);
  const byId = (rows: any[] | null) => Object.fromEntries((rows ?? []).map((r: any) => [r.id, r]));
  const courseMap = byId(coursesRaw), veMap = byId(vesRaw), pathMap = byId(pathsRaw), certificationMap = byId(certificationsRaw);
  const list = (v: unknown): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((t): t is string => typeof t === 'string').map(t => t.trim()).filter(Boolean))] : [];

  const allCerts = (certsRaw ?? []).map((c: any) => {
    const contentType = c.course_id ? 'course' : c.ve_id ? 'virtual_experience' : c.learning_path_id ? 'learning_path' : c.certification_id ? 'certification' : 'course';
    const content = c.course_id ? courseMap[c.course_id] : c.ve_id ? veMap[c.ve_id] : c.learning_path_id ? pathMap[c.learning_path_id] : c.certification_id ? certificationMap[c.certification_id] : null;
    return {
      id:          c.id,
      courseName:  content?.title || (contentType === 'virtual_experience' ? 'Virtual Experience' : contentType === 'learning_path' ? 'Learning Path' : contentType === 'certification' ? 'Certification' : 'Course'),
      coverImage:  content?.cover_image ?? null,
      contentType,
      issuedAt:    c.issued_at,
      tags:        list(contentType === 'learning_path' ? content?.skills : content?.tags),
      tools:       list(content?.tools),
    };
  });

  // 5. Build response -- public fields only
  return NextResponse.json({
    profile: {
      username:       student.username,
      fullName:       student.full_name,
      avatarUrl:      student.avatar_url,
      bio:            student.bio,
      country:        student.country,
      city:           student.city,
      socialLinks:    student.social_links ?? {},
      role:           student.role,
      memberSince:    student.created_at,
      education,
      workExperience:  work_experience,
      skills,
      portfolioItems:  portfolio_items,
    },
    certificates: allCerts,
  });
}
