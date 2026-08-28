import 'server-only';

import { unstable_cache } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { adminClient } from './admin-client';
import { resolveCoverUrl } from './cloudinary-url';
import type { SiteConfig } from './site-templates';

export type PathCourse = {
  id: string;
  title: string;
  imageUrl: string;
  slug: string;
  type?: 'course' | 've' | 'certification';
};

export type ProgrammeItem = {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  badge: string;
  difficulty?: string;
  type: 'course' | 've' | 'path';
  slug: string;
  category?: string;
  partnerName?: string;
  partnerLogoUrl?: string;
  pathCourses?: PathCourse[];
};

export type LandingPageData = {
  template: string;
  config: Partial<SiteConfig>;
  programmes: ProgrammeItem[];
  programmesError: boolean;
};

export const getLandingSiteSettings = unstable_cache(
  async (): Promise<{ template: string; config: Partial<SiteConfig> }> => {
    const { data, error } = await adminClient()
      .from('site_settings')
      .select('template, config')
      .eq('singleton', true)
      .maybeSingle();

    if (error) throw error;
    return {
      template: data?.template ?? 'modern',
      config: (data?.config ?? {}) as Partial<SiteConfig>,
    };
  },
  ['landing-site-settings'],
  { revalidate: 60, tags: ['landing-site-settings'] },
);

export async function getLandingSiteSettingsOrDefault() {
  try {
    return await getLandingSiteSettings();
  } catch {
    return { template: 'modern', config: {} as Partial<SiteConfig> };
  }
}

const getProgrammes = unstable_cache(
  async (): Promise<ProgrammeItem[]> => {
    const publicClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );

    const [coursesResult, experiencesResult, pathsResult, offeredResult] = await Promise.all([
      publicClient.from('published_courses').select('id,title,cover_image,slug,category,description,partner_name,partner_logo_url').limit(20),
      publicClient.from('published_virtual_experiences').select('id,title,cover_image,slug,tagline,difficulty,industry').limit(12),
      publicClient.from('published_learning_paths').select('id,title,description,cover_image').limit(8),
      // What a visitor without an account can actually obtain. The published_* views list every
      // published row, so without this the page advertises bootcamp-cohort content nobody
      // outside that cohort can get -- a dead-end click, and private client delivery on a public
      // marketing page. The view applies the same rule the content page enforces.
      publicClient.from('publicly_offered_content').select('content_table,content_id'),
    ]);

    const catalogueError = coursesResult.error || experiencesResult.error || pathsResult.error;
    if (catalogueError) throw catalogueError;

    // A failure here must not blank the marketing page. Falling back to showing everything keeps
    // the old behaviour, which is a dead-end click at worst -- an empty homepage is worse.
    const offeredRows = offeredResult.error ? null : (offeredResult.data ?? []);
    const offered = (table: string, id: string) =>
      offeredRows === null || offeredRows.some(row => row.content_table === table && row.content_id === id);

    const courses: ProgrammeItem[] = (coursesResult.data ?? [])
      .filter((row) => offered('courses', row.id))
      .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? '',
      imageUrl: resolveCoverUrl(row.cover_image),
      badge: 'Course',
      type: 'course',
      slug: row.slug,
      category: row.category ?? '',
      partnerName: row.partner_name ?? undefined,
      partnerLogoUrl: row.partner_logo_url ?? undefined,
    }));

    const experiences: ProgrammeItem[] = (experiencesResult.data ?? [])
      .filter((row) => offered('virtual_experiences', row.id))
      .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.tagline ?? row.industry ?? '',
      imageUrl: resolveCoverUrl(row.cover_image),
      badge: 'Guided Project',
      difficulty: row.difficulty
        ? row.difficulty.charAt(0).toUpperCase() + row.difficulty.slice(1)
        : undefined,
      type: 've',
      slug: row.slug,
      category: row.industry
        ? row.industry.charAt(0).toUpperCase() + row.industry.slice(1)
        : '',
    }));

    const pathRows = (pathsResult.data ?? []).filter((row) => offered('learning_paths', row.id));
    const pathIds = pathRows.map((row) => row.id);
    const pathCourseMap: Record<string, PathCourse[]> = {};
    if (pathIds.length > 0) {
      const pathItemsResult = await publicClient
        .from('published_path_items')
        .select('path_id,id,title,cover_image,slug,type,position')
        .in('path_id', pathIds)
        .order('position');

      if (pathItemsResult.error) throw pathItemsResult.error;
      (pathItemsResult.data ?? []).forEach((row) => {
        if (!pathCourseMap[row.path_id]) pathCourseMap[row.path_id] = [];
        pathCourseMap[row.path_id].push({
          id: row.id,
          title: row.title,
          imageUrl: resolveCoverUrl(row.cover_image),
          slug: row.slug,
          type: row.type,
        });
      });
    }

    const paths: ProgrammeItem[] = pathRows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? '',
      imageUrl: resolveCoverUrl(row.cover_image),
      badge: 'Learning Path',
      type: 'path',
      slug: '',
      category: '',
      pathCourses: pathCourseMap[row.id] ?? [],
    }));

    return [...courses, ...experiences, ...paths];
  },
  ['landing-programmes-v2'],
  { revalidate: 60, tags: ['landing-programmes'] },
);

export async function getLandingPageData(): Promise<LandingPageData> {
  const [settingsResult, programmesResult] = await Promise.allSettled([
    getLandingSiteSettings(),
    getProgrammes(),
  ]);

  const settings = settingsResult.status === 'fulfilled'
    ? settingsResult.value
    : { template: 'modern', config: {} };
  const programmes = programmesResult.status === 'fulfilled'
    ? { items: programmesResult.value, error: false }
    : { items: [], error: true };

  return {
    ...settings,
    programmes: programmes.items,
    programmesError: programmes.error,
  };
}
