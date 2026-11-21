'use client';

// Pick a video from the Bunny library for a mission: search, filter by collection, click one.
// Each search or collection click is a new request, and only the latest one fills the list, so
// a slow earlier answer cannot replace a newer one.

import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Search, Video, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { ThemeColors } from '@/lib/theme';
import { btnClass, btnStyle, palette } from '@/components/dashboard/subscriptions/ui';

type BunnyVideo = { guid: string; title: string; embedUrl: string; thumbnail?: string; status: number; duration: number };
type BunnyCollection = { guid: string; name: string; videoCount: number };

export function BunnyPicker({ C, onPick, onClose }: { C: ThemeColors; onPick: (embedUrl: string) => void; onClose: () => void }) {
  const P = palette(C);
  const [videos, setVideos] = useState<BunnyVideo[]>([]);
  const [collections, setCollections] = useState<BunnyCollection[]>([]);
  const [collection, setCollection] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);

  const load = async (query: string, inCollection: string, withCollections = false) => {
    const mine = ++request.current;
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { Authorization: `Bearer ${session?.access_token ?? ''}` };
      const qs = new URLSearchParams({ ...(query ? { search: query } : {}), ...(inCollection ? { collection: inCollection } : {}) });
      const [videosRes, collectionsRes] = await Promise.all([
        fetch(`/api/bunny?${qs}`, { headers }),
        withCollections ? fetch('/api/bunny?collections=1', { headers }) : Promise.resolve(null),
      ]);
      const videosJson = await videosRes.json();
      if (mine !== request.current) return;
      if (!videosRes.ok) { setError(videosJson.error || 'Failed to load videos'); return; }
      setVideos(videosJson.videos ?? []);
      if (collectionsRes?.ok) setCollections((await collectionsRes.json()).collections ?? []);
    } catch {
      if (mine === request.current) setError('Network error. Please try again.');
    } finally {
      if (mine === request.current) setLoading(false);
    }
  };

  useEffect(() => { load('', '', true); }, []);

  const pickCollection = (guid: string) => { setCollection(guid); load(search, guid); };
  const tab = (on: boolean) => (on ? { background: P.sel, color: P.onSel } : { color: C.muted });

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <motion.div initial={{ opacity: 0, scale: 0.96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 12 }}
        onClick={e => e.stopPropagation()} role="dialog" aria-label="Pick a video from the Bunny library"
        className="w-full max-w-3xl rounded-2xl overflow-hidden flex flex-col" style={{ background: C.card, maxHeight: '82vh' }}>
        <div className="flex items-center justify-between px-5 py-4 flex-shrink-0" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <span className="text-base font-semibold" style={{ color: C.text }}>Pick from the Bunny library</span>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-lg" style={{ color: C.muted }}><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-3 flex-shrink-0 flex items-center gap-2" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <div className="flex items-center gap-2 flex-1 px-3 h-10 rounded-xl" style={{ background: C.input, border: `1px solid ${C.inputBorder}` }}>
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: C.muted }} />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && load(search, collection)}
              placeholder="Search videos" aria-label="Search videos" className="flex-1 bg-transparent text-sm outline-none" style={{ color: C.text }} />
          </div>
          <button type="button" onClick={() => load(search, collection)} className={btnClass} style={btnStyle('sec', C)}>Search</button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          {collections.length > 0 && (
            <div className="w-44 flex-shrink-0 overflow-y-auto p-2 grid content-start gap-1" style={{ borderRight: `1px solid ${C.divider}` }}>
              <button type="button" onClick={() => pickCollection('')} className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold" style={tab(collection === '')}>
                All videos
              </button>
              {collections.map(col => (
                <button key={col.guid} type="button" onClick={() => pickCollection(col.guid)} className="w-full text-left px-3 py-2 rounded-lg text-xs" style={tab(collection === col.guid)}>
                  <span className="block font-semibold truncate">{col.name}</span>
                  <span className="text-[11px]" style={{ opacity: 0.75 }}>{col.videoCount} videos</span>
                </button>
              ))}
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4">
            {loading && <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.muted }} /></div>}
            {error && !loading && <div className="text-center py-10 text-sm" style={{ color: P.bad }}>{error}</div>}
            {!loading && !error && videos.length === 0 && <div className="text-center py-10 text-sm" style={{ color: C.muted }}>No videos found.</div>}
            {!loading && !error && videos.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {videos.map(v => (
                  <button key={v.guid} type="button" onClick={() => onPick(v.embedUrl)}
                    className="text-left rounded-xl overflow-hidden transition-transform hover:scale-[1.02] group" style={{ background: C.input }}>
                    <div className="relative aspect-video bg-black overflow-hidden">
                      {v.thumbnail
                        ? <img src={v.thumbnail} alt={v.title} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity"
                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; (e.currentTarget.nextSibling as HTMLElement).style.display = 'flex'; }} />
                        : null}
                      <div className="w-full h-full items-center justify-center" style={{ display: v.thumbnail ? 'none' : 'flex' }}>
                        <Video className="w-6 h-6 opacity-30" style={{ color: C.faint }} />
                      </div>
                      {v.status !== 4 && (
                        <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.5)' }}>
                          <span className="text-xs text-white font-medium">Processing...</span>
                        </div>
                      )}
                      {v.duration > 0 && (
                        <span className="absolute bottom-1.5 right-1.5 text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.75)', color: 'white' }}>
                          {Math.floor(v.duration / 60)}:{String(v.duration % 60).padStart(2, '0')}
                        </span>
                      )}
                    </div>
                    <div className="px-3 py-2">
                      <p className="text-xs font-medium line-clamp-2 leading-snug" style={{ color: C.text }}>{v.title}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
