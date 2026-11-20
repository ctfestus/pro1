'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, ExternalLink, Loader2, Upload, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { resolveConfig, type SiteConfig } from '@/lib/site-templates';
import { LIGHT_C, cardStyle } from '@/lib/theme';

function loadFont(family: string) {
  if (!family || family === 'Inter') return;
  const id = `gf-${family.replace(/\s+/g, '-').toLowerCase()}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  // Google Sans Text only ships 400/500/700 -- the css2 API 400s if you request
  // a weight a family doesn't have, so use the available subset for it.
  const weights = family === 'Google Sans Text' ? '400;500;700' : '400;500;600;700;800;900';
  link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/\s+/g, '+')}:wght@${weights}&display=swap`;
  document.head.appendChild(link);
}

const FONT_OPTIONS = [
  'Inter', 'Google Sans Text', 'Plus Jakarta Sans', 'Space Grotesk', 'Outfit',
  'Syne', 'DM Sans', 'Poppins', 'Montserrat', 'Raleway', 'Nunito',
];

// --- Live preview ---
function SitePreview({ config, C }: { config: Record<string, string>; C: typeof LIGHT_C }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef    = useRef<HTMLIFrameElement>(null);
  const [scale, setScale]           = useState(1);
  const [containerH, setContainerH] = useState(600);
  const [ready, setReady]           = useState(false);

  const INNER_W = 1440;

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setScale(width / INNER_W);
      setContainerH(height);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!ready || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage(
      { type: 'preview-config', config },
      window.location.origin,
    );
  }, [config, ready]);

  const iframeH = scale > 0 ? Math.ceil(containerH / scale) : containerH;

  return (
    <div className="w-full rounded-2xl overflow-hidden"
      style={{ border: `1px solid ${C.cardBorder}`, boxShadow: 'none', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 160px)' }}>
      {/* Clean header */}
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0" style={{ background: C.card, borderBottom: `1px solid ${C.divider}` }}>
        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-[11px] font-semibold" style={{ color: C.text }}>Live preview</span>
        <span className="text-[11px]" style={{ color: C.faint }}>updates as you type</span>
      </div>

      {/* Scaled iframe */}
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', position: 'relative', background: 'white' }}>
        <iframe
          ref={iframeRef}
          src="/"
          onLoad={() => setReady(true)}
          style={{
            width: INNER_W,
            height: iframeH,
            border: 'none',
            transformOrigin: 'top left',
            transform: `scale(${scale})`,
            display: 'block',
          }}
        />
      </div>
    </div>
  );
}

// --- Site Settings Section ---
export function SiteSettingsSection({ C }: { C: typeof LIGHT_C }) {
  const [config, setConfig]     = useState<Record<string, string>>({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState<{ ok: boolean; text: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['brand', 'hero']));
  const toggleSec = (id: string) => setOpenSections(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  useEffect(() => {
    fetch('/api/site-settings')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json?.data) {
          setConfig(json.data.config ?? {});
          // Pre-load saved fonts
          loadFont(json.data.config?.headingFont);
          loadFont(json.data.config?.bodyFont);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const set = (key: string, value: string) => {
    if (key === 'headingFont' || key === 'bodyFont') loadFont(value);
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  // What the landing page actually shows: saved values over the template's defaults. Fields read
  // from this so a default the admin never touched is visible and editable, not a placeholder that
  // looks empty while the live page renders it. Edits still go to `config`, which is what is saved.
  const view = resolveConfig(config as Partial<SiteConfig>) as Record<string, string>;

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      const res = await fetch('/api/site-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ template: 'modern', config }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      setMsg({ ok: true, text: 'Saved. Landing page will update within 60 seconds.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 6000);
    }
  };

  const tf = (key: string, label: string, placeholder: string, hint?: string) => (
    <div className="space-y-1">
      <label className="text-xs font-semibold" style={{ color: C.muted }}>{label}</label>
      <input type="text" value={view[key] ?? ''} onChange={e => set(key, e.target.value)}
        placeholder={placeholder} className="w-full px-3 py-2 rounded-lg text-sm outline-none"
        style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }} />
      {hint && <p className="text-[11px]" style={{ color: C.faint }}>{hint}</p>}
    </div>
  );

  const cf = (key: string, label: string, fallback: string, hint?: string) => {
    const val = view[key] || fallback;
    return (
      <div className="space-y-1">
        <label className="text-xs font-semibold" style={{ color: C.muted }}>{label}</label>
        <div className="flex items-center gap-2">
          {/* Swatch -- native picker hidden underneath */}
          <label className="flex-shrink-0 cursor-pointer">
            <span className="block w-9 h-9 rounded-lg border-2 relative overflow-hidden"
              style={{ background: val, borderColor: C.cardBorder, boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }}>
              <input type="color" value={val} onChange={e => set(key, e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            </span>
          </label>
          <input type="text" value={view[key] ?? ''} onChange={e => set(key, e.target.value)}
            placeholder={fallback} className="w-24 px-2 py-2 rounded-lg text-xs outline-none font-mono"
            style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }} />
        </div>
        {hint && <p className="text-[11px]" style={{ color: C.faint }}>{hint}</p>}
      </div>
    );
  };

  const taf = (key: string, label: string, placeholder: string, hint?: string, rows = 3) => (
    <div className="space-y-1">
      <label className="text-xs font-semibold" style={{ color: C.muted }}>{label}</label>
      <textarea value={view[key] ?? ''} onChange={e => set(key, e.target.value)}
        placeholder={placeholder} rows={rows} className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none"
        style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }} />
      {hint && <p className="text-[11px]" style={{ color: C.faint }}>{hint}</p>}
    </div>
  );

  const imgUpload = (key: string, label: string, hint?: string) => {
    const url = view[key] ?? '';
    const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploading(key);
      try {
        const uploaded = await uploadToCloudinary(file, 'site-assets');
        set(key, uploaded);
      } catch {}
      setUploading(null);
      e.target.value = '';
    };
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold" style={{ color: C.muted }}>{label}</label>
        {url && (
          <div className="relative rounded-lg overflow-hidden" style={{ height: 90 }}>
            <img src={url} alt="" className="w-full h-full object-cover" />
            <button onClick={() => set(key, '')}
              className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.55)' }}>
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        )}
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-all hover:opacity-80"
          style={{ background: C.pill, color: C.text }}>
          {uploading === key
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Upload className="w-3.5 h-3.5" />}
          {url ? 'Replace image' : 'Upload image'}
          <input type="file" accept="image/*" className="sr-only" onChange={handleFile} disabled={!!uploading} />
        </label>
        {hint && <p className="text-[11px]" style={{ color: C.faint }}>{hint}</p>}
      </div>
    );
  };

  const fontPicker = (key: string, label: string, fallback: string) => (
    <div className="space-y-2">
      <label className="text-xs font-semibold" style={{ color: C.muted }}>{label}</label>
      <div className="grid grid-cols-2 gap-2">
        {FONT_OPTIONS.map(f => {
          loadFont(f);
          const active = (view[key] || fallback) === f;
          return (
            <button key={f} onClick={() => set(key, f)}
              className="px-3 py-2 rounded text-sm text-left transition-all"
              style={{
                fontFamily: `'${f}', sans-serif`,
                background:   active ? C.cta   : C.pill,
                color:        active ? C.ctaText : C.text,

              }}>
              {f}
            </button>
          );
        })}
      </div>
    </div>
  );

  // Visibility toggle -- '1' means hidden
  const Vis = (key: string) => {
    const hidden = view[key] === '1';
    return (
      <div className="flex items-center justify-between pb-3 mb-1 border-b" style={{ borderColor: C.cardBorder }}>
        <span className="text-xs font-semibold" style={{ color: C.muted }}>Show this section</span>
        <button onClick={() => set(key, hidden ? '' : '1')}
          className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
          style={{ background: hidden ? C.cardBorder : (view.primaryColor || '#0e09dd') }}>
          <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
            style={{ left: hidden ? 2 : 22 }} />
        </button>
      </div>
    );
  };

  // Ad-card header with its own show switch -- hiding keeps the card's content for later
  const cardHead = (n: string, key: string) => {
    const hidden = view[key] === '1';
    return (
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold uppercase tracking-widest" style={{ color: C.muted }}>
          Card {n}{hidden && <span className="ml-2 normal-case tracking-normal font-semibold" style={{ color: C.faint }}>Hidden</span>}
        </p>
        <button onClick={() => set(key, hidden ? '' : '1')} aria-label={hidden ? `Show card ${n}` : `Hide card ${n}`}
          className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
          style={{ background: hidden ? C.cardBorder : (view.primaryColor || '#0056D2') }}>
          <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
            style={{ left: hidden ? 2 : 22 }} />
        </button>
      </div>
    );
  };

  // Ad-card image layout toggle -- only shown once an image is uploaded
  const imgLayout = (key: string) => {
    return (
      <div className="space-y-2">
        <label className="text-xs font-semibold" style={{ color: C.muted }}>Image layout</label>
        <div className="flex gap-2">
          {([['', 'Full background'], ['side', 'Beside text']] as const).map(([val, lbl]) => {
            const active = (view[key] || '') === val;
            return (
              <button key={val || 'cover'} onClick={() => set(key, val)}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all"
                style={{ background: active ? C.cta : C.pill, color: active ? C.ctaText : C.text }}>
                {lbl}
              </button>
            );
          })}
        </div>
        <p className="text-[11px]" style={{ color: C.faint }}>Beside text: image sits on the right (desktop) or bottom (mobile) with the background colour showing.</p>
      </div>
    );
  };

  // Accordion section wrapper
  const Sec = (id: string, label: string, preview: React.ReactNode, children: React.ReactNode) => (
    <div className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
      <button onClick={() => toggleSec(id)} className="w-full flex items-center gap-3 px-4 py-4 text-left transition-opacity hover:opacity-70">
        <span className="flex-1 text-[11px] font-bold uppercase tracking-widest" style={{ color: C.text }}>{label}</span>
        {preview && <span className="flex items-center gap-1">{preview}</span>}
        <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ${openSections.has(id) ? 'rotate-180' : ''}`} style={{ color: C.faint }} />
      </button>
      {openSections.has(id) && (
        <div className="px-4 pb-5 pt-3 space-y-4 border-t" style={{ borderColor: C.cardBorder }}>
          {children}
        </div>
      )}
    </div>
  );
  // Colour swatch dot for section header preview
  const Dot = (k: string, fb: string) => (
    <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: view[k] || fb, border: '1.5px solid rgba(0,0,0,0.12)' }} />
  );
  // Sub-label divider inside a section
  const Sub = (t: string) => (
    <p className="text-[11px] font-bold uppercase tracking-[0.08em] mt-1 pb-1 border-b" style={{ color: C.faint, borderColor: C.cardBorder }}>{t}</p>
  );

  const handleOpenPreview = () => {
    try { localStorage.setItem('_site_preview', JSON.stringify({ config })); } catch {}
    window.open('/?_preview=1', '_blank');
  };

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: C.faint }} />
    </div>
  );

  return (
    <div className="flex gap-4 items-start" style={{ minHeight: 'calc(100vh - 120px)' }}>

      {/* ---- Collapsable settings pane ---- */}
      <div style={{ width: panelOpen ? 400 : 0, overflow: 'hidden', flexShrink: 0, transition: 'width 0.25s ease' }}>
        <div style={{ width: 400 }} className="space-y-4 pb-6 pr-1">

        {/* Brand & Style */}
        {Sec('brand', 'Brand & Style',
          <>{Dot('primaryColor','#0e09dd')}{Dot('accentColor','#ff9933')}</>,
          <>
            <div className="grid grid-cols-2 gap-3">
              {cf('primaryColor', 'Primary colour', '#0e09dd', 'Nav, hero, buttons.')}
              {cf('accentColor',  'Accent colour',  '#ff9933', 'Highlights, icons, links.')}
            </div>
            {Sub('Typography')}
            {fontPicker('headingFont', 'Heading Font', 'Inter')}
            {fontPicker('bodyFont', 'Body Font', 'Inter')}
          </>
        )}

        {/* Headline: not shown on the page itself, which opens on the ad banner */}
        {Sec('hero', 'Headline',
          <></>,
          <>
            <p className="text-[11px]" style={{ color: C.faint }}>Used for the browser tab, search results and link previews, and read out by screen readers. Leave blank to use the platform name.</p>
            {tf('heroTitle',       'Headline',        'Build skills that move your career forward')}
            {tf('heroTitleAccent', 'Headline accent', 'Learn at your own pace.', 'Second line on link previews.')}
          </>
        )}

        {Sec('pricing', 'Pricing Page',
          <></>,
          <>
            {imgUpload('heroImageUrl', 'Picture', 'Shown beside the tools list on the pricing page. Leave blank to let the list fill the width.')}
          </>
        )}

        {Sec('c-darkmode', 'Dark Mode',
          <></>,
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold" style={{ color: C.text }}>Enable dark mode</p>
                <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>Switches the landing page to a dark background.</p>
              </div>
              <button onClick={() => set('siteDarkMode', view.siteDarkMode === '1' ? '' : '1')}
                className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                style={{ background: view.siteDarkMode === '1' ? (view.primaryColor || '#0056D2') : C.cardBorder }}>
                <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: view.siteDarkMode === '1' ? 22 : 2 }} />
              </button>
            </div>
          </>
        )}

        {Sec('c-ads', 'Ad Banner Cards',
          <></>,
          <>
            {Vis('hideAdBanner')}
            <div className="flex items-center justify-between pb-3 mb-1 border-b" style={{ borderColor: C.cardBorder }}>
              <div className="pr-3">
                <p className="text-xs font-semibold" style={{ color: C.text }}>Full-width banner</p>
                <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>Edge-to-edge image banner with a white text panel on the left. Off = contained cards.</p>
              </div>
              <button onClick={() => set('adBannerFullWidth', view.adBannerFullWidth === '1' ? '' : '1')}
                className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0"
                style={{ background: view.adBannerFullWidth === '1' ? (view.primaryColor || '#0056D2') : C.cardBorder }}>
                <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: view.adBannerFullWidth === '1' ? 22 : 2 }} />
              </button>
            </div>
            {(['1','2','3'] as const).map(n => (
              <div key={n} className="border rounded-lg p-4 space-y-2" style={{ borderColor: C.cardBorder }}>
                {cardHead(n, `hideAd${n}`)}
                {tf(`ad${n}Label`,       'Badge label',       n === '1' ? 'New' : n === '2' ? 'Featured' : 'Popular')}
                {tf(`ad${n}Title`,       'Headline',          'Start your learning journey today')}
                {taf(`ad${n}Description`,'Description',       'Short description text', undefined, 2)}
                {tf(`ad${n}CtaText`,     'Button text',       'Get started free')}
                {tf(`ad${n}CtaUrl`,      'Button URL',        '/auth?mode=signup')}
                <div className="grid grid-cols-2 gap-2">
                  {cf(`ad${n}BgColor`,   'Background colour', '#0056D2')}
                </div>
                {imgUpload(`ad${n}BgImage`, 'Image', 'Optional. Choose how it displays below.')}
                {view[`ad${n}BgImage`] && imgLayout(`ad${n}ImageLayout`)}
              </div>
            ))}
          </>
        )}

        {Sec('c-mid-ads', 'Mid-Page Ad Banner',
          <></>,
          <>
            {Vis('hideMidAdBanner')}
            <p className="text-[11px]" style={{ color: C.faint }}>Two cards shown between Learning Paths and Virtual Experiences.</p>
            {(['1','2'] as const).map(n => (
              <div key={n} className="border rounded-lg p-4 space-y-2" style={{ borderColor: C.cardBorder }}>
                {cardHead(n, `hideMidAd${n}`)}
                {tf(`midAd${n}Label`,       'Badge label',       n === '1' ? 'Trending' : 'Free')}
                {tf(`midAd${n}Title`,       'Headline',          'Start your learning journey today')}
                {taf(`midAd${n}Description`,'Description',       'Short description text', undefined, 2)}
                {tf(`midAd${n}CtaText`,     'Button text',       'Get started free')}
                {tf(`midAd${n}CtaUrl`,      'Button URL',        '/auth?mode=signup')}
                <div className="grid grid-cols-2 gap-2">
                  {cf(`midAd${n}BgColor`,   'Background colour', '#0056D2')}
                </div>
                {imgUpload(`midAd${n}BgImage`, 'Image', 'Optional. Choose how it displays below.')}
                {view[`midAd${n}BgImage`] && imgLayout(`midAd${n}ImageLayout`)}
              </div>
            ))}
          </>
        )}

        {Sec('c-closing-cta', 'Closing CTA',
          <></>,
          <>
            {Vis('hideCta')}
            {tf('ctaHeading',       'Heading',        'Start with one course.')}
            {tf('ctaHeadingAccent', 'Heading accent', 'Build from there.', 'Shown in the accent colour on its own line.')}
            {taf('ctaSubtext',      'Subtext',        'Create an account to save your progress, collect credentials and pick up where you left off.', undefined, 3)}
            {tf('ctaButton',        'Button text',    'Create free account')}
          </>
        )}

        {Sec('c-footer', 'Footer',
          <></>,
          <>
            {tf('footerTagline', 'Tagline', 'One line about your platform')}
            {Sub('Custom Links Column')}
            {tf('footerLinksHeading', 'Column heading', 'Learn')}
            <div className="grid grid-cols-2 gap-2">
              {tf('footerLink1Label', 'Link 1 label', 'Courses')}
              {tf('footerLink1Url',   'Link 1 URL',   '/#section-courses')}
              {tf('footerLink2Label', 'Link 2 label', 'Learning Paths')}
              {tf('footerLink2Url',   'Link 2 URL',   '/#section-paths')}
              {tf('footerLink3Label', 'Link 3 label', 'Virtual Experiences')}
              {tf('footerLink3Url',   'Link 3 URL',   '/#section-ves')}
              {tf('footerLink4Label', 'Link 4 label', 'Certifications')}
              {tf('footerLink4Url',   'Link 4 URL',   '/#section-certifications')}
            </div>
          </>
        )}

        </div>
      </div>

      {/* ---- Preview pane ---- */}
      <div className="flex-1 min-w-0 flex flex-col gap-3 min-h-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
          <button
            onClick={() => setPanelOpen(v => !v)}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs font-semibold transition-all hover:opacity-80"
            style={{ background: C.pill, color: C.text }}
          >
            {panelOpen
              ? <><ArrowLeft className="w-3.5 h-3.5" /> Hide settings</>
              : <><ArrowRight className="w-3.5 h-3.5" /> Show settings</>
            }
          </button>
          <div className="flex-1" />
          <button
            onClick={handleOpenPreview}
            className="flex items-center gap-2 px-3 py-2 rounded text-xs font-semibold transition-all hover:opacity-80"
            style={{ background: C.pill, color: C.text }}
          >
            <ExternalLink className="w-3.5 h-3.5" /> Open in new tab
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded text-xs font-semibold disabled:opacity-50 transition-opacity hover:opacity-80"
            style={{ background: C.cta, color: C.ctaText }}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Check className="w-3.5 h-3.5" /> Save</>}
          </button>
        </div>
        {msg && (
          <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg flex-shrink-0 ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}
            style={{ background: msg.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)' }}>
            {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 flex-shrink-0" />}
            {msg.text}
          </div>
        )}
        <div className="flex-1 min-h-0">
          <SitePreview config={config} C={C} />
        </div>
      </div>

    </div>
  );
}
