'use client';

/**
 * Share buttons for a public page (a product, an event): WhatsApp, LinkedIn, X and Facebook, Copy
 * link, and the device's own share sheet where there is one (phones). The link's preview comes
 * from the page's metadata; the title and blurb go along for apps that show text.
 */
import { useState, useSyncExternalStore } from 'react';
import { Check, Link2, Share2 } from 'lucide-react';
import { SHARE_PLATFORMS } from '@/components/share-platforms';

const ORDER = ['whatsapp', 'linkedin', 'twitter', 'facebook'] as const;
const BUTTON_SHADOW = '0 1px 2px rgba(15,23,42,0.06), 0 8px 20px -12px rgba(15,23,42,0.2)';
const noop = () => () => {};

export function ShareButtons({ url: givenUrl, title, blurb, className = 'flex flex-wrap items-center gap-2' }: {
  url: string;
  title: string;
  blurb: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  // Read once on the client; false on the server, so the first render matches.
  const canNativeShare = useSyncExternalStore(noop, () => typeof navigator !== 'undefined' && typeof navigator.share === 'function', () => false);
  // The server passes the tenant's address; without one configured, the address being viewed.
  const pageUrl = useSyncExternalStore(noop, () => givenUrl || window.location.href.split(/[?#]/)[0], () => givenUrl);
  if (!pageUrl) return null;

  const platforms = ORDER.map(id => SHARE_PLATFORMS.find(p => p.id === id)!).filter(Boolean);

  async function copy() {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link', pageUrl);
    }
  }

  async function nativeShare() {
    try { await navigator.share({ title, text: `${title}\n${blurb}`, url: pageUrl }); } catch { /* closed by the person */ }
  }

  const btn = 'w-10 h-10 rounded-full inline-flex items-center justify-center transition-transform hover:-translate-y-0.5';
  const style = { background: '#ffffff', color: '#0f172a', boxShadow: BUTTON_SHADOW };
  return (
    <div className={className}>
      <span className="text-sm mr-1" style={{ color: '#64748b' }}>Share</span>
      {canNativeShare && (
        <button type="button" onClick={nativeShare} aria-label="Share" title="Share" className={btn} style={style}>
          <Share2 className="w-4 h-4" />
        </button>
      )}
      {platforms.map(p => (
        <a key={p.id} href={p.href(pageUrl, title, blurb)} target="_blank" rel="noopener noreferrer" aria-label={`Share on ${p.label}`} title={p.label}
          className={btn} style={style}>
          {p.icon}
        </a>
      ))}
      <button type="button" onClick={copy} aria-label={copied ? 'Link copied' : 'Copy link'} title={copied ? 'Copied' : 'Copy link'}
        className="h-10 px-4 rounded-full inline-flex items-center gap-2 text-sm font-semibold transition-transform hover:-translate-y-0.5"
        style={{ ...style, color: copied ? '#16a34a' : '#0f172a' }}>
        {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />} {copied ? 'Copied' : 'Copy link'}
      </button>
    </div>
  );
}
