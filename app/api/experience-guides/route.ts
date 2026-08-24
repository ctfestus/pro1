import { NextRequest, NextResponse } from 'next/server';
import { requireRole, isAuthError } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const cleanHttpUrl = (value: unknown) => {
  const raw = clean(value, 1000);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch { return null; }
};

export async function GET(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;

  const [{ data: guides, error }, { data: instructors }] = await Promise.all([
    auth.serviceDb.from('experience_guides').select('*').eq('owner_id', auth.user.id).order('full_name'),
    auth.serviceDb.from('students').select('id, full_name, avatar_url, bio, social_links, work_experience, skills').in('role', ['instructor', 'admin']).order('full_name'),
  ]);
  if (error) return NextResponse.json({ error: 'Failed to load experience guides.' }, { status: 500 });

  return NextResponse.json({
    guides: guides ?? [],
    instructors: (instructors ?? []).filter(p => p.full_name).map(p => {
      const work = Array.isArray(p.work_experience) ? p.work_experience : [];
      const currentWork = work.find((item: any) => item?.current) ?? work[0];
      const social = p.social_links && typeof p.social_links === 'object' ? p.social_links : {};
      return {
        id: `instructor:${p.id}`,
        linked_user_id: p.id,
        source_type: 'instructor',
        full_name: p.full_name,
        profile_photo_url: p.avatar_url,
        professional_title: currentWork?.title || 'Instructor',
        company: currentWork?.company || null,
        bio: p.bio || null,
        linkedin_url: social.linkedin || null,
        expertise: Array.isArray(p.skills) ? p.skills.filter((item: unknown) => typeof item === 'string').slice(0, 20) : [],
        consent_status: 'not_required',
        status: 'active',
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const body = await req.json().catch(() => null);
  const fullName = clean(body?.full_name, 120);
  if (!fullName) return NextResponse.json({ error: 'Professional name is required.' }, { status: 400 });
  if (body?.linkedin_url && !cleanHttpUrl(body.linkedin_url)) return NextResponse.json({ error: 'Enter a valid LinkedIn URL.' }, { status: 400 });
  if (body?.profile_photo_url && !cleanHttpUrl(body.profile_photo_url)) return NextResponse.json({ error: 'Enter a valid profile photo URL.' }, { status: 400 });

  const row = {
    owner_id: auth.user.id,
    source_type: 'external',
    full_name: fullName,
    profile_photo_url: cleanHttpUrl(body?.profile_photo_url),
    professional_title: clean(body?.professional_title, 160) || null,
    company: clean(body?.company, 160) || null,
    bio: clean(body?.bio, 1000) || null,
    linkedin_url: cleanHttpUrl(body?.linkedin_url),
    expertise: Array.isArray(body?.expertise) ? body.expertise.map((x: unknown) => clean(x, 80)).filter(Boolean).slice(0, 20) : [],
    consent_status: body?.consent_status === 'confirmed' ? 'confirmed' : 'pending',
    status: 'active',
  };
  const { data, error } = await auth.serviceDb.from('experience_guides').insert(row).select('*').single();
  if (error) return NextResponse.json({ error: 'Failed to create experience guide.' }, { status: 500 });
  return NextResponse.json({ guide: data }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRole(req, ['instructor', 'admin']);
  if (isAuthError(auth)) return auth.error;
  const body = await req.json().catch(() => null);
  const id = clean(body?.id, 80);
  if (!id) return NextResponse.json({ error: 'Guide id is required.' }, { status: 400 });
  if (body?.full_name !== undefined && !clean(body.full_name, 120)) return NextResponse.json({ error: 'Professional name is required.' }, { status: 400 });
  if (body?.linkedin_url && !cleanHttpUrl(body.linkedin_url)) return NextResponse.json({ error: 'Enter a valid LinkedIn URL.' }, { status: 400 });
  if (body?.profile_photo_url && !cleanHttpUrl(body.profile_photo_url)) return NextResponse.json({ error: 'Enter a valid profile photo URL.' }, { status: 400 });

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.full_name !== undefined) updates.full_name = clean(body.full_name, 120);
  if (body?.profile_photo_url !== undefined) updates.profile_photo_url = cleanHttpUrl(body.profile_photo_url);
  if (body?.professional_title !== undefined) updates.professional_title = clean(body.professional_title, 160) || null;
  if (body?.company !== undefined) updates.company = clean(body.company, 160) || null;
  if (body?.bio !== undefined) updates.bio = clean(body.bio, 1000) || null;
  if (body?.linkedin_url !== undefined) updates.linkedin_url = cleanHttpUrl(body.linkedin_url);
  if (body?.expertise !== undefined) {
    updates.expertise = Array.isArray(body.expertise)
      ? body.expertise.map((x: unknown) => clean(x, 80)).filter(Boolean).slice(0, 20)
      : [];
  }
  if (['draft', 'active', 'archived'].includes(body?.status)) updates.status = body.status;
  if (['pending', 'confirmed', 'not_required'].includes(body?.consent_status)) updates.consent_status = body.consent_status;

  const { data, error } = await auth.serviceDb.from('experience_guides').update(updates).eq('id', id).eq('owner_id', auth.user.id).select('*').maybeSingle();
  if (error || !data) return NextResponse.json({ error: 'Experience guide was not found.' }, { status: 404 });
  return NextResponse.json({ guide: data });
}
