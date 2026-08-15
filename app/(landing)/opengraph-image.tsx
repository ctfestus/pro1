import { ImageResponse } from 'next/og';
import { getLandingSiteSettingsOrDefault } from '@/lib/get-landing-page-data';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { resolveImageUrl } from '@/lib/cloudinary-url';
import { loadLandingOgImageDataUrl } from '@/lib/landing-og-image';
import { resolveConfig } from '@/lib/site-templates';

export const alt = 'Learning platform course catalogue';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const dynamic = 'force-dynamic';

const responseOptions = {
  ...size,
  headers: {
    'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
  },
};

function safeColor(value: string, fallback: string) {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function compact(value: string, maxLength: number) {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 3).trimEnd()}...`;
}

export default async function OpenGraphImage() {
  const [tenant, settings] = await Promise.all([
    getTenantSettings(),
    getLandingSiteSettingsOrDefault(),
  ]);
  const emailBannerUrl = tenant.emailBannerUrl?.trim();
  if (emailBannerUrl) {
    const thumbnailUrl = resolveImageUrl(
      emailBannerUrl,
      'f_auto,q_auto,w_1200,h_630,c_fill,g_auto',
    );
    const bannerDataUrl = await loadLandingOgImageDataUrl(thumbnailUrl);
    if (bannerDataUrl) {
      return new ImageResponse(
        (
          <div style={{ width: '100%', height: '100%', display: 'flex', background: '#111827' }}>
            <img
              src={bannerDataUrl}
              alt=""
              width={size.width}
              height={size.height}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        ),
        responseOptions,
      );
    }
  }

  const config = resolveConfig(settings.template, settings.config);
  const appName = tenant.appName || tenant.orgName || 'Learning platform';
  const primary = safeColor(config.primaryColor || tenant.primaryColor, '#0056d2');
  const accent = safeColor(config.accentColor || tenant.accentColor, '#ff9933');
  const headline = compact(config.heroTitle || config.tracksHeading || config.offeringsHeading || 'Build skills that move your career forward', 48);
  const highlight = compact(config.heroTitleAccent || config.tracksHeadingAccent || '', 52);
  const description = compact(tenant.appDescription || `Build job-ready skills with courses, guided projects and learning paths from ${appName}.`, 120);
  const initials = appName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('') || 'AI';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          color: '#ffffff',
          background: `linear-gradient(135deg, #09131f 0%, ${primary} 68%, #101820 100%)`,
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 68,
              height: 68,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              background: accent,
              color: '#111827',
              fontSize: 25,
              fontWeight: 800,
            }}
          >
            {initials}
          </div>
          <div style={{ display: 'flex', fontSize: 30, fontWeight: 700 }}>{appName}</div>
        </div>

        <div style={{ width: 930, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', fontSize: 54, lineHeight: 1.08, fontWeight: 800 }}>
            <div style={{ display: 'flex' }}>{headline}</div>
            {highlight && <div style={{ display: 'flex', color: accent }}>{highlight}</div>}
          </div>
          <div style={{ display: 'flex', width: 780, fontSize: 25, lineHeight: 1.45, color: 'rgba(255,255,255,0.78)' }}>
            {description}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 20, color: 'rgba(255,255,255,0.82)' }}>
          {['Courses', 'Guided projects', 'Learning paths'].map((label) => (
            <div
              key={label}
              style={{
                display: 'flex',
                padding: '10px 16px',
                border: '1px solid rgba(255,255,255,0.22)',
                borderRadius: 6,
                background: 'rgba(0,0,0,0.16)',
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    responseOptions,
  );
}
