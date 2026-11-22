'use client';

// The one layout every public credential page uses (certificate, credential, badge): the issuer's
// logo with a "Verified credential" label on top, the certificate or badge on the left, and a panel
// on the right with who it was awarded to, the date, the ID, the actions and who issued it.
// The certification report uses CredentialShell for the same top bar. Follows the viewer's theme.

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import CertificateTemplate, { type CertificateTemplateProps } from '@/components/CertificateTemplate';
import { useTenant } from '@/components/TenantProvider';
import { DARK_C, useC } from '@/lib/theme';
import { DISPLAY_FONT, btnClass, btnStyle } from '@/components/dashboard/subscriptions/ui';
import { CalendarBlank, CaretDown, Check, Copy, DownloadSimple, IdentificationCard, LinkSimple, LinkedinLogo, SealCheck, SpinnerGap } from '@phosphor-icons/react';

/** The certificate template's own size; previews scale it down to fit. */
export const CERT_W = 1860;
export const CERT_H = 1200;

/**
 * This page's address: empty on the server, the real one in the browser, so the server's first render
 * and the browser's agree (no hydration mismatch) without setting state in an effect.
 */
const noSubscribe = () => () => {};
export function usePageUrl() {
  return useSyncExternalStore(noSubscribe, () => window.location.href, () => '');
}

export const CARD_SHADOW = 'shadow-[0_1px_2px_rgba(16,24,40,0.06),0_8px_24px_-12px_rgba(16,24,40,0.18)]';

/** Page frame: the issuer's logo (or name) and a "Verified credential" label, then the content. */
export function CredentialShell({ children }: { children: ReactNode }) {
  const C = useC();
  const { logoUrl, logoDarkUrl, orgName, appName } = useTenant();
  const logo = C.page === DARK_C.page ? (logoDarkUrl || logoUrl) : logoUrl;
  return (
    <div className="min-h-screen" style={{ background: C.page, color: C.text }}>
      <header style={{ background: C.card, borderBottom: `1px solid ${C.divider}` }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5">
            {logo
              ? <img src={logo} alt={orgName || appName || ''} className="h-7 w-auto max-w-[160px] object-contain"/>
              : <span className="truncate font-bold" style={{ fontFamily: DISPLAY_FONT }}>{orgName || appName}</span>}
          </Link>
          <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
            style={{ color: '#12A150', background: C.card, boxShadow: 'inset 0 0 0 1px rgba(18,161,80,0.18)' }}>
            <SealCheck size={14} weight="fill"/> Verified credential
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

/** The two columns: the certificate or badge, and the details panel (stacked on phones). */
export function CredentialLayout({ art, children }: { art: ReactNode; children: ReactNode }) {
  const C = useC();
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className={`min-w-0 rounded-2xl p-3 sm:p-4 ${CARD_SHADOW}`} style={{ background: C.card }}>{art}</div>
      <div className={`flex min-w-0 flex-col gap-4 rounded-2xl p-5 ${CARD_SHADOW}`} style={{ background: C.card }}>{children}</div>
    </div>
  );
}

/** The certificate template, scaled to the width of its card. */
export function ScaledCertificate(props: CertificateTemplateProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.38);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => setScale(Math.max(box.clientWidth / CERT_W, 0.05));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} className="relative w-full overflow-hidden rounded-xl" style={{ height: Math.round(CERT_H * scale) }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: CERT_W, height: CERT_H }}>
        <CertificateTemplate {...props}/>
      </div>
    </div>
  );
}

/** A badge shown large: its image, or its icon when it has none. */
export function BadgeArt({ imageUrl, icon, name, tint }: { imageUrl?: string | null; icon?: string | null; name: string; tint?: string }) {
  const C = useC();
  return (
    <div className="grid aspect-[16/10] w-full place-items-center rounded-xl"
      style={{ background: `color-mix(in srgb, ${tint || '#0ea5e9'} 10%, ${C.card})` }}>
      {imageUrl
        ? <img src={imageUrl} alt={`${name} badge`} fetchPriority="high" className="h-auto max-h-[70%] w-auto max-w-[60%] object-contain drop-shadow-lg"/>
        : <span className="text-[96px] leading-none">{icon || '\u{1F3C5}'}</span>}
    </div>
  );
}

/** Certificate / Badge, when a credential has both. */
export function ArtSwitch({ value, onChange }: { value: 'certificate' | 'badge'; onChange: (v: 'certificate' | 'badge') => void }) {
  const C = useC();
  return (
    <div className="mt-3 inline-flex gap-1 rounded-xl p-1" role="group" aria-label="Show" style={{ background: C.pill }}>
      {(['certificate', 'badge'] as const).map(v => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}
          className="h-8 rounded-[9px] px-3 text-[13px] font-semibold"
          style={value === v ? { background: C.card, color: C.text, boxShadow: '0 1px 2px rgba(0,0,0,0.08)' } : { color: C.muted }}>
          {v === 'certificate' ? 'Certificate' : 'Badge'}
        </button>
      ))}
    </div>
  );
}

export function TypePill({ children }: { children: ReactNode }) {
  const C = useC();
  return <span className="self-start rounded-full px-2.5 text-xs font-semibold leading-[22px]" style={{ background: C.pill, color: C.muted }}>{children}</span>;
}

export function CredentialTitle({ children }: { children: ReactNode }) {
  const C = useC();
  return <h1 className="text-2xl font-semibold leading-[30px]" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{children}</h1>;
}

/** Who it was awarded to, with their profile when they have one. */
export function AwardedTo({ label = 'Awarded to', name, avatarUrl, username }: { label?: string; name: string; avatarUrl?: string | null; username?: string | null }) {
  const C = useC();
  const initials = name.split(' ').slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('');
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-10 w-10 flex-shrink-0 place-items-center overflow-hidden rounded-full text-[13px] font-bold" style={{ background: C.pill, color: C.text }}>
        {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover"/> : initials}
      </span>
      <div className="min-w-0">
        <p className="text-xs" style={{ color: C.muted }}>{label}</p>
        <p className="truncate font-semibold" style={{ color: C.text }}>{name}</p>
      </div>
      {username && <a href={`/s/${username}`} className={`${btnClass} ml-auto h-8 px-3 text-xs`} style={btnStyle('sec', C)}>View profile</a>}
    </div>
  );
}

/** The date and the ID, the ID with a copy button. */
export function CredentialFacts({ dateLabel = 'Issued', date, idLabel = 'Credential ID', id }: { dateLabel?: string; date: string; idLabel?: string; id: string }) {
  const C = useC();
  const [copied, setCopied] = useState(false);
  const copy = () => navigator.clipboard?.writeText(id).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  return (
    <div className="grid gap-2 text-[13px]" style={{ color: C.muted }}>
      <div className="flex items-center gap-2"><CalendarBlank size={15} weight="bold"/>{dateLabel} <b className="font-semibold" style={{ color: C.text }}>{date}</b></div>
      {/* IDs are long codes: the label on its own line, the whole ID under it, wrapping, never cut off. */}
      <div className="flex min-w-0 items-start gap-2">
        <IdentificationCard size={15} weight="bold" className="mt-0.5 flex-shrink-0"/>
        <div className="min-w-0 flex-1">
          <p>{idLabel}</p>
          <p className="mt-0.5 break-all font-mono text-xs font-semibold" style={{ color: C.text }}>{id}</p>
        </div>
        <button type="button" onClick={copy} aria-label={`Copy ${idLabel.toLowerCase()}`} title="Copy" className="flex-shrink-0 rounded-md p-1 hover:opacity-70">
          {copied ? <Check size={14} weight="bold" style={{ color: '#12A150' }}/> : <Copy size={14} weight="bold"/>}
        </button>
      </div>
    </div>
  );
}

export type DownloadOption = { label: string; run: () => Promise<void> };

/** Download (a menu when there is more than one thing to download), Add to LinkedIn, Copy link: one line.
 * `linkedIn` builds the Add to LinkedIn address from this page's address. */
export function CredentialActions({ downloads, linkedIn }: { downloads: DownloadOption[]; linkedIn: (pageUrl: string) => string }) {
  const C = useC();
  // Compact, as the mockup: Download, Add to LinkedIn and Copy link fit on one line in the panel.
  const btn = 'inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50';
  const pageUrl = usePageUrl();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const run = async (d: DownloadOption) => {
    setOpen(false);
    setBusy(true);
    try { await d.run(); } finally { setBusy(false); }
  };
  const copyLink = () => navigator.clipboard?.writeText(pageUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  return (
    <div className="flex flex-wrap items-center gap-2">
      {downloads.length > 0 && (
        <div className="relative">
          {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)}/>}
          <button type="button" disabled={busy} aria-haspopup={downloads.length > 1 ? 'menu' : undefined} aria-expanded={downloads.length > 1 ? open : undefined}
            onClick={() => (downloads.length > 1 ? setOpen(o => !o) : run(downloads[0]))}
            className={btn} style={{ background: DARK_C.cta, color: '#ffffff' }}>
            {busy ? <SpinnerGap size={16} weight="bold" className="animate-spin"/> : <DownloadSimple size={16} weight="bold"/>}
            {busy ? 'Preparing' : 'Download'}
            {downloads.length > 1 && <CaretDown size={12} weight="bold"/>}
          </button>
          {open && (
            <div role="menu" className="absolute left-0 top-[calc(100%+6px)] z-20 min-w-[200px] overflow-hidden rounded-xl py-1 shadow-xl" style={{ background: C.card, boxShadow: `0 12px 32px rgba(0,0,0,0.14), inset 0 0 0 1px ${C.divider}` }}>
              {downloads.map(d => (
                <button key={d.label} type="button" role="menuitem" onClick={() => run(d)}
                  className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-[13px] font-semibold hover:opacity-80" style={{ color: C.text }}>
                  <DownloadSimple size={14} weight="bold" style={{ color: C.muted }}/> {d.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <a href={pageUrl ? linkedIn(pageUrl) : '#'} target="_blank" rel="noopener noreferrer" className={btn} style={btnStyle('sec', C)}>
        <LinkedinLogo size={16} weight="fill" style={{ color: '#0A66C2' }}/> Add to LinkedIn
      </a>
      <button type="button" onClick={copyLink} className={btn} style={btnStyle('sec', C)}>
        {copied ? <Check size={15} weight="bold" style={{ color: '#12A150' }}/> : <LinkSimple size={15} weight="bold"/>}
        {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}

/** Skills as small chips, under a heading. */
export function SkillChips({ skills }: { skills: string[] }) {
  const C = useC();
  if (!skills.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-[13px] font-semibold" style={{ color: C.text }}>Skills</p>
      <div className="flex flex-wrap gap-1.5">
        {skills.map(s => <span key={s} className="rounded-lg px-2.5 py-0.5 text-xs font-medium" style={{ background: C.pill, color: C.text }}>{s}</span>)}
      </div>
    </div>
  );
}

/** Who issued it, under a line, at the foot of the panel. */
export function IssuerNote({ issuer, idLabel = 'ID' }: { issuer: string; idLabel?: string }) {
  const C = useC();
  return (
    <p className="pt-3.5 text-xs" style={{ color: C.muted, borderTop: `1px solid ${C.divider}` }}>
      {issuer ? `Issued by ${issuer}. ` : ''}This page is the official record of this credential; the {idLabel} above confirms it.
    </p>
  );
}

/** Saves the full-size certificate (rendered off screen into `node`) as a PDF. */
export async function downloadCertificatePdf(node: HTMLElement | null, fileName: string) {
  if (!node) return;
  try {
    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF } = await import('jspdf');
    await document.fonts.ready;
    const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'px', format: [canvas.width / 2, canvas.height / 2] });
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width / 2, canvas.height / 2);
    pdf.save(fileName);
  } catch {
    alert('Could not make the PDF. Please try again.');
  }
}

/** Saves an image file; opens it in a new tab when the browser will not save it directly. */
export async function downloadImage(url: string, fileName: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(String(res.status));
    const objectUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = objectUrl; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

/** The full-size certificate, off screen, for the PDF. */
export function PdfSource({ nodeRef, ...props }: CertificateTemplateProps & { nodeRef: React.Ref<HTMLDivElement> }) {
  return (
    <div aria-hidden style={{ position: 'fixed', top: 0, left: -10000, zIndex: -1 }}>
      <CertificateTemplate ref={nodeRef} {...props}/>
    </div>
  );
}
