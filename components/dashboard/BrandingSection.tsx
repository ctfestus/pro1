'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Loader2, Upload, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { LIGHT_C, cardStyle } from '@/lib/theme';

export function BrandingSection({ C }: { C: typeof LIGHT_C }) {
  const [form, setForm] = useState({
    appName:         '',
    orgName:         '',
    appUrl:          '',
    logoUrl:         '',
    logoDarkUrl:     '',
    faviconUrl:      '',
    emailBannerUrl:  '',
    brandColor:      '',
    senderName:      '',
    teamName:        '',
    supportEmail:    '',
    appDescription:  '',
    // Access. The only non-string field here, so it is set from the row explicitly below rather
    // than falling through the ?? '' pattern the text fields use.
    publicSignupEnabled: false,
    // Landing page
    primaryColor:    '',
    accentColor:     '',
    heroTitle:       '',
    heroTitleAccent: '',
    heroSubheadline: '',
    heroPrimaryCta:  '',
    footerTagline:   '',
    statsEnrolled:   '',
    statsRating:     '',
  });
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [logoUploading, setLogoUploading]               = useState(false);
  const [logoDarkUploading, setLogoDarkUploading]       = useState(false);
  const [faviconUploading, setFaviconUploading]         = useState(false);
  const [emailBannerUploading, setEmailBannerUploading] = useState(false);
  const [msg, setMsg]                 = useState<{ ok: boolean; text: string } | null>(null);
  const logoInputRef                  = useRef<HTMLInputElement>(null);
  const logoDarkInputRef              = useRef<HTMLInputElement>(null);
  const faviconInputRef               = useRef<HTMLInputElement>(null);
  const emailBannerInputRef           = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/platform-settings', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (res.ok) {
        const { data } = await res.json();
        if (data) setForm({
          appName:         data.app_name         ?? '',
          orgName:         data.org_name         ?? '',
          appUrl:          data.app_url          ?? '',
          logoUrl:         data.logo_url         ?? '',
          logoDarkUrl:     data.logo_dark_url    ?? '',
          faviconUrl:      data.favicon_url      ?? '',
          emailBannerUrl:  data.email_banner_url ?? '',
          brandColor:      data.brand_color      ?? '',
          senderName:      data.sender_name      ?? '',
          teamName:        data.team_name        ?? '',
          supportEmail:    data.support_email    ?? '',
          appDescription:  data.app_description  ?? '',
          publicSignupEnabled: data.public_signup_enabled === true,
          primaryColor:    data.primary_color    ?? '',
          accentColor:     data.accent_color     ?? '',
          heroTitle:       data.hero_title       ?? '',
          heroTitleAccent: data.hero_title_accent ?? '',
          heroSubheadline: data.hero_subheadline ?? '',
          heroPrimaryCta:  data.hero_primary_cta ?? '',
          footerTagline:   data.footer_tagline   ?? '',
          statsEnrolled:   data.stats_enrolled   ?? '',
          statsRating:     data.stats_rating     ?? '',
        });
      }
      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const res = await fetch('/api/platform-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      setMsg({ ok: true, text: 'Platform settings saved. Changes will reflect across the platform within 60 seconds.' });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(null), 6000);
    }
  };

  const handleLogoUpload = async (file: File) => {
    setLogoUploading(true);
    try {
      const raw = await uploadToCloudinary(file, 'branding', 'branding/logo');
      // Remove f_auto,q_auto so SVG logos are served as-is rather than
      // being rasterised by Cloudinary (which breaks SVGs with complex features).
      const url = raw.replace('/upload/f_auto,q_auto/', '/upload/');
      setForm(prev => ({ ...prev, logoUrl: url }));
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? 'Logo upload failed' });
      setTimeout(() => setMsg(null), 4000);
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoDarkUpload = async (file: File) => {
    setLogoDarkUploading(true);
    try {
      const raw = await uploadToCloudinary(file, 'branding', 'branding/logo-dark');
      const url = raw.replace('/upload/f_auto,q_auto/', '/upload/');
      setForm(prev => ({ ...prev, logoDarkUrl: url }));
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? 'Dark logo upload failed' });
      setTimeout(() => setMsg(null), 4000);
    } finally {
      setLogoDarkUploading(false);
    }
  };

  const handleFaviconUpload = async (file: File) => {
    setFaviconUploading(true);
    try {
      const raw = await uploadToCloudinary(file, 'branding', 'branding/favicon');
      const url = raw.replace('/upload/f_auto,q_auto/', '/upload/');
      setForm(prev => ({ ...prev, faviconUrl: url }));
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? 'Favicon upload failed' });
      setTimeout(() => setMsg(null), 4000);
    } finally {
      setFaviconUploading(false);
    }
  };

  const handleEmailBannerUpload = async (file: File) => {
    setEmailBannerUploading(true);
    try {
      const raw = await uploadToCloudinary(file, 'branding', 'branding/email-banner');
      const url = raw.replace('/upload/f_auto,q_auto/', '/upload/');
      setForm(prev => ({ ...prev, emailBannerUrl: url }));
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? 'Email banner upload failed' });
      setTimeout(() => setMsg(null), 4000);
    } finally {
      setEmailBannerUploading(false);
    }
  };

  // Only the TEXT keys. The form also carries a boolean (publicSignupEnabled) which has its own
  // control, and handing that to an <input value> is a type error rather than a runtime surprise.
  type TextKey = { [K in keyof typeof form]: (typeof form)[K] extends string ? K : never }[keyof typeof form];

  const field = (key: TextKey, label: string, placeholder: string, hint?: string, type = 'text') => (
    <div className="space-y-1">
      <label className="text-xs font-semibold" style={{ color: C.muted }}>{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-xl text-sm outline-none"
        style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}
      />
      {hint && <p className="text-[11px]" style={{ color: C.faint }}>{hint}</p>}
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: C.faint }}/>
    </div>
  );

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="rounded-2xl p-5 space-y-5" style={{ ...cardStyle(C) }}>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.faint }}>Platform Branding</h2>
          <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
            Override the default branding for this deployment. Changes are stored in the database and applied across emails and the platform.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {field('appName',     'App / Platform Name',  'e.g. Your Platform Name',  'Used in page titles and emails.')}
          {field('orgName',     'Organisation Name',    'e.g. Your Organisation',   'Used in certificates and formal text.')}
          {field('supportEmail','Support Email',        'support@yourapp.com',      'Shown in footer of emails.')}
          {field('appUrl',      'App URL',              'https://yourapp.com', 'Base URL used in email links.')}
        </div>

        {field('appDescription', 'App Description', 'Empowering Africans with practical AI skills…', 'Used in SEO meta description tag.')}

        <div className="space-y-1">
          <label className="text-xs font-semibold" style={{ color: C.muted }}>Logo</label>
          <input ref={logoInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ''; }} />
          <div className="flex items-center gap-3">
            {form.logoUrl ? (
              <img src={form.logoUrl} alt="Logo preview" className="h-10 w-auto max-w-[120px] rounded-lg object-contain"
                style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, padding: 4 }} />
            ) : (
              <div className="h-10 w-16 rounded-lg flex items-center justify-center"
                style={{ background: C.pill, border: `1px solid ${C.cardBorder}` }}>
                <span className="text-[10px]" style={{ color: C.faint }}>No logo</span>
              </div>
            )}
            <button type="button" onClick={() => logoInputRef.current?.click()} disabled={logoUploading}
              className="px-3 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center gap-1.5"
              style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}>
              {logoUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
              {logoUploading ? 'Uploading…' : form.logoUrl ? 'Replace' : 'Upload Logo'}
            </button>
          </div>
          <p className="text-[11px]" style={{ color: C.faint }}>Uploaded to Cloudinary. PNG, SVG or JPG recommended.</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold" style={{ color: C.muted }}>Logo (Dark Mode)</label>
          <input ref={logoDarkInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoDarkUpload(f); e.target.value = ''; }} />
          <div className="flex items-center gap-3">
            {form.logoDarkUrl ? (
              <img src={form.logoDarkUrl} alt="Dark logo preview" className="h-10 w-auto max-w-[120px] rounded-lg object-contain"
                style={{ background: '#1E1F26', border: `1px solid ${C.cardBorder}`, padding: 4 }} />
            ) : (
              <div className="h-10 w-16 rounded-lg flex items-center justify-center"
                style={{ background: C.pill, border: `1px solid ${C.cardBorder}` }}>
                <span className="text-[10px]" style={{ color: C.faint }}>No logo</span>
              </div>
            )}
            <button type="button" onClick={() => logoDarkInputRef.current?.click()} disabled={logoDarkUploading}
              className="px-3 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center gap-1.5"
              style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}>
              {logoDarkUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
              {logoDarkUploading ? 'Uploading…' : form.logoDarkUrl ? 'Replace' : 'Upload Dark Logo'}
            </button>
            {form.logoDarkUrl && (
              <button type="button" onClick={() => setForm(prev => ({ ...prev, logoDarkUrl: '' }))}
                className="px-3 py-2 rounded-xl text-xs transition-opacity hover:opacity-80"
                style={{ background: C.deleteBg, color: C.deleteText, border: 'none' }}>
                Remove
              </button>
            )}
          </div>
          <p className="text-[11px]" style={{ color: C.faint }}>Optional. Used in place of the main logo when dark mode is active. If not set, the main logo is used.</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold" style={{ color: C.muted }}>Favicon</label>
          <input ref={faviconInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFaviconUpload(f); e.target.value = ''; }} />
          <div className="flex items-center gap-3">
            {form.faviconUrl ? (
              <img src={form.faviconUrl} alt="Favicon preview" className="h-8 w-8 rounded object-contain"
                style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, padding: 4 }} />
            ) : (
              <div className="h-8 w-8 rounded flex items-center justify-center"
                style={{ background: C.pill, border: `1px solid ${C.cardBorder}` }}>
                <span className="text-[10px]" style={{ color: C.faint }}>None</span>
              </div>
            )}
            <button type="button" onClick={() => faviconInputRef.current?.click()} disabled={faviconUploading}
              className="px-3 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center gap-1.5"
              style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}>
              {faviconUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
              {faviconUploading ? 'Uploading…' : form.faviconUrl ? 'Replace' : 'Upload Favicon'}
            </button>
          </div>
          <p className="text-[11px]" style={{ color: C.faint }}>Shown in browser tabs. PNG or ICO, 32×32 or 64×64 recommended.</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold" style={{ color: C.muted }}>Email Banner</label>
          <input ref={emailBannerInputRef} type="file" accept="image/*" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleEmailBannerUpload(f); e.target.value = ''; }} />
          <div className="flex items-start gap-3">
            {form.emailBannerUrl ? (
              <img src={form.emailBannerUrl} alt="Email banner preview"
                className="rounded-lg object-cover"
                style={{ width: 160, height: 48, border: `1px solid ${C.cardBorder}` }} />
            ) : (
              <div className="rounded-lg flex items-center justify-center"
                style={{ width: 160, height: 48, background: C.pill, border: `1px solid ${C.cardBorder}` }}>
                <span className="text-[10px]" style={{ color: C.faint }}>No banner</span>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => emailBannerInputRef.current?.click()} disabled={emailBannerUploading}
                className="px-3 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50 flex items-center gap-1.5"
                style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}>
                {emailBannerUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
                {emailBannerUploading ? 'Uploading…' : form.emailBannerUrl ? 'Replace' : 'Upload Banner'}
              </button>
              {form.emailBannerUrl && (
                <button type="button" onClick={() => setForm(prev => ({ ...prev, emailBannerUrl: '' }))}
                  className="px-3 py-1.5 rounded-xl text-xs transition-opacity hover:opacity-80"
                  style={{ background: C.deleteBg, color: C.deleteText, border: 'none' }}>
                  Remove
                </button>
              )}
            </div>
          </div>
          <p className="text-[11px]" style={{ color: C.faint }}>Full-width header image for emails. 600px wide recommended. If not set, the logo is used.</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold" style={{ color: C.muted }}>Brand Colour</label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={form.brandColor || '#00bf63'}
              onChange={e => setForm(prev => ({ ...prev, brandColor: e.target.value }))}
              className="w-10 h-9 rounded-lg cursor-pointer border-0 p-0.5"
              style={{ background: C.pill, border: `1px solid ${C.cardBorder}` }}
            />
            <input
              type="text"
              value={form.brandColor}
              onChange={e => setForm(prev => ({ ...prev, brandColor: e.target.value }))}
              placeholder="#00bf63"
              className="flex-1 px-3 py-2 rounded-xl text-sm outline-none font-mono"
              style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}
            />
          </div>
          <p className="text-[11px]" style={{ color: C.faint }}>Used for buttons and accents on certificate defaults.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {field('senderName', 'Email Sender Name', 'e.g. Your Team - Learning Experience', 'Shown as sender label in emails.')}
          {field('teamName',   'Team Sign-off Name', 'e.g. The Team',                        'Used in email footers.')}
        </div>
      </div>

      {/* Access */}
      <div className="rounded-2xl p-5 space-y-4" style={{ ...cardStyle(C) }}>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.faint }}>Access</h2>
          <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
            Controls who can create an account on this deployment.
          </p>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold" style={{ color: C.muted }}>Public signups</label>
            <p className="text-[11px] leading-relaxed" style={{ color: C.faint }}>
              Off means only people an admin has admitted can create an account. On means anyone can
              sign up and gets a free account with no cohort, which sees only content marked
              available to everyone. Turning this off takes effect immediately.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.publicSignupEnabled}
            aria-label="Public signups"
            onClick={() => setForm(prev => ({ ...prev, publicSignupEnabled: !prev.publicSignupEnabled }))}
            className="relative flex-shrink-0 w-11 h-6 rounded-full transition-colors"
            style={{
              background: form.publicSignupEnabled ? '#10b981' : C.pill,
              border: `1px solid ${form.publicSignupEnabled ? '#10b981' : C.cardBorder}`,
            }}
          >
            <span
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full transition-all"
              style={{ left: form.publicSignupEnabled ? 23 : 3, background: '#ffffff' }}
            />
          </button>
        </div>

        {form.publicSignupEnabled && (
          <div className="text-[11px] leading-relaxed px-3 py-2.5 rounded-xl" style={{ background: 'rgba(16,185,129,0.08)', color: '#047857' }}>
            Signups are open once you save. New accounts must confirm their email address before
            they can sign in.
          </div>
        )}
      </div>

      {/* Landing Page */}
      <div className="rounded-2xl p-5 space-y-5" style={{ ...cardStyle(C) }}>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: C.faint }}>Landing Page</h2>
          <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
            Customise the public-facing homepage for this deployment.
          </p>
        </div>

        {/* Colours */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold" style={{ color: C.muted }}>Primary Colour</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.primaryColor || '#0e09dd'}
                onChange={e => setForm(prev => ({ ...prev, primaryColor: e.target.value }))}
                className="w-10 h-9 rounded-lg cursor-pointer border-0 p-0.5"
                style={{ background: C.pill, border: `1px solid ${C.cardBorder}` }} />
              <input type="text" value={form.primaryColor}
                onChange={e => setForm(prev => ({ ...prev, primaryColor: e.target.value }))}
                placeholder="#0e09dd"
                className="flex-1 px-3 py-2 rounded-xl text-sm outline-none font-mono"
                style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }} />
            </div>
            <p className="text-[11px]" style={{ color: C.faint }}>Nav, hero, section backgrounds.</p>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold" style={{ color: C.muted }}>Accent Colour</label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.accentColor || '#ff9933'}
                onChange={e => setForm(prev => ({ ...prev, accentColor: e.target.value }))}
                className="w-10 h-9 rounded-lg cursor-pointer border-0 p-0.5"
                style={{ background: C.pill, border: `1px solid ${C.cardBorder}` }} />
              <input type="text" value={form.accentColor}
                onChange={e => setForm(prev => ({ ...prev, accentColor: e.target.value }))}
                placeholder="#ff9933"
                className="flex-1 px-3 py-2 rounded-xl text-sm outline-none font-mono"
                style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }} />
            </div>
            <p className="text-[11px]" style={{ color: C.faint }}>Buttons, highlight text, icons.</p>
          </div>
        </div>

        {/* Hero */}
        <div className="grid grid-cols-2 gap-4">
          {field('heroTitle',       'Hero Headline',        'Build the skills Africa',     'First line of the hero heading.')}
          {field('heroTitleAccent', 'Hero Headline Accent', 'needs right now.',            'Second line -- shown in accent colour.')}
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold" style={{ color: C.muted }}>Hero Subheadline</label>
          <textarea
            value={form.heroSubheadline}
            onChange={e => setForm(prev => ({ ...prev, heroSubheadline: e.target.value }))}
            placeholder="Enrol in courses, attend live workshops…"
            rows={3}
            className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
            style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}
          />
          <p className="text-[11px]" style={{ color: C.faint }}>Paragraph below the hero headline.</p>
        </div>
        {field('heroPrimaryCta', 'Primary CTA Button Text', 'Start learning free', 'Main call-to-action button on the hero.')}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          {field('statsEnrolled', 'Enrolled Stat', '10,000+', 'e.g. "5,000+" shown as social proof.')}
          {field('statsRating',   'Rating Stat',   '4.9',     'Star rating displayed in the hero.')}
        </div>

        {/* Footer */}
        <div className="space-y-1">
          <label className="text-xs font-semibold" style={{ color: C.muted }}>Footer Tagline</label>
          <textarea
            value={form.footerTagline}
            onChange={e => setForm(prev => ({ ...prev, footerTagline: e.target.value }))}
            placeholder="The learning platform built for professionals. Learn, practise, and prove your skills."
            rows={2}
            className="w-full px-3 py-2 rounded-xl text-sm outline-none resize-none"
            style={{ background: C.pill, border: `1px solid ${C.cardBorder}`, color: C.text }}
          />
          <p className="text-[11px]" style={{ color: C.faint }}>Short description shown in the footer.</p>
        </div>

        {msg && (
          <div className={`flex items-start gap-2 text-xs px-3 py-2.5 rounded-xl ${msg.ok ? 'text-emerald-600' : 'text-red-500'}`}
            style={{ background: msg.ok ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)' }}>
            {msg.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/> : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"/>}
            {msg.text}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-80"
          style={{ background: C.cta, color: C.ctaText }}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin mx-auto"/> : 'Save Platform Settings'}
        </button>
      </div>

    </div>
  );
}
