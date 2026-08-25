'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2, ArrowLeft, Camera, Check, AlertCircle,
  Twitter, Linkedin, Instagram, Globe, Github, Youtube,
  Search, X, ImageIcon, Move, ExternalLink, Star, Sun, Moon,
  Award, Upload, Trash2, CheckCircle2, XCircle, ChevronDown, Copy, Link2,
} from 'lucide-react';
import { ImageCropModal } from '@/components/ImageCropModal';
import { sanitizePlainText } from '@/lib/sanitize';
import { uploadToCloudinary, deleteFromCloudinary } from '@/lib/uploadToCloudinary';
import { useToolIcons } from '@/lib/use-tool-icons';

const INDUSTRIES = [
  'Accounting & Finance', 'Advertising & Marketing', 'Aerospace & Defence',
  'Agriculture & Farming', 'Architecture & Urban Planning', 'Arts & Entertainment',
  'Automotive', 'Banking', 'Biotechnology', 'Broadcasting & Media',
  'Business Consulting', 'Chemical & Materials', 'Civic & Non-Profit',
  'Civil Engineering', 'Construction & Real Estate', 'Consumer Goods',
  'Cybersecurity', 'Data & Analytics', 'Design & Creative', 'E-Commerce',
  'Education & Training', 'Energy & Utilities', 'Environmental Services',
  'Events & Hospitality', 'Fashion & Apparel', 'Film & Production',
  'Financial Technology', 'Food & Beverage', 'Gaming & Esports',
  'Government & Public Sector', 'Healthcare & Medical', 'Human Resources',
  'Insurance', 'Interior Design', 'Internet of Things', 'Investment',
  'Law & Legal Services', 'Logistics & Supply Chain', 'Luxury Goods',
  'Manufacturing', 'Market Research', 'Mining & Resources', 'Music & Audio',
  'Oil & Gas', 'Pharmaceuticals', 'Photography & Videography',
  'Product Management', 'Public Relations', 'Publishing & Writing',
  'Recruitment & Staffing', 'Retail', 'Robotics & Automation',
  'SaaS & Software', 'Sales & Business Development', 'Science & Research',
  'Social Impact', 'Sports & Fitness', 'Telecommunications',
  'Tourism & Travel', 'Transportation', 'UX & Product Design',
  'Venture Capital & Private Equity', 'Web Development', 'Wellness & Beauty',
];
import Link from 'next/link';
import { useTheme } from '@/components/ThemeProvider';
import { useTenant } from '@/components/TenantProvider';
import { useC } from '@/lib/theme';

const PEXELS_KEY = process.env.NEXT_PUBLIC_PEXELS_API_KEY ?? '';


const SOCIAL_FIELDS = [
  { key: 'twitter',   label: 'X / Twitter', icon: Twitter,   placeholder: 'https://x.com/username' },
  { key: 'linkedin',  label: 'LinkedIn',     icon: Linkedin,  placeholder: 'https://linkedin.com/in/username' },
  { key: 'instagram', label: 'Instagram',    icon: Instagram, placeholder: 'https://instagram.com/username' },
  { key: 'github',    label: 'GitHub',       icon: Github,    placeholder: 'https://github.com/username' },
  { key: 'youtube',   label: 'YouTube',      icon: Youtube,   placeholder: 'https://youtube.com/@channel' },
  { key: 'website',   label: 'Website',      icon: Globe,     placeholder: 'https://yoursite.com' },
];

// --- Pexels Picker ---
function PexelsPicker({ onSelect, onClose }: { onSelect: (url: string) => void; onClose: () => void }) {
  const C = useC();
  const [query, setQuery]   = useState('');
  const [photos, setPhotos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage]     = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const noCreds = !PEXELS_KEY;
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const search = useCallback(async (q: string, p: number, append = false) => {
    if (!q.trim() || !PEXELS_KEY) return;
    setLoading(true);
    try {
      const res  = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=20&page=${p}`, { headers: { Authorization: PEXELS_KEY } });
      const data = await res.json();
      setPhotos(prev => append ? [...prev, ...data.photos] : data.photos);
      setHasMore(!!data.next_page);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div initial={{ scale: 0.95, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 16 }}
        transition={{ duration: 0.2, ease: [0.23,1,0.32,1] }}
        className="w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden rounded-2xl"
        style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: '0 24px 64px rgba(0,0,0,0.15)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: C.divider }}>
          <div className="flex items-center gap-2.5">
            <ImageIcon className="w-4 h-4" style={{ color: C.faint }}/>
            <span className="text-sm font-semibold" style={{ color: C.text }}>Browse Pexels photos</span>
          </div>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" style={{ color: C.faint }}><X className="w-4 h-4"/></button>
        </div>
        <form onSubmit={e => { e.preventDefault(); setPage(1); search(query, 1, false); }} className="px-5 py-3 border-b flex gap-2" style={{ borderColor: C.divider }}>
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: C.faint }}/>
            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search for photos…"
              className="w-full rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none border transition-colors"
              style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
          </div>
          <button type="submit" disabled={loading || !query.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
            style={{ background: C.green }}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : 'Search'}
          </button>
        </form>
        {noCreds && (
          <div className="px-5 py-6 text-center space-y-2">
            <p className="text-sm" style={{ color: C.muted }}>Add <code className="px-1.5 py-0.5 rounded text-xs" style={{ background: C.pill }}>NEXT_PUBLIC_PEXELS_API_KEY</code> to your .env file.</p>
            <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline" style={{ color: C.faint }}>Get a free Pexels API key <ExternalLink className="w-3 h-3"/></a>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-4">
          {photos.length === 0 && !loading && !noCreds && (
            <div className="text-center py-12 text-sm" style={{ color: C.faint }}>{query ? 'No results. Try another search.' : 'Search for a photo above.'}</div>
          )}
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map(photo => (
              <button key={photo.id} onClick={() => onSelect(photo.src.large2x)}
                className="group relative aspect-[4/3] rounded-xl overflow-hidden hover:ring-2 transition-all"
                style={{ background: C.pill, outlineColor: C.green }}>
                <img src={photo.src.medium} alt={photo.alt} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy"/>
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors"/>
                <div className="absolute bottom-1.5 left-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-[10px] text-white/90 truncate bg-black/50 rounded px-1.5 py-0.5">{photo.photographer}</p>
                </div>
              </button>
            ))}
          </div>
          {hasMore && (
            <div className="text-center pt-4">
              <button onClick={() => { const n = page+1; setPage(n); search(query, n, true); }} disabled={loading}
                className="px-4 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
                style={{ background: C.pill, color: C.muted }}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin inline"/> : 'Load more'}
              </button>
            </div>
          )}
        </div>
        <div className="px-5 py-2.5 border-t text-right" style={{ borderColor: C.divider }}>
          <a href="https://www.pexels.com" target="_blank" rel="noreferrer" className="text-[11px] hover:opacity-60 transition-opacity" style={{ color: C.faint }}>Photos provided by Pexels</a>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Cover Editor ---
function CoverEditor({ coverUrl, coverPosition, onUrlChange, onPositionChange, onFileChange, onBrowse }: {
  coverUrl: string; coverPosition: { x: number; y: number };
  onUrlChange: (url: string) => void; onPositionChange: (pos: { x: number; y: number }) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void; onBrowse: () => void;
}) {
  const C = useC();
  const [repositioning, setRepositioning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef  = useRef(false);
  const startRef     = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const fileRef      = useRef<HTMLInputElement>(null);

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const dx = ((e.clientX - startRef.current.mx) / rect.width)  * -100;
    const dy = ((e.clientY - startRef.current.my) / rect.height) * -100;
    onPositionChange({ x: Math.max(0, Math.min(100, startRef.current.px + dx)), y: Math.max(0, Math.min(100, startRef.current.py + dy)) });
  }, [onPositionChange]);

  const stopDrag = useCallback(() => { draggingRef.current = false; }, []);

  useEffect(() => {
    if (!repositioning) return;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDrag);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', stopDrag); };
  }, [repositioning, onMouseMove, stopDrag]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: C.faint }}>Cover Image</label>
        {coverUrl && (
          <div className="flex items-center gap-2">
            {repositioning
              ? <button onClick={() => setRepositioning(false)} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg font-medium" style={{ background: C.cta, color: C.ctaText }}><Check className="w-3 h-3"/> Done</button>
              : <button onClick={() => setRepositioning(true)} className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg transition-colors" style={{ background: C.pill, color: C.muted }}><Move className="w-3 h-3"/> Reposition</button>
            }
            <button onClick={() => onUrlChange('')} className="text-xs px-2.5 py-1 rounded-lg transition-colors" style={{ color: '#ef4444' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,68,68,0.08)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>Remove</button>
          </div>
        )}
      </div>
      <div ref={containerRef}
        className={`relative h-40 rounded-2xl overflow-hidden border ${repositioning ? 'cursor-grab active:cursor-grabbing select-none' : ''}`}
        style={{ background: '#e8f5ee', borderColor: C.cardBorder }}
        onMouseDown={repositioning ? e => { draggingRef.current = true; startRef.current = { mx: e.clientX, my: e.clientY, px: coverPosition.x, py: coverPosition.y }; e.preventDefault(); } : undefined}>
        {coverUrl ? (
          <>
            <img src={coverUrl} alt="Cover" className="w-full h-full object-cover pointer-events-none" style={{ objectPosition: `${coverPosition.x}% ${coverPosition.y}%` }} draggable={false}/>
            {repositioning && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-2 text-white text-xs font-medium px-3 py-1.5 rounded-full" style={{ background: 'rgba(0,0,0,0.6)' }}>
                  <Move className="w-3.5 h-3.5"/> Drag to reposition
                </div>
              </div>
            )}
            {!repositioning && (
              <div className="absolute inset-0 bg-black/0 hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 hover:opacity-100">
                <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded-lg text-white font-medium" style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)' }}>Upload new</button>
                <button onClick={onBrowse} className="text-xs px-3 py-1.5 rounded-lg text-white font-medium" style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)' }}>Browse Pexels</button>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3" style={{ color: C.faint }}>
            <ImageIcon className="w-8 h-8 opacity-40"/>
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()} className="text-xs px-3 py-1.5 rounded-lg transition-colors" style={{ background: C.pill, color: C.muted }}>Upload</button>
              <button onClick={onBrowse} className="text-xs px-3 py-1.5 rounded-lg transition-colors" style={{ background: C.pill, color: C.muted }}>Browse Pexels</button>
            </div>
          </div>
        )}
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFileChange}/>
    </div>
  );
}

// --- Types ---
type EducationEntry = {
  id: string;
  school: string;
  degree: string;
  field: string;
  start_year: string;
  end_year: string;
  current: boolean;
};
type WorkEntry = {
  id: string;
  company: string;
  title: string;
  start_year: string;
  end_year: string;
  current: boolean;
  description?: string;
};
type PortfolioItem = {
  id: string;
  title: string;
  tools: string[];
  url: string;
  thumbnail_url: string;
  description: string;
};
const PORTFOLIO_TOOLS = [
  'Claude', 'Excel', 'SQL', 'Power BI', 'Python', 'Tableau',
  'Perplexity AI', 'Zapier', 'Databricks', 'AWS', 'Azure',
];

const YEARS = Array.from({ length: new Date().getFullYear() - 1969 }, (_, i) => String(new Date().getFullYear() - i));
const DEGREES = ['High School', 'Diploma', 'Associate', "Bachelor's", "Master's", 'MBA', 'PhD', 'Certificate', 'Other'];

const SKILLS_LIST = [
  'Claude', 'Excel', 'SQL', 'Power BI', 'Python', 'Tableau',
  'Perplexity AI', 'Zapier', 'Databricks', 'AWS', 'Azure',
];

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  const C = useC();
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium block" style={{ color: C.muted }}>{label}</label>
      {children}
    </div>
  );
}

function EntryCard({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const C = useC();
  return (
    <div className="rounded-xl p-4 space-y-3 relative" style={{ background: C.input, border: `1px solid ${C.cardBorder}` }}>
      {children}
      <button onClick={onDelete} className="absolute top-3 right-3 p-1 rounded-lg transition-colors hover:opacity-70"
        style={{ color: '#ef4444' }}>
        <Trash2 className="w-3.5 h-3.5"/>
      </button>
    </div>
  );
}

function SelectField({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string }) {
  const C = useC();
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none appearance-none"
      style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: value ? C.text : C.faint }}>
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// --- Settings Page ---
export default function SettingsPage() {
  const toolIcon = useToolIcons();
  const C = useC();
  const { toggle: toggleTheme, theme } = useTheme();
  const { logoUrl, logoDarkUrl } = useTenant();
  const router = useRouter();
  const [user, setUser]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState('');
  const [name, setName]         = useState('');
  const [username, setUsername] = useState('');
  const [usernameMsg, setUsernameMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [bio, setBio]           = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [country, setCountry]     = useState('');
  const [city, setCity]           = useState('');
  const [socialLinks, setSocialLinks] = useState<Record<string, string>>({});
  const [education, setEducation]         = useState<EducationEntry[]>([]);
  const [workExperience, setWorkExperience] = useState<WorkEntry[]>([]);
  const [skills, setSkills]               = useState<string[]>([]);
  const [skillInput, setSkillInput]       = useState('');
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [thumbUploading, setThumbUploading] = useState<string | null>(null);
  const avatarRef = useRef<HTMLInputElement>(null);

  const [accessToken, setAccessToken]   = useState<string | null>(null);
  const [certUploading, setCertUploading] = useState<string | null>(null);
  const [avatarCropSrc, setAvatarCropSrc] = useState<string | null>(null);

  // Change password state
  const [pwCurrent, setPwCurrent]   = useState('');
  const [pwNew, setPwNew]           = useState('');
  const [pwConfirm, setPwConfirm]   = useState('');
  const [pwLoading, setPwLoading]   = useState(false);
  const [pwMsg, setPwMsg]           = useState<{ ok: boolean; text: string } | null>(null);

  // Delete account state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteText, setDeleteText]       = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteMsg, setDeleteMsg]         = useState('');

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

  const handleChangePassword = async () => {
    if (pwNew !== pwConfirm) { setPwMsg({ ok: false, text: 'Passwords do not match.' }); return; }
    if (pwNew.length < 8) { setPwMsg({ ok: false, text: 'Password must be at least 8 characters.' }); return; }
    setPwLoading(true); setPwMsg(null);
    const res = await fetch('/api/account/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ currentPassword: pwCurrent, newPassword: pwNew }),
    });
    const data = await res.json();
    setPwLoading(false);
    if (!res.ok) { setPwMsg({ ok: false, text: data.error ?? 'Failed to update password. Try again.' }); }
    else { setPwMsg({ ok: true, text: 'Password updated successfully.' }); setPwCurrent(''); setPwNew(''); setPwConfirm(''); }
  };

  const handleDeleteAccount = async () => {
    if (deleteText !== 'DELETE') return;
    setDeleteLoading(true); setDeleteMsg('');
    const res = await fetch('/api/account/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const data = await res.json();
      setDeleteMsg(data.error ?? 'Failed to delete account.');
      setDeleteLoading(false);
      return;
    }
    await supabase.auth.signOut();
    window.location.href = '/auth';
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
    <div className="min-h-screen flex items-center justify-center" style={{ background: C.page }}>
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.green }}/>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: C.page }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'); *{font-family:'Inter',sans-serif;}`}</style>

      {/* Avatar crop modal */}
      {avatarCropSrc && (
        <ImageCropModal
          src={avatarCropSrc}
          aspect={1}
          shape="round"
          title="Crop profile photo"
          onConfirm={async blob => {
            setAvatarCropSrc(null);
            setCertUploading('avatar');
            const url = await uploadToStorage(blob, 'profiles', avatarUrl || undefined);
            if (url) setAvatarUrl(url);
            setCertUploading(null);
          }}
          onCancel={() => { URL.revokeObjectURL(avatarCropSrc); setAvatarCropSrc(null); }}
        />
      )}

      {/* Navbar */}
      <nav className="sticky top-0 z-20 border-b px-6 md:px-10 h-14 flex items-center justify-between"
        style={{ background: C.nav, borderColor: C.navBorder }}>
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1.5 rounded-lg transition-opacity hover:opacity-70" style={{ color: C.muted }}>
            <ArrowLeft className="w-5 h-5"/>
          </button>
          <img
            src={(theme === 'dark' ? logoDarkUrl || logoUrl : logoUrl) || undefined}
            alt=""
            className="h-7 w-auto"
          />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleTheme} className="p-2 rounded-xl transition-opacity hover:opacity-70" title="Toggle theme" style={{ color: C.muted }}>
            {theme === 'dark' ? <Sun className="w-4 h-4"/> : <Moon className="w-4 h-4"/>}
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-60 hover:opacity-90"
            style={{ background: saved ? '#16a34a' : C.pill, color: saved ? 'white' : C.text, border: `1px solid ${saved ? 'transparent' : C.inputBorder}` }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : saved ? <Check className="w-4 h-4"/> : null}
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save changes'}
          </button>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-5 md:px-6 py-8 space-y-6 pb-16">

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity:0,y:-8 }} animate={{ opacity:1,y:0 }} exit={{ opacity:0 }}
              className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm"
              style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#ef4444' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0"/> {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Share Profile card -- shown when username is set */}
        {username && (
          <div className="rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3"
            style={{ background: C.card, boxShadow: C.cardShadow }}>
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: C.cta + '18' }}>
                <Link2 className="w-4 h-4" style={{ color: C.cta }}/>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: C.text }}>Your public profile</p>
                <p className="text-xs truncate mt-0.5" style={{ color: C.muted }}>
                  {typeof window !== 'undefined' ? window.location.origin : ''}/s/{username}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={() => {
                  const url = `${window.location.origin}/s/${username}`;
                  navigator.clipboard?.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all"
                style={{ background: C.cta, color: C.ctaText }}>
                {copied ? <Check className="w-3.5 h-3.5"/> : <Copy className="w-3.5 h-3.5"/>}
                {copied ? 'Copied!' : 'Copy link'}
              </button>
              <a href={`/s/${username}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-opacity hover:opacity-70"
                style={{ background: C.pill, color: C.muted }}>
                <ExternalLink className="w-3.5 h-3.5"/> View
              </a>
            </div>
          </div>
        )}

        {/* Avatar */}
        <div className="rounded-2xl p-5" style={{ background: C.card, boxShadow: C.cardShadow }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: C.faint }}>Profile Photo</h2>
          <div className="flex items-center gap-4">
            <div className="relative w-16 h-16 rounded-full cursor-pointer group flex-shrink-0" onClick={() => avatarRef.current?.click()}>
              {avatarUrl
                ? <img src={avatarUrl} alt="Avatar" className="w-full h-full rounded-full object-cover"/>
                : <div className="w-full h-full rounded-full flex items-center justify-center text-lg font-bold" style={{ background: C.lime, color: C.green }}>{initials}</div>
              }
              {certUploading === 'avatar'
                ? <div className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center">
                    <svg className="animate-spin w-5 h-5 text-white" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"/></svg>
                  </div>
                : <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="w-4 h-4 text-white"/>
                  </div>}
            </div>
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={e => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 8 * 1024 * 1024) { alert('Image must be 8 MB or smaller.'); return; }
              setAvatarCropSrc(URL.createObjectURL(f));
              e.target.value = '';
            }}/>
            <div>
              <p className="text-sm font-medium" style={{ color: C.text }}>Profile photo</p>
              <p className="text-xs mt-0.5" style={{ color: C.faint }}>{certUploading === 'avatar' ? 'Uploading…' : 'Click to upload a new photo.'}</p>
            </div>
          </div>
        </div>

        {/* Basic Info */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: C.card, boxShadow: C.cardShadow }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Basic Info</h2>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: C.muted }}>Full Name</label>
              <input value={name} onChange={e => setName(sanitizePlainText(e.target.value))} placeholder="Your full name"
                className="w-full rounded-xl px-4 py-2.5 text-sm border focus:outline-none transition-colors"
                style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
            </div>
            <div>
              <label className="text-xs font-medium mb-1.5 block" style={{ color: C.muted }}>Username</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm select-none" style={{ color: C.faint }}>@</span>
                <input
                  value={username}
                  onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30))}
                  placeholder="yourname"
                  maxLength={30}
                  className="w-full rounded-xl pl-8 pr-4 py-2.5 text-sm border focus:outline-none transition-colors"
                  style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
              </div>
              <p className="text-xs mt-1.5" style={{ color: C.faint }}>
                {username
                  ? <>Your shareable profile: <span style={{ color: C.green }}>{typeof window !== 'undefined' ? window.location.origin : ''}/s/{username}</span></>
                  : 'Set a username to get a shareable public profile. Letters, numbers, underscores only.'}
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium" style={{ color: C.muted }}>Bio</label>
                <span className="text-xs" style={{ color: bio.length > 280 ? '#ef4444' : C.faint }}>{bio.length}/300</span>
              </div>
              <textarea
                value={bio}
                onChange={e => setBio(sanitizePlainText(e.target.value).slice(0, 300))}
                maxLength={300}
                rows={3}
                placeholder="A short bio about yourself…"
                className="w-full rounded-xl px-4 py-2.5 text-sm border focus:outline-none transition-colors resize-none"
                style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: C.muted }}>Country</label>
                <input value={country} onChange={e => setCountry(sanitizePlainText(e.target.value))} placeholder="e.g. Ghana"
                  className="w-full rounded-xl px-4 py-2.5 text-sm border focus:outline-none transition-colors"
                  style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
              </div>
              <div>
                <label className="text-xs font-medium mb-1.5 block" style={{ color: C.muted }}>City</label>
                <input value={city} onChange={e => setCity(sanitizePlainText(e.target.value))} placeholder="e.g. Accra"
                  className="w-full rounded-xl px-4 py-2.5 text-sm border focus:outline-none transition-colors"
                  style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
              </div>
            </div>
          </div>
        </div>

        {/* Social Links */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: C.card, boxShadow: C.cardShadow }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Social Links</h2>
          <div className="space-y-3">
            {SOCIAL_FIELDS.map(({ key, label, icon: Icon, placeholder }) => (
              <div key={key} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: C.pill }}>
                  <Icon className="w-4 h-4" style={{ color: C.faint }}/>
                </div>
                <input
                  value={socialLinks[key] ?? ''}
                  onChange={e => setSocialLinks(prev => ({ ...prev, [key]: sanitizePlainText(e.target.value) }))}
                  placeholder={placeholder}
                  className="flex-1 rounded-xl px-4 py-2.5 text-sm border focus:outline-none transition-colors"
                  style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}
                />
              </div>
            ))}
          </div>
        </div>


        {/* Education */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: C.card, boxShadow: C.cardShadow }}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Education</h2>
            <button
              onClick={() => setEducation(prev => [...prev, { id: crypto.randomUUID(), school: '', degree: '', field: '', start_year: '', end_year: '', current: false }])}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
              style={{ background: C.lime, color: C.green }}>
              + Add
            </button>
          </div>
          {education.length === 0 && (
            <p className="text-xs py-2" style={{ color: C.faint }}>No education added yet.</p>
          )}
          <div className="space-y-3">
            {education.map((ed, i) => (
              <EntryCard key={ed.id} onDelete={() => setEducation(prev => prev.filter((_, j) => j !== i))}>
                <FieldRow label="School / University">
                  <input value={ed.school} onChange={e => setEducation(prev => prev.map((x, j) => j === i ? { ...x, school: sanitizePlainText(e.target.value) } : x))}
                    placeholder="e.g. University of Ghana"
                    className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none"
                    style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                </FieldRow>
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Degree">
                    <SelectField value={ed.degree} onChange={v => setEducation(prev => prev.map((x, j) => j === i ? { ...x, degree: v } : x))} options={DEGREES} placeholder="Select degree"/>
                  </FieldRow>
                  <FieldRow label="Field of Study">
                    <input value={ed.field} onChange={e => setEducation(prev => prev.map((x, j) => j === i ? { ...x, field: sanitizePlainText(e.target.value) } : x))}
                      placeholder="e.g. Computer Science"
                      className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none"
                      style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                  </FieldRow>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Start Year">
                    <SelectField value={ed.start_year} onChange={v => setEducation(prev => prev.map((x, j) => j === i ? { ...x, start_year: v } : x))} options={YEARS} placeholder="Year"/>
                  </FieldRow>
                  <FieldRow label="End Year">
                    {ed.current
                      ? <div className="flex items-center h-10 px-3 rounded-xl text-xs" style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.faint }}>Present</div>
                      : <SelectField value={ed.end_year} onChange={v => setEducation(prev => prev.map((x, j) => j === i ? { ...x, end_year: v } : x))} options={YEARS} placeholder="Year"/>
                    }
                  </FieldRow>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={ed.current}
                    onChange={e => setEducation(prev => prev.map((x, j) => j === i ? { ...x, current: e.target.checked, end_year: e.target.checked ? '' : x.end_year } : x))}
                    className="rounded"/>
                  <span className="text-xs" style={{ color: C.muted }}>Currently studying here</span>
                </label>
              </EntryCard>
            ))}
          </div>
        </div>

        {/* Work Experience */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: C.card, boxShadow: C.cardShadow }}>
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Work Experience</h2>
            <button
              onClick={() => setWorkExperience(prev => [...prev, { id: crypto.randomUUID(), company: '', title: '', start_year: '', end_year: '', current: false }])}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80"
              style={{ background: C.lime, color: C.green }}>
              + Add
            </button>
          </div>
          {workExperience.length === 0 && (
            <p className="text-xs py-2" style={{ color: C.faint }}>No work experience added yet.</p>
          )}
          <div className="space-y-3">
            {workExperience.map((job, i) => (
              <EntryCard key={job.id} onDelete={() => setWorkExperience(prev => prev.filter((_, j) => j !== i))}>
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Company">
                    <input value={job.company} onChange={e => setWorkExperience(prev => prev.map((x, j) => j === i ? { ...x, company: sanitizePlainText(e.target.value) } : x))}
                      placeholder="e.g. Google"
                      className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none"
                      style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                  </FieldRow>
                  <FieldRow label="Job Title">
                    <input value={job.title} onChange={e => setWorkExperience(prev => prev.map((x, j) => j === i ? { ...x, title: sanitizePlainText(e.target.value) } : x))}
                      placeholder="e.g. Software Engineer"
                      className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none"
                      style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                  </FieldRow>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Start Year">
                    <SelectField value={job.start_year} onChange={v => setWorkExperience(prev => prev.map((x, j) => j === i ? { ...x, start_year: v } : x))} options={YEARS} placeholder="Year"/>
                  </FieldRow>
                  <FieldRow label="End Year">
                    {job.current
                      ? <div className="flex items-center h-10 px-3 rounded-xl text-xs" style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.faint }}>Present</div>
                      : <SelectField value={job.end_year} onChange={v => setWorkExperience(prev => prev.map((x, j) => j === i ? { ...x, end_year: v } : x))} options={YEARS} placeholder="Year"/>
                    }
                  </FieldRow>
                </div>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={job.current}
                    onChange={e => setWorkExperience(prev => prev.map((x, j) => j === i ? { ...x, current: e.target.checked, end_year: e.target.checked ? '' : x.end_year } : x))}
                    className="rounded"/>
                  <span className="text-xs" style={{ color: C.muted }}>I currently work here</span>
                </label>
                <FieldRow label="Description">
                  {(() => {
                    const words = (job.description ?? '').trim().split(/\s+/).filter(Boolean).length;
                    const over  = words > 120;
                    return (
                      <>
                        <textarea
                          value={job.description ?? ''}
                          onChange={e => setWorkExperience(prev => prev.map((x, j) => j === i ? { ...x, description: sanitizePlainText(e.target.value) } : x))}
                          rows={3}
                          placeholder="Briefly describe your role and responsibilities…"
                          className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none transition-colors resize-none"
                          style={{ background: C.card, border: `1px solid ${over ? '#ef4444' : C.cardBorder}`, color: C.text }}
                        />
                        <p className="text-right text-[11px] mt-0.5" style={{ color: over ? '#ef4444' : C.faint }}>
                          {words}/120 words
                        </p>
                      </>
                    );
                  })()}
                </FieldRow>
              </EntryCard>
            ))}
          </div>
        </div>

        {/* Skills */}
        {(() => {
          const query = skillInput.trim().toLowerCase();
          const suggestions = SKILLS_LIST.filter(s =>
            s.toLowerCase().includes(query) && !skills.includes(s)
          ).slice(0, 8);
          const canAddCustom = query.length > 1 && !skills.map(s => s.toLowerCase()).includes(query) && !SKILLS_LIST.map(s => s.toLowerCase()).includes(query);

          const addSkill = (skill: string) => {
            const trimmed = skill.trim();
            if (!trimmed || skills.includes(trimmed) || skills.length >= 20) return;
            setSkills(prev => [...prev, trimmed]);
            setSkillInput('');
          };

          return (
            <div className="rounded-2xl p-5 space-y-4" style={{ background: C.card, boxShadow: C.cardShadow }}>
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Skills</h2>
                <p className="text-xs mt-1" style={{ color: C.faint }}>We recommend adding your top 5 skills used in your role.</p>
              </div>

              {/* Selected pills */}
              {skills.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {skills.map(skill => (
                    <span key={skill} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold"
                      style={{ background: C.lime, color: C.text }}>
                      {toolIcon(skill) && <img src={toolIcon(skill)} alt="" style={{ width: 13, height: 13, objectFit: 'contain', flexShrink: 0 }}/>}
                      {skill}
                      <button onClick={() => setSkills(prev => prev.filter(s => s !== skill))}
                        className="hover:opacity-60 transition-opacity leading-none">
                        <X className="w-3 h-3"/>
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Input + autocomplete */}
              <div className="relative">
                <input
                  value={skillInput}
                  onChange={e => setSkillInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); if (suggestions[0]) addSkill(suggestions[0]); else if (canAddCustom) addSkill(skillInput); }
                  }}
                  placeholder="Search or type a skill…"
                  className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none"
                  style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}
                />
                {skillInput && (suggestions.length > 0 || canAddCustom) && (
                  <div className="absolute z-20 left-0 right-0 mt-1 rounded-xl overflow-hidden"
                    style={{ background: C.card, boxShadow: C.cardShadow }}>
                    {suggestions.map(s => (
                      <button key={s} onMouseDown={e => { e.preventDefault(); addSkill(s); }}
                        className="w-full text-left px-4 py-2.5 text-sm transition-colors hover:opacity-70"
                        style={{ color: C.text }}>
                        {s}
                      </button>
                    ))}
                    {canAddCustom && (
                      <button onMouseDown={e => { e.preventDefault(); addSkill(skillInput.trim()); }}
                        className="w-full text-left px-4 py-2.5 text-sm border-t transition-colors hover:opacity-70"
                        style={{ color: C.muted, borderColor: C.divider }}>
                        Add &ldquo;{skillInput.trim()}&rdquo;
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Suggested pills (when input is empty) */}
              {!skillInput && (
                <div>
                  <p className="text-[11px] mb-2" style={{ color: C.faint }}>Suggested</p>
                  <div className="flex flex-wrap gap-2">
                    {SKILLS_LIST.filter(s => !skills.includes(s)).slice(0, 12).map(s => (
                      <button key={s} onClick={() => addSkill(s)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-opacity hover:opacity-70"
                        style={{ background: C.input, color: C.muted }}>
                        + {toolIcon(s) && <img src={toolIcon(s)} alt="" style={{ width: 14, height: 14, objectFit: 'contain', flexShrink: 0 }}/>}{s}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* Portfolio */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: C.card, boxShadow: C.cardShadow }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Portfolio</h2>
              <p className="text-xs mt-1" style={{ color: C.faint }}>Embed Canva, Power BI, Tableau, Jupyter, and more. Paste the public share URL.</p>
            </div>
            {portfolioItems.length < 5 && (
              <button
                onClick={() => setPortfolioItems(prev => [...prev, { id: crypto.randomUUID(), title: '', tools: [], url: '', thumbnail_url: '', description: '' }])}
                className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-opacity hover:opacity-80 flex-shrink-0"
                style={{ background: C.lime, color: C.green }}>
                + Add
              </button>
            )}
          </div>
          {portfolioItems.length === 0 && (
            <p className="text-xs py-2" style={{ color: C.faint }}>No portfolio items added yet. Up to 5 items.</p>
          )}
          <div className="space-y-3">
            {portfolioItems.map((item, i) => (
              <EntryCard key={item.id} onDelete={() => {
                if (item.thumbnail_url) deleteFromCloudinary(item.thumbnail_url).catch(() => {});
                setPortfolioItems(prev => prev.filter((_, j) => j !== i));
              }}>
                <FieldRow label="Title">
                  <input
                    value={item.title}
                    onChange={e => setPortfolioItems(prev => prev.map((x, j) => j === i ? { ...x, title: sanitizePlainText(e.target.value) } : x))}
                    placeholder="e.g. Sales Dashboard"
                    className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none"
                    style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.text }}
                  />
                </FieldRow>
                <FieldRow label="Tools used">
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {PORTFOLIO_TOOLS.map(tool => {
                      const active = (item.tools ?? []).includes(tool);
                      return (
                        <button key={tool} type="button"
                          onClick={() => setPortfolioItems(prev => prev.map((x, j) => j === i
                            ? { ...x, tools: active ? x.tools.filter(t => t !== tool) : [...x.tools, tool] }
                            : x))}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors"
                          style={{
                            background: active ? C.lime : C.card,
                            color:      active ? C.text : C.muted,
                          }}>
                          {toolIcon(tool) && <img src={toolIcon(tool)} alt="" style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }}/>}
                          {tool}
                        </button>
                      );
                    })}
                  </div>
                </FieldRow>
                <FieldRow label="Embed URL">
                  <input
                    value={item.url}
                    onChange={e => setPortfolioItems(prev => prev.map((x, j) => j === i ? { ...x, url: e.target.value.trim() } : x))}
                    placeholder="https://www.canva.com/design/... or Power BI / Tableau / Jupyter URL"
                    className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none"
                    style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.text }}
                  />
                  {item.url && !item.url.startsWith('https://') && (
                    <p className="text-xs mt-1 text-red-400">URL must start with https://</p>
                  )}
                </FieldRow>
                <FieldRow label="Thumbnail (optional)">
                  <div className="flex items-center gap-3">
                    {item.thumbnail_url
                      ? <img src={item.thumbnail_url} alt="Thumbnail"
                          className="w-20 h-14 rounded-lg object-cover flex-shrink-0"
                          style={{ border: `1px solid ${C.cardBorder}` }}/>
                      : <div className="w-20 h-14 rounded-lg flex items-center justify-center flex-shrink-0"
                          style={{ background: C.pill, border: `1px solid ${C.cardBorder}` }}>
                          <ImageIcon className="w-5 h-5" style={{ color: C.faint }}/>
                        </div>
                    }
                    <div className="flex-1 min-w-0">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="file" accept="image/*" className="hidden" onChange={async e => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          if (f.size > 8 * 1024 * 1024) { alert('Image must be 8 MB or smaller.'); return; }
                          setThumbUploading(item.id);
                          const url = await uploadToStorage(f, 'portfolio-thumbnails', item.thumbnail_url || undefined);
                          if (url) setPortfolioItems(prev => prev.map((x, j) => j === i ? { ...x, thumbnail_url: url } : x));
                          setThumbUploading(null);
                          e.target.value = '';
                        }}/>
                        <span className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                          style={{ background: C.lime, color: C.green }}>
                          {thumbUploading === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
                          {thumbUploading === item.id ? 'Uploading...' : item.thumbnail_url ? 'Replace' : 'Upload'}
                        </span>
                      </label>
                      {item.thumbnail_url && (
                        <button onClick={() => setPortfolioItems(prev => prev.map((x, j) => j === i ? { ...x, thumbnail_url: '' } : x))}
                          className="mt-1.5 text-xs transition-opacity hover:opacity-70"
                          style={{ color: '#ef4444' }}>
                          Remove
                        </button>
                      )}
                      <p className="text-xs mt-1" style={{ color: C.faint }}>Used as cover when the embed cannot be previewed.</p>
                    </div>
                  </div>
                </FieldRow>
                <FieldRow label="Description (optional)">
                  <textarea
                    value={item.description}
                    onChange={e => setPortfolioItems(prev => prev.map((x, j) => j === i ? { ...x, description: sanitizePlainText(e.target.value).slice(0, 200) } : x))}
                    placeholder="Brief description of this work"
                    rows={3}
                    maxLength={200}
                    className="w-full rounded-xl px-3 py-2.5 text-sm border focus:outline-none resize-none"
                    style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.text }}
                  />
                  <p className="text-right text-[11px] mt-0.5" style={{ color: item.description.length >= 180 ? '#ef4444' : C.faint }}>
                    {item.description.length}/200
                  </p>
                </FieldRow>
              </EntryCard>
            ))}
          </div>
        </div>

        {/* Account */}
        <div className="rounded-2xl p-5 space-y-4" style={{ background: C.card, boxShadow: C.cardShadow }}>
          <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Account</h2>

          {/* Email */}
          <div className="rounded-xl px-4 py-3" style={{ background: C.pill }}>
            <p className="text-xs" style={{ color: C.faint }}>Email address</p>
            <p className="text-sm font-medium mt-0.5" style={{ color: C.text }}>{user?.email}</p>
          </div>

          {/* Change Password */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Change Password</h3>
            <input type="password" value={pwCurrent} onChange={e => setPwCurrent(e.target.value)} placeholder="Current password"
              className="w-full rounded-xl px-4 py-2.5 text-sm border focus:outline-none transition-colors"
              style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text }}/>
            <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} placeholder="New password (min 8 characters)"
              className="w-full rounded-xl px-4 py-2.5 text-sm border focus:outline-none transition-colors"
              style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text }}/>
            <input type="password" value={pwConfirm} onChange={e => setPwConfirm(e.target.value)} placeholder="Confirm new password"
              className="w-full rounded-xl px-4 py-2.5 text-sm border focus:outline-none transition-colors"
              style={{ background: C.input, border: `1px solid ${C.inputBorder}`, color: C.text }}/>
            {pwMsg && (
              <div className={`flex items-center gap-2 text-xs ${pwMsg.ok ? 'text-emerald-500' : 'text-red-500'}`}>
                {pwMsg.ok ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0"/> : <XCircle className="w-3.5 h-3.5 flex-shrink-0"/>}
                {pwMsg.text}
              </div>
            )}
            <button onClick={handleChangePassword} disabled={pwLoading || !pwCurrent || !pwNew || !pwConfirm}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-50 hover:opacity-90"
              style={{ background: C.cta, color: C.ctaText }}>
              {pwLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
              {pwLoading ? 'Updating…' : 'Update Password'}
            </button>
          </div>

          {/* Danger Zone */}
          <div className="border-t pt-4 space-y-3" style={{ borderColor: C.divider }}>
            <h3 className="text-xs font-semibold uppercase tracking-widest text-red-500">Danger Zone</h3>
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                style={{ background: '#fef2f2', color: '#ef4444' }}>
                <Trash2 className="w-4 h-4"/> Delete Account
              </button>
            ) : (
              <div className="rounded-xl p-4 space-y-3" style={{ background: '#fef2f2', border: '1px solid #fecaca' }}>
                <p className="text-sm font-medium text-red-600">This permanently deletes your account, all forms, responses, and certificates. This cannot be undone.</p>
                <p className="text-xs text-red-500">Type <strong>DELETE</strong> to confirm.</p>
                <input value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder="DELETE"
                  className="w-full rounded-xl px-4 py-2.5 text-sm border focus:outline-none"
                  style={{ background: 'white', border: '1px solid #fecaca', color: '#111' }}/>
                {deleteMsg && <p className="text-xs text-red-500">{deleteMsg}</p>}
                <div className="flex gap-2">
                  <button onClick={handleDeleteAccount} disabled={deleteLoading || deleteText !== 'DELETE'}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 bg-red-500 hover:bg-red-600 text-white">
                    {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin"/> : <Trash2 className="w-4 h-4"/>}
                    {deleteLoading ? 'Deleting…' : 'Delete My Account'}
                  </button>
                  <button onClick={() => { setConfirmDelete(false); setDeleteText(''); setDeleteMsg(''); }}
                    className="px-4 py-2.5 rounded-xl text-sm font-medium transition-colors"
                    style={{ background: 'white', color: '#555', border: '1px solid #fecaca' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>
  );
}
