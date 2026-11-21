'use client';

// Account settings, Profile step: photo, basic info and social links.

import { useRef, useState } from 'react';
import { Camera, Check, Copy, Loader2, Trash2, Upload } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { sanitizePlainText } from '@/lib/sanitize';
import { FIELD, Hint, Label, Sect, inputStyle } from '@/components/create/EditorKit';
import { Card, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';

const SOCIAL_FIELDS = [
  { key: 'linkedin',  label: 'LinkedIn',    placeholder: 'https://linkedin.com/in/username' },
  { key: 'twitter',   label: 'X / Twitter', placeholder: 'https://x.com/username' },
  { key: 'github',    label: 'GitHub',      placeholder: 'https://github.com/username' },
  { key: 'website',   label: 'Website',     placeholder: 'https://yoursite.com' },
  { key: 'instagram', label: 'Instagram',   placeholder: 'https://instagram.com/username' },
  { key: 'youtube',   label: 'YouTube',     placeholder: 'https://youtube.com/@channel' },
];

export function ProfileStep({ C, initials, avatarUrl, avatarUploading, onPickAvatar, onRemoveAvatar, name, setName, username, setUsername,
  bio, setBio, country, setCountry, city, setCity, socialLinks, setSocialLinks }: {
  C: ThemeColors; initials: string; avatarUrl: string; avatarUploading: boolean;
  onPickAvatar: (file: File) => void; onRemoveAvatar: () => void;
  name: string; setName: (v: string) => void; username: string; setUsername: (v: string) => void;
  bio: string; setBio: (v: string) => void; country: string; setCountry: (v: string) => void; city: string; setCity: (v: string) => void;
  socialLinks: Record<string, string>; setSocialLinks: (fn: (prev: Record<string, string>) => Record<string, string>) => void;
}) {
  const P = palette(C);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const profileUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/s/${username}`;

  return (
    <Card C={C}>
      <Sect title="Profile photo" first C={C}>
        <div className="flex flex-wrap items-center gap-4">
          <button type="button" onClick={() => avatarRef.current?.click()} aria-label="Upload a new photo"
            className="relative w-14 h-14 rounded-full group flex-shrink-0 overflow-hidden">
            {avatarUrl
              ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              : <span className="w-full h-full grid place-items-center text-base font-semibold" style={{ background: C.pill, color: C.muted }}>{initials}</span>}
            <span className={`absolute inset-0 grid place-items-center bg-black/40 transition-opacity ${avatarUploading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              {avatarUploading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-4 h-4 text-white" />}
            </span>
          </button>
          <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={e => {
            const f = e.target.files?.[0];
            if (f) onPickAvatar(f);
            e.target.value = '';
          }} />
          <button type="button" onClick={() => avatarRef.current?.click()} disabled={avatarUploading} className={btnSmClass} style={btnStyle('sec', C)}>
            <Upload className="w-3.5 h-3.5" /> {avatarUploading ? 'Uploading...' : 'Upload new'}
          </button>
          {avatarUrl && (
            <button type="button" onClick={onRemoveAvatar} disabled={avatarUploading} className={btnSmClass} style={btnStyle('danger', C)}>
              <Trash2 className="w-3.5 h-3.5" /> Remove
            </button>
          )}
        </div>
      </Sect>

      <Sect title="Basic info" C={C}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label C={C}>Full name</Label>
            <input value={name} onChange={e => setName(sanitizePlainText(e.target.value))} placeholder="Your full name" className={FIELD} style={inputStyle(C)} />
          </div>
          <div>
            <Label C={C}>Username</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm select-none" style={{ color: C.faint }}>@</span>
              <input value={username} onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30))}
                placeholder="yourname" maxLength={30} className={`${FIELD} pl-7`} style={inputStyle(C)} />
            </div>
            {username ? (
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className="text-xs break-all" style={{ color: C.muted }}>Your public profile: {profileUrl}</span>
                <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: C.text }}
                  onClick={() => { navigator.clipboard?.writeText(profileUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{copied ? 'Copied' : 'Copy link'}
                </button>
              </div>
            ) : (
              <Hint C={C}>For your public profile link. Letters, numbers and underscores.</Hint>
            )}
          </div>
          <div>
            <Label C={C}>Country</Label>
            <input value={country} onChange={e => setCountry(sanitizePlainText(e.target.value))} placeholder="For example Ghana" className={FIELD} style={inputStyle(C)} />
          </div>
          <div>
            <Label C={C}>City</Label>
            <input value={city} onChange={e => setCity(sanitizePlainText(e.target.value))} placeholder="For example Accra" className={FIELD} style={inputStyle(C)} />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label C={C}>Bio</Label>
            <span className="text-xs mb-2" style={{ color: bio.length > 280 ? P.bad : C.faint }}>{bio.length}/300</span>
          </div>
          <textarea value={bio} onChange={e => setBio(sanitizePlainText(e.target.value).slice(0, 300))} maxLength={300} rows={3}
            placeholder="A short bio about yourself" className={`${FIELD} resize-none`} style={inputStyle(C)} />
        </div>
      </Sect>

      <Sect title="Social links" C={C}>
        <div className="grid gap-4 sm:grid-cols-2">
          {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
            <div key={key}>
              <Label C={C}>{label}</Label>
              <input value={socialLinks[key] ?? ''} onChange={e => setSocialLinks(prev => ({ ...prev, [key]: sanitizePlainText(e.target.value) }))}
                placeholder={placeholder} className={FIELD} style={inputStyle(C)} />
            </div>
          ))}
        </div>
      </Sect>
    </Card>
  );
}
