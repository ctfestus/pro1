'use client';

import { useState, useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Loader2, Check, Image as ImageIcon, Upload, Images, Trash2 } from 'lucide-react';
import { uploadToCloudinary } from '@/lib/uploadToCloudinary';
import { supabase } from '@/lib/supabase';
import type { LibraryImage } from '@/components/ImageLibrary';

interface Photo {
  id: number;
  photographer: string;
  alt: string;
  src: { medium: string; large: string };
}

interface Props {
  value: string | null;
  altValue: string | null;
  onChange: (url: string, alt: string) => void;
  onClear: () => void;
  C: {
    card: string;
    cardBorder: string;
    input: string;
    text: string;
    muted: string;
    faint: string;
    cta: string;
    ctaText: string;
    divider: string;
  };
  token: string;
  /** Optional cap on the preview/dropzone width (px). Defaults to full width. */
  previewMaxWidth?: number;
  /** Lets a feature reuse the picker modal while providing its own selected-image surface. */
  renderTrigger?: (actions: { open: () => void; clear: () => void }) => ReactNode;
}

type Tab = 'pexels' | 'upload' | 'library';

const DEFAULT_QUERY = 'data technology africa business';

export function PexelsImagePicker({ value, altValue, onChange, onClear, C, previewMaxWidth, renderTrigger }: Props) {
  const [open, setOpen]             = useState(false);
  const [tab, setTab]               = useState<Tab>('pexels');
  const [query, setQuery]           = useState('');
  const [photos, setPhotos]         = useState<Photo[]>([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectingId, setSelectingId] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Upload tab state
  const [uploadFile, setUploadFile]     = useState<File | null>(null);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const [uploading, setUploading]       = useState(false);
  const [uploadError, setUploadError]   = useState('');
  const [dragOver, setDragOver]         = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Library tab state
  const [libImages, setLibImages]         = useState<LibraryImage[]>([]);
  const [libLoading, setLibLoading]       = useState(false);
  const [libError, setLibError]           = useState('');
  const [libNextCursor, setLibNextCursor] = useState<string | null>(null);
  const [libDeletingId, setLibDeletingId] = useState<string | null>(null);

  async function fetchPhotos(q: string) {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`/api/pexels-search?q=${encodeURIComponent(q)}&per_page=18`, {
        headers: { Authorization: `Bearer ${session?.access_token ?? ''}` },
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? 'Search failed'); return; }
      setPhotos(json.photos ?? []);
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && tab === 'pexels') fetchPhotos(DEFAULT_QUERY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'pexels') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchPhotos(query.trim() || DEFAULT_QUERY);
    }, 420);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    if (open && tab === 'library' && libImages.length === 0) fetchLibrary();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  async function fetchLibrary(cursor?: string) {
    setLibLoading(true);
    if (!cursor) setLibError('');
    try {
      const params = new URLSearchParams();
      if (cursor) params.set('cursor', cursor);
      const res = await fetch(`/api/assets?${params}`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setLibImages(prev => cursor ? [...prev, ...data.images] : data.images);
      setLibNextCursor(data.nextCursor ?? null);
    } catch {
      setLibError('Could not load images');
    } finally {
      setLibLoading(false);
    }
  }

  // Delete a library image. The server scopes deletes to the caller's own folder and
  // refuses to destroy one still used as a content cover (returns skipped:'referenced').
  async function deleteLibImage(img: LibraryImage) {
    if (libDeletingId) return;
    if (!window.confirm('Delete this image from your library permanently? This cannot be undone.')) return;
    setLibDeletingId(img.publicId);
    setLibError('');
    try {
      const res = await fetch('/api/upload', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicId: img.publicId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setLibError(json.error || 'Could not delete image.'); return; }
      if (json.skipped === 'referenced') {
        setLibError('This image is still used as a cover somewhere, so it was not deleted.');
        return;
      }
      setLibImages(prev => prev.filter(i => i.publicId !== img.publicId));
    } catch {
      setLibError('Could not delete image. Please try again.');
    } finally {
      setLibDeletingId(null);
    }
  }

  async function select(photo: Photo) {
    if (selectingId !== null) return;
    setSelectingId(photo.id);
    setSelectedId(photo.id);
    try {
      const imgRes = await fetch(photo.src.large);
      const blob = await imgRes.blob();
      const ext = blob.type.split('/')[1] || 'jpg';
      const file = new File([blob], `pexels-${photo.id}.${ext}`, { type: blob.type });
      const cloudUrl = await uploadToCloudinary(file, 'covers');
      onChange(cloudUrl, photo.photographer);
    } catch {
      // Fallback to direct Pexels URL if upload fails
      onChange(photo.src.large, photo.photographer);
    } finally {
      setSelectingId(null);
      setOpen(false);
    }
  }

  function openModal() {
    setQuery('');
    setPhotos([]);
    setError('');
    setUploadFile(null);
    setUploadPreview(null);
    setUploadError('');
    setDragOver(false);
    setLibImages([]);
    setLibError('');
    setLibNextCursor(null);
    setOpen(true);
  }

  function handleFileSelect(file: File) {
    if (!file.type.startsWith('image/')) { setUploadError('Please select an image file.'); return; }
    if (file.size > 20 * 1024 * 1024) { setUploadError('File is too large (max 20 MB).'); return; }
    setUploadFile(file);
    setUploadError('');
    const prev = URL.createObjectURL(file);
    setUploadPreview(prev);
  }

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError('');
    try {
      const url = await uploadToCloudinary(uploadFile, 'datasets/covers');
      onChange(url, '');
      setOpen(false);
    } catch (err) {
      setUploadError((err as Error).message || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  const isPexels = value?.includes('pexels.com');

  const TAB_STYLE = (active: boolean) => ({
    padding: '8px 20px',
    borderRadius: 10,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    transition: 'all 0.15s',
    background: active ? C.cta : 'transparent',
    color: active ? C.ctaText : C.muted,
  });

  return (
    <>
      {/* Trigger */}
      {renderTrigger ? renderTrigger({ open: openModal, clear: onClear }) : value ? (
        <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: '16/9', background: C.input, maxWidth: previewMaxWidth, width: '100%' }}>
          <img src={value} alt={altValue ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          <div
            className="pexels-overlay"
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0)', transition: 'background 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.42)'; (e.currentTarget.querySelectorAll('button') as NodeListOf<HTMLElement>).forEach(b => b.style.opacity = '1'); }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0)'; (e.currentTarget.querySelectorAll('button') as NodeListOf<HTMLElement>).forEach(b => b.style.opacity = '0'); }}
          >
            <button
              onClick={openModal}
              style={{ opacity: 0, transition: 'opacity 0.2s', padding: '8px 18px', borderRadius: 9, border: 'none', background: 'white', color: '#111', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              Change
            </button>
            <button
              onClick={onClear}
              style={{ opacity: 0, transition: 'opacity 0.2s', padding: '8px 13px', borderRadius: 9, border: 'none', background: 'rgba(0,0,0,0.65)', color: 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
            >
              <X size={12} /> Remove
            </button>
          </div>
          {isPexels && altValue && (
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.5)', color: 'white', fontSize: 11, padding: '5px 10px', pointerEvents: 'none' }}>
              Photo by {altValue} on Pexels
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={openModal}
          style={{ width: '100%', maxWidth: previewMaxWidth, aspectRatio: '16/9', borderRadius: 14, border: `2px dashed ${C.cardBorder}`, background: C.input, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: C.faint, transition: 'border-color 0.2s, color 0.2s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.cta; e.currentTarget.style.color = C.cta; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.cardBorder; e.currentTarget.style.color = C.faint; }}
        >
          <ImageIcon size={30} />
          <span style={{ fontSize: 14, fontWeight: 700 }}>Add cover image</span>
          <span style={{ fontSize: 12 }}>Browse Pexels or upload your own</span>
        </button>
      )}

      {/* Modal */}
      {open && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div style={{ background: C.card, borderRadius: 22, width: '100%', maxWidth: 820, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }}>

            {/* Header: tabs + close */}
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.divider}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 4, background: C.input, borderRadius: 12, padding: 3, flex: 1 }}>
                <button style={TAB_STYLE(tab === 'pexels')} onClick={() => setTab('pexels')}>
                  Pexels Photos
                </button>
                <button style={TAB_STYLE(tab === 'upload')} onClick={() => setTab('upload')}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Upload size={13} /> Upload Image</span>
                </button>
                <button style={TAB_STYLE(tab === 'library')} onClick={() => setTab('library')}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Images size={13} /> My Library</span>
                </button>
              </div>
              <button
                onClick={() => setOpen(false)}
                style={{ width: 38, height: 38, borderRadius: 10, border: 'none', background: C.input, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: C.muted }}
              >
                <X size={17} />
              </button>
            </div>

            {/* Pexels tab: search bar */}
            {tab === 'pexels' && (
              <div style={{ padding: '12px 20px 0', flexShrink: 0 }}>
                <div style={{ position: 'relative' }}>
                  <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: C.faint, pointerEvents: 'none' }} />
                  {loading && (
                    <Loader2 size={14} className="animate-spin" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: C.faint }} />
                  )}
                  <input
                    autoFocus
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Type to search... e.g. sales, africa, technology, finance"
                    style={{ width: '100%', padding: '11px 42px 11px 42px', borderRadius: 12, border: `1.5px solid ${C.cardBorder}`, background: C.input, color: C.text, fontSize: 14, outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>
                <p style={{ margin: '8px 0 0', fontSize: 12, color: C.faint, fontWeight: 600 }}>
                  {query.trim() ? `Results for "${query.trim()}"` : 'Suggested photos -- type above to search'}
                </p>
              </div>
            )}

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px 20px' }}>

              {/* Pexels grid */}
              {tab === 'pexels' && (
                <>
                  {error && <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: 20 }}>{error}</p>}
                  {!error && loading && photos.length === 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: C.faint }}>
                      <Loader2 size={30} className="animate-spin" />
                    </div>
                  )}
                  {!error && photos.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                      {photos.map(photo => {
                        const isSel = selectedId === photo.id;
                        const isSelecting = selectingId === photo.id;
                        return (
                          <button
                            key={photo.id}
                            onClick={() => select(photo)}
                            disabled={selectingId !== null}
                            style={{
                              position: 'relative', padding: 0, margin: 0,
                              border: isSel ? `3px solid ${C.cta}` : '3px solid transparent',
                              borderRadius: 12, overflow: 'hidden', cursor: selectingId !== null ? 'wait' : 'pointer',
                              background: C.input, display: 'block', width: '100%',
                              transition: 'border-color 0.15s, transform 0.15s',
                            }}
                            onMouseEnter={e => { if (!isSel && !selectingId) e.currentTarget.style.borderColor = `${C.cta}80`; e.currentTarget.style.transform = 'scale(1.02)'; }}
                            onMouseLeave={e => { if (!isSel) e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'scale(1)'; }}
                          >
                            <img
                              src={photo.src.medium}
                              alt={photo.alt || photo.photographer}
                              style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }}
                            />
                            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.62))', padding: '18px 8px 6px', color: 'white', fontSize: 11, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {photo.photographer}
                            </div>
                            {isSelecting && (
                              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Loader2 size={28} className="animate-spin" color="white" />
                              </div>
                            )}
                            {isSel && !isSelecting && (
                              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <div style={{ background: C.cta, borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                  <Check size={18} color="white" strokeWidth={3} />
                                </div>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* Upload tab */}
              {tab === 'upload' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Drop zone */}
                  <div
                    onClick={() => uploadInputRef.current?.click()}
                    onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
                    style={{
                      border: `2px dashed ${dragOver ? C.cta : C.cardBorder}`,
                      borderRadius: 16,
                      padding: '40px 20px',
                      textAlign: 'center',
                      cursor: 'pointer',
                      background: dragOver ? `${C.cta}10` : C.input,
                      transition: 'all 0.2s',
                      color: dragOver ? C.cta : C.faint,
                    }}
                  >
                    <Upload size={32} style={{ marginBottom: 10, display: 'block', margin: '0 auto 10px' }} />
                    <p style={{ fontWeight: 700, fontSize: 15, margin: '0 0 4px', color: dragOver ? C.cta : C.text }}>
                      {uploadFile ? uploadFile.name : 'Click or drag an image here'}
                    </p>
                    <p style={{ fontSize: 12, margin: 0 }}>PNG, JPG, WEBP up to 20 MB</p>
                  </div>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                  />

                  {/* Preview */}
                  {uploadPreview && (
                    <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: '16/9' }}>
                      <img src={uploadPreview} alt="Preview" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      <button
                        onClick={() => { setUploadFile(null); setUploadPreview(null); setUploadError(''); }}
                        style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%', width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white' }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}

                  {uploadError && (
                    <p style={{ fontSize: 13, color: '#ef4444', margin: 0, textAlign: 'center' }}>{uploadError}</p>
                  )}

                  {uploadFile && (
                    <button
                      onClick={handleUpload}
                      disabled={uploading}
                      style={{ padding: '13px 0', borderRadius: 12, border: 'none', background: uploading ? C.input : C.cta, color: uploading ? C.muted : C.ctaText, fontSize: 15, fontWeight: 700, cursor: uploading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s' }}
                    >
                      {uploading ? <><Loader2 size={16} className="animate-spin" /> Uploading...</> : <><Upload size={15} /> Upload to Cloudinary</>}
                    </button>
                  )}
                </div>
              )}

              {/* Library tab */}
              {tab === 'library' && (
                <>
                  {libError && <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', padding: 20 }}>{libError}</p>}
                  {libLoading && libImages.length === 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: C.faint }}>
                      <Loader2 size={30} className="animate-spin" />
                    </div>
                  )}
                  {!libLoading && !libError && libImages.length === 0 && (
                    <div style={{ textAlign: 'center', padding: '50px 20px', color: C.faint }}>
                      <Images size={40} style={{ opacity: 0.3, display: 'block', margin: '0 auto 12px' }} />
                      <p style={{ fontSize: 14, fontWeight: 700, margin: '0 0 4px', color: C.muted }}>No images uploaded yet</p>
                      <p style={{ fontSize: 13, margin: 0 }}>Switch to the Upload tab to add your first image.</p>
                    </div>
                  )}
                  {libImages.length > 0 && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                        {libImages.map(img => {
                          const isDeleting = libDeletingId === img.publicId;
                          return (
                            <div
                              key={img.publicId}
                              style={{ position: 'relative', border: '3px solid transparent', borderRadius: 12, overflow: 'hidden', background: C.input, width: '100%', transition: 'border-color 0.15s, transform 0.15s' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = `${C.cta}90`; e.currentTarget.style.transform = 'scale(1.02)'; }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.transform = 'scale(1)'; }}
                            >
                              <button
                                onClick={() => { onChange(img.url, ''); setOpen(false); }}
                                style={{ padding: 0, margin: 0, border: 'none', cursor: 'pointer', background: 'transparent', display: 'block', width: '100%' }}
                              >
                                <img src={img.thumbUrl} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} loading="lazy" />
                                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.62))', padding: '18px 8px 6px', color: 'white', fontSize: 11, textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
                                  {img.folder}
                                </div>
                              </button>
                              <button
                                onClick={() => deleteLibImage(img)}
                                disabled={isDeleting}
                                title="Delete from library"
                                style={{ position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 8, border: 'none', background: 'rgba(0,0,0,0.55)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: isDeleting ? 'wait' : 'pointer' }}
                              >
                                {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      {libNextCursor && !libLoading && (
                        <div style={{ textAlign: 'center', marginTop: 14 }}>
                          <button onClick={() => fetchLibrary(libNextCursor)} style={{ padding: '8px 20px', borderRadius: 10, border: `1.5px solid ${C.cardBorder}`, background: 'transparent', color: C.text, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                            Load more
                          </button>
                        </div>
                      )}
                      {libLoading && (
                        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                          <Loader2 size={18} className="animate-spin" style={{ color: C.faint }} />
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '10px 20px', borderTop: `1px solid ${C.divider}`, fontSize: 11, color: C.faint, textAlign: 'center', flexShrink: 0 }}>
              {tab === 'pexels'
                ? <>Photos provided by <strong>Pexels</strong> - free to use, no attribution required</>
                : <>Images are stored securely on Cloudinary</>
              }
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
