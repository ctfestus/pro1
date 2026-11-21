'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Edit2, Handshake, Loader2, MoreHorizontal, Plus, Trash2, Upload, XCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { DARK_C, type ThemeColors } from '@/lib/theme';
import { PageHeader } from '@/components/dashboard/content/kit';
import { FloatingMenu, menuPosition, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { Card, Pill, btnClass, btnSmClass, btnStyle } from '@/components/dashboard/subscriptions/ui';
import { EditorHeader, FIELD, Label, Sect, SwitchRow, inputStyle } from '@/components/create/EditorKit';

type Partner = {
  id: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

type PartnerForm = Omit<Partner, 'id' | 'created_at'>;

const EMPTY: PartnerForm = {
  name: '',
  logo_url: null,
  website_url: '',
  description: '',
  is_active: true,
};

export function PartnersSection({ C: theme }: { C: ThemeColors }) {
  const C = useMemo(() => ({ ...theme, cta: DARK_C.cta }), [theme]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [editing, setEditing] = useState<Partner | null>(null);
  const [form, setForm] = useState<PartnerForm>({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ partner: Partner; position: MenuPosition } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? '';
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch('/api/partners', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not load partners');
      setPartners(json.partners ?? []);
    } catch (e: any) {
      setError(e.message ?? 'Could not load partners');
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY });
    setError('');
    setView('editor');
  }

  function openEdit(partner: Partner) {
    setEditing(partner);
    setForm({
      name: partner.name,
      logo_url: partner.logo_url,
      website_url: partner.website_url ?? '',
      description: partner.description ?? '',
      is_active: partner.is_active,
    });
    setError('');
    setView('editor');
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch('/api/partners', {
        method: editing ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(editing ? { id: editing.id, ...form } : form),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not save partner');
      await load();
      setView('list');
    } catch (e: any) {
      setError(e.message ?? 'Could not save partner');
    } finally {
      setSaving(false);
    }
  }

  async function remove(partner: Partner) {
    if (!window.confirm(`Delete ${partner.name}? Courses using it will keep working without attribution.`)) return;
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(`/api/partners?id=${encodeURIComponent(partner.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Could not delete partner');
      await load();
    } catch (e: any) {
      setError(e.message ?? 'Could not delete partner');
    }
  }

  async function uploadLogo(file: File) {
    setUploading(true);
    setError('');
    try {
      const raw = await uploadToCloudinary(file, 'partners');
      const logoUrl = raw.replace('/upload/f_auto,q_auto/', '/upload/');
      setForm(current => ({ ...current, logo_url: logoUrl }));
    } catch (e: any) {
      setError(e.message ?? 'Logo upload failed');
    } finally {
      setUploading(false);
    }
  }

  const field = { ...inputStyle(C) };
  const errorBox = error && (
    <div role="alert" className="rounded-2xl px-4 py-3 text-sm flex items-center gap-3" style={{ background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}` }}>
      <XCircle className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1">{error}</span>
    </div>
  );
  const logo = (url: string | null, size: string) => url
    ? <img src={url} alt="" className={`${size} object-contain rounded-[10px] flex-shrink-0`} style={{ background: '#fff' }} />
    : <span className={`${size} rounded-[10px] grid place-items-center flex-shrink-0`} style={{ background: C.pill }}><Handshake className="w-4 h-4" style={{ color: C.faint }} /></span>;

  if (loading && view === 'list') {
    return <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.muted }} /></div>;
  }

  if (view === 'editor') {
    return (
      <div className="max-w-3xl">
        <EditorHeader C={C} back="Back to partners" onBack={() => setView('list')} title={editing ? 'Edit partner' : 'New partner'}
          error={error} onDismissError={() => setError('')}
          actions={
            <button type="button" onClick={save} disabled={saving} className={btnClass} style={btnStyle('pri', C)}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save partner
            </button>
          }>
          <p className="text-sm mt-1" style={{ color: C.muted }}>The organisation shown in course attribution.</p>
        </EditorHeader>
        <Card C={C} className="mt-6">
          <Sect C={C} title="Details" first>
            <div>
              <Label C={C}>Name</Label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                className={FIELD} style={field} placeholder="Organisation name" />
            </div>
            <div>
              <Label C={C}>Website</Label>
              <input value={form.website_url ?? ''} onChange={e => setForm({ ...form, website_url: e.target.value })}
                className={FIELD} style={field} placeholder="https://example.org" />
            </div>
            <div>
              <Label C={C}>Description</Label>
              <textarea value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })}
                rows={4} className={`${FIELD} resize-y`} style={field} />
            </div>
          </Sect>
          <Sect C={C} title="Logo">
            <div className="flex items-center gap-4">
              {logo(form.logo_url, 'w-24 h-16')}
              <input ref={fileRef} type="file" accept="image/*,.svg" className="hidden"
                onChange={e => { const file = e.target.files?.[0]; if (file) uploadLogo(file); e.target.value = ''; }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className={btnSmClass} style={btnStyle('sec', C)}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Upload logo
              </button>
            </div>
          </Sect>
          <Sect C={C} title="Status">
            <SwitchRow C={C} title="Active" sub="Inactive partners stay on record but are not offered for new courses." on={form.is_active}
              onChange={v => setForm({ ...form, is_active: v })} />
          </Sect>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <PageHeader C={C} title="Partners" sub="Organisations credited on courses and certificates."
        actions={
          <button type="button" onClick={openCreate} className={btnClass} style={btnStyle('pri', C)}>
            <Plus className="w-4 h-4" /> New partner
          </button>
        } />

      {errorBox}

      <Card C={C} className="overflow-hidden">
        {!partners.length ? (
          <div className="py-16 text-center">
            <Handshake className="w-8 h-8 mx-auto mb-3" style={{ color: C.faint }} />
            <p className="text-sm font-semibold" style={{ color: C.text }}>No partners yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr>{['Partner', 'Website', 'Status', ''].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {partners.map(partner => (
                  <tr key={partner.id} onClick={() => openEdit(partner)} className="cursor-pointer" style={{ borderTop: `1px solid ${C.divider}` }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {logo(partner.logo_url, 'w-9 h-9')}
                        <div className="min-w-0">
                          <p className="font-semibold truncate" style={{ color: C.text }}>{partner.name}</p>
                          {partner.description && <p className="text-xs truncate max-w-[360px]" style={{ color: C.muted }}>{partner.description}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: partner.website_url ? C.text : C.muted }}>
                      {partner.website_url ? partner.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'None'}
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone={partner.is_active ? 'good' : 'mute'} dot={partner.is_active} C={C}>{partner.is_active ? 'Active' : 'Inactive'}</Pill>
                    </td>
                    <td className="pl-2 pr-5 py-3 text-right">
                      <button type="button" aria-label={`Actions for ${partner.name}`}
                        onClick={e => { e.stopPropagation(); setMenu(menu?.partner.id === partner.id ? null : { partner, position: menuPosition(e.currentTarget, 150) }); }}
                        className="w-8 h-8 rounded-[10px] inline-grid place-items-center"
                        style={menu?.partner.id === partner.id ? { background: C.text, color: C.card } : { color: C.muted }}>
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {menu && (
        <FloatingMenu position={menu.position} label="partner actions" onClose={() => setMenu(null)} C={C}
          items={[
            { label: 'Edit', sub: 'Name, logo, website and status', icon: Edit2, onClick: () => { setMenu(null); openEdit(menu.partner); } },
            { label: 'Delete', sub: 'Courses keep working without attribution', icon: Trash2, danger: true, onClick: () => { setMenu(null); remove(menu.partner); } },
          ]} />
      )}
    </div>
  );
}
