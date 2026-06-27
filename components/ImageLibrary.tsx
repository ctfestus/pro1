'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Upload, Loader2, Images } from 'lucide-react';
import { useC } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { uploadToCloudinaryWithMeta } from '@/lib/uploadToCloudinary';

export interface LibraryImage {
  publicId: string;
  url: string;
  thumbUrl: string;
  folder: string;
  format?: string;
  createdAt: string;
  width: number;
  height: number;
}

interface PexelsPhoto {
  id: number;
  photographer: string;
  alt: string;
  src: { medium: string; large: string };
}

interface Props {
  onSelect: (value: string) => void;
  onClose: () => void;
  /** Folder used when uploading a new image from within the library. */
  uploadFolder?: string;
  /** Pre-select this folder filter on open. */
  initialFolder?: string;
  /**
   * Persist a stable Cloudinary public_id instead of a full URL (resolved at render
   * via resolveCoverUrl). Use for content covers so switching accounts can't orphan them.
   * SVGs still return a full URL (they must not be f_auto-transformed).
   */
  returnPublicId?: boolean;
}

const FOLDERS = [
  { value: '', label: 'All images' },
  { value: 'lesson-images', label: 'Lesson images' },
  { value: 'covers', label: 'Covers' },
  { value: 'course-options', label: 'Course options' },
  { value: 'datasets/covers', label: 'Dataset covers' },
  { value: 'avatars', label: 'Avatars' },
  { value: 'tool-logos', label: 'Tool logos' },
];

type Tab = 'library' | 'pexels';

const PEXELS_DEFAULT_QUERY = 'technology education business';

export function ImageLibrary({ onSelect, onClose, uploadFolder, initialFolder, returnPublicId }: Props) {
  const C = useC();
  const [tab, setTab] = useState<Tab>('library');
  const [images, setImages] = useState<LibraryImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [folder, setFolder] = useState(initialFolder ?? '');
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  // Pexels tab state
  const [pexQuery, setPexQuery] = useState('');
  const [pexPhotos, setPexPhotos] = useState<PexelsPhoto[]>([]);
  const [pexLoading, setPexLoading] = useState(false);
  const [pexError, setPexError] = useState('');
  const [pexSelectingId, setPexSelectingId] = useState<number | null>(null);
  const pexDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchImages = useCallback(async (cursor?: string) => {
    setLoading(true);
    if (!cursor) setError('');
    try {
      const params = new URLSearchParams();
      if (folder) params.set('folder', folder);
      if (cursor) params.set('cursor', cursor);
      const res = await fetch(`/api/assets?${params}`);
      if (!res.ok) throw new Error('Failed to load library');
      const data = await res.json();
      setImages(prev => cursor ? [...prev, ...data.images] : data.images);
      setNextCursor(data.nextCursor ?? null);
    } catch {
      setError('Could not load images. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [folder]);

  useEffect(() => {
    setImages([]);
    setNextCursor(null);
    fetchImages();
  }, [fetchImages]);

  // Pexels search proxies the server's API key (staff-only route), so it needs the
  // user's bearer token. Debounced: a tab switch fires the suggested query, then each
  // keystroke re-queries 420ms after the user stops typing.
  const fetchPexels = useCallback(async (q: string) => {
    setPexLoading(true);
    setPexError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/pexels-search?q=${encodeURIComponent(q)}&per_page=18`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      });
      const json = await res.json();
      if (!res.ok) { setPexError(json.error ?? 'Search failed'); return; }
      setPexPhotos(json.photos ?? []);
    } catch {
      setPexError('Network error');
    } finally {
      setPexLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'pexels') return;
    if (pexDebounce.current) clearTimeout(pexDebounce.current);
    pexDebounce.current = setTimeout(() => {
      fetchPexels(pexQuery.trim() || PEXELS_DEFAULT_QUERY);
    }, 420);
    return () => { if (pexDebounce.current) clearTimeout(pexDebounce.current); };
  }, [tab, pexQuery, fetchPexels]);

  // For cover usage we persist the bare public_id; SVGs keep their full URL.
  const valueOf = (img: LibraryImage) =>
    returnPublicId && img.format !== 'svg' ? img.publicId : img.url;

  async function handleUpload(file: File) {
    setUploading(true);
    setError('');
    try {
      const { url, publicId } = await uploadToCloudinaryWithMeta(file, uploadFolder ?? (folder || 'assets'));
      const isSvg = file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
      onSelect(returnPublicId && !isSvg ? (publicId || url) : url);
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Upload failed');
      setUploading(false);
    }
  }

  // Pull the chosen Pexels photo through our own Cloudinary upload so it lives in the
  // library (and survives a Pexels-side change), then return the same value shape the
  // library tab does. Pexels assets are always raster, so no SVG guard is needed.
  async function selectPexels(photo: PexelsPhoto) {
    if (pexSelectingId !== null) return;
    setPexSelectingId(photo.id);
    try {
      const imgRes = await fetch(photo.src.large);
      const blob = await imgRes.blob();
      const ext = blob.type.split('/')[1] || 'jpg';
      const file = new File([blob], `pexels-${photo.id}.${ext}`, { type: blob.type });
      const { url, publicId } = await uploadToCloudinaryWithMeta(file, uploadFolder ?? (folder || 'assets'));
      onSelect(returnPublicId ? (publicId || url) : url);
      onClose();
    } catch {
      // Fall back to the direct Pexels URL if the upload fails.
      onSelect(photo.src.large);
      onClose();
    } finally {
      setPexSelectingId(null);
    }
  }

  const filtered = search.trim()
    ? images.filter(img =>
        img.publicId.toLowerCase().includes(search.toLowerCase()) ||
        img.folder.toLowerCase().includes(search.toLowerCase())
      )
    : images;

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 16px',
    borderRadius: 9,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    transition: 'all 0.15s',
    background: active ? C.cta : 'transparent',
    color: active ? C.ctaText : C.muted,
  });

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: C.card, borderRadius: 22, width: '100%', maxWidth: 880, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }}>

        {/* Header: tabs + upload + close */}
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.divider}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, background: C.input, borderRadius: 12, padding: 3, flex: 1 }}>
            <button style={tabStyle(tab === 'library')} onClick={() => setTab('library')}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Images size={13} /> My Library</span>
            </button>
            <button style={tabStyle(tab === 'pexels')} onClick={() => setTab('pexels')}>Pexels Photos</button>
          </div>
          {tab === 'library' && (
            <label style={{ padding: '8px 14px', borderRadius: 10, background: C.cta, color: C.ctaText, fontSize: 13, fontWeight: 700, cursor: uploading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, opacity: uploading ? 0.7 : 1 }}>
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              Upload new
              <input type="file" accept="image/*" style={{ display: 'none' }} disabled={uploading} onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ''; }} />
            </label>
          )}
          <button
            onClick={onClose}
            style={{ width: 36, height: 36, borderRadius: 10, border: 'none', background: C.input, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, flexShrink: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Toolbar */}
        {tab === 'library' ? (
          <div style={{ padding: '10px 20px', borderBottom: `1px solid ${C.divider}`, display: 'flex', gap: 10, flexShrink: 0 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.faint, pointerEvents: 'none' }} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter by name..."
                style={{ width: '100%', padding: '8px 12px 8px 36px', borderRadius: 10, border: `1.5px solid ${C.cardBorder}`, background: C.input, color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <select
              value={folder}
              onChange={e => { setFolder(e.target.value); setSearch(''); }}
              style={{ padding: '8px 12px', borderRadius: 10, border: `1.5px solid ${C.cardBorder}`, background: C.input, color: C.text, fontSize: 13, outline: 'none', cursor: 'pointer', flexShrink: 0 }}
            >
              {FOLDERS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
        ) : (
          <div style={{ padding: '10px 20px', borderBottom: `1px solid ${C.divider}`, flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: C.faint, pointerEvents: 'none' }} />
              {pexLoading && <Loader2 size={14} className="animate-spin" style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: C.faint }} />}
              <input
                autoFocus
                value={pexQuery}
                onChange={e => setPexQuery(e.target.value)}
                placeholder="Search Pexels... e.g. data, africa, finance, technology"
                style={{ width: '100%', padding: '8px 38px 8px 36px', borderRadius: 10, border: `1.5px solid ${C.cardBorder}`, background: C.input, color: C.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
          </div>
        )}

        {/* Grid */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px' }}>

          {/* Library grid */}
          {tab === 'library' && (
            <>
              {error && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</p>}

              {loading && images.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: C.muted }}>
                  <Loader2 size={28} className="animate-spin" />
                </div>
              )}

              {!loading && !error && images.length === 0 && (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: C.muted }}>
                  <Images size={44} style={{ opacity: 0.25, marginBottom: 14, display: 'block', margin: '0 auto 14px' }} />
                  <p style={{ fontSize: 15, fontWeight: 700, margin: '0 0 6px' }}>No images yet</p>
                  <p style={{ fontSize: 13, margin: 0 }}>Use the Upload button to add your own, or switch to the Pexels tab.</p>
                </div>
              )}

              {filtered.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
                  {filtered.map(img => (
                    <button
                      key={img.publicId}
                      onClick={() => { onSelect(valueOf(img)); onClose(); }}
                      style={{ position: 'relative', padding: 0, borderRadius: 12, overflow: 'hidden', aspectRatio: '4/3', border: '3px solid transparent', cursor: 'pointer', background: C.input, transition: 'border-color 0.15s, transform 0.12s' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = C.cta; e.currentTarget.style.transform = 'scale(1.02)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'scale(1)'; }}
                    >
                      <img src={img.thumbUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
                      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.65))', padding: '20px 8px 7px' }}>
                        <span style={{ fontSize: 11, color: 'white', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {img.folder}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!search.trim() && nextCursor && !loading && (
                <div style={{ textAlign: 'center', marginTop: 16 }}>
                  <button
                    onClick={() => fetchImages(nextCursor)}
                    style={{ padding: '9px 22px', borderRadius: 10, border: `1.5px solid ${C.cardBorder}`, background: 'transparent', color: C.text, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Load more
                  </button>
                </div>
              )}

              {loading && images.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                  <Loader2 size={18} className="animate-spin" style={{ color: C.muted }} />
                </div>
              )}
            </>
          )}

          {/* Pexels grid */}
          {tab === 'pexels' && (
            <>
              {pexError && <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{pexError}</p>}

              {!pexError && pexLoading && pexPhotos.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: C.muted }}>
                  <Loader2 size={28} className="animate-spin" />
                </div>
              )}

              {!pexError && pexPhotos.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
                  {pexPhotos.map(photo => {
                    const isSelecting = pexSelectingId === photo.id;
                    return (
                      <button
                        key={photo.id}
                        onClick={() => selectPexels(photo)}
                        disabled={pexSelectingId !== null}
                        style={{ position: 'relative', padding: 0, borderRadius: 12, overflow: 'hidden', aspectRatio: '4/3', border: '3px solid transparent', cursor: pexSelectingId !== null ? 'wait' : 'pointer', background: C.input, transition: 'border-color 0.15s, transform 0.12s' }}
                        onMouseEnter={e => { if (!pexSelectingId) { e.currentTarget.style.borderColor = C.cta; e.currentTarget.style.transform = 'scale(1.02)'; } }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'scale(1)'; }}
                      >
                        <img src={photo.src.medium} alt={photo.alt || photo.photographer} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
                        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.65))', padding: '20px 8px 7px' }}>
                          <span style={{ fontSize: 11, color: 'white', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {photo.photographer}
                          </span>
                        </div>
                        {isSelecting && (
                          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Loader2 size={26} className="animate-spin" color="white" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: `1px solid ${C.divider}`, fontSize: 11, color: C.faint, textAlign: 'center', flexShrink: 0 }}>
          {tab === 'pexels'
            ? <>Photos provided by <strong>Pexels</strong> - free to use, no attribution required. Selected photos are saved to your library.</>
            : <>Images are stored securely on Cloudinary</>
          }
        </div>
      </div>
    </div>,
    document.body
  );
}
