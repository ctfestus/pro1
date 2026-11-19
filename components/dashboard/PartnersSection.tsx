'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Edit2, Handshake, Loader2, Plus, Save, Trash2, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { LIGHT_C } from '@/lib/theme';

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

export function PartnersSection({ C }: { C: typeof LIGHT_C }) {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [view, setView] = useState<'list' | 'editor'>('list');
  const [editing, setEditing] = useState<Partner | null>(null);
  const [form, setForm] = useState<PartnerForm>({ ...EMPTY });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
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

  const inputStyle = {
    background: C.input,
    color: C.text,
    border: `1px solid ${C.cardBorder}`,
  };

  if (loading && view === 'list') {
    return <div className="py-24 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.green }} /></div>;
  }

  if (view === 'editor') {
    return (
      <div className="max-w-3xl">
        <button onClick={() => setView('list')} className="flex items-center gap-2 text-sm mb-5" style={{ color: C.muted }}>
          <ArrowLeft className="w-4 h-4" /> Back to partners
        </button>
        <div className="rounded-2xl p-6 space-y-5" style={{ background: C.card, boxShadow: '0 8px 30px rgba(0,0,0,0.08)' }}>
          <div>
            <h2 className="text-[22px] font-bold leading-7" style={{ color: C.text }}>{editing ? 'Edit partner' : 'New partner'}</h2>
            <p className="text-sm mt-1" style={{ color: C.faint }}>Manage the organization shown in course attribution.</p>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2" style={{ color: C.text }}>Name</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-xl px-4 py-3 outline-none" style={inputStyle} placeholder="Organization name" />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2" style={{ color: C.text }}>Logo</label>
            <div className="flex items-center gap-4">
              {form.logo_url ? (
                <img src={form.logo_url} alt="" className="w-24 h-16 object-contain rounded-lg" style={{ background: '#fff' }} />
              ) : (
                <div className="w-24 h-16 rounded-lg grid place-items-center" style={{ background: C.pill }}>
                  <Handshake className="w-6 h-6" style={{ color: C.faint }} />
                </div>
              )}
              <input ref={fileRef} type="file" accept="image/*,.svg" className="hidden"
                onChange={e => { const file = e.target.files?.[0]; if (file) uploadLogo(file); e.target.value = ''; }} />
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold"
                style={{ background: C.pill, color: C.text }}>
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Upload logo
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2" style={{ color: C.text }}>Website</label>
            <input value={form.website_url ?? ''} onChange={e => setForm({ ...form, website_url: e.target.value })}
              className="w-full rounded-xl px-4 py-3 outline-none" style={inputStyle} placeholder="https://example.org" />
          </div>

          <div>
            <label className="block text-sm font-semibold mb-2" style={{ color: C.text }}>Description</label>
            <textarea value={form.description ?? ''} onChange={e => setForm({ ...form, description: e.target.value })}
              rows={4} className="w-full rounded-xl px-4 py-3 outline-none resize-y" style={inputStyle} />
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })}
              className="w-4 h-4 accent-green-600" />
            <span className="text-sm font-semibold" style={{ color: C.text }}>Active</span>
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white disabled:opacity-60"
            style={{ background: C.green }}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save partner
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-[22px] font-bold leading-7" style={{ color: C.text }}>Partners</h2>
          <p className="text-sm mt-1" style={{ color: C.faint }}>Organizations credited on courses and certificates.</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold text-white"
          style={{ background: C.green }}>
          <Plus className="w-4 h-4" /> New partner
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {!partners.length ? (
        <div className="rounded-2xl py-16 text-center" style={{ background: C.card, boxShadow: '0 8px 30px rgba(0,0,0,0.06)' }}>
          <Handshake className="w-8 h-8 mx-auto mb-3" style={{ color: C.faint }} />
          <p className="font-semibold" style={{ color: C.text }}>No partners yet</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {partners.map(partner => (
            <div key={partner.id} className="rounded-2xl p-5" style={{ background: C.card, boxShadow: '0 8px 30px rgba(0,0,0,0.06)' }}>
              <div className="flex items-start gap-4">
                {partner.logo_url ? (
                  <img src={partner.logo_url} alt="" className="w-14 h-14 object-contain rounded-lg flex-shrink-0" style={{ background: '#fff' }} />
                ) : (
                  <div className="w-14 h-14 rounded-lg grid place-items-center flex-shrink-0" style={{ background: C.pill }}>
                    <Handshake className="w-5 h-5" style={{ color: C.faint }} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-bold truncate" style={{ color: C.text }}>{partner.name}</h3>
                  <span className="inline-flex mt-2 px-2 py-1 rounded-full text-[11px] font-bold"
                    style={partner.is_active
                      ? { background: '#fff', color: '#15803d', boxShadow: '0 0 0 1px #bbf7d0' }
                      : { background: C.pill, color: C.faint }}>
                    {partner.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              {partner.description && <p className="text-sm mt-4 line-clamp-2" style={{ color: C.muted }}>{partner.description}</p>}
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => openEdit(partner)} aria-label={`Edit ${partner.name}`}
                  className="p-2 rounded-lg" style={{ background: C.pill, color: C.text }}><Edit2 className="w-4 h-4" /></button>
                <button onClick={() => remove(partner)} aria-label={`Delete ${partner.name}`}
                  className="p-2 rounded-lg" style={{ background: '#fef2f2', color: '#dc2626' }}><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
