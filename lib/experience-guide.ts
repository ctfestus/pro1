export interface VerifiedExperienceGuide {
  guideId: string | null;
  snapshot: Record<string, unknown> | null;
}

export class ExperienceGuideResolutionError extends Error {
  constructor(message: string, readonly code: 'not_found' | 'not_publishable') {
    super(message);
    this.name = 'ExperienceGuideResolutionError';
  }
}

interface ResolveExperienceGuideOptions {
  db: any;
  ownerId: string;
  requestedGuideId: unknown;
  publishing: boolean;
}

/** Build a public guide snapshot exclusively from canonical server-side rows. */
export async function resolveExperienceGuide({
  db,
  ownerId,
  requestedGuideId,
  publishing,
}: ResolveExperienceGuideOptions): Promise<VerifiedExperienceGuide> {
  const guideId = typeof requestedGuideId === 'string' ? requestedGuideId.trim() : '';
  if (!guideId) return { guideId: null, snapshot: null };

  if (guideId.startsWith('instructor:')) {
    const linkedUserId = guideId.slice('instructor:'.length).trim();
    const { data: instructor } = await db
      .from('students')
      .select('id, full_name, avatar_url, bio, social_links, work_experience, skills, role')
      .eq('id', linkedUserId)
      .maybeSingle();
    if (!instructor || !['instructor', 'admin'].includes(instructor.role) || !instructor.full_name) {
      throw new ExperienceGuideResolutionError('The selected instructor profile is no longer available.', 'not_found');
    }
    const work = Array.isArray(instructor.work_experience) ? instructor.work_experience : [];
    const currentWork = work.find((item: any) => item?.current) ?? work[0];
    const social = instructor.social_links && typeof instructor.social_links === 'object' ? instructor.social_links : {};
    return {
      guideId: null,
      snapshot: {
        fullName: instructor.full_name,
        professionalTitle: currentWork?.title || 'Instructor',
        company: currentWork?.company || undefined,
        profilePhotoUrl: instructor.avatar_url || undefined,
        linkedUserId: instructor.id,
        sourceType: 'instructor',
        consentStatus: 'not_required',
        bio: instructor.bio || undefined,
        linkedinUrl: social.linkedin || undefined,
        expertise: Array.isArray(instructor.skills)
          ? instructor.skills.filter((item: unknown) => typeof item === 'string').slice(0, 20)
          : [],
      },
    };
  }

  const { data: guide } = await db
    .from('experience_guides')
    .select('id, full_name, profile_photo_url, professional_title, company, bio, linkedin_url, expertise, consent_status, source_type, status')
    .eq('id', guideId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (!guide || guide.source_type !== 'external') {
    throw new ExperienceGuideResolutionError('The selected professional profile was not found.', 'not_found');
  }
  if (publishing && guide.status !== 'active') {
    throw new ExperienceGuideResolutionError('Reactivate the selected professional profile before publishing.', 'not_publishable');
  }
  if (publishing && guide.consent_status !== 'confirmed') {
    throw new ExperienceGuideResolutionError('Permission must be confirmed before publishing a professional profile.', 'not_publishable');
  }

  return {
    guideId: guide.id,
    snapshot: {
      fullName: guide.full_name,
      professionalTitle: guide.professional_title || undefined,
      company: guide.company || undefined,
      profilePhotoUrl: guide.profile_photo_url || undefined,
      sourceType: 'external',
      consentStatus: guide.consent_status,
      bio: guide.bio || undefined,
      linkedinUrl: guide.linkedin_url || undefined,
      expertise: Array.isArray(guide.expertise) ? guide.expertise : [],
    },
  };
}

/**
 * Resolve guide identity at a content-transfer boundary. Guide IDs are installation-local,
 * so a missing row on the destination means the transferred VE simply has no guide.
 * Canonical rows that do exist still receive the normal consent/status validation.
 */
export async function resolveTransferredExperienceGuide(
  options: ResolveExperienceGuideOptions,
): Promise<VerifiedExperienceGuide> {
  try {
    return await resolveExperienceGuide(options);
  } catch (error) {
    if (error instanceof ExperienceGuideResolutionError && error.code === 'not_found') {
      return { guideId: null, snapshot: null };
    }
    throw error;
  }
}
