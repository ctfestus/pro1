import { ApplicationStart } from '@/components/ApplicationStart';

export default async function ApplyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ApplicationStart slug={slug} />;
}
