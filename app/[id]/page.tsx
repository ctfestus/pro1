import type { Metadata } from 'next';
import { buildShareMetadata } from '@/lib/content-share-metadata';
import PublicFormPage from './PublicFormPage';

// Server wrapper so link previews can read ?catalogueType= (a layout never receives search
// params). The page itself is the client component in PublicFormPage.tsx.
export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const catalogueType = typeof query.catalogueType === 'string' ? query.catalogueType : null;
  return buildShareMetadata(id, catalogueType);
}

export default function Page() {
  return <PublicFormPage />;
}
