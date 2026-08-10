import { describe, expect, it } from 'vitest';
import { ExperienceGuideResolutionError, resolveExperienceGuide, resolveTransferredExperienceGuide } from '@/lib/experience-guide';

function mockDb(rows: Record<string, any[]>) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
        maybeSingle: async () => ({
          data: (rows[table] ?? []).find(row => filters.every(([column, value]) => row[column] === value)) ?? null,
        }),
      };
      return query;
    },
  };
}

describe('resolveExperienceGuide', () => {
  it('drops an embedded snapshot when there is no canonical guide selection', async () => {
    await expect(resolveExperienceGuide({ db: mockDb({}), ownerId: 'owner-1', requestedGuideId: undefined, publishing: false }))
      .resolves.toEqual({ guideId: null, snapshot: null });
  });

  it('rebuilds an external snapshot from the owner-scoped guide row', async () => {
    const db = mockDb({ experience_guides: [{
      id: 'guide-1', owner_id: 'owner-1', source_type: 'external', status: 'active', consent_status: 'confirmed',
      full_name: 'Ada Example', professional_title: 'Analyst', company: 'Example Co', profile_photo_url: 'photo',
      bio: 'Bio', linkedin_url: 'https://linkedin.example/ada', expertise: ['SQL'],
    }] });
    const result = await resolveExperienceGuide({ db, ownerId: 'owner-1', requestedGuideId: 'guide-1', publishing: true });
    expect(result.guideId).toBe('guide-1');
    expect(result.snapshot).toMatchObject({ fullName: 'Ada Example', consentStatus: 'confirmed', sourceType: 'external' });
  });

  it('blocks publication when canonical external consent is not confirmed', async () => {
    const db = mockDb({ experience_guides: [{
      id: 'guide-1', owner_id: 'owner-1', source_type: 'external', status: 'active', consent_status: 'pending', full_name: 'Ada Example',
    }] });
    await expect(resolveExperienceGuide({ db, ownerId: 'owner-1', requestedGuideId: 'guide-1', publishing: true }))
      .rejects.toBeInstanceOf(ExperienceGuideResolutionError);
  });

  it('drops an installation-local guide ID that does not exist on a transfer destination', async () => {
    await expect(resolveTransferredExperienceGuide({
      db: mockDb({}), ownerId: 'destination-owner', requestedGuideId: 'source-platform-guide', publishing: false,
    })).resolves.toEqual({ guideId: null, snapshot: null });
  });

  it('does not bypass publish checks when a transferred guide resolves locally', async () => {
    const db = mockDb({ experience_guides: [{
      id: 'guide-1', owner_id: 'owner-1', source_type: 'external', status: 'active', consent_status: 'pending', full_name: 'Ada Example',
    }] });
    await expect(resolveTransferredExperienceGuide({ db, ownerId: 'owner-1', requestedGuideId: 'guide-1', publishing: true }))
      .rejects.toMatchObject({ code: 'not_publishable' });
  });

  it('rebuilds instructor identity from the students table', async () => {
    const db = mockDb({ students: [{
      id: 'staff-1', role: 'instructor', full_name: 'Sam Instructor', avatar_url: null, bio: null,
      social_links: { linkedin: 'https://linkedin.example/sam' },
      work_experience: [{ title: 'Lead', company: 'Example Co', current: true }], skills: ['Data'],
    }] });
    const result = await resolveExperienceGuide({ db, ownerId: 'owner-1', requestedGuideId: 'instructor:staff-1', publishing: true });
    expect(result).toMatchObject({
      guideId: null,
      snapshot: { fullName: 'Sam Instructor', professionalTitle: 'Lead', consentStatus: 'not_required', linkedUserId: 'staff-1' },
    });
  });
});
