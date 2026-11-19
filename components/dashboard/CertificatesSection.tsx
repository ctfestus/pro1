'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useRef } from 'react';
import { Check, CheckCircle2, Loader2, Trash2, Upload, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import CertificateTemplate, { CertificateSettings, DEFAULT_CERT_SETTINGS, TextPositions, defaultTextPositions, type PartnerAttributionLayout } from '@/components/CertificateTemplate';
import { LIGHT_C, cardStyle } from '@/lib/theme';

const CERT_W = 1860;
const CERT_H = 1200;
const SAMPLE_PARTNER_LOGO = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 rx=%2220%22 fill=%22%230ea5e9%22/%3E%3Ctext x=%2250%22 y=%2264%22 text-anchor=%22middle%22 font-family=%22Arial%22 font-size=%2252%22 font-weight=%22700%22 fill=%22white%22%3EP%3C/text%3E%3C/svg%3E';


export function CertificatesSection({ C }: { C: typeof LIGHT_C }) {
  const [user, setUser]           = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [saveMsg, setSaveMsg]     = useState<{ ok: boolean; msg: string } | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [settings, setSettings]   = useState<CertificateSettings>(DEFAULT_CERT_SETTINGS);
  // Which design is being edited: 'default' (courses / VEs / paths) or 'certification'.
  const [contentType, setContentType] = useState<'default' | 'certification'>('default');
  const [selectedElement, setSelectedElement] = useState<keyof TextPositions | null>(null);
  const [previewScale, setPreviewScale] = useState(1);
  const previewWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = previewWrapRef.current;
    if (!el) return;
    const update = () => setPreviewScale(el.getBoundingClientRect().width / CERT_W);
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [loading]);
  const bgRef  = useRef<HTMLInputElement>(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const sigRef  = useRef<HTMLInputElement>(null);
  const set = <K extends keyof CertificateSettings>(k: K, v: CertificateSettings[K]) =>
    setSettings(prev => ({ ...prev, [k]: v }));

  const setPos = (key: keyof TextPositions, axis: 'x' | 'y', val: number) =>
    setSettings(prev => {
      const base = {
        ...defaultTextPositions(prev.paddingTop, prev.paddingLeft, prev.headingSize),
        ...(prev.textPositions ?? {}),
      };
      const current = base[key] ?? { x: 0, y: 0 };
      return {
        ...prev,
        textPositions: {
          ...prev.textPositions,
          [key]: { ...current, [axis]: val },
        },
      };
    });
  const setPartnerLayout = <K extends keyof PartnerAttributionLayout>(
    key: K,
    value: PartnerAttributionLayout[K],
  ) => setSettings(prev => {
    const resolved = {
      ...defaultTextPositions(prev.paddingTop, prev.paddingLeft, prev.headingSize),
      ...(prev.textPositions ?? {}),
    };
    return {
      ...prev,
      textPositions: {
        ...prev.textPositions,
        partnerAttribution: {
          ...resolved.partnerAttribution,
          [key]: value,
        },
      },
    };
  });



  const applySettingsData = (data: any) => {
    setSettings(data ? {
      institutionName:    data.institution_name    ?? DEFAULT_CERT_SETTINGS.institutionName,
      primaryColor:       data.primary_color       ?? DEFAULT_CERT_SETTINGS.primaryColor,
      accentColor:        data.accent_color        ?? DEFAULT_CERT_SETTINGS.accentColor,
      backgroundImageUrl: data.background_image_url ?? null,
      logoUrl:            data.logo_url            ?? null,
      signatureUrl:       data.signature_url       ?? null,
      signatoryName:      data.signatory_name      ?? DEFAULT_CERT_SETTINGS.signatoryName,
      signatoryTitle:     data.signatory_title     ?? DEFAULT_CERT_SETTINGS.signatoryTitle,
      headerText:         data.header_text         ?? DEFAULT_CERT_SETTINGS.headerText,
      certifyText:        data.certify_text        ?? DEFAULT_CERT_SETTINGS.certifyText,
      completionText:     data.completion_text     ?? DEFAULT_CERT_SETTINGS.completionText,
      fontFamily:         (data.font_family        ?? DEFAULT_CERT_SETTINGS.fontFamily) as CertificateSettings['fontFamily'],
      headingSize:        (data.heading_size       ?? DEFAULT_CERT_SETTINGS.headingSize) as CertificateSettings['headingSize'],
      paddingTop:         data.padding_top         ?? DEFAULT_CERT_SETTINGS.paddingTop,
      paddingLeft:        data.padding_left        ?? DEFAULT_CERT_SETTINGS.paddingLeft,
      lineSpacing:        (data.line_spacing       ?? DEFAULT_CERT_SETTINGS.lineSpacing) as CertificateSettings['lineSpacing'],
      alignment:          (data.alignment          ?? DEFAULT_CERT_SETTINGS.alignment) as CertificateSettings['alignment'],
      textPositions:      data.text_positions      ?? undefined,
    } : DEFAULT_CERT_SETTINGS);
  };

  const fetchSettings = async (ct: 'default' | 'certification') => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/certificate-defaults?content_type=${ct}`, {
      headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    if (res.ok) { const { data } = await res.json(); applySettingsData(data); }
  };

  // Switch which design is being edited; loads that type (certification seeds from the default
  // design the first time, matching how the certificate renders).
  const switchType = async (ct: 'default' | 'certification') => {
    if (ct === contentType) return;
    setContentType(ct);
    setSaveMsg(null);
    await fetchSettings(ct);
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUser(user);
      await fetchSettings('default');
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadImage = async (slot: 'background' | 'logo' | 'signature', file: File) => {
    if (!user || !file.type.startsWith('image/')) return;
    setUploading(slot);
    setSaveMsg(null);
    try {
      const url = await uploadToCloudinary(file, 'cert-assets');
      const key = slot === 'background' ? 'backgroundImageUrl' : slot === 'logo' ? 'logoUrl' : 'signatureUrl';
      set(key, url);
    } catch (err: any) {
      setSaveMsg({ ok: false, msg: `Image upload failed: ${err.message}` });
    }
    setUploading(null);
  };

  const save = async () => {
    if (!user) return;
    setSaving(true); setSaveMsg(null);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/certificate-defaults', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ ...settings, contentType }),
    });
    const json = await res.json();
    if (!res.ok) {
      console.error('[cert save]', json.error);
      setSaveMsg({ ok: false, msg: `Save failed: ${json.error}` });
    } else {
      setSaveMsg({ ok: true, msg: 'Certificate default saved.' });
    }
    setSaving(false);
  };

  const inputCls = `w-full rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors`;
  const inputStyle = { background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text };
  const labelCls  = `text-xs font-medium mb-2 block`;

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }}/></div>;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 space-y-4" style={{ ...cardStyle(C) }}>
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Certificate Design</h2>
        {/* Design a separate certificate for certifications, distinct from courses/VEs/paths. */}
        <div className="flex gap-2">
          {([['default', 'Courses & paths'], ['certification', 'Certifications']] as const).map(([ct, label]) => (
            <button key={ct} onClick={() => switchType(ct)} disabled={saving}
              className="px-4 py-2 rounded-full text-xs font-medium transition-colors"
              style={contentType === ct
                ? { background: C.cta, color: C.ctaText ?? '#ffffff' }
                : { background: C.input, color: C.muted, border: `1px solid ${C.cardBorder}` }}>
              {label}
            </button>
          ))}
        </div>
        <p className="text-xs" style={{ color: C.muted }}>
          {contentType === 'certification'
            ? 'Design the certificate awarded for certifications. It starts from your default design; customize it to make certification certificates distinct.'
            : 'Set once. All your courses, virtual experiences and learning paths inherit this design automatically.'}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: C.muted }}>Alignment</span>
          {([['left', 'Left'], ['center', 'Centered']] as const).map(([al, label]) => (
            <button key={al} onClick={() => set('alignment', al)}
              className="px-3 py-2 rounded-full text-xs font-medium transition-colors"
              style={(settings.alignment ?? 'left') === al
                ? { background: C.cta, color: C.ctaText ?? '#ffffff' }
                : { background: C.input, color: C.muted, border: `1px solid ${C.cardBorder}` }}>
              {label}
            </button>
          ))}
        </div>
        <div>
          <label className={labelCls} style={{ color: C.muted }}>Institution Name</label>
          <input value={settings.institutionName} onChange={e => set('institutionName', e.target.value)} placeholder="Your institution name" className={inputCls} style={inputStyle}/>
        </div>
        <div>
          <label className={labelCls} style={{ color: C.muted }}>Header text</label>
          <input value={settings.headerText ?? ''} onChange={e => set('headerText', e.target.value)} placeholder="Certificate of Completion" className={inputCls} style={inputStyle}/>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={{ color: C.muted }}>Primary Color</label>
            <div className="flex gap-2">
              <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0" style={{ border: `1px solid ${C.cardBorder}` }}>
                <input type="color" value={settings.primaryColor} onChange={e => set('primaryColor', e.target.value)}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}/>
                <div className="w-full h-full" style={{ background: settings.primaryColor }}/>
              </div>
              <input value={settings.primaryColor} onChange={e => set('primaryColor', e.target.value)} maxLength={7} className={`flex-1 rounded-xl px-3 py-3 text-sm font-mono focus:outline-none`} style={inputStyle}/>
            </div>
          </div>
          <div>
            <label className={labelCls} style={{ color: C.muted }}>Accent Color</label>
            <div className="flex gap-2">
              <div className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0" style={{ border: `1px solid ${C.cardBorder}` }}>
                <input type="color" value={settings.accentColor} onChange={e => set('accentColor', e.target.value)}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}/>
                <div className="w-full h-full" style={{ background: settings.accentColor }}/>
              </div>
              <input value={settings.accentColor} onChange={e => set('accentColor', e.target.value)} maxLength={7} className={`flex-1 rounded-xl px-3 py-3 text-sm font-mono focus:outline-none`} style={inputStyle}/>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={{ color: C.muted }}>Certify Text</label>
            <input value={settings.certifyText} onChange={e => set('certifyText', e.target.value)} className={inputCls} style={inputStyle}/>
          </div>
          <div>
            <label className={labelCls} style={{ color: C.muted }}>Completion Text</label>
            <input value={settings.completionText} onChange={e => set('completionText', e.target.value)} className={inputCls} style={inputStyle}/>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={{ color: C.muted }}>Signatory Name</label>
            <input value={settings.signatoryName} onChange={e => set('signatoryName', e.target.value)} placeholder="Dr. Jane Smith" className={inputCls} style={inputStyle}/>
          </div>
          <div>
            <label className={labelCls} style={{ color: C.muted }}>Signatory Title</label>
            <input value={settings.signatoryTitle} onChange={e => set('signatoryTitle', e.target.value)} placeholder="Program Director" className={inputCls} style={inputStyle}/>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} style={{ color: C.muted }}>Font Family</label>
            <select value={settings.fontFamily} onChange={e => set('fontFamily', e.target.value as CertificateSettings['fontFamily'])} className={inputCls} style={{ ...inputStyle, appearance: 'auto' }}>
              <option value="serif">Serif (Georgia)</option>
              <option value="sans-serif">Sans-serif (Inter)</option>
              <option value="lato">Lato</option>
              <option value="source-sans-pro">Source Sans Pro</option>
              <option value="google-sans-text">Google Sans Text</option>
              <option value="script">Script</option>
            </select>
          </div>
          <div>
            <label className={labelCls} style={{ color: C.muted }}>Name Size</label>
            <select value={settings.headingSize} onChange={e => set('headingSize', e.target.value as CertificateSettings['headingSize'])} className={inputCls} style={{ ...inputStyle, appearance: 'auto' }}>
              <option value="sm">Small</option>
              <option value="md">Medium</option>
              <option value="lg">Large</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <label className={labelCls} style={{ color: C.muted }}>Images</label>
          {(['background', 'logo', 'signature'] as const).map(slot => {
            const labels = { background: 'Background', logo: 'Logo / Seal', signature: 'Signature' };
            const urlKey = slot === 'background' ? 'backgroundImageUrl' : slot === 'logo' ? 'logoUrl' : 'signatureUrl';
            const ref    = slot === 'background' ? bgRef : slot === 'logo' ? logoRef : sigRef;
            const url    = settings[urlKey] as string | null | undefined;
            return (
              <div key={slot} className="flex items-center gap-3">
                <input ref={ref} type="file" accept="image/*" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(slot, f); e.target.value = ''; }}/>
                <button onClick={() => ref.current?.click()} disabled={!!uploading}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ border: 'none', color: C.muted, background: C.pill }}>
                  {uploading === slot ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
                  {url ? `Replace ${labels[slot]}` : `Upload ${labels[slot]}`}
                </button>
                {url && (
                  <button onClick={() => set(urlKey as any, null)} className="p-2 rounded-lg" style={{ color: C.faint }}>
                    <Trash2 className="w-3.5 h-3.5"/>
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {/* Text Layout */}
        {(() => {
          const resolved = {
            ...defaultTextPositions(settings.paddingTop, settings.paddingLeft, settings.headingSize),
            ...(settings.textPositions ?? {}),
          } as Required<TextPositions>;

          const ELEMENTS: { key: keyof TextPositions; label: string; color: string }[] = [
            { key: 'institutionName', label: 'Institution Name',            color: '#f59e0b' },
            ...(contentType === 'default' ? [{ key: 'partnerAttribution' as const, label: 'Partner Attribution', color: '#0ea5e9' }] : []),
            { key: 'header',         label: 'Certificate of Completion',    color: '#10b981' },
            { key: 'certifyText',    label: 'Certify Text',                 color: '#6366f1' },
            { key: 'studentName',    label: 'Student Name',                 color: '#ef4444' },
            { key: 'completionText', label: 'Completion Text',              color: '#ec4899' },
            { key: 'courseName',     label: 'Course Title',                 color: '#3b82f6' },
            { key: 'issueDate',      label: 'Issue Date',                   color: '#14b8a6' },
            { key: 'certificateId',  label: 'Certificate ID',               color: '#a855f7' },
            { key: 'signatory',      label: 'Signatory',                    color: '#f97316' },
          ];

          return (
            <div className="border-t pt-4 space-y-3" style={{ borderColor: C.divider }}>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Text Layout</h3>
                <p className="text-xs mt-1" style={{ color: C.muted }}>Select an element, then click on the preview to place it. Or type exact pixel values.</p>
              </div>
              <div className="space-y-2">
                {ELEMENTS.map(({ key, label, color }) => (
                  <div key={key}
                    onClick={() => setSelectedElement(selectedElement === key ? null : key)}
                    className="grid grid-cols-[12px_1fr_88px_88px] items-center gap-2 px-2 py-2 rounded-lg cursor-pointer transition-colors"
                    style={{ background: selectedElement === key ? `${color}18` : 'transparent', border: `1px solid ${selectedElement === key ? color : 'transparent'}` }}>
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: color }}/>
                    <span className="text-xs font-medium truncate" style={{ color: selectedElement === key ? color : C.muted }}>{label}</span>
                    <input
                      type="number" min={0} max={1860}
                      value={resolved[key].x}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setPos(key, 'x', Number(e.target.value))}
                      className="w-full rounded-lg px-2 py-1 text-xs font-mono focus:outline-none"
                      style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}
                    />
                    <input
                      type="number" min={0} max={1200}
                      value={resolved[key].y}
                      onClick={e => e.stopPropagation()}
                      onChange={e => setPos(key, 'y', Number(e.target.value))}
                      className="w-full rounded-lg px-2 py-1 text-xs font-mono focus:outline-none"
                      style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}
                    />
                  </div>
                ))}
              </div>
              {contentType === 'default' && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl p-3" style={{ background: C.input }}>
                  <div>
                    <label className={labelCls} style={{ color: C.muted }}>Partner layout</label>
                    <select
                      value={resolved.partnerAttribution.direction ?? 'horizontal'}
                      onChange={e => setPartnerLayout('direction', e.target.value as PartnerAttributionLayout['direction'])}
                      className="w-full rounded-lg px-2 py-2 text-xs"
                      style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.text }}
                    >
                      <option value="horizontal">Horizontal</option>
                      <option value="vertical">Vertical</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls} style={{ color: C.muted }}>Partner logo height</label>
                    <input
                      type="number" min={24} max={240}
                      value={resolved.partnerAttribution.logoHeight ?? 90}
                      onChange={e => setPartnerLayout('logoHeight', Math.max(24, Math.min(240, Number(e.target.value))))}
                      className="w-full rounded-lg px-2 py-2 text-xs font-mono"
                      style={{ background: C.card, border: `1px solid ${C.cardBorder}`, color: C.text }}
                    />
                  </div>
                  <label className="flex items-center gap-2 self-end min-h-8 text-xs" style={{ color: C.muted }}>
                    <input
                      type="checkbox"
                      checked={resolved.partnerAttribution.showLabel !== false}
                      onChange={e => setPartnerLayout('showLabel', e.target.checked)}
                    />
                    Show &quot;Offered by&quot;
                  </label>
                  <p className="sm:col-span-3 text-[11px]" style={{ color: C.faint }}>
                    The sample partner in the preview is replaced automatically by each course&apos;s selected partner.
                  </p>
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <div className="flex gap-2 text-[11px]" style={{ color: C.faint }}>
                  <span className="font-mono px-2 py-0.5 rounded" style={{ background: C.pill }}>X</span> left 
                  <span className="font-mono px-2 py-0.5 rounded ml-2" style={{ background: C.pill }}>Y</span> top 
                </div>
                <button
                  onClick={() => { setSettings(prev => ({ ...prev, textPositions: undefined })); setSelectedElement(null); }}
                  className="ml-auto text-xs px-3 py-2 rounded-lg transition-opacity hover:opacity-70"
                  style={{ color: C.faint, border: `1px solid ${C.cardBorder}` }}>
                  Reset to defaults
                </button>
              </div>
            </div>
          );
        })()}

        {saveMsg && (
          <div className={`flex items-center gap-2 text-sm ${saveMsg.ok ? 'text-emerald-500' : 'text-red-500'}`}>
            {saveMsg.ok ? <CheckCircle2 className="w-4 h-4"/> : <XCircle className="w-4 h-4"/>} {saveMsg.msg}
          </div>
        )}
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-60"
          style={{ background: C.cta, color: C.ctaText }}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
          {saving ? 'Saving…' : 'Save as default'}
        </button>
      </div>

      {/* Interactive Preview */}
      {(() => {
        const resolved = {
          ...defaultTextPositions(settings.paddingTop, settings.paddingLeft, settings.headingSize),
          ...(settings.textPositions ?? {}),
        } as Required<TextPositions>;

        const ELEMENT_COLORS: Partial<Record<keyof TextPositions, string>> = {
          institutionName: '#f59e0b', header: '#10b981', certifyText: '#6366f1',
          studentName: '#ef4444', completionText: '#ec4899', courseName: '#3b82f6',
          issueDate: '#14b8a6', certificateId: '#a855f7', signatory: '#f97316',
          ...(contentType === 'default' ? { partnerAttribution: '#0ea5e9' } : {}),
        };

        const handlePreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
          if (!selectedElement || !previewWrapRef.current) return;
          const rect = previewWrapRef.current.getBoundingClientRect();
          const certX = Math.round((e.clientX - rect.left) / previewScale);
          const certY = Math.round((e.clientY - rect.top)  / previewScale);
          setSettings(prev => {
            const base = {
              ...defaultTextPositions(prev.paddingTop, prev.paddingLeft, prev.headingSize),
              ...(prev.textPositions ?? {}),
            };
            const current = base[selectedElement] ?? { x: 0, y: 0 };
            return {
              ...prev,
              textPositions: {
                ...prev.textPositions,
                [selectedElement]: { ...current, x: certX, y: certY },
              },
            };
          });
        };

        return (
          <div className="rounded-2xl overflow-hidden" style={{ ...cardStyle(C) }}>
            <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: C.divider }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>Preview</p>
              {selectedElement && (
                <p className="text-xs font-medium" style={{ color: ELEMENT_COLORS[selectedElement] }}>
                  Click to place <span className="font-semibold">{selectedElement}</span>
                </p>
              )}
            </div>
            {/* Same presentation as student certificate page */}
            <div style={{ background: '#F9FAFB', padding: '32px', display: 'flex', justifyContent: 'center' }}>
              <div
                ref={previewWrapRef}
                onClick={handlePreviewClick}
                style={{
                  width: '100%',
                  height: previewScale > 0 ? Math.round(CERT_H * previewScale) : 'auto',
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: '10px',
                  boxShadow: '0 8px 40px rgba(0,0,0,0.16)',
                  cursor: selectedElement ? 'crosshair' : 'default',
                  flexShrink: 0,
                }}>
                {/* Certificate scaled to fit */}
                <div style={{ width: CERT_W, height: CERT_H, transform: `scale(${previewScale})`, transformOrigin: 'top left', pointerEvents: 'none' }}>
                  <CertificateTemplate
                    settings={settings}
                    studentName="Sample Student"
                    courseName="Sample Course"
                    issueDate={new Date().toLocaleDateString()}
                    partnerName={contentType === 'default' ? 'Sample Partner' : null}
                    partnerLogoUrl={contentType === 'default' ? SAMPLE_PARTNER_LOGO : null}
                  />
                </div>
                {/* Dots overlaid at scaled coordinates */}
                {Object.entries(ELEMENT_COLORS).map(([key, color]) => {
                  const p = resolved[key as keyof TextPositions];
                  if (!p) return null;
                  const isSelected = selectedElement === key;
                  return (
                    <div key={key} style={{
                      position: 'absolute',
                      left: p.x * previewScale,
                      top:  p.y * previewScale,
                      width: isSelected ? 14 : 10,
                      height: isSelected ? 14 : 10,
                      borderRadius: '50%',
                      background: color,
                      border: '2px solid white',
                      transform: 'translate(-50%, -50%)',
                      boxShadow: isSelected ? `0 0 0 3px ${color}55` : '0 1px 4px rgba(0,0,0,0.5)',
                      zIndex: 50,
                      pointerEvents: 'none',
                      transition: 'all 0.15s',
                    }}/>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
