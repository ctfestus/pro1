'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, Images, Loader2, Search, X } from 'lucide-react';
import { useC } from '@/lib/theme';
import { BRANDFETCH_CLIENT_ID, buildBrandfetchLogoUrl, searchBrandfetch, type BrandfetchBrand } from '@/lib/brandfetch';

interface Props {
  onSelect: (brand: BrandfetchBrand & { logoUrl: string }) => void;
  onOpenLibrary: () => void;
  onClose: () => void;
}

// Kept as a guard for any caller that opens the picker without checking: callers that can fall
// back to the library should send the author straight there instead. Module scope, so the search
// effect below does not have to carry it as a dependency.
const CLIENT_ID = BRANDFETCH_CLIENT_ID;

export function BrandfetchLogoPicker({ onSelect, onOpenLibrary, onClose }: Props) {
  const C = useC();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BrandfetchBrand[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    const needle = query.trim();
    if (!CLIENT_ID || needle.length < 2) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        setResults(await searchBrandfetch(needle, CLIENT_ID, controller.signal));
      } catch (cause) {
        if ((cause as Error).name !== 'AbortError') setError('Brand search is unavailable right now. You can still use your image library.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  const choose = (brand: BrandfetchBrand) => {
    const logoUrl = buildBrandfetchLogoUrl(brand.domain, CLIENT_ID);
    if (!logoUrl) return;
    onSelect({ ...brand, logoUrl });
    onClose();
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a brand logo"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div style={{ width: '100%', maxWidth: 650, maxHeight: '82vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRadius: 22, background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: '0 32px 80px rgba(0,0,0,0.4)' }}>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ flex: 1 }}>
            <strong style={{ display: 'block', color: C.text, fontSize: 15 }}>Choose a brand logo</strong>
            <span style={{ color: C.muted, fontSize: 12 }}>Search by company name or website</span>
          </div>
          <button type="button" onClick={() => { onClose(); onOpenLibrary(); }} style={{ padding: '8px 12px', display: 'inline-flex', alignItems: 'center', gap: 6, border: `1px solid ${C.cardBorder}`, borderRadius: 10, background: C.input, color: C.text, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <Images size={14} /> My library
          </button>
          <button type="button" aria-label="Close brand logo picker" onClick={onClose} style={{ width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 10, background: C.input, color: C.muted, cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${C.divider}` }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)', color: C.faint, pointerEvents: 'none' }} />
            {loading && <Loader2 size={15} className="animate-spin" style={{ position: 'absolute', right: 13, top: '50%', transform: 'translateY(-50%)', color: C.faint }} />}
            <input
              autoFocus
              value={query}
              disabled={!CLIENT_ID}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search brands, e.g. Microsoft or microsoft.com"
              aria-label="Search brands"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 38px', border: `1.5px solid ${C.inputBorder}`, borderRadius: 11, outline: 'none', background: C.input, color: C.text, fontSize: 13, opacity: CLIENT_ID ? 1 : 0.65 }}
            />
          </div>
        </div>

        <div style={{ minHeight: 240, overflowY: 'auto', padding: '12px 20px 18px' }}>
          {!CLIENT_ID && (
            <div style={{ padding: '44px 20px', textAlign: 'center', color: C.muted }}>
              <Building2 size={38} style={{ display: 'block', margin: '0 auto 12px', opacity: 0.35 }} />
              <strong style={{ display: 'block', marginBottom: 5, color: C.text }}>Brandfetch needs a client ID</strong>
              <span style={{ fontSize: 13 }}>Set NEXT_PUBLIC_BRANDFETCH_CLIENT_ID to enable brand search and live logos.</span>
            </div>
          )}
          {CLIENT_ID && !query.trim() && (
            <div style={{ padding: '52px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>Start typing to find a brand and its official logo.</div>
          )}
          {error && <p role="alert" style={{ margin: '12px 0', color: C.errorText, textAlign: 'center', fontSize: 13 }}>{error}</p>}
          {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
            <p style={{ margin: '42px 0', color: C.muted, textAlign: 'center', fontSize: 13 }}>No matching brands found.</p>
          )}
          {results.map((brand) => {
            const preview = brand.icon || buildBrandfetchLogoUrl(brand.domain, CLIENT_ID);
            return (
              <button
                key={brand.brandId || brand.domain}
                type="button"
                onClick={() => choose(brand)}
                style={{ width: '100%', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12, border: 0, borderBottom: `1px solid ${C.divider}`, borderRadius: 10, background: 'transparent', color: C.text, textAlign: 'left', cursor: 'pointer' }}
                onMouseEnter={(event) => { event.currentTarget.style.background = C.input; }}
                onMouseLeave={(event) => { event.currentTarget.style.background = 'transparent'; }}
              >
                <span style={{ width: 42, height: 42, flex: '0 0 42px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 11, background: C.input }}>
                  {preview ? <img src={preview} alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} /> : <Building2 size={18} style={{ color: C.faint }} />}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{brand.name}</strong>
                  <small style={{ display: 'block', marginTop: 2, color: C.muted, fontSize: 11 }}>{brand.domain}</small>
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ padding: '9px 20px', borderTop: `1px solid ${C.divider}`, color: C.faint, textAlign: 'center', fontSize: 11 }}>
          Brand search and live logos provided by Brandfetch
        </div>
      </div>
    </div>,
    document.body,
  );
}
