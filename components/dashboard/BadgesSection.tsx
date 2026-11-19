'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useRef } from 'react';
import { Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, cardStyle } from '@/lib/theme';

export function BadgesSection({ C }: { C: typeof LIGHT_C }) {
  const [badges, setBadges] = useState<{ id: string; name: string; description: string; icon: string; color: string; image_url: string | null; category: string; managed: 'course' | 'learning_path' | 'virtual_experience' | null }[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [removing, setRemoving]   = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [catIdx, setCatIdx] = useState(0);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    (async () => {
      const [{ data: seeded }, { data: courses }, { data: paths }, { data: ves }] = await Promise.all([
        supabase.from('badges').select('id, name, description, icon, color, image_url, category').order('id'),
        supabase.from('courses').select('id, title, badge_image_url').not('badge_image_url', 'is', null),
        supabase.from('learning_paths').select('id, title, badge_image_url').not('badge_image_url', 'is', null),
        supabase.from('virtual_experiences').select('id, title, badge_image_url').not('badge_image_url', 'is', null),
      ]);
      // Seeded/system badges are editable here; content badges (crs_/lp_/ve_) are
      // synthesized straight from the course/path/VE so they appear immediately.
      const achievement = (seeded ?? [])
        .filter((b: any) => !/^(crs_|lp_|ve_)/.test(b.id))
        .map((b: any) => ({ ...b, managed: null as 'course' | 'learning_path' | 'virtual_experience' | null }));
      const content = [
        ...(courses ?? []).map((c: any) => ({ id: `crs_${c.id}`, name: `${c.title} Badge`, description: `Awarded for completing ${c.title}`, icon: 'graduated', color: '#6366f1', image_url: c.badge_image_url, category: 'course', managed: 'course' as const })),
        ...(paths ?? []).map((p: any) => ({ id: `lp_${p.id}`, name: `${p.title} Badge`, description: `Awarded for completing ${p.title}`, icon: 'map', color: '#6366f1', image_url: p.badge_image_url, category: 'learning_path', managed: 'learning_path' as const })),
        ...(ves ?? []).map((v: any) => ({ id: `ve_${v.id}`, name: `${v.title} Badge`, description: `Awarded for completing ${v.title}`, icon: 'briefcase', color: '#6366f1', image_url: v.badge_image_url, category: 'virtual_experience', managed: 'virtual_experience' as const })),
      ];
      setBadges([...achievement, ...content]);
    })();
  }, []);

  const handleUpload = async (badge: typeof badges[0], file: File) => {
    if (!file.type.startsWith('image/')) { setMsg({ ok: false, text: 'Please select an image file' }); return; }
    setUploading(badge.id);
    setMsg(null);
    try {
      const ext  = file.name.split('.').pop() || 'png';
      const path = `badge-images/${badge.id}.${ext}`;
      const { error: upErr } = await supabase.storage.from('form-assets').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data: { publicUrl } } = supabase.storage.from('form-assets').getPublicUrl(path);
      const url = publicUrl;
      const { error } = await supabase.from('badges').update({ image_url: url }).eq('id', badge.id);
      if (error) throw error;
      setBadges(prev => prev.map(b => b.id === badge.id ? { ...b, image_url: url } : b));
      setMsg({ ok: true, text: `${badge.name} image updated` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? 'Upload failed' });
    } finally {
      setUploading(null);
      setTimeout(() => setMsg(null), 3500);
    }
  };

  const handleRemove = async (badge: typeof badges[0]) => {
    setRemoving(badge.id);
    setMsg(null);
    try {
      const { error } = await supabase.from('badges').update({ image_url: null }).eq('id', badge.id);
      if (error) throw error;
      setBadges(prev => prev.map(b => b.id === badge.id ? { ...b, image_url: null } : b));
      setMsg({ ok: true, text: `${badge.name} image removed` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message ?? 'Remove failed' });
    } finally {
      setRemoving(null);
      setTimeout(() => setMsg(null), 3500);
    }
  };

  const CATEGORY_META = [
    { key: 'achievement',        label: 'Achievement' },
    { key: 'course',             label: 'Course' },
    { key: 'learning_path',      label: 'Learning Path' },
    { key: 'virtual_experience', label: 'Virtual Experience' },
  ] as const;
  const MANAGED_LABEL: Record<string, string> = { course: 'course editor', learning_path: 'learning path editor', virtual_experience: 'virtual experience editor' };
  const cats = CATEGORY_META.filter(m => badges.some(b => b.category === m.key));
  const ci = Math.min(Math.max(catIdx, 0), Math.max(0, cats.length - 1));
  const activeCat = cats[ci];
  const activeBadges = activeCat ? badges.filter(b => b.category === activeCat.key) : [];

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {msg && (
        <div className="px-4 py-3 rounded-xl text-sm font-medium" style={{
          background: msg.ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.10)',
          color: msg.ok ? '#10b981' : '#ef4444',
          border: `1px solid ${msg.ok ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
        }}>
          {msg.text}
        </div>
      )}

      <div className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
        {/* Header + badge-type tabs */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <h2 className="text-base font-bold leading-none" style={{ color: C.text }}>Badge Images</h2>
          <p className="text-xs mt-2" style={{ color: C.muted }}>Upload a custom image for each badge. If no image is uploaded, the emoji icon is shown instead.</p>
          {cats.length > 1 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              {cats.map((m, i) => {
                const active = i === ci;
                return (
                  <button key={m.key} onClick={() => setCatIdx(i)}
                    className="text-center px-4 py-4 rounded-md text-sm font-semibold transition-all"
                    style={{ background: active ? C.cta : C.pill, color: active ? C.ctaText : C.text, border: 'none' }}>
                    {m.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Badge rows for the active type */}
        {activeBadges.map((badge, i) => {
          const isUp  = uploading === badge.id;
          const isRem = removing  === badge.id;
          return (
            <div key={badge.id}
              className="flex items-center gap-4 px-5 py-4"
              style={{ borderBottom: i < activeBadges.length - 1 ? `1px solid ${C.divider}` : 'none' }}>

              {/* Badge preview */}
              <div className="flex-shrink-0 w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden"
                style={{ background: badge.image_url ? 'transparent' : `${badge.color}20` }}>
                {badge.image_url
                  ? <img src={badge.image_url} alt={badge.name} className="w-full h-full object-cover" />
                  : <span className="text-2xl">{badge.icon}</span>
                }
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate" style={{ color: C.text }}>{badge.name}</p>
                <p className="text-xs mt-0.5 line-clamp-1" style={{ color: C.muted }}>{badge.description}</p>
              </div>

              {/* Actions */}
              {badge.managed ? (
                <span className="text-xs flex-shrink-0 text-right" style={{ color: C.faint }}>
                  Managed in the {MANAGED_LABEL[badge.managed]}
                </span>
              ) : (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {badge.image_url && (
                    <button
                      onClick={() => handleRemove(badge)}
                      disabled={isRem || isUp}
                      className="px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-40 transition-opacity"
                      style={{ background: C.deleteBg, color: C.deleteText, border: 'none' }}>
                      {isRem ? 'Removing...' : 'Remove'}
                    </button>
                  )}
                  <button
                    onClick={() => fileRefs.current[badge.id]?.click()}
                    disabled={isUp || isRem}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-40 transition-opacity"
                    style={{ background: C.cta, color: C.ctaText }}>
                    <Upload className="w-3.5 h-3.5" />
                    {isUp ? 'Uploading...' : badge.image_url ? 'Replace' : 'Upload'}
                  </button>
                  <input
                    ref={el => { fileRefs.current[badge.id] = el; }}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(badge, f); e.target.value = ''; }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
