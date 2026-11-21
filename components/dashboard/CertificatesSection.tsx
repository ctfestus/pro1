'use client';

// The admin Certificates page: the certificate design for courses and paths, and a separate one
// for certifications, with a preview where each text element can be placed by clicking.

import { useState, useEffect, useRef, useMemo } from 'react';
import { CheckCircle2, Loader2, Trash2, Upload, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import CertificateTemplate, { CertificateSettings, DEFAULT_CERT_SETTINGS, TextPositions, defaultTextPositions, type PartnerAttributionLayout } from '@/components/CertificateTemplate';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { MenuSelect } from '@/components/MenuSelect';
import { PageHeader } from '@/components/dashboard/content/kit';
import { Tick } from '@/components/dashboard/cohorts/CohortModals';
import { FIELD, NUMBER_FIELD, inputStyle } from '@/components/dashboard/subscriptions/Modal';
import { Card, btnClass, btnSmClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';
import { Hint, Label, Sect } from '@/components/create/EditorKit';

const CERT_W = 1860;
const CERT_H = 1200;
const SAMPLE_PARTNER_LOGO = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22 viewBox=%220 0 100 100%22%3E%3Crect width=%22100%22 height=%22100%22 rx=%2220%22 fill=%22%230ea5e9%22/%3E%3Ctext x=%2250%22 y=%2264%22 text-anchor=%22middle%22 font-family=%22Arial%22 font-size=%2252%22 font-weight=%22700%22 fill=%22white%22%3EP%3C/text%3E%3C/svg%3E';

// Each text element's marker colour, in the layout list and on the preview.
const ELEMENT_COLORS: Record<keyof TextPositions, string> = {
  institutionName: '#f59e0b', partnerAttribution: '#0ea5e9', header: '#10b981', certifyText: '#64748b',
  studentName: '#ef4444', completionText: '#ec4899', courseName: '#3b82f6',
  issueDate: '#14b8a6', certificateId: '#78716c', signatory: '#f97316',
};
const ELEMENT_LABELS: Record<keyof TextPositions, string> = {
  institutionName: 'Institution name', partnerAttribution: 'Partner attribution', header: 'Header text', certifyText: 'Certify text',
  studentName: 'Student name', completionText: 'Completion text', courseName: 'Course title',
  issueDate: 'Issue date', certificateId: 'Certificate ID', signatory: 'Signatory',
};
const FONTS: { value: CertificateSettings['fontFamily']; label: string }[] = [
  { value: 'serif', label: 'Serif (Georgia)' },
  { value: 'sans-serif', label: 'Sans-serif (Inter)' },
  { value: 'lato', label: 'Lato' },
  { value: 'source-sans-pro', label: 'Source Sans Pro' },
  { value: 'google-sans-text', label: 'Google Sans Text' },
  { value: 'script', label: 'Script' },
];

export function CertificatesSection({ C: theme }: { C: ThemeColors }) {
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const P = palette(C);
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

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }}/></div>;

  const resolved = {
    ...defaultTextPositions(settings.paddingTop, settings.paddingLeft, settings.headingSize),
    ...(settings.textPositions ?? {}),
  } as Required<TextPositions>;
  // Partner attribution only appears on course and path certificates.
  const elements = (Object.keys(ELEMENT_LABELS) as (keyof TextPositions)[])
    .filter(key => key !== 'partnerAttribution' || contentType === 'default');

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

  const textField = (label: string, key: 'institutionName' | 'headerText' | 'certifyText' | 'completionText' | 'signatoryName' | 'signatoryTitle', placeholder?: string) => (
    <div>
      <Label C={C}>{label}</Label>
      <input value={settings[key] ?? ''} onChange={e => set(key, e.target.value)} placeholder={placeholder} className={FIELD} style={inputStyle(C)}/>
    </div>
  );
  const colourField = (label: string, key: 'primaryColor' | 'accentColor') => (
    <div>
      <Label C={C}>{label}</Label>
      <div className="flex gap-2">
        <div className="relative w-11 rounded-[10px] overflow-hidden flex-shrink-0" style={{ border: `1px solid ${C.inputBorder}` }}>
          <input type="color" value={settings[key]} onChange={e => set(key, e.target.value)} aria-label={`${label} picker`}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}/>
          <div className="w-full h-full" style={{ background: settings[key] }}/>
        </div>
        <input value={settings[key]} onChange={e => set(key, e.target.value)} maxLength={7} aria-label={label} className={`${FIELD} font-mono`} style={inputStyle(C)}/>
      </div>
    </div>
  );
  // Small fields inside the layout rows; on the card colour so they never sit grey on grey.
  const smallField = 'field-focus w-full rounded-lg px-2 py-1.5 text-xs font-mono outline-none';
  const smallStyle = { background: C.card, color: C.text, border: `1px solid ${C.inputBorder}` };

  return (
    <div className="space-y-5 pb-12">
      <PageHeader C={C} title="Certificates"
        sub={contentType === 'certification'
          ? 'The certificate awarded for certifications. It starts from your default design; change it to make certification certificates distinct.'
          : 'One design for every certificate. Courses, experiences and learning paths use it automatically.'}
        actions={
          <button type="button" onClick={save} disabled={saving} className={btnClass} style={btnStyle('pri', C)}>
            {saving && <Loader2 className="w-4 h-4 animate-spin"/>}
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        } />

      {/* Design a separate certificate for certifications, distinct from courses/VEs/paths. */}
      <div role="tablist" aria-label="Certificate design" className="inline-flex max-w-full gap-1 p-1 rounded-[14px] overflow-x-auto" style={{ background: C.card }}>
        {([['default', 'Courses and paths'], ['certification', 'Certifications']] as const).map(([ct, label]) => (
          <button key={ct} type="button" role="tab" aria-selected={contentType === ct} onClick={() => switchType(ct)} disabled={saving}
            className="h-9 px-3 sm:px-4 rounded-[10px] text-[13px] font-semibold whitespace-nowrap"
            style={contentType === ct ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
            {label}
          </button>
        ))}
      </div>

      {saveMsg && (
        <div role={saveMsg.ok ? 'status' : 'alert'} className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3"
          style={saveMsg.ok ? { background: C.successBg, color: C.successText, border: `1px solid ${C.successBorder}` } : { background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
          {saveMsg.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0"/> : <XCircle className="w-4 h-4 flex-shrink-0"/>}
          {saveMsg.msg}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <Card C={C} className="min-w-0">
          <Sect C={C} first title="Text">
            <div className="grid sm:grid-cols-2 gap-3">
              {textField('Institution name', 'institutionName', 'Your institution name')}
              {textField('Header text', 'headerText', 'Certificate of Completion')}
              {textField('Certify text', 'certifyText')}
              {textField('Completion text', 'completionText')}
            </div>
          </Sect>

          <Sect C={C} title="Signatory">
            <div className="grid sm:grid-cols-2 gap-3">
              {textField('Name', 'signatoryName', 'Dr. Jane Smith')}
              {textField('Title', 'signatoryTitle', 'Program Director')}
            </div>
          </Sect>

          <Sect C={C} title="Look">
            <div className="grid sm:grid-cols-2 gap-3">
              {colourField('Primary colour', 'primaryColor')}
              {colourField('Accent colour', 'accentColor')}
              <div>
                <Label C={C}>Font</Label>
                <MenuSelect field label="Font" value={settings.fontFamily} options={FONTS} onChange={v => set('fontFamily', v)} C={C}/>
              </div>
              <div>
                <Label C={C}>Name size</Label>
                <MenuSelect field label="Name size" value={settings.headingSize} onChange={v => set('headingSize', v)} C={C}
                  options={[{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Medium' }, { value: 'lg', label: 'Large' }]}/>
              </div>
            </div>
            <div>
              <Label C={C}>Alignment</Label>
              <div role="group" aria-label="Alignment" className="inline-flex gap-1 p-1 rounded-[14px]" style={{ background: C.pill }}>
                {([['left', 'Left'], ['center', 'Centred']] as const).map(([al, label]) => {
                  const on = (settings.alignment ?? 'left') === al;
                  return (
                    <button key={al} type="button" aria-pressed={on} onClick={() => set('alignment', al)}
                      className="h-8 px-4 rounded-[10px] text-[13px] font-semibold"
                      style={on ? { background: P.sel, color: P.onSel } : { color: C.muted }}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </Sect>

          <Sect C={C} title="Images">
            <div className="flex flex-wrap gap-2">
              {(['background', 'logo', 'signature'] as const).map(slot => {
                const labels = { background: 'background', logo: 'logo or seal', signature: 'signature' };
                const urlKey = slot === 'background' ? 'backgroundImageUrl' : slot === 'logo' ? 'logoUrl' : 'signatureUrl';
                const ref    = slot === 'background' ? bgRef : slot === 'logo' ? logoRef : sigRef;
                const url    = settings[urlKey] as string | null | undefined;
                return (
                  <div key={slot} className="inline-flex items-center gap-1">
                    <input ref={ref} type="file" accept="image/*" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) uploadImage(slot, f); e.target.value = ''; }}/>
                    <button type="button" onClick={() => ref.current?.click()} disabled={!!uploading} className={btnSmClass} style={btnStyle('sec', C)}>
                      {uploading === slot ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Upload className="w-3.5 h-3.5"/>}
                      {url ? `Replace ${labels[slot]}` : `Upload ${labels[slot]}`}
                    </button>
                    {url && (
                      <button type="button" onClick={() => set(urlKey, null)} aria-label={`Remove ${labels[slot]}`} className="w-8 h-8 rounded-[10px] grid place-items-center" style={{ color: C.muted }}>
                        <Trash2 className="w-3.5 h-3.5"/>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </Sect>

          <Sect C={C} title="Text layout"
            action={
              <button type="button" onClick={() => { setSettings(prev => ({ ...prev, textPositions: undefined })); setSelectedElement(null); }} className={btnSmClass} style={btnStyle('sec', C)}>
                Reset to defaults
              </button>
            }>
            <p className="text-xs -mt-2" style={{ color: C.muted }}>Select an element, then click on the preview to place it, or type exact pixel values. X is from the left, Y from the top.</p>
            <div className="grid gap-1">
              <div className="grid grid-cols-[12px_minmax(0,1fr)_72px_72px] gap-2 px-2 text-xs font-semibold" style={{ color: C.faint }}>
                <span/><span>Element</span><span>X</span><span>Y</span>
              </div>
              {elements.map(key => {
                const on = selectedElement === key;
                return (
                  <div key={key} role="button" tabIndex={0} aria-pressed={on}
                    onClick={() => setSelectedElement(on ? null : key)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedElement(on ? null : key); } }}
                    className="grid grid-cols-[12px_minmax(0,1fr)_72px_72px] items-center gap-2 px-2 py-1.5 rounded-[10px] cursor-pointer"
                    style={on ? { background: C.page, boxShadow: `inset 0 0 0 2px ${P.sel}` } : undefined}>
                    <span className="w-3 h-3 rounded-full" style={{ background: ELEMENT_COLORS[key] }}/>
                    <span className="text-sm truncate" style={{ color: C.text, fontWeight: on ? 600 : 400 }}>{ELEMENT_LABELS[key]}</span>
                    <input type="number" min={0} max={1860} value={resolved[key].x} aria-label={`${ELEMENT_LABELS[key]} X`}
                      onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                      onChange={e => setPos(key, 'x', Number(e.target.value))} className={smallField} style={smallStyle}/>
                    <input type="number" min={0} max={1200} value={resolved[key].y} aria-label={`${ELEMENT_LABELS[key]} Y`}
                      onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}
                      onChange={e => setPos(key, 'y', Number(e.target.value))} className={smallField} style={smallStyle}/>
                  </div>
                );
              })}
            </div>
            {contentType === 'default' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-[14px] p-4" style={{ background: C.page }}>
                <div>
                  <Label C={C}>Partner layout</Label>
                  <MenuSelect field label="Partner layout" value={resolved.partnerAttribution.direction ?? 'horizontal'} onChange={v => setPartnerLayout('direction', v)} C={{ ...C, input: C.card }}
                    options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]}/>
                </div>
                <div>
                  <Label C={C}>Partner logo height</Label>
                  <input type="number" min={24} max={240}
                    value={resolved.partnerAttribution.logoHeight ?? 90}
                    onChange={e => setPartnerLayout('logoHeight', Math.max(24, Math.min(240, Number(e.target.value))))}
                    className={`${NUMBER_FIELD} font-mono`} style={{ ...inputStyle(C), background: C.card }}/>
                </div>
                <button type="button" role="checkbox" aria-checked={resolved.partnerAttribution.showLabel !== false}
                  onClick={() => setPartnerLayout('showLabel', resolved.partnerAttribution.showLabel === false)}
                  className="flex items-center gap-2 self-end min-h-[46px] text-sm text-left" style={{ color: C.text }}>
                  <Tick on={resolved.partnerAttribution.showLabel !== false} C={C}/>
                  Show &quot;Offered by&quot;
                </button>
                <div className="sm:col-span-3 -mt-1.5">
                  <Hint C={C}>The sample partner in the preview is replaced automatically by each course&apos;s selected partner.</Hint>
                </div>
              </div>
            )}
          </Sect>
        </Card>

        <Card C={C} className="min-w-0 lg:sticky lg:top-4">
          <Sect C={C} first title="Preview" aside={selectedElement ? `Click to place ${ELEMENT_LABELS[selectedElement].toLowerCase()}` : undefined}>
            {/* Same presentation as student certificate page */}
            <div
              ref={previewWrapRef}
              onClick={handlePreviewClick}
              style={{
                width: '100%',
                height: previewScale > 0 ? Math.round(CERT_H * previewScale) : 'auto',
                position: 'relative',
                overflow: 'hidden',
                borderRadius: '10px',
                boxShadow: `0 0 0 1px ${C.divider}`,
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
              {elements.map(key => {
                const p = resolved[key];
                if (!p) return null;
                const color = ELEMENT_COLORS[key];
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
          </Sect>
        </Card>
      </div>
    </div>
  );
}
