'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, Download, Loader2, X } from 'lucide-react';
import { modalStyle, type ThemeColors } from '@/lib/theme';

/**
 * A QR code for a published form's public link, made in the browser so printing does not depend
 * on an outside image service. PNG is large enough for posters; SVG stays sharp at any size.
 */
export function ApplicationFormQrDialog({ title, slug, url, C, onClose }: {
  title: string;
  slug: string;
  url: string;
  C: ThemeColors;
  onClose: () => void;
}) {
  const [png, setPng] = useState('');
  const [svg, setSvg] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const QRCode = (await import('qrcode')).default;
        const options = { margin: 2, errorCorrectionLevel: 'M' as const, color: { dark: '#000000', light: '#ffffff' } };
        const [dataUrl, svgText] = await Promise.all([
          QRCode.toDataURL(url, { ...options, width: 1024 }),
          QRCode.toString(url, { ...options, type: 'svg' }),
        ]);
        if (!cancelled) { setPng(dataUrl); setSvg(svgText); }
      } catch {
        if (!cancelled) setError('Could not create the QR code. Copy the link instead.');
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function save(href: string, extension: 'png' | 'svg') {
    const link = document.createElement('a');
    link.href = href; link.download = `${slug}-qr-code.${extension}`;
    document.body.appendChild(link); link.click(); link.remove();
  }

  function saveSvg() {
    const href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    save(href, 'svg');
    // Some browsers start the download after click() returns; free the URL a moment later.
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy the link. Select it and copy it instead.');
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl" style={modalStyle(C)} role="dialog" aria-modal="true" aria-labelledby="form-qr-title">
        <div className="flex items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <h3 id="form-qr-title" className="text-base font-bold" style={{ color: C.text }}>QR code</h3>
            <p className="mt-1 truncate text-xs" style={{ color: C.faint }}>{title}</p>
          </div>
          <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: C.input, color: C.muted }} aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 px-5 pb-5">
          <div className="mx-auto grid aspect-square w-full max-w-[240px] place-items-center rounded-xl bg-white p-2">
            {png
              ? <img src={png} alt={`QR code for ${title}`} className="h-full w-full" />
              : !error && <Loader2 className="h-6 w-6 animate-spin" style={{ color: C.cta }} aria-label="Creating QR code" />}
          </div>
          <p className="text-center text-[11px] leading-4" style={{ color: C.muted }}>Applicants scan this to open the form. Print it on posters or flyers, or add it to slides.</p>
          <div className="flex items-center gap-2 rounded-xl p-2 pl-3" style={{ background: C.input }}>
            <span className="min-w-0 flex-1 truncate text-xs" style={{ color: C.text }}>{url}</span>
            <button type="button" onClick={() => void copyLink()} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold" style={{ background: C.card, color: copied ? C.successText : C.cta }}>{copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Copy className="h-3.5 w-3.5" /> Copy link</>}</button>
          </div>
          {error && <p role="alert" className="rounded-xl px-3 py-2.5 text-xs" style={{ background: C.errorBg, color: C.errorText }}>{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={!png} onClick={() => save(png, 'png')} className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold disabled:opacity-50" style={{ background: C.cta, color: C.ctaText }}><Download className="h-3.5 w-3.5" /> Download PNG</button>
            <button type="button" disabled={!svg} onClick={saveSvg} className="flex items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-semibold disabled:opacity-50" style={{ background: C.pill, color: C.text }}><Download className="h-3.5 w-3.5" /> Download SVG</button>
          </div>
        </div>
      </section>
    </div>
  );
}
