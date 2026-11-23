import type { Metadata } from 'next';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { CataloguePage } from '@/components/landing/CataloguePage';

const LINE = 'Level up your skills with interactive and project-based courses.';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantSettings();
  return { title: `Courses - ${tenant.appName}`, description: LINE };
}

export default function CoursesPage() {
  return <CataloguePage type="course" title="Courses" line={LINE} noun="courses" />;
}
