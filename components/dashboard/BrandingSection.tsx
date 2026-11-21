'use client';

// The platform settings page.
//
// Grouped into tabs rather than one long scroll: branding, email, access, the landing page and
// the AI limits are unrelated jobs, and an admin who came to flip one switch should not have to
// scroll past four other things to find it.
//
// The first four tabs share one form and one save, because the settings route saves the row in a
// single POST -- tabs are how it is read, not how it is stored. Tool logos and AI limits each own
// their own save, so the shared button is hidden on those.

import { useCallback, useState, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { CheckCircle2, Loader2, Upload, XCircle } from 'lucide-react';
import { AiFeaturesTab } from '@/components/dashboard/AiFeaturesTab';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { ToolIconsPanel } from '@/components/dashboard/ToolIconsPanel';
import { PageHeader } from '@/components/dashboard/content/kit';
import { Card, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { FIELD, Hint, Label, Sect, SwitchRow, inputStyle } from '@/components/create/EditorKit';

type TabId = 'identity' | 'email' | 'access' | 'analytics' | 'ai' | 'tools';

const TABS: { id: TabId; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'email',    label: 'Email' },
  { id: 'access',   label: 'Access' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'ai',       label: 'AI features' },
  { id: 'tools',    label: 'Tool logos' },
];

// Each tab saves only what it owns. The settings route already guards every field with
// `!== undefined`, so a partial body updates those columns and leaves the rest alone -- a tab
// cannot overwrite a field an admin never opened.
//
// There is no Landing page tab. Its fields -- hero headline, stats, footer tagline -- were
// collected by this form, dropped by the save route, which has no mapping for them, and read back
// from platform_settings columns that were never created. An admin could type a headline, be told
// it saved, and find it gone on reload. The landing page is edited in the Site section, which
// stores a template and config in its own table and works.
const IDENTITY_FIELDS = ['appName', 'orgName', 'appUrl', 'appDescription', 'logoUrl', 'logoDarkUrl', 'faviconUrl', 'brandColor'] as const;
const EMAIL_FIELDS    = ['senderName', 'teamName', 'supportEmail', 'emailBannerUrl'] as const;
const ACCESS_FIELDS   = ['publicSignupEnabled'] as const;
const ANALYTICS_FIELDS = ['googleAnalyticsId'] as const;

export function BrandingSection({ C: theme }: { C: ThemeColors }) {
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
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
    googleAnalyticsId:   '',
  });
  const [loading, setLoading]         = useState(true);
  // Why the section could not load, so an expired session reads differently from a dropped
  // request. Without this the early return below left `loading` true forever and the whole
  // section was a spinner with no message and nothing to click.
  const [loadError, setLoadError]     = useState<'signed-out' | 'failed' | null>(null);
  const [saving, setSaving]           = useState(false);
  const [logoUploading, setLogoUploading]               = useState(false);
  const [logoDarkUploading, setLogoDarkUploading]       = useState(false);
  const [faviconUploading, setFaviconUploading]         = useState(false);
  const [emailBannerUploading, setEmailBannerUploading] = useState(false);
  const [msg, setMsg]                 = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab]                 = useState<TabId>('identity');

  // Which fields each tab saves. Tabs absent from here own their own save: AI limits and tool
  // logos each write a different table.
  const SAVE_TABS: Partial<Record<TabId, readonly (keyof typeof form)[]>> = {
    identity: IDENTITY_FIELDS,
    email: EMAIL_FIELDS,
    access: ACCESS_FIELDS,
    analytics: ANALYTICS_FIELDS,
  };
  const logoInputRef                  = useRef<HTMLInputElement>(null);
  const logoDarkInputRef              = useRef<HTMLInputElement>(null);
  const faviconInputRef               = useRef<HTMLInputElement>(null);
  const emailBannerInputRef           = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoadError('signed-out'); return; }
      const res = await fetch('/api/platform-settings', { headers: { Authorization: `Bearer ${session.access_token}` } });
      if (!res.ok) { setLoadError('failed'); return; }
      {
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
          googleAnalyticsId:   data.google_analytics_id ?? '',
        });
      }
    } catch {
      setLoadError('failed');
    } finally {
      // In a finally so every path clears it, including the two that used to return early.
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (fields: readonly (keyof typeof form)[]) => {
    setSaving(true);
    setMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      // Only this tab's fields. Sending the whole form would make every save a save of everything,
      // which is the thing separating the tabs was meant to stop.
      const payload = Object.fromEntries(fields.map(key => [key, form[key]]));
      const res = await fetch('/api/platform-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Save failed');
      setMsg({ ok: true, text: 'Saved. Changes reflect across the platform within 60 seconds.' });
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
    <div>
      <Label C={C}>{label}</Label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
        className={FIELD}
        style={inputStyle(C)}
      />
      {hint && <Hint C={C}>{hint}</Hint>}
    </div>
  );

  // One image setting: its preview, Upload or Replace, an optional Remove, and a line of help.
  const imageField = ({ label, url, uploading, inputRef, onFile, onRemove, preview, hint }: {
    label: string; url: string; uploading: boolean; inputRef: RefObject<HTMLInputElement | null>;
    onFile: (file: File) => void; onRemove?: () => void; preview: ReactNode; hint: string;
  }) => (
    <div>
      <Label C={C}>{label}</Label>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <div className="flex flex-wrap items-center gap-2">
        {preview}
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className={btnSmClass} style={btnStyle('sec', C)}>
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
          {uploading ? 'Uploading' : url ? 'Replace' : 'Upload'}
        </button>
        {url && onRemove && (
          <button type="button" onClick={onRemove} className={btnSmClass} style={btnStyle('danger', C)}>Remove</button>
        )}
      </div>
      <Hint C={C}>{hint}</Hint>
    </div>
  );
  const empty = (text: string, className: string) => (
    <div className={`rounded-[10px] flex items-center justify-center ${className}`} style={{ background: C.pill }}>
      <span className="text-[11px]" style={{ color: C.faint }}>{text}</span>
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: C.faint }}/>
    </div>
  );

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
      <p className="text-sm max-w-xs" style={{ color: C.muted }}>
        {loadError === 'signed-out'
          ? 'Your session has expired. Sign in again to change platform settings.'
          : 'Could not load platform settings. Check your connection and try again.'}
      </p>
      <button type="button" onClick={load} className={btnClass} style={btnStyle('pri', C)}>Retry</button>
    </div>
  );

  const saveFields = SAVE_TABS[tab];
  return (
    <div className="grid gap-4">
      <PageHeader C={C} title="Platform" sub="How this deployment is named, looks and emails people."
        actions={saveFields && (
          <button type="button" onClick={() => handleSave(saveFields)} disabled={saving} className={btnClass} style={btnStyle('pri', C)}>
            {saving && <Loader2 className="w-4 h-4 animate-spin"/>}Save changes
          </button>
        )} />

      {/* One row of tabs rather than one long page. Scrolls sideways on a phone instead of
          wrapping into a block that pushes the settings themselves below the fold. */}
      <div role="tablist" aria-label="Platform sections" className="inline-flex w-fit max-w-full overflow-x-auto gap-1 p-1 rounded-[14px]" style={{ background: C.card }}>
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className="inline-flex items-center h-9 px-4 rounded-[10px] text-sm font-semibold whitespace-nowrap"
            style={tab === t.id ? { background: P.sel, color: P.onSel } : { color: C.muted }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {saveFields && msg && (
        <div role={msg.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={msg.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          {msg.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0"/> : <XCircle className="w-4 h-4 flex-shrink-0"/>}
          <span className="flex-1">{msg.text}</span>
        </div>
      )}

      {tab === 'identity' && (
        <Card C={C}>
          <Sect C={C} title="Identity" first>
            <p className="-mt-2 text-xs" style={{ color: C.muted }}>What this deployment is called and how it looks. Stored in the database and applied across the platform.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {field('appName', 'Platform name', 'Your platform name', 'Used in page titles and emails.')}
              {field('orgName', 'Organisation name', 'Your organisation', 'Used in certificates and formal text.')}
              {field('appUrl', 'App address', 'https://yourapp.com', 'Base address used in email links.')}
            </div>
            {field('appDescription', 'Description', 'One line about the platform', 'Used in the search engine description tag.')}
          </Sect>

          <Sect C={C} title="Logos">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {imageField({
                label: 'Logo', url: form.logoUrl, uploading: logoUploading, inputRef: logoInputRef, onFile: handleLogoUpload,
                preview: form.logoUrl
                  ? <img src={form.logoUrl} alt="Logo preview" className="h-10 w-auto max-w-[120px] rounded-[10px] object-contain" style={{ background: C.pill, padding: 4 }} />
                  : empty('No logo', 'h-10 w-16'),
                hint: 'Uploaded to Cloudinary. PNG, SVG or JPG recommended.',
              })}
              {imageField({
                label: 'Logo in dark mode', url: form.logoDarkUrl, uploading: logoDarkUploading, inputRef: logoDarkInputRef, onFile: handleLogoDarkUpload,
                onRemove: () => setForm(prev => ({ ...prev, logoDarkUrl: '' })),
                preview: form.logoDarkUrl
                  ? <img src={form.logoDarkUrl} alt="Dark logo preview" className="h-10 w-auto max-w-[120px] rounded-[10px] object-contain" style={{ background: '#1E1F26', padding: 4 }} />
                  : empty('No logo', 'h-10 w-16'),
                hint: 'Optional. Used in place of the main logo when dark mode is on. If not set, the main logo is used.',
              })}
              {imageField({
                label: 'Favicon', url: form.faviconUrl, uploading: faviconUploading, inputRef: faviconInputRef, onFile: handleFaviconUpload,
                preview: form.faviconUrl
                  ? <img src={form.faviconUrl} alt="Favicon preview" className="h-8 w-8 rounded object-contain" style={{ background: C.pill, padding: 4 }} />
                  : empty('None', 'h-8 w-8'),
                hint: 'Shown in browser tabs. PNG or ICO, 32 by 32 or 64 by 64 recommended.',
              })}
            </div>
          </Sect>

          <Sect C={C} title="Brand colour">
            <div>
              <div className="flex items-center gap-3 max-w-sm">
                <input
                  type="color"
                  aria-label="Pick brand colour"
                  value={form.brandColor || '#00bf63'}
                  onChange={e => setForm(prev => ({ ...prev, brandColor: e.target.value }))}
                  className="w-11 h-11 rounded-[10px] cursor-pointer p-0.5 flex-shrink-0"
                  style={inputStyle(C)}
                />
                <input
                  type="text"
                  aria-label="Brand colour"
                  value={form.brandColor}
                  onChange={e => setForm(prev => ({ ...prev, brandColor: e.target.value }))}
                  placeholder="#00bf63"
                  className={`${FIELD} font-mono`}
                  style={inputStyle(C)}
                />
              </div>
              <Hint C={C}>Used for buttons and accents on certificate defaults.</Hint>
            </div>
          </Sect>
        </Card>
      )}

      {tab === 'email' && (
        <Card C={C}>
          <Sect C={C} title="Sender" first>
            <p className="-mt-2 text-xs" style={{ color: C.muted }}>How messages from this platform are signed and where replies go.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {field('senderName', 'Email sender name', 'Your team name', 'Shown as the sender label in emails.')}
              {field('teamName', 'Team sign-off name', 'The team', 'Used in email footers.')}
            </div>
            {field('supportEmail', 'Support email', 'support@yourapp.com', 'Shown in the footer of emails.')}
          </Sect>

          <Sect C={C} title="Email banner">
            {imageField({
              label: 'Banner image', url: form.emailBannerUrl, uploading: emailBannerUploading, inputRef: emailBannerInputRef, onFile: handleEmailBannerUpload,
              onRemove: () => setForm(prev => ({ ...prev, emailBannerUrl: '' })),
              preview: form.emailBannerUrl
                ? <img src={form.emailBannerUrl} alt="Email banner preview" className="rounded-[10px] object-cover" style={{ width: 160, height: 48 }} />
                : empty('No banner', 'w-40 h-12'),
              hint: 'Full-width header image for emails. 600px wide recommended. If not set, the logo is used.',
            })}
          </Sect>
        </Card>
      )}

      {tab === 'access' && (
        <Card C={C}>
          <Sect C={C} title="Access" first>
            <p className="-mt-2 text-xs" style={{ color: C.muted }}>Controls who can create an account on this deployment.</p>
            <SwitchRow C={C} title="Public signups" on={form.publicSignupEnabled}
              onChange={on => setForm(prev => ({ ...prev, publicSignupEnabled: on }))}
              sub="Off means only people an admin has admitted can create an account. On means anyone can sign up and gets a free account with no cohort, which sees only content marked available to everyone. Turning this off takes effect immediately." />
            {form.publicSignupEnabled && (
              <div className="text-xs leading-relaxed px-3 py-3 rounded-xl" style={{ background: C.successBg, color: C.successText }}>
                Signups are open once you save. New accounts must confirm their email address before
                they can sign in.
              </div>
            )}
          </Sect>
        </Card>
      )}

      {tab === 'analytics' && (
        <Card C={C}>
          <Sect C={C} title="Analytics" first>
            <p className="-mt-2 text-xs" style={{ color: C.muted }}>
              Connect Google Analytics 4 to see visitors, sessions and which pages they use. Leave
              it blank and no analytics script is loaded at all.
            </p>
            {field('googleAnalyticsId', 'GA4 measurement ID', 'G-XXXXXXXXXX',
              'Find it in Google Analytics under Admin, Data streams, your web stream. Covers every page, signed in or out.')}
          </Sect>
        </Card>
      )}

      {tab === 'ai' && <Card C={C}><AiFeaturesTab C={C} /></Card>}

      {/* Tool logos live in their own table with their own save, so they are never caught up
          in the platform-settings form above. */}
      {tab === 'tools' && <Card C={C}><ToolIconsPanel C={C}/></Card>}
    </div>
  );
}
