'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useCallback, useContext } from 'react';
import Link from 'next/link';
import { Video, Plus, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { deleteFromCloudinary } from '@/lib/uploadToCloudinary';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { SectionEmptyState } from '@/components/dashboard/primitives';
import { IsStaffContext } from '@/components/dashboard/context';
import { SectionSkeleton } from '@/components/dashboard/content/SectionSkeleton';

export function RecordingsManageSection({ C }: { C: typeof LIGHT_C }) {
  const isStaff = useContext(IsStaffContext);
  const [items, setItems]       = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('recordings').select('*').order('created_at', { ascending: false });
    setItems(data ?? []);
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this recording? All entries will be removed.')) return;
    setDeletingId(id);
    const item = items.find(i => i.id === id);
    const { error } = await supabase.from('recordings').delete().eq('id', id);
    setDeletingId(null);
    if (error) { window.alert(error.message || 'Failed to delete.'); return; }
    if (item?.cover_image) await deleteFromCloudinary(item.cover_image).catch(() => {});
    setItems(prev => prev.filter(i => i.id !== id));
  }

  if (loading) return <SectionSkeleton C={C} shape="rows" header={false} stats={0} />;

  if (!items.length) return (
    <SectionEmptyState Icon={Video} label="Recordings" createHref="/create/recording" createLabel="New Recording" C={C}/>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold" style={{ color: C.text }}>Recordings</h2>
        <Link href="/create/recording" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-4 h-4"/> New Recording
        </Link>
      </div>
      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between gap-3 p-4 rounded-2xl"
            style={{ ...cardStyle(C) }}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm truncate" style={{ color: C.text }}>{item.title}</p>
              <p className="text-xs mt-0.5" style={{ color: C.faint }}>
                {item.status} · {item.cohort_ids?.length ?? 0} cohort{item.cohort_ids?.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs px-2 py-1 rounded-lg capitalize" style={{ background: C.pill, color: C.muted }}>{item.status}</span>
              <Link href={`/create/recording?edit=${item.id}`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
                style={{ background: C.pill, color: C.muted, textDecoration: 'none' }}>
                <Edit2 className="w-3.5 h-3.5"/> Edit
              </Link>
              {!isStaff && (
                <button onClick={() => handleDelete(item.id)} disabled={deletingId === item.id}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
                  style={{ background: C.deleteBg, color: C.deleteText, border: `1px solid ${C.deleteBorder}`,
                    cursor: deletingId === item.id ? 'not-allowed' : 'pointer', opacity: deletingId === item.id ? 0.6 : 1 }}>
                  <Trash2 className="w-3.5 h-3.5"/> {deletingId === item.id ? 'Deleting…' : 'Delete'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
