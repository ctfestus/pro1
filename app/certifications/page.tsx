import type { Metadata } from 'next';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { CataloguePage } from '@/components/landing/CataloguePage';

const LINE = 'Prove what you can already do. Timed, protected exams that end in a credential you can share.';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await getTenantSettings();
  return { title: `Certifications - ${tenant.appName}`, description: LINE };
}

export default function CertificationsPage() {
  return <CataloguePage type="certification" title="Certifications" line={LINE} noun="certifications" />;
}
