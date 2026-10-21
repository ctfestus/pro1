import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { chosenTrack, requiredItemIds } from '@/lib/learning-path-tracks';

// Server-only loader for public certificate display data. Shared by the
// /api/certificate route and the server-rendered /certificate/[id] page.
// Keep the response limited to public fields -- never expose student_email.

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

type CertType = 'course' | 'virtual_experience' | 'learning_path' | 'certification';

export interface CertificateData {
  certId:           string;
  studentName:      string;
  studentAvatarUrl: string | null;
  studentUsername:  string | null;
  courseName:       string;
  issueDate:        string;
  issuedAt:         string;
  certType:         CertType;
  badgeImageUrl:    string | null;
  settings:         Record<string, any> | null;
  pathItems?:       { id: string; title: string; coverImage: string | null }[];
  pathCoverImage?:  string | null;
  partnerName?:     string | null;
  partnerLogoUrl?:  string | null;
}

export type CertificateResult =
  | { status: 'notfound' }
  | { status: 'revoked' }
  | { status: 'ready'; data: CertificateData };

function mapSettings(raw: any): Record<string, any> | null {
  return raw ? {
    institutionName:    raw.institution_name,
    primaryColor:       raw.primary_color,
    accentColor:        raw.accent_color,
    backgroundImageUrl: raw.background_image_url,
    logoUrl:            raw.logo_url,
    signatureUrl:       raw.signature_url,
    signatoryName:      raw.signatory_name,
    signatoryTitle:     raw.signatory_title,
    certifyText:        raw.certify_text,
    completionText:     raw.completion_text,
    fontFamily:         raw.font_family,
    headingSize:        raw.heading_size,
    paddingTop:         raw.padding_top,
    paddingLeft:        raw.padding_left,
    lineSpacing:        raw.line_spacing,
    alignment:          raw.alignment ?? 'left',
    headerText:         raw.header_text ?? 'Certificate of Completion',
    textPositions:      raw.text_positions ?? undefined,
  } : null;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export async function loadCertificate(id: string): Promise<CertificateResult> {
  const { data: cert, error } = await svc
    .from('certificates')
    .select('id, student_name, issued_at, revoked, course_id, ve_id, learning_path_id, certification_id, student_id')
    .eq('id', id)
    .single();

  if (error || !cert) return { status: 'notfound' };
  if (cert.revoked)   return { status: 'revoked' };

  const { data: studentRow } = await svc
    .from('students')
    .select('avatar_url, username')
    .eq('id', cert.student_id)
    .maybeSingle();
  const studentAvatarUrl = studentRow?.avatar_url ?? null;
  const studentUsername  = studentRow?.username   ?? null;

  const base = {
    certId:      cert.id,
    studentName: cert.student_name,
    studentAvatarUrl,
    studentUsername,
    issueDate:   fmtDate(cert.issued_at),
    issuedAt:    cert.issued_at,
  };

  // VE certificate
  if (cert.ve_id) {
    const { data: ve } = await svc
      .from('virtual_experiences')
      .select('title, user_id, badge_image_url')
      .eq('id', cert.ve_id)
      .single();

    const { data: rawSettings } = ve?.user_id
      ? await svc.from('certificate_defaults').select('*').eq('user_id', ve.user_id).eq('content_type', 'default').maybeSingle()
      : { data: null };

    return {
      status: 'ready',
      data: {
        ...base,
        courseName:    ve?.title ?? 'Virtual Experience',
        certType:      'virtual_experience',
        badgeImageUrl: ve?.badge_image_url ?? null,
        settings:      mapSettings(rawSettings),
      },
    };
  }

  // Certification certificate
  if (cert.certification_id) {
    const { data: c } = await svc
      .from('certifications')
      .select('title, user_id, badge_image_url')
      .eq('id', cert.certification_id)
      .maybeSingle();

    // Certification uses its own design when customized, otherwise falls back to the default one.
    let rawSettings: any = null;
    if (c?.user_id) {
      ({ data: rawSettings } = await svc.from('certificate_defaults').select('*')
        .eq('user_id', c.user_id).eq('content_type', 'certification').maybeSingle());
      if (!rawSettings) {
        ({ data: rawSettings } = await svc.from('certificate_defaults').select('*')
          .eq('user_id', c.user_id).eq('content_type', 'default').maybeSingle());
      }
    }

    return {
      status: 'ready',
      data: {
        ...base,
        courseName:    c?.title ?? 'Certification',
        certType:      'certification',
        badgeImageUrl: c?.badge_image_url ?? null,
        settings:      mapSettings(rawSettings),
      },
    };
  }

  // Learning path certificate
  if (!cert.course_id && cert.learning_path_id) {
    const [{ data: pathRow }, { data: prog }] = await Promise.all([
      svc.from('learning_paths')
        .select('title, instructor_id, item_ids, tracks, cover_image, badge_image_url')
        .eq('id', cert.learning_path_id)
        .single(),
      cert.student_id
        ? svc.from('learning_path_progress').select('track_id')
            .eq('learning_path_id', cert.learning_path_id).eq('student_id', cert.student_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    // On a path with tracks the certificate lists what this learner took (core + their track)
    // and names the track.
    const track = pathRow ? chosenTrack(pathRow, (prog as any)?.track_id) : null;
    const path = pathRow ? { ...pathRow, item_ids: requiredItemIds(pathRow, track?.id) } : pathRow;

    const [{ data: rawSettings }, pathItemsResult] = await Promise.all([
      path?.instructor_id
        ? svc.from('certificate_defaults').select('*').eq('user_id', path.instructor_id).eq('content_type', 'default').maybeSingle()
        : Promise.resolve({ data: null }),
      (path?.item_ids ?? []).length > 0
        ? Promise.all([
            svc.from('courses').select('id, title, cover_image').in('id', path!.item_ids),
            svc.from('virtual_experiences').select('id, title, cover_image').in('id', path!.item_ids),
            svc.from('certifications').select('id, title, cover_image').in('id', path!.item_ids),
          ])
        : Promise.resolve(null),
    ]);

    let pathItems: { id: string; title: string; coverImage: string | null }[] = [];
    if (pathItemsResult && path?.item_ids) {
      const [{ data: pCourses }, { data: pVes }, { data: pCerts }] = pathItemsResult as any;
      const itemMap: Record<string, { title: string; coverImage: string | null }> = Object.fromEntries([
        ...(pCourses ?? []).map((r: any) => [r.id, { title: r.title, coverImage: r.cover_image ?? null }]),
        ...(pVes     ?? []).map((r: any) => [r.id, { title: r.title, coverImage: r.cover_image ?? null }]),
        ...(pCerts   ?? []).map((r: any) => [r.id, { title: r.title, coverImage: r.cover_image ?? null }]),
      ]);
      pathItems = (path.item_ids as string[]).map(itemId => ({ id: itemId, ...itemMap[itemId] })).filter(r => r.title);
    }

    return {
      status: 'ready',
      data: {
        ...base,
        courseName:     path?.title ? (track ? `${path.title}: ${track.name} track` : path.title) : 'Learning Path',
        certType:       'learning_path',
        badgeImageUrl:  (path as any)?.badge_image_url ?? null,
        pathItems,
        pathCoverImage: (path as any)?.cover_image ?? null,
        settings:       mapSettings(rawSettings),
      },
    };
  }

  // Course certificate
  const { data: content } = await svc
    .from('courses')
    .select('title, user_id, badge_image_url, partner_id')
    .eq('id', cert.course_id)
    .maybeSingle();

  const [{ data: rawSettings }, { data: partner }] = await Promise.all([
    content?.user_id
      ? svc.from('certificate_defaults').select('*').eq('user_id', content.user_id).eq('content_type', 'default').maybeSingle()
      : Promise.resolve({ data: null }),
    content?.partner_id
      ? svc.from('partners').select('name, logo_url').eq('id', content.partner_id).eq('is_active', true).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    status: 'ready',
    data: {
      ...base,
      courseName:    content?.title || 'Course',
      certType:      'course',
      badgeImageUrl: content?.badge_image_url ?? null,
      partnerName:    partner?.name ?? null,
      partnerLogoUrl: partner?.logo_url ?? null,
      settings:      mapSettings(rawSettings),
    },
  };
}
