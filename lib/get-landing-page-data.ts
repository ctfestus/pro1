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

    // What a visitor without an account can actually obtain. The published_* views list every
    // published row, so without this the page advertises bootcamp-cohort content nobody outside
    // that cohort can get -- a dead-end click, and private client delivery on a public marketing
    // page. The view applies the same rule the content detail page enforces.
    //
    // Read FIRST, and a failure here throws rather than falling back to showing everything.
    // Failing open would restore the leak precisely when the guard is broken or the migration has
    // not been applied -- the one moment it has to hold. The caller reports programmesError, and
    // the page says so, which is the honest outcome.
    const offeredResult = await publicClient
      .from('publicly_offered_content')
      .select('content_table,content_id');
    if (offeredResult.error) throw offeredResult.error;
    const offeredRows = offeredResult.data ?? [];
    const offeredIds = (table: string) =>
      offeredRows.filter(row => row.content_table === table).map(row => row.content_id);
    const courseIds = offeredIds('courses');
    const experienceIds = offeredIds('virtual_experiences');
    const offeredPathIds = offeredIds('learning_paths');

    // The id filter has to go on the query, not on its results. Filtering afterwards lets private
    // rows occupy the row budget and pushes genuine public offerings off the page entirely.
    const empty = { data: [] as any[], error: null };
    const [coursesResult, experiencesResult, pathsResult] = await Promise.all([
      courseIds.length
        ? publicClient.from('published_courses').select('id,title,cover_image,slug,category,description,partner_name,partner_logo_url').in('id', courseIds).limit(20)
        : empty,
      experienceIds.length
        ? publicClient.from('published_virtual_experiences').select('id,title,cover_image,slug,tagline,difficulty,industry').in('id', experienceIds).limit(12)
        : empty,
      offeredPathIds.length
        ? publicClient.from('published_learning_paths').select('id,title,description,cover_image').in('id', offeredPathIds).limit(8)
        : empty,
    ]);

    const catalogueError = coursesResult.error || experiencesResult.error || pathsResult.error;
    if (catalogueError) throw catalogueError;

    const courses: ProgrammeItem[] = (coursesResult.data ?? []).map((row) => ({
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

    const experiences: ProgrammeItem[] = (experiencesResult.data ?? []).map((row) => ({
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

    const pathRows = pathsResult.data ?? [];
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
