import type { Metadata } from 'next';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { CataloguePage } from '@/components/landing/CataloguePage';

const LINE = 'Launch your career in tech with curated courses, virtual experiences and guided projects.';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantSettings();
  return { title: `Learning paths - ${tenant.appName}`, description: LINE };
}

export default function LearningPathsPage() {
  return <CataloguePage type="path" title="Learning paths" line={LINE} noun="learning paths" />;
}
