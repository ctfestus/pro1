'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { CalendarDays, Plus, Edit2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { deleteFromCloudinary } from '@/lib/uploadToCloudinary';
import { LIGHT_C, cardStyle } from '@/lib/theme';
import { SectionEmptyState } from '@/components/dashboard/primitives';

export function SchedulesManageSection({ C }: { C: typeof LIGHT_C }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    const { data } = await supabase.from('schedules').select('*').order('created_at', { ascending: false });
    setItems(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSchedules();
  }, [loadSchedules]);

  async function deleteSchedule(id: string) {
    const confirmed = window.confirm('Delete this schedule? This will also remove its topics and resources.');
    if (!confirmed) return;

    setDeletingId(id);

    // Clean up Cloudinary cover image before deleting
    const item = items.find(i => i.id === id);
    if (item?.cover_image?.includes('res.cloudinary.com')) {
      await deleteFromCloudinary(item.cover_image);
    }

    const { error } = await supabase.from('schedules').delete().eq('id', id);
    setDeletingId(null);
    if (error) {
      window.alert(error.message || 'Failed to delete schedule.');
      return;
    }
    setItems(prev => prev.filter(item => item.id !== id));
  }

  if (loading) return (
    <div className="space-y-3">
      {[0,1,2].map(i => <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: C.card }}/>)}
    </div>
  );

  if (!items.length) return (
    <SectionEmptyState Icon={CalendarDays} label="Schedules" createHref="/create/schedule" createLabel="New Schedule" C={C}/>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold" style={{ color: C.text }}>Schedules</h2>
        <Link href="/create/schedule" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ background: C.cta, color: C.ctaText }}>
          <Plus className="w-4 h-4"/> New Schedule
        </Link>
      </div>
      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className="flex items-center justify-between gap-3 p-4 rounded-2xl" style={{ ...cardStyle(C) }}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-sm truncate" style={{ color: C.text }}>{item.title}</p>
              <p className="text-xs mt-0.5" style={{ color: C.faint }}>
                {item.status}{item.start_date ? ` · ${new Date(item.start_date).toLocaleDateString()}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs px-2 py-1 rounded-lg" style={{ background: C.pill, color: C.muted }}>{item.status}</span>
              <Link href={`/create/schedule?edit=${item.id}`}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
                style={{ background: C.pill, color: C.muted, textDecoration: 'none' }}>
                <Edit2 className="w-3.5 h-3.5"/> Edit
              </Link>
              <button onClick={() => deleteSchedule(item.id)} disabled={deletingId === item.id}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold"
                style={{ background: C.deleteBg, color: C.deleteText, border: `1px solid ${C.deleteBorder}`, cursor: deletingId === item.id ? 'not-allowed' : 'pointer', opacity: deletingId === item.id ? 0.6 : 1 }}>
                <Trash2 className="w-3.5 h-3.5"/> {deletingId === item.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
