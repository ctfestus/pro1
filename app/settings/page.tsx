'use client';

// Account settings, for every role: the public profile, experience, portfolio and sign-in.
// Each step lives in components/settings/.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Eye, Loader2, Moon, Sun, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSessionToken } from '@/lib/use-session-token';
import { DARK_C, useC } from '@/lib/theme';
import { uploadToCloudinary, deleteFromCloudinary } from '@/lib/uploadToCloudinary';
import { useTheme } from '@/components/ThemeProvider';
import { ImageCropModal } from '@/components/ImageCropModal';
import { PageHeader } from '@/components/dashboard/content/kit';
import { btnClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { ProfileStep } from '@/components/settings/ProfileStep';
import { ExperienceStep } from '@/components/settings/ExperienceStep';
import { PortfolioStep } from '@/components/settings/PortfolioStep';
import { AccountStep } from '@/components/settings/AccountStep';
import type { EducationEntry, PortfolioItem, WorkEntry } from '@/components/settings/shared';

type Step = 'profile' | 'experience' | 'portfolio' | 'account';
const STEPS: [Step, string][] = [['profile', 'Profile'], ['experience', 'Experience'], ['portfolio', 'Portfolio'], ['account', 'Account']];

export default function SettingsPage() {
  const theme = useC();
  // As on the dashboard's admin pages: the dark-mode blue for buttons and selection controls.
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const { toggle: toggleTheme, theme: mode } = useTheme();
  const router = useRouter();
  const [step, setStep]       = useState<Step>('profile');
  const [user, setUser]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');
  const [name, setName]         = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio]           = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [country, setCountry]     = useState('');
  const [city, setCity]           = useState('');
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});
  const [education, setEducation]         = useState<EducationEntry[]>([]);
  const [workExperience, setWorkExperience] = useState<WorkEntry[]>([]);
  const [skills, setSkills]               = useState<string[]>([]);
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);

  // Kept current, so a settings page left open does not send an expired token.
  const [loadedAccessToken, setAccessToken] = useState<string | null>(null);
  const accessToken = useSessionToken(loadedAccessToken ?? '') || null;
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarCropSrc, setAvatarCropSrc] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) { window.location.href = '/auth'; return; }
      setAccessToken(session.access_token);
      const [{ data: { user } }, { data: studentProfile }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('students').select('full_name, bio, avatar_url, country, city, social_links, username, education, work_experience, skills, portfolio_items').eq('id', session.user.id).single(),
      ]);
      if (!user) { window.location.href = '/auth'; return; }
      setUser(user);
      if (studentProfile) {
        setName(studentProfile.full_name ?? '');
        setUsername(studentProfile.username ?? '');
        setBio(studentProfile.bio ?? '');
        setAvatarUrl(studentProfile.avatar_url ?? '');
        setCountry(studentProfile.country ?? '');
        setCity(studentProfile.city ?? '');
        setSocialLinks(studentProfile.social_links ?? {});
        setEducation(studentProfile.education ?? []);
        setWorkExperience(studentProfile.work_experience ?? []);
        setSkills(studentProfile.skills ?? []);
        setPortfolioItems((studentProfile.portfolio_items ?? []).map((p: any) => ({
          ...p,
          tools:         Array.isArray(p.tools) ? p.tools : p.tool ? [p.tool] : [],
          thumbnail_url: p.thumbnail_url ?? '',
        })));
      }

      setLoading(false);
    };
    load();
  }, []);

  const uploadToStorage = async (file: File | Blob, folder: string, oldUrl?: string): Promise<string | null> => {
    if (file.size > 8 * 1024 * 1024) { alert('Image must be 8 MB or smaller.'); return null; }
    try {
      const url = await uploadToCloudinary(file instanceof File ? file : new File([file], 'upload.jpg', { type: 'image/jpeg' }), folder);
      if (oldUrl) deleteFromCloudinary(oldUrl).catch(() => {});
      return url;
    } catch (err: any) {
      console.error('[uploadToStorage]', err);
      return null;
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setError(''); setSaving(true);
    if (!name.trim()) { setError('Full name is required.'); setSaving(false); return; }
    const cleanUsername = username.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30) || null;
    const [{ error: updateError }] = await Promise.all([
      supabase.from('students').update({
        full_name:       name.trim() || null,
        username:        cleanUsername,
        bio:             bio.trim() || null,
        avatar_url:      avatarUrl || null,
        country:         country.trim() || null,
        city:            city.trim() || null,
        social_links:    socialLinks,
        education:        education,
        work_experience:  workExperience,
        skills:           skills,
        portfolio_items:  portfolioItems.filter(p => p.title.trim() && p.url.startsWith('https://')),
      }).eq('id', user.id),
      supabase.auth.updateUser({ data: { full_name: name.trim() || null } }),
    ]);
    setSaving(false);
    if (updateError) { setError(updateError.message.includes('unique') ? 'That username is already taken. Please choose another.' : updateError.message); }
    else {
      if (cleanUsername) setUsername(cleanUsername);
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    }
  };

  const initials = (name || user?.email || '?').slice(0, 2).toUpperCase();

  if (loading) return (
    <div className="min-h-screen grid place-items-center" style={{ background: C.page }}>
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }} />
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: C.page, color: C.text }}>
      {avatarCropSrc && (
        <ImageCropModal
          src={avatarCropSrc}
          aspect={1}
          shape="round"
          title="Crop profile photo"
          onConfirm={async blob => {
            setAvatarCropSrc(null);
            setAvatarUploading(true);
            const url = await uploadToStorage(blob, 'profiles', avatarUrl || undefined);
            if (url) setAvatarUrl(url);
            setAvatarUploading(false);
          }}
          onCancel={() => { URL.revokeObjectURL(avatarCropSrc); setAvatarCropSrc(null); }}
        />
      )}

      <div className="max-w-[1140px] mx-auto px-4 sm:px-6 py-8 pb-16 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-2 text-sm font-semibold hover:opacity-80" style={{ color: C.muted }}>
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button type="button" onClick={toggleTheme} aria-label="Switch theme" title="Switch theme"
            className="w-9 h-9 rounded-[10px] grid place-items-center" style={{ background: C.card, color: C.muted }}>
            {mode === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>

        <PageHeader
          title="Account settings"
          sub="Your public profile, experience and sign-in."
          actions={
            <>
              {username && (
                <a href={`/s/${username}`} target="_blank" rel="noreferrer" className={btnClass} style={btnStyle('sec', C)}>
                  <Eye className="w-4 h-4" /> View public profile
                </a>
              )}
              <button type="button" onClick={handleSave} disabled={saving} className={btnClass} style={btnStyle('pri', C)}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : null}
                {saving ? 'Saving...' : saved ? 'Saved' : 'Save changes'}
              </button>
            </>
          }
          C={C}
        />

        {error && (
          <div role="alert" className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
            <XCircle className="w-4 h-4 flex-shrink-0" /><span className="flex-1">{error}</span>
          </div>
        )}

        <div role="tablist" aria-label="Settings sections" className="inline-flex max-w-full gap-1 p-1 rounded-[14px] overflow-x-auto" style={{ background: C.card }}>
          {STEPS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={step === id} onClick={() => setStep(id)}
              className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
              style={step === id ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
              {label}
            </button>
          ))}
        </div>

        {step === 'profile' && (
          <ProfileStep C={C} initials={initials} avatarUrl={avatarUrl} avatarUploading={avatarUploading}
            onPickAvatar={f => {
              if (f.size > 8 * 1024 * 1024) { alert('Image must be 8 MB or smaller.'); return; }
              setAvatarCropSrc(URL.createObjectURL(f));
            }}
            onRemoveAvatar={() => setAvatarUrl('')}
            name={name} setName={setName} username={username} setUsername={setUsername}
            bio={bio} setBio={setBio} country={country} setCountry={setCountry} city={city} setCity={setCity}
            socialLinks={socialLinks} setSocialLinks={setSocialLinks} />
        )}
        {step === 'experience' && (
          <ExperienceStep C={C} education={education} setEducation={setEducation} workExperience={workExperience} setWorkExperience={setWorkExperience}
            skills={skills} setSkills={setSkills} />
        )}
        {step === 'portfolio' && (
          <PortfolioStep C={C} items={portfolioItems} setItems={setPortfolioItems} uploadToStorage={uploadToStorage} />
        )}
        {step === 'account' && <AccountStep C={C} email={user?.email ?? ''} accessToken={accessToken} />}
      </div>
    </div>
  );
}
