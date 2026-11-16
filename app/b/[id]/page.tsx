import { loadBadge } from "@/lib/badge";
import { getTenantSettings } from "@/lib/get-tenant-settings";
import { linkedInAddCertUrl } from '@/lib/linkedin-cert-url';

// Server component: the badge is fetched and rendered on the server so it
// appears in the initial HTML (no client-side spinner) -- important for a public
// page people open from shared links. The page is non-interactive (links only),
// so it needs no client JS.

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16}>
      <path fill="#0A66C2" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  );
}

export default async function BadgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await loadBadge(id);

  if (result.status === "notfound") {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F2F5FA' }}>
        <div className="text-center px-8 py-10 max-w-sm rounded-3xl bg-white" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Badge Not Found</h1>
          <p className="text-gray-500 text-sm">This badge does not exist or has not been earned.</p>
        </div>
      </div>
    );
  }

  const data = result.data;
  const t = await getTenantSettings();
  const pageUrl = t.appUrl ? `${t.appUrl}/b/${id}` : `/b/${id}`;

  const awarded      = new Date(data.awardedAt);
  const awardedDate  = awarded.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const initials = data.studentName
    .split(' ')
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');

  const liUrl = t.appUrl
    ? linkedInAddCertUrl({ name: data.badgeName, issuedAt: data.awardedAt, certId: id, certUrl: pageUrl })
    : '#';

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: '#F2F5FA' }}>
      <div className="w-full max-w-lg rounded-3xl bg-white overflow-hidden" style={{ border: '1px solid rgba(0,0,0,0.07)' }}>
        <div className="px-6 sm:px-10 py-10 sm:py-12">

          {/* Badge */}
          <div className="flex flex-col items-center text-center">
            <div
              className="w-44 h-44 rounded-3xl flex items-center justify-center mb-6"
              style={{ background: `${data.badgeColor}18`, boxShadow: `0 8px 40px ${data.badgeColor}30` }}
            >
              {data.badgeImageUrl
                ? (
                  <div className="drop-shadow-lg">
                    <img src={data.badgeImageUrl} alt={data.badgeName} fetchPriority="high" className="w-36 h-36 object-contain" />
                  </div>
                )
                : <span className="text-8xl leading-none">{data.badgeIcon}</span>
              }
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-gray-900 leading-tight">{data.badgeName}</h1>
            <p className="mt-2 text-sm text-gray-500 max-w-xs leading-relaxed">{data.badgeDescription}</p>
            <span
              className="mt-4 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold"
              style={{ background: `${data.badgeColor}14`, color: data.badgeColor }}
            >
              Awarded {awardedDate}
            </span>
          </div>

          <div className="my-8" style={{ height: 1, background: 'rgba(0,0,0,0.07)' }} />

          {/* Student row */}
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center"
              style={{ background: data.badgeColor }}
            >
              {data.studentAvatarUrl
                ? <img src={data.studentAvatarUrl} alt={data.studentName} className="w-full h-full object-cover" />
                : <span className="text-white font-bold text-sm">{initials}</span>
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 leading-tight truncate">{data.studentName}</p>
              {data.studentUsername && (
                <a href={`/s/${data.studentUsername}`} className="text-xs hover:underline" style={{ color: data.badgeColor }}>View Profile</a>
              )}
            </div>
            <a
              href={liUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-gray-700 text-xs font-semibold rounded-lg hover:bg-gray-100 transition-colors flex-shrink-0"
              style={{ background: '#f4f5f7' }}
            >
              <LinkedInIcon />
              Add to LinkedIn
            </a>
          </div>

        </div>
      </div>
    </div>
  );
}
