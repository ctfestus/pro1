import type { Metadata } from 'next';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { CataloguePage } from '@/components/landing/CataloguePage';

const LINE = 'Gain job-ready skills with virtual internship programs and projects to build your portfolio.';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantSettings();
  return { title: `Virtual experiences - ${tenant.appName}`, description: LINE };
}

export default function VirtualExperiencesPage() {
  return <CataloguePage type="ve" title="Virtual experiences" line={LINE} noun="virtual experiences" />;
}
