'use client';

// The admin Badges page: every badge with its image. Achievement badges take an upload here;
// course, path and experience badges get their image from that item's editor.

import { useState, useEffect, useRef, useMemo } from 'react';
import { Award, CheckCircle2, Trash2, Upload, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { PageHeader } from '@/components/dashboard/content/kit';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { Card, Empty, Pill, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';

type Managed = 'course' | 'learning_path' | 'virtual_experience' | null;

const CATEGORY_META = [
  { key: 'course',             label: 'Course',             chip: 'Courses' },
  { key: 'learning_path',      label: 'Learning path',      chip: 'Learning paths' },
  { key: 'virtual_experience', label: 'Virtual experience', chip: 'Experiences' },
  { key: 'achievement',        label: 'Achievement',        chip: 'Achievements' },
] as const;
const MANAGED_LABEL: Record<string, string> = { course: 'course editor', learning_path: 'learning path editor', virtual_experience: 'virtual experience editor' };

export function BadgesSection({ C: theme }: { C: ThemeColors }) {
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
  const [badges, setBadges] = useState<{ id: string; name: string; description: string; icon: string; image_url: string | null; category: string; managed: Managed }[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [removing, setRemoving]   = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
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
        .map((b: any) => ({ ...b, managed: null as Managed }));
      const content = [
        ...(courses ?? []).map((c: any) => ({ id: `crs_${c.id}`, name: `${c.title} Badge`, description: `Awarded for completing ${c.title}`, icon: '', image_url: c.badge_image_url, category: 'course', managed: 'course' as const })),
        ...(paths ?? []).map((p: any) => ({ id: `lp_${p.id}`, name: `${p.title} Badge`, description: `Awarded for completing ${p.title}`, icon: '', image_url: p.badge_image_url, category: 'learning_path', managed: 'learning_path' as const })),
        ...(ves ?? []).map((v: any) => ({ id: `ve_${v.id}`, name: `${v.title} Badge`, description: `Awarded for completing ${v.title}`, icon: '', image_url: v.badge_image_url, category: 'virtual_experience', managed: 'virtual_experience' as const })),
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

  const cats = CATEGORY_META.filter(m => badges.some(b => b.category === m.key));
  const term = search.trim().toLowerCase();
  const visible = badges.filter(b =>
    (category === 'all' || b.category === category)
    && (!term || `${b.name} ${b.description ?? ''}`.toLowerCase().includes(term)));
  const chip = (on: boolean) => on ? { background: P.sel, color: P.onSel } : { background: C.card, color: C.muted, boxShadow: `inset 0 0 0 1px ${C.divider}` };

  return (
    <div className="space-y-5 pb-12">
      <PageHeader C={C} title="Badges" sub="The image each badge shows. Without one, the default icon is used." actions={null} />

      {msg && (
        <div role={msg.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={msg.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          {msg.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          {msg.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Search badges" C={C} />
        {cats.length > 1 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by badge type">
            {[{ key: 'all', chip: 'All' }, ...cats].map(m => (
              <button key={m.key} type="button" aria-pressed={category === m.key} onClick={() => setCategory(m.key)} className="h-8 px-3 rounded-full text-xs font-semibold" style={chip(category === m.key)}>
                {m.chip}
              </button>
            ))}
          </div>
        )}
      </div>

      <Card C={C} className="overflow-hidden">
        {visible.length === 0 ? (
          <Empty C={C} title={badges.length ? 'No badges match these filters.' : 'No badges yet.'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>{['Badge', 'For', ''].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {visible.map(badge => {
                  const isUp  = uploading === badge.id;
                  const isRem = removing  === badge.id;
                  return (
                    <tr key={badge.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex-shrink-0 w-11 h-11 rounded-xl grid place-items-center overflow-hidden" style={{ background: badge.image_url ? 'transparent' : C.pill }}>
                            {badge.image_url
                              ? <img src={badge.image_url} alt={badge.name} className="w-full h-full object-cover" />
                              : badge.icon ? <span className="text-xl">{badge.icon}</span> : <Award className="w-5 h-5" style={{ color: C.muted }} />}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold truncate" style={{ color: C.text }}>{badge.name}</p>
                            <p className="text-xs line-clamp-1" style={{ color: C.muted }}>{badge.description}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><Pill tone="mute" C={C}>{CATEGORY_META.find(m => m.key === badge.category)?.label ?? 'Achievement'}</Pill></td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {badge.managed ? (
                          <span className="text-xs" style={{ color: C.muted }}>Managed in the {MANAGED_LABEL[badge.managed]}</span>
                        ) : (
                          <div className="inline-flex items-center gap-2">
                            {badge.image_url && (
                              <button type="button" onClick={() => handleRemove(badge)} disabled={isRem || isUp} className={btnSmClass} style={btnStyle('danger', C)}>
                                <Trash2 className="w-3.5 h-3.5" /> {isRem ? 'Removing...' : 'Remove'}
                              </button>
                            )}
                            <button type="button" onClick={() => fileRefs.current[badge.id]?.click()} disabled={isUp || isRem} className={btnSmClass} style={btnStyle('sec', C)}>
                              <Upload className="w-3.5 h-3.5" />
                              {isUp ? 'Uploading...' : badge.image_url ? 'Change image' : 'Upload image'}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
