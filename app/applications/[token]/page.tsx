import { ApplicationPortal } from '@/components/ApplicationPortal';

export default async function ApplicationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ApplicationPortal token={token} />;
}
