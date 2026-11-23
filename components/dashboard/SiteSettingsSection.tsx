'use client';

import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, Upload, X, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { resolveConfig, type SiteConfig } from '@/lib/site-templates';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { MenuSelect } from '@/components/MenuSelect';
import { PageHeader } from '@/components/dashboard/content/kit';
import { Switch } from '@/components/dashboard/subscriptions/PlanForm';
import { Card, Pill, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { FIELD, Hint, Label, SwitchRow, inputStyle } from '@/components/create/EditorKit';

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
function SitePreview({ config, action, C }: { config: Record<string, string>; action: ReactNode; C: ThemeColors }) {
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
    <Card C={C} className="w-full overflow-hidden flex flex-col" style={{ height: 'calc(100vh - 32px)' }}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: C.text }}>
            <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: palette(C).good }} />
            Live preview
          </h3>
          <p className="text-xs mt-0.5" style={{ color: C.muted }}>Updates as you type.</p>
        </div>
        {action}
      </div>

      {/* Scaled iframe */}
      <div ref={containerRef} className="mx-5 mb-5 rounded-xl" style={{ flex: 1, overflow: 'hidden', position: 'relative', background: 'white', boxShadow: `0 0 0 1px ${C.divider}` }}>
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
    </Card>
  );
}

// --- Site Settings Section ---
export function SiteSettingsSection({ C: theme }: { C: ThemeColors }) {
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const [config, setConfig]     = useState<Record<string, string>>({});
  // The settings as last loaded or saved, to tell when there is something to save.
  const [savedConfig, setSavedConfig] = useState('{}');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState<{ ok: boolean; text: string } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [uploading, setUploading] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['brand', 'type', 'hero']));
  const toggleSec = (id: string) => setOpenSections(prev => {
    const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s;
  });

  useEffect(() => {
    fetch('/api/site-settings')
      .then(r => r.ok ? r.json() : null)
      .then(json => {
        if (json?.data) {
          setConfig(json.data.config ?? {});
          setSavedConfig(JSON.stringify(json.data.config ?? {}));
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
      setSavedConfig(JSON.stringify(config));
      setMsg({ ok: true, text: 'Saved. Landing page will update within 60 seconds.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 6000);
    }
  };

  const dirty = !loading && JSON.stringify(config) !== savedConfig;
  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const tf = (key: string, label: string, placeholder: string, hint?: string) => (
    <div>
      <Label C={C}>{label}</Label>
      <input type="text" value={view[key] ?? ''} onChange={e => set(key, e.target.value)}
        placeholder={placeholder} className={FIELD} style={inputStyle(C)} />
      {hint && <Hint C={C}>{hint}</Hint>}
    </div>
  );

  const cf = (key: string, label: string, fallback: string, hint?: string) => {
    const val = view[key] || fallback;
    return (
      <div>
        <Label C={C}>{label}</Label>
        <div className="flex items-center gap-2">
          {/* Swatch -- native picker hidden underneath */}
          <label className="flex-shrink-0 cursor-pointer">
            <span className="block w-10 h-10 rounded-[10px] relative overflow-hidden"
              style={{ background: val, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
              <input type="color" value={val} onChange={e => set(key, e.target.value)} aria-label={`Pick ${label.toLowerCase()}`}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
            </span>
          </label>
          <input type="text" value={view[key] ?? ''} onChange={e => set(key, e.target.value)} aria-label={label}
            placeholder={fallback} className="field-focus w-28 px-3 py-2.5 rounded-[10px] text-xs outline-none font-mono" style={inputStyle(C)} />
        </div>
        {hint && <Hint C={C}>{hint}</Hint>}
      </div>
    );
  };

  const taf = (key: string, label: string, placeholder: string, hint?: string, rows = 3) => (
    <div>
      <Label C={C}>{label}</Label>
      <textarea value={view[key] ?? ''} onChange={e => set(key, e.target.value)}
        placeholder={placeholder} rows={rows} className={`${FIELD} resize-none`} style={inputStyle(C)} />
      {hint && <Hint C={C}>{hint}</Hint>}
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
      <div className="grid gap-2">
        <Label C={C}>{label}</Label>
        {url && (
          <div className="relative rounded-[10px] overflow-hidden" style={{ height: 90 }}>
            <img src={url} alt="" className="w-full h-full object-cover" />
            <button type="button" onClick={() => set(key, '')} aria-label={`Remove ${label.toLowerCase()}`}
              className="absolute top-2 right-2 w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0,0,0,0.55)' }}>
              <X className="w-3 h-3 text-white" />
            </button>
          </div>
        )}
        <label className={`${btnSmClass} w-fit cursor-pointer`} style={btnStyle('sec', C)}>
          {uploading === key
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Upload className="w-3.5 h-3.5" />}
          {url ? 'Replace image' : 'Upload image'}
          <input type="file" accept="image/*" className="sr-only" onChange={handleFile} disabled={!!uploading} />
        </label>
        {hint && <Hint C={C}>{hint}</Hint>}
      </div>
    );
  };

  // Headings default to Lato (the code's heading font), so the heading picker offers Lato in place
  // of Inter and shows the saved default, Inter, as Lato.
  const fontPicker = (key: string, label: string, fallback: string) => {
    const options = key === 'headingFont' ? ['Lato', ...FONT_OPTIONS.filter(f => f !== 'Inter')] : FONT_OPTIONS;
    const value = view[key] || fallback;
    return (
    <div>
      <Label C={C}>{label}</Label>
      <MenuSelect field label={label} value={key === 'headingFont' && value === 'Inter' ? 'Lato' : value} options={options.map(f => ({ value: f, label: f }))}
        onChange={v => set(key, v)} C={C} />
    </div>
    );
  };

  // Visibility toggle -- '1' means hidden
  const Vis = (key: string) => (
    <SwitchRow C={C} title="Show this section" sub="Hiding it keeps what you entered for later." on={view[key] !== '1'} onChange={on => set(key, on ? '' : '1')} />
  );

  // Ad-card header with its own show switch -- hiding keeps the card's content for later
  const cardHead = (n: string, key: string) => {
    const hidden = view[key] === '1';
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold flex items-center gap-2" style={{ color: C.text }}>
          Card {n}{hidden && <Pill tone="mute" C={C}>Hidden</Pill>}
        </p>
        <Switch on={!hidden} onChange={on => set(key, on ? '' : '1')} label={`Show card ${n}`} C={C} />
      </div>
    );
  };

  // Ad-card image layout toggle -- only shown once an image is uploaded
  const imgLayout = (key: string) => {
    return (
      <div>
        <Label C={C}>Image layout</Label>
        <div className="flex gap-2" role="group" aria-label="Image layout">
          {([['', 'Full background'], ['side', 'Beside text']] as const).map(([val, lbl]) => {
            const active = (view[key] || '') === val;
            return (
              <button key={val || 'cover'} type="button" aria-pressed={active} onClick={() => set(key, val)}
                className="flex-1 h-9 px-3 rounded-[10px] text-xs font-semibold"
                style={active ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
                {lbl}
              </button>
            );
          })}
        </div>
        <Hint C={C}>Beside text: image sits on the right (desktop) or bottom (mobile) with the background colour showing.</Hint>
      </div>
    );
  };

  // A section of the settings card that folds open and shut.
  const Sec = (id: string, label: string, preview: ReactNode, children: ReactNode) => {
    const open = openSections.has(id);
    return (
      <div style={id === 'brand' ? undefined : { borderTop: `1px solid ${C.divider}` }}>
        <button type="button" onClick={() => toggleSec(id)} aria-expanded={open} className="w-full flex items-center gap-3 px-5 py-4 text-left">
          <span className="flex-1 text-base font-semibold" style={{ color: C.text }}>{label}</span>
          {preview && <span className="flex items-center gap-1">{preview}</span>}
          <span className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ color: C.muted }}>
            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </span>
        </button>
        {open && <div className="px-5 pb-5 grid gap-4 min-w-0">{children}</div>}
      </div>
    );
  };
  // Colour swatch dot for section header preview
  const Dot = (k: string, fb: string) => (
    <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: view[k] || fb, boxShadow: `inset 0 0 0 1px ${C.divider}` }} />
  );
  // A group heading inside a section, with a hairline above it
  const Sub = (t: string) => (
    <p className="text-sm font-semibold pt-4 -mb-1" style={{ color: C.text, borderTop: `1px solid ${C.divider}` }}>{t}</p>
  );
  // One ad card's fields, under a hairline
  const adCard = (prefix: 'ad' | 'midAd', hideKey: string, n: string, label: string) => (
    <div key={n} className="grid gap-4 pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
      {cardHead(n, hideKey)}
      {tf(`${prefix}${n}Label`,       'Badge label',       label)}
      {tf(`${prefix}${n}Title`,       'Headline',          'Start your learning journey today')}
      {taf(`${prefix}${n}Description`,'Description',       'Short description text', undefined, 2)}
      {tf(`${prefix}${n}CtaText`,     'Button text',       'Get started free')}
      {tf(`${prefix}${n}CtaUrl`,      'Button link',       '/auth?mode=signup')}
      {cf(`${prefix}${n}BgColor`,     'Background colour', '#0056D2')}
      {imgUpload(`${prefix}${n}BgImage`, 'Image', 'Optional. Choose how it displays below.')}
      {view[`${prefix}${n}BgImage`] && imgLayout(`${prefix}${n}ImageLayout`)}
    </div>
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
    // One column that never grows past the page: the preview draws the landing page 1440px wide and
    // scales it down, and an auto column would stretch to that width and push Save off-screen.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <PageHeader C={C} title="Site" sub="The public landing page: colours, fonts and each section. The preview updates as you type."
        actions={<>
          <button type="button" onClick={handleOpenPreview} className={btnClass} style={btnStyle('sec', C)}>
            <ExternalLink className="w-4 h-4" /> Open in new tab
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className={btnClass} style={btnStyle('pri', C)}>
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}Save changes
          </button>
        </>} />

      {msg && (
        <div role={msg.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={msg.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          {msg.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          <span className="flex-1">{msg.text}</span>
        </div>
      )}

    <div className="flex gap-4 items-start">

      {/* ---- Collapsable settings pane ---- */}
      <div style={{ width: panelOpen ? 420 : 0, overflow: 'hidden', flexShrink: 0, transition: 'width 0.25s ease' }}>
        <Card C={C} className="pb-1" style={{ width: 420 }}>

        {/* Brand and style */}
        {Sec('brand', 'Brand and style',
          <>{Dot('primaryColor','#0056D2')}{Dot('accentColor','#ff9933')}</>,
          <>
            <div className="grid grid-cols-2 gap-3">
              {cf('primaryColor', 'Primary colour', '#0056D2', 'Nav, hero, buttons.')}
              {cf('accentColor',  'Accent colour',  '#ff9933', 'Highlights, icons, links.')}
            </div>
            {cf('pathCardColor', 'Learning path cards', '#3E93FF', 'Button colour on every learning path card; the card is a pale tint of it.')}
            <SwitchRow C={C} title="Dark mode" sub="Switches the landing page to a dark background." on={view.siteDarkMode === '1'}
              onChange={on => set('siteDarkMode', on ? '1' : '')} />
          </>
        )}

        {Sec('type', 'Typography',
          <></>,
          <>
            {fontPicker('headingFont', 'Heading font', 'Lato')}
            {fontPicker('bodyFont', 'Body font', 'Inter')}
          </>
        )}

        {/* Headline: not shown on the page itself, which opens on the ad banner */}
        {Sec('hero', 'Headline',
          <></>,
          <>
            <p className="-mt-2 text-xs" style={{ color: C.muted }}>Used for the browser tab, search results and link previews, and read out by screen readers. Leave blank to use the platform name.</p>
            {tf('heroTitle',       'Headline',        'Build skills that move your career forward')}
            {tf('heroTitleAccent', 'Headline accent', 'Learn at your own pace.', 'Second line on link previews.')}
          </>
        )}

        {Sec('pricing', 'Pricing page',
          <></>,
          <>
            {imgUpload('heroImageUrl', 'Picture', 'Shown beside the tools list on the pricing page. Leave blank to let the list fill the width.')}
          </>
        )}

        {Sec('c-ads', 'Ad banner cards',
          <></>,
          <>
            {Vis('hideAdBanner')}
            <SwitchRow C={C} title="Full-width banner" sub="Edge-to-edge image banner with a white text panel on the left. Off shows contained cards."
              on={view.adBannerFullWidth === '1'} onChange={on => set('adBannerFullWidth', on ? '1' : '')} />
            {(['1','2','3'] as const).map(n => adCard('ad', `hideAd${n}`, n, n === '1' ? 'New' : n === '2' ? 'Featured' : 'Popular'))}
          </>
        )}

        {Sec('c-mid-ads', 'Mid-page ad banner',
          <></>,
          <>
            {Vis('hideMidAdBanner')}
            <p className="text-xs" style={{ color: C.muted }}>Two cards shown between Learning paths and Virtual experiences.</p>
            {(['1','2'] as const).map(n => adCard('midAd', `hideMidAd${n}`, n, n === '1' ? 'Trending' : 'Free'))}
          </>
        )}

        {Sec('c-closing-cta', 'Closing call to action',
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
            {Sub('Custom links column')}
            {tf('footerLinksHeading', 'Column heading', 'Learn')}
            <div className="grid grid-cols-2 gap-3">
              {tf('footerLink1Label', 'Link 1 label', 'Courses')}
              {tf('footerLink1Url',   'Link 1 address', '/#section-courses')}
              {tf('footerLink2Label', 'Link 2 label', 'Learning paths')}
              {tf('footerLink2Url',   'Link 2 address', '/#section-paths')}
              {tf('footerLink3Label', 'Link 3 label', 'Virtual experiences')}
              {tf('footerLink3Url',   'Link 3 address', '/#section-ves')}
              {tf('footerLink4Label', 'Link 4 label', 'Certifications')}
              {tf('footerLink4Url',   'Link 4 address', '/#section-certifications')}
            </div>
          </>
        )}

        </Card>
      </div>

      {/* ---- Preview pane ---- */}
      <div className="flex-1 min-w-0 sticky top-4">
        <SitePreview config={config} C={C}
          action={
            <button type="button" onClick={() => setPanelOpen(v => !v)} className={btnSmClass} style={btnStyle('sec', C)}>
              {panelOpen
                ? <><ArrowLeft className="w-3.5 h-3.5" /> Hide settings</>
                : <><ArrowRight className="w-3.5 h-3.5" /> Show settings</>}
            </button>
          } />
      </div>

    </div>

      {/* Unsaved changes: a bar at the bottom of the screen, so Save is in reach wherever you are
          in the settings. It shows the result once saved, then goes. */}
      {(dirty || saving || msg) && (
        <div role={msg && !msg.ok ? 'alert' : 'status'}
          className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl px-4 py-3"
          style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: '0 18px 40px -12px rgba(0,0,0,0.35)' }}>
          {msg ? (msg.ok ? <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: C.successText }} /> : <XCircle className="h-4 w-4 flex-shrink-0" style={{ color: C.errorText }} />)
            : <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: P.warn }} />}
          <span className="min-w-0 flex-1 text-sm" style={{ color: msg ? (msg.ok ? C.successText : C.errorText) : C.text }}>
            {msg ? msg.text : 'You have unsaved changes'}
          </span>
          {dirty && (
            <button type="button" onClick={handleSave} disabled={saving} className={btnSmClass} style={btnStyle('pri', C)}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Save changes
            </button>
          )}
        </div>
      )}
    </div>
  );
}
