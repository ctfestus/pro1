'use client';

/**
 * The guest buyer's download page (/products/download?access=...). Shows the product and what is
 * left of the purchase; nothing is used by looking. Download takes one of the five downloads and
 * starts the file; Open in browser (interactive HTML) uses none, and a link product (migration 243)
 * only has Open, which uses none either. A guest whose link has
 * expired or been used up can still ask for help, and anyone can have a link emailed again.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download, ExternalLink, Loader2, Package } from 'lucide-react';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { formatLabel } from '@/lib/books/format';
import { ResendGuestLink } from '@/components/books/store/ResendGuestLink';

type Info = {
  title: string;
  slug: string | null;
  coverImage: string | null;
  format: string | null;
  state: 'ready' | 'pending' | 'not_paid' | 'expired' | 'used_up' | 'unavailable';
  downloadsLeft: number;
  expiresAt: string | null;
  free?: boolean;
};

const CARD_SHADOW = '0 1px 2px rgba(15,23,42,0.04), 0 10px 30px -14px rgba(15,23,42,0.14)';

export function GuestDownload({ access, primaryColor }: { access: string; primaryColor: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState<null | 'download' | 'open'>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!access) { setLoadError('This link is not valid.'); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/books/guest-access', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access }),
        });
        const d = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setLoadError(d.error || 'This link is not valid.');
        else setInfo(d as Info);
      } catch {
        if (!cancelled) setLoadError('Could not load your purchase. Check your connection and try again.');
      }
    })();
    return () => { cancelled = true; };
  }, [access]);

  async function download() {
    setError(''); setBusy('download');
    try {
      const res = await fetch('/api/books/guest-access/download', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) {
        if (d.reason === 'used_up' || d.reason === 'expired' || d.reason === 'not_paid') {
          setInfo(prev => (prev ? { ...prev, state: d.reason, downloadsLeft: d.reason === 'used_up' ? 0 : prev.downloadsLeft } : prev));
        }
        throw new Error(d.error || 'Could not get the file. Try again.');
      }
      setInfo(prev => (prev ? { ...prev, downloadsLeft: typeof d.remaining === 'number' ? d.remaining : prev.downloadsLeft } : prev));
      window.location.href = d.url;
    } catch (e: any) {
      setError(e?.message || 'Could not get the file. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function openInBrowser() {
    setError(''); setBusy('open');
    // Opened inside the click so a popup blocker allows it.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const res = await fetch('/api/books/guest-access/open', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.url) throw new Error(d.error || 'Could not open the product.');
      if (tab) tab.location.href = d.url;
      else window.location.href = d.url;
    } catch (e: any) {
      tab?.close();
      setError(e?.message || 'Could not open the product.');
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <div className="rounded-[28px] bg-white p-6 sm:p-8 text-center" style={{ boxShadow: CARD_SHADOW }}>
        <p className="text-lg font-bold" style={{ color: '#0f172a' }}>{loadError}</p>
        <p className="mt-2 text-sm" style={{ color: '#64748b' }}>Enter the email you paid with and we will send your download link again.</p>
        <div className="mt-5"><ResendGuestLink primaryColor={primaryColor} /></div>
      </div>
    );
  }
  if (!info) {
    return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#94a3b8' }} /></div>;
  }

  const until = info.expiresAt ? new Date(info.expiresAt).toLocaleDateString('en', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const ready = info.state === 'ready';
  const canDownload = ready && info.downloadsLeft > 0;
  const isLink = info.format === 'link';
  const primaryBtn = 'inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-2xl text-[15px] font-semibold disabled:opacity-60';
  const secondaryStyle = { background: '#ffffff', color: '#0f172a', boxShadow: CARD_SHADOW };

  return (
    <div className="rounded-[28px] bg-white p-6 sm:p-8" style={{ boxShadow: CARD_SHADOW }}>
      <div className="flex flex-col sm:flex-row gap-6 items-center sm:items-start">
        <div className="w-28 shrink-0 rounded-xl overflow-hidden flex items-center justify-center" style={{ aspectRatio: '3 / 4', background: '#E8EEF0' }}>
          {info.coverImage
            ? <img src={resolveCoverUrl(info.coverImage)} alt="" className="w-full h-full object-cover" />
            : <Package className="w-8 h-8" style={{ color: '#94a3b8' }} />}
        </div>
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: '#16a34a' }}>
            {ready ? (info.free ? (info.format === 'link' ? 'Your free copy' : 'Your free download') : 'Payment received') : info.state === 'pending' ? 'Confirming payment' : info.free ? (info.format === 'link' ? 'Your free copy' : 'Your free download') : 'Your purchase'}
          </p>
          <h1 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight" style={{ color: '#0f172a' }}>{info.title}</h1>
          {info.format && <p className="mt-1 text-sm" style={{ color: '#64748b' }}>{formatLabel(info.format)}</p>}

          {ready && isLink && (
            <p className="mt-4 text-sm" style={{ color: '#475569' }}>
              {until ? `Open it as often as you like until ${until}. ` : ''}Save your own copy there to keep it.
            </p>
          )}
          {ready && !isLink && (
            <p className="mt-4 text-sm" style={{ color: '#475569' }}>
              {info.downloadsLeft > 0
                ? `${info.downloadsLeft} of 5 downloads left${until ? `, until ${until}` : ''}. Save a copy to keep: it works without this link.`
                : 'All 5 downloads have been used.'}
            </p>
          )}
          {info.state === 'expired' && <p className="mt-4 text-sm" style={{ color: '#475569' }}>This download link has expired.</p>}
          {info.state === 'unavailable' && <p className="mt-4 text-sm" style={{ color: '#475569' }}>This product is no longer available.</p>}
          {info.state === 'not_paid' && <p className="mt-4 text-sm" style={{ color: '#475569' }}>This purchase is no longer active.</p>}
          {info.state === 'pending' && <p className="mt-4 text-sm" style={{ color: '#475569' }}>Your payment is still being confirmed. Refresh this page in a minute.</p>}

          {ready && isLink && (
            <div className="mt-6 flex flex-col sm:flex-row flex-wrap gap-3">
              <button onClick={openInBrowser} disabled={busy !== null} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
                {busy === 'open' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />} Open
              </button>
            </div>
          )}
          {ready && !isLink && (
            <div className="mt-6 flex flex-col sm:flex-row flex-wrap gap-3">
              <button onClick={download} disabled={!canDownload || busy !== null} className={primaryBtn} style={{ background: primaryColor, color: '#ffffff' }}>
                {busy === 'download' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download
              </button>
              {info.format === 'html' && (
                <button onClick={openInBrowser} disabled={busy !== null} className={primaryBtn} style={secondaryStyle}>
                  {busy === 'open' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />} Open in browser
                </button>
              )}
            </div>
          )}
          {error && <p className="mt-3 text-sm" style={{ color: '#dc2626' }}>{error}</p>}
          {info.slug && (
            <p className="mt-6 text-sm" style={{ color: '#64748b' }}>
              <Link href={`/products/${info.slug}`} className="underline underline-offset-2">Back to the product page</Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
