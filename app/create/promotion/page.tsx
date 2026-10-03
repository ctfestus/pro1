'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { ImageLibrary } from '@/components/ImageLibrary';
import { LIGHT_C, DARK_C, useC } from '@/lib/theme';
import { motion } from 'motion/react';
import { ArrowLeft, Loader2, Save, Upload, X, Images } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { sanitizePlainText } from '@/lib/sanitize';
import { PROMO_PLACEMENTS, safePromoUrl, type PromoPlacement } from '@/lib/promotions';

// --- Design tokens: standard palette from lib/theme.ts ---

function inputStyle(C: typeof LIGHT_C) {
  return {
    width: '100%', padding: '10px 14px', borderRadius: 10, border: `1px solid ${C.cardBorder}`,
    background: C.input, color: C.text, fontSize: 14, outline: 'none',
    transition: 'border-color 0.15s', boxSizing: 'border-box',
  } as React.CSSProperties;
}
function labelStyle(C: typeof LIGHT_C) {
  return { display: 'block', fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 6 } as React.CSSProperties;
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type AudienceOption = { id: string; name: string; kind: 'bootcamp' | 'plan' };

export default function CreatePromotionPage() {
  const C = useC();
  const isDark = C === DARK_C;
  const router = useRouter();

  const [editId, setEditId]         = useState<string | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');

  const [title, setTitle]           = useState('');
  const [body, setBody]             = useState('');
  const [imageUrl, setImageUrl]     = useState('');
  const [showLibrary, setShowLibrary] = useState(false);
  const [uploading, setUploading]   = useState(false);
  const imageRef = useRef<HTMLInputElement>(null);
  const [ctaLabel, setCtaLabel]     = useState('');
  const [ctaUrl, setCtaUrl]         = useState('');
  const [placements, setPlacements] = useState<PromoPlacement[]>(['landing', 'student', 'course']);
  const [isActive, setIsActive]     = useState(true);
  const [startsAt, setStartsAt]     = useState(() => toDatetimeLocalValue(new Date()));
  const [endsAt, setEndsAt]         = useState('');
  const [audience, setAudience]     = useState<AudienceOption[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);

  const togglePlacement = (id: PromoPlacement) =>
    setPlacements(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleCohort = (id: string) =>
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    setEditId(id);

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { data: profile } = await supabase.from('students').select('role').eq('id', session.user.id).single();
      if (!profile || !['instructor', 'admin'].includes(profile.role)) { router.replace('/dashboard'); return; }

      // Bootcamp intakes, plus subscription plans (each plan has its own access cohort) so a
      // promo can target paying subscribers of one plan.
      const [{ data: cohorts }, { data: plans }] = await Promise.all([
        supabase.from('cohorts').select('id, name, cohort_kind').in('cohort_kind', ['bootcamp', 'subscription_plan']).order('name'),
        supabase.from('subscription_plans').select('name, cohort_id').eq('status', 'active'),
      ]);
      const planNames = new Map((plans ?? []).map((p: any) => [p.cohort_id, p.name]));
      setAudience((cohorts ?? []).flatMap((c: any): AudienceOption[] => {
        if (c.cohort_kind === 'bootcamp') return [{ id: c.id, name: c.name, kind: 'bootcamp' }];
        const planName = planNames.get(c.id);
        return planName ? [{ id: c.id, name: planName, kind: 'plan' }] : [];
      }));

      if (id) {
        const { data } = await supabase.from('promotions').select('*').eq('id', id).single();
        if (data) {
          setTitle(data.title ?? '');
          setBody(data.body ?? '');
          setImageUrl(data.image_url ?? '');
          setCtaLabel(data.cta_label ?? '');
          setCtaUrl(data.cta_url ?? '');
          setPlacements(data.placements ?? []);
          setIsActive(data.is_active ?? true);
          if (data.starts_at) setStartsAt(toDatetimeLocalValue(new Date(data.starts_at)));
          if (data.ends_at) setEndsAt(toDatetimeLocalValue(new Date(data.ends_at)));
          setSelectedCohortIds(data.cohort_ids ?? []);
        }
      }
    };
    init();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (uploading) return;

    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError('Title is required.'); return; }
    if (placements.length === 0) { setError('Pick at least one place to show this promotion.'); return; }
    if (imageUrl.trim() && !safePromoUrl(imageUrl)) { setError('Image must be an https:// link or an image on this site.'); return; }
    if (ctaUrl.trim() && !safePromoUrl(ctaUrl)) { setError('Button link must start with https:// or with / for a page on this site.'); return; }
    if (ctaLabel.trim() && !ctaUrl.trim()) { setError('Add a button link, or clear the button text.'); return; }

    const startDate = new Date(startsAt);
    const endDate   = endsAt ? new Date(endsAt) : null;
    if (Number.isNaN(startDate.getTime())) { setError('Pick a valid start date.'); return; }
    if (endDate && endDate <= startDate) { setError('End date must be after the start date.'); return; }

    setLoading(true);
    try {
      const payload = {
        title: trimmedTitle, body: body.trim() || null,
        image_url: imageUrl.trim() || null,
        cta_label: ctaLabel.trim() || null, cta_url: ctaUrl.trim() || null,
        placements, cohort_ids: selectedCohortIds, is_active: isActive,
        starts_at: startDate.toISOString(), ends_at: endDate ? endDate.toISOString() : null,
      };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { error: e } = editId
        ? await supabase.from('promotions').update(payload).eq('id', editId)
        : await supabase.from('promotions').insert({ ...payload, author_id: session.user.id });
      if (e) throw e;

      router.push('/dashboard#promotions');
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const previewImage = safePromoUrl(imageUrl);

  return (
    <div style={{ minHeight: '100vh', background: C.page }}>
      {/* Sticky header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: C.nav, borderBottom: `1px solid ${C.navBorder}`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      }}>
        <div style={{ maxWidth: 880, margin: '0 auto', padding: '0 16px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <Link href="/dashboard#promotions" style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
            <ArrowLeft style={{ width: 16, height: 16 }}/> Back
          </Link>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: C.text, margin: 0 }}>{editId ? 'Edit Promotion' : 'New Promotion'}</h1>
          <motion.button
            type="submit" form="promotion-form"
            disabled={loading || uploading}
            whileTap={{ scale: 0.96 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 18px', borderRadius: 10, border: 'none', cursor: loading || uploading ? 'not-allowed' : 'pointer',
              background: C.cta, color: C.ctaText, fontSize: 14, fontWeight: 600,
              opacity: loading || uploading ? 0.7 : 1, transition: 'opacity 0.15s',
            }}
          >
            {loading ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin"/> : <Save style={{ width: 15, height: 15 }}/>}
            {loading ? 'Saving...' : 'Save'}
          </motion.button>
        </div>
      </header>

      <main style={{ maxWidth: 880, margin: '0 auto', padding: '32px 16px 80px' }}>
        <form id="promotion-form" onSubmit={handleSubmit} noValidate>

          {error && (
            <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 10, background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}`, fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* Preview: the same layout the card uses on the page */}
          <div style={{ marginBottom: 20 }}>
            <p style={labelStyle(C)}>Preview</p>
            <div style={{ maxWidth: 380, background: C.card, borderRadius: 16, padding: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.12)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {previewImage && (
                <img src={previewImage} alt="" style={{ width: 96, height: 96, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }}
                  onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}/>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text, lineHeight: 1.35 }}>{title.trim() || 'Your promotion title'}</p>
                {body.trim() && <p style={{ margin: '4px 0 0', fontSize: 13, color: C.muted, lineHeight: 1.35 }}>{body}</p>}
                {ctaUrl.trim() && <p style={{ margin: '8px 0 0', fontSize: 13, fontWeight: 600, color: C.cta }}>{ctaLabel.trim() || 'Learn more'}</p>}
              </div>
            </div>
          </div>

          <section style={{ background: C.card, borderRadius: 18, border: isDark ? 'none' : `1px solid ${C.cardBorder}`, boxShadow: C.cardShadow, overflow: 'hidden' }}>

            {/* Section: Content */}
            <div style={{ padding: '26px 20px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 18 }}>Content</h2>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle(C)}>Title <span style={{ color: C.errorText }}>*</span></label>
                <input type="text" value={title} onChange={e => setTitle(sanitizePlainText(e.target.value))}
                  placeholder="e.g. Power BI bootcamp starts next month" style={inputStyle(C)} maxLength={80}/>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle(C)}>Short text <span style={{ color: C.faint, fontWeight: 400 }}>(optional)</span></label>
                <textarea value={body} onChange={e => setBody(sanitizePlainText(e.target.value))}
                  placeholder="One or two sentences. Long text is cut off after three lines."
                  style={{ ...inputStyle(C), minHeight: 80, resize: 'vertical', lineHeight: 1.5 }} maxLength={200}/>
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={labelStyle(C)}>Image <span style={{ color: C.faint, fontWeight: 400 }}>(optional, square works best)</span></label>
                <input ref={imageRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                  const file = e.target.files?.[0]; if (!file) return;
                  setUploading(true);
                  try {
                    setImageUrl(await uploadToCloudinary(file, 'covers'));
                  } catch (err: any) { setError(err?.message || 'Image upload failed.'); }
                  finally { setUploading(false); e.target.value = ''; }
                }}/>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input type="url" value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                    placeholder="https://example.com/image.jpg" style={{ ...inputStyle(C), flex: 1, minWidth: 0 }}/>
                  <button type="button" onClick={() => imageRef.current?.click()} disabled={uploading}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 10, border: 'none', background: C.pill, color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    <Upload style={{ width: 14, height: 14 }}/>{uploading ? 'Uploading...' : 'Upload'}
                  </button>
                  <button type="button" onClick={() => setShowLibrary(true)} title="Select from library"
                    style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderRadius: 10, border: 'none', background: C.pill, color: C.muted, cursor: 'pointer', flexShrink: 0 }}>
                    <Images style={{ width: 14, height: 14 }}/>
                  </button>
                  {imageUrl.trim() && (
                    <button type="button" onClick={() => setImageUrl('')} title="Remove image" aria-label="Remove image"
                      style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderRadius: 10, border: 'none', background: C.pill, color: C.muted, cursor: 'pointer', flexShrink: 0 }}>
                      <X style={{ width: 14, height: 14 }}/>
                    </button>
                  )}
                </div>
                {showLibrary && (
                  <ImageLibrary uploadFolder="covers" initialFolder="covers"
                    onSelect={url => setImageUrl(url)} onClose={() => setShowLibrary(false)}/>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                <div>
                  <label style={labelStyle(C)}>Button text</label>
                  <input type="text" value={ctaLabel} onChange={e => setCtaLabel(sanitizePlainText(e.target.value))}
                    placeholder="e.g. Enrol now" style={inputStyle(C)} maxLength={30}/>
                </div>
                <div>
                  <label style={labelStyle(C)}>Button link</label>
                  <input type="text" value={ctaUrl} onChange={e => setCtaUrl(e.target.value)}
                    placeholder="/pricing or https://..." style={inputStyle(C)}/>
                </div>
              </div>
            </div>

            <div style={{ height: 1, background: C.divider }} />

            {/* Section: Where and when */}
            <div style={{ padding: '26px 20px' }}>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 16 }}>Where it shows</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 22 }}>
                {PROMO_PLACEMENTS.map(p => (
                  <label key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer' }}>
                    <input type="checkbox" checked={placements.includes(p.id)} onChange={() => togglePlacement(p.id)}
                      style={{ width: 16, height: 16, marginTop: 2, accentColor: C.cta, cursor: 'pointer' }}/>
                    <span>
                      <span style={{ display: 'block', fontSize: 14, color: C.text, fontWeight: 600 }}>{p.label}</span>
                      <span style={{ display: 'block', fontSize: 12, color: C.faint }}>{p.hint}</span>
                    </span>
                  </label>
                ))}
              </div>

              {/* Active toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '12px 16px', borderRadius: 10, background: C.input }}>
                <button type="button" onClick={() => setIsActive(a => !a)}
                  style={{ width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', background: isActive ? C.cta : C.faint, position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}
                  aria-checked={isActive} role="switch" aria-label="Promotion is live">
                  <span style={{ position: 'absolute', top: 3, left: isActive ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: 'white', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }}/>
                </button>
                <div>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.text }}>Live</p>
                  <p style={{ margin: 0, fontSize: 12, color: C.faint }}>Turn off to pause it without deleting</p>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                <div>
                  <label style={labelStyle(C)}>Starts</label>
                  <input type="datetime-local" value={startsAt} onChange={e => setStartsAt(e.target.value)} style={inputStyle(C)}/>
                </div>
                <div>
                  <label style={labelStyle(C)}>Ends <span style={{ color: C.faint, fontWeight: 400 }}>(optional)</span></label>
                  <input type="datetime-local" value={endsAt} onChange={e => setEndsAt(e.target.value)} style={inputStyle(C)}/>
                </div>
              </div>
            </div>

            {/* Section: Audience */}
            {audience.length > 0 && (
              <>
                <div style={{ height: 1, background: C.divider }} />
                <div style={{ padding: '26px 20px' }}>
                  <h2 style={{ fontSize: 15, fontWeight: 700, color: C.text, marginTop: 0, marginBottom: 6 }}>Who sees it</h2>
                  <p style={{ margin: '0 0 16px', fontSize: 12, color: C.faint }}>
                    Leave all unticked to show it to everyone, including visitors who are not signed in. Ticking any limits it to students in those cohorts or plans, and it then never shows to signed-out visitors.
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {audience.map(a => (
                      <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selectedCohortIds.includes(a.id)} onChange={() => toggleCohort(a.id)}
                          style={{ width: 16, height: 16, accentColor: C.cta, cursor: 'pointer' }}/>
                        <span style={{ fontSize: 14, color: C.text }}>{a.name}</span>
                        <span style={{ fontSize: 11, color: C.faint }}>{a.kind === 'plan' ? 'Subscription plan' : 'Cohort'}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

          </section>
        </form>
      </main>
    </div>
  );
}
