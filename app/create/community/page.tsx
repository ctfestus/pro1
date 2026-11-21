'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { RichTextEditor } from '@/components/RichTextEditor';
import { sanitizeRichText, sanitizePlainText } from '@/lib/sanitize';
import { Card, Pill, btnClass, btnStyle } from '@/components/dashboard/subscriptions/ui';
import { CoverField, EditorHeader, FIELD, Label, Sect, SwitchRow, TickList, inputStyle, useEditorC } from '@/components/create/EditorKit';

// --- Page ---
export default function CreateCommunityPage() {
  const C = useEditorC();
  const router = useRouter();

  const [editId, setEditId]           = useState<string | null>(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');

  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [whatsappLink, setWhatsappLink] = useState('');
  const [coverImage, setCoverImage]   = useState('');
  const [status, setStatus]           = useState<'active' | 'archived'>('active');
  const [cohorts, setCohorts]         = useState<{ id: string; name: string }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
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

      const { data: c } = await supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name');
      if (c) setCohorts(c);

      if (id) {
        const { data } = await supabase.from('communities').select('*').eq('id', id).single();
        if (data) {
          setName(data.name ?? '');
          setDescription(data.description ?? '');
          setWhatsappLink(data.whatsapp_link ?? '');
          setCoverImage(data.cover_image ?? '');
          setStatus(data.status ?? 'active');
          if (data.cohort_ids?.length) setSelectedCohortIds(data.cohort_ids);
        }
      }
    };
    init();
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmedName = name.trim();
    if (!trimmedName) { setError('Name is required.'); return; }

    setLoading(true);
    try {
      const payload = { name: trimmedName, description: sanitizeRichText(description) || null, whatsapp_link: whatsappLink.trim() || null, cover_image: coverImage.trim() || null, status, cohort_ids: selectedCohortIds };

      if (editId) {
        const { error: e } = await supabase.from('communities').update(payload).eq('id', editId);
        if (e) throw e;
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { router.replace('/auth'); return; }
        const { error: e } = await supabase.from('communities').insert({ ...payload, created_by: session.user.id });
        if (e) throw e;
      }
      router.push('/dashboard#community');
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const field = inputStyle(C);

  return (
    <div className="min-h-screen pb-12" style={{ background: C.page, color: C.text }}>
      <form onSubmit={handleSubmit} noValidate className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
        <EditorHeader C={C} back="All communities" onBack={() => router.push('/dashboard#community')}
          title={name.trim() || (editId ? 'Edit community' : 'New community')}
          pill={status === 'active' ? <Pill tone="good" dot C={C}>Active</Pill> : <Pill tone="mute" C={C}>Archived</Pill>}
          error={error} onDismissError={() => setError('')}
          actions={
            <button type="submit" disabled={loading} className={btnClass} style={btnStyle('pri', C)}>
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Saving...' : editId ? 'Save changes' : 'Create community'}
            </button>
          } />

        <Card C={C} className="mt-4">
          <Sect C={C} title="About the community" first>
            <div>
              <Label C={C}>Name</Label>
              <input type="text" value={name} onChange={e => setName(sanitizePlainText(e.target.value))}
                placeholder="For example Spring Cohort 2025" className={FIELD} style={field} maxLength={255} />
            </div>
            <div>
              <Label C={C}>Description</Label>
              <RichTextEditor value={description} onChange={setDescription} placeholder="What is this community about?" enableAiAssist />
            </div>
          </Sect>

          <Sect C={C} title="Cover">
            <CoverField C={C} value={coverImage} onChange={setCoverImage} />
          </Sect>

          <Sect C={C} title="Access">
            <div>
              <Label C={C}>WhatsApp group link</Label>
              <input type="url" value={whatsappLink} onChange={e => setWhatsappLink(e.target.value)}
                placeholder="https://chat.whatsapp.com/" className={FIELD} style={field} />
            </div>
            <div className="pt-4" style={{ borderTop: `1px solid ${C.divider}` }}>
              <SwitchRow C={C} title="Active" sub="Turn off to archive it. Students do not see archived communities."
                on={status === 'active'} onChange={on => setStatus(on ? 'active' : 'archived')} />
            </div>
          </Sect>

          {cohorts.length > 0 && (
            <Sect C={C} title="Cohorts" aside={`${selectedCohortIds.length} selected`}>
              <TickList C={C} items={cohorts} selected={selectedCohortIds} onToggle={toggleCohort} />
            </Sect>
          )}
        </Card>
      </form>
    </div>
  );
}
