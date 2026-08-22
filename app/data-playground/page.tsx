'use client';

import Link from 'next/link';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';
import { DataPlaygroundGrid, WhatsAppCommunityBanner } from '@/components/data-playground/lazy';
import { useC } from '@/lib/theme';

export default function DataPlaygroundPage() {
  const C = useC();
  const { theme, toggle: toggleTheme } = useTheme();
  const { logoUrl, logoDarkUrl, whatsappCommunityUrl } = useTenant();
  const isDark = theme === 'dark';
  const font = "'Google Sans', Inter, sans-serif";

  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: font }}>
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: C.nav, borderBottom: `1px solid ${C.navBorder}`, backdropFilter: 'blur(12px)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            {(isDark ? logoDarkUrl || logoUrl : logoUrl)
              ? <img src={(isDark ? logoDarkUrl || logoUrl : logoUrl) || undefined} alt="Logo" style={{ height: 32, objectFit: 'contain' }} />
              : <span style={{ fontWeight: 900, fontSize: 18, color: C.text }}>Data Playground</span>
            }
          </Link>
          <button onClick={toggleTheme} style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: C.input, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}>
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </nav>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '48px 24px 32px' }}>
        <h1 style={{ fontWeight: 900, fontSize: 36, color: C.text, margin: '0 0 12px', lineHeight: 1.2 }}>Data Playground</h1>
        <p style={{ fontSize: 17, color: C.muted, margin: '0 0 36px', lineHeight: 1.65, maxWidth: 920 }}>
          Explore real-world datasets and sharpen your skills in data analysis, visualization, and storytelling. Each dataset comes with business questions designed to challenge how you think with data.
        </p>

        <WhatsAppCommunityBanner url={whatsappCommunityUrl} C={C} isDark={isDark} style={{ margin: '0 0 36px' }} />

        <DataPlaygroundGrid
          C={C}
          isDark={isDark}
          loadingCardCount={6}
          searchMaxWidth={560}
          searchInputShadow
          showDetailCta
        />
      </div>
    </div>
  );
}
