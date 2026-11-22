import { loadBadge } from "@/lib/badge";
import BadgePageClient from "./BadgePageClient";

// Server component: the badge is fetched on the server so it appears in the initial HTML (no
// client-side spinner) -- important for a public page people open from shared links. The layout is
// the shared credential layout (BadgePageClient), which adds Download and Copy link.

export default async function BadgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadBadge(id);

  if (result.status === "notfound") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F2F5FA' }}>
        <div className="text-center px-8 py-10 max-w-sm rounded-3xl bg-white" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Badge not found</h1>
          <p className="text-gray-500 text-sm">This badge does not exist or has not been earned.</p>
        </div>
      </div>
    );
  }

  return <BadgePageClient badgeId={id} data={result.data} />;
}
