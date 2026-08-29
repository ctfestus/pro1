import { createClient } from '@supabase/supabase-js';
import type { Metadata } from 'next';
import { resolveCoverUrl } from '@/lib/cloudinary-url';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function findContent(id: string) {
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const field = isUUID ? 'id' : 'slug';

  const [{ data: course }, { data: event }, { data: ve }, { data: learningPath }] = await Promise.all([
    supabase.from('courses').select('id, title, description, cover_image').eq(field, id).maybeSingle(),
    supabase.from('events').select('id, title, description, cover_image').eq(field, id).maybeSingle(),
    supabase.from('virtual_experiences').select('id, title, description, cover_image').eq(field, id).maybeSingle(),
    isUUID
      ? supabase.from('learning_paths').select('id, title, description, cover_image').eq('id', id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (course) return { id: course.id, title: course.title, description: course.description, coverImage: course.cover_image };
  if (event)  return { id: event.id,  title: event.title,  description: event.description,  coverImage: event.cover_image };
  if (ve)     return { id: ve.id,     title: ve.title,     description: ve.description,     coverImage: ve.cover_image };
  if (learningPath) return { id: learningPath.id, title: learningPath.title, description: learningPath.description, coverImage: learningPath.cover_image };
  return null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const data = await findContent(id);

  if (!data) return { title: 'Not Found' };

  // Strip HTML tags so og:description is plain text (descriptions are rich text)
  const stripped = (data.description || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  // LinkedIn requires at least 100 characters -- pad with a generic suffix if short
  const appName = process.env.NEXT_PUBLIC_APP_NAME || '';
  const suffix  = appName ? ` Powered by ${appName}.` : '.';
  const plainDescription = stripped.length >= 100
    ? stripped
    : (stripped
        ? `${stripped}${suffix}`
        : `${data.title}${suffix}`
      ).slice(0, 200);

  const rawUrl =
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const appUrl = rawUrl.replace(/\/$/, '');

  // Resolve bare Cloudinary public_ids to full https URLs so the http branch below uses them
  // directly (crawlers fetch Cloudinary). Otherwise they fall through to the /api/og proxy,
  // which has no Cloudinary handling and 404s -- breaking social previews for new covers.
  const coverImage = resolveCoverUrl(data.coverImage);

  let ogImage: string | undefined;
  if (coverImage) {
    if (coverImage.startsWith('https://images.pexels.com')) {
      const base = coverImage.split('?')[0];
      ogImage = `${base}?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop`;
    } else if (coverImage.startsWith('http')) {
      ogImage = coverImage;
    } else {
      ogImage = `${appUrl}/api/og/${data.id}`;
    }
  }

  return {
    title: data.title,
    description: plainDescription,
    openGraph: {
      title: data.title,
      description: plainDescription,
      images: ogImage ? [{ url: ogImage, width: 1200, height: 630 }] : [],
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title: data.title,
      description: plainDescription,
      images: ogImage ? [ogImage] : [],
    },
  };
}

export default function FormLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
