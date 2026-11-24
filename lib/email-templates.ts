import { tenant } from './tenant';
import { resolveCoverUrl, IMG_EMAIL, IMG_EMAIL_THUMB } from './cloudinary-url';

function esc(s: string | null | undefined): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const BANNER  = tenant.logoUrl;
const APP_URL = process.env.APP_URL || tenant.appUrl;

export interface EmailBranding {
  logoUrl?:        string;
  emailBannerUrl?: string;
  teamName?:       string;
  appName?:        string;
  appUrl?:         string;
  /** The site's brand colour (Site Settings); buttons and links take it. */
  brandColor?:     string;
}

// -- Shared shell ---
/** Relative luminance of a #rrggbb colour, to choose readable text on it. */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map(c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

/**
 * The templates are written with one stand-in blue (#2563eb). Here it becomes the site's brand
 * colour: filled buttons take the brand with readable text on it, and blue text takes the brand
 * only when it is dark enough to read on white.
 */
export function brandEmailColors(html: string, brandColor?: string): string {
  const brand = /^#[0-9a-f]{6}$/i.test(brandColor || '') ? brandColor! : '#2563eb';
  if (brand.toLowerCase() === '#2563eb') return html;
  const onBrand = luminance(brand) > 0.45 ? '#111827' : '#ffffff';
  const textColor = luminance(brand) < 0.3 ? brand : '#111827';
  return html
    .replace(/background(-color)?:#2563eb;color:#ffffff/gi, (_m, dash) => `background${dash || ''}:${brand};color:${onBrand}`)
    .replace(/border-left:4px solid #2563eb/gi, `border-left:4px solid ${brand}`)
    .replace(/color:#2563eb/gi, `color:${textColor}`);
}

// -- Building blocks ---
// Every email is a white card on a grey page: a header (logo and a small "kind" pill), a hero
// that says the news, the content, and a slim footer. Layout is tables with inline styles, so it
// holds in Gmail and Outlook. Icons are Phosphor glyphs sent as small PNGs from the site
// (public/email-icons): mail apps do not show SVG, and every icon has alt="" so nothing breaks
// when images are blocked.
//
// Colour rules: icons are dark (#1f2937); only status icons are coloured (a green tick, a green
// seal, a red warning). Tinted boxes are fill only, with no border and no side bar; white cards
// keep a thin #e5e7eb border. The stand-in blue #2563eb becomes the site's brand colour in
// brandEmailColors, so filled brand elements are always written "background:#2563eb;color:#ffffff".

/** Placeholder for the icon folder; the shell swaps in `${appUrl}/email-icons`. */
const ICONS = '__EMAIL_ICONS__';

function icon(name: string, size = 20): string {
  return `<img src="${ICONS}/${name}.png" width="${size}" height="${size}" alt="" style="display:inline-block;width:${size}px;height:${size}px;border:0;outline:none;vertical-align:middle;" />`;
}

type Tone = 'info' | 'good' | 'warn';
const HERO_EYEBROW: Record<Tone, string> = { info: '#2563eb', good: '#15803d', warn: '#b45309' };

/**
 * The news, as the opening title of the email: a small grey icon tile with a coloured label on one
 * line, then the headline and one line. No box or background, so the banner or logo above stays the
 * only header; the label's colour carries the tone.
 */
function hero(iconName: string, eyebrow: string, title: string, sub: string, tone: Tone = 'info'): string {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td width="36" height="36" align="center" valign="middle" style="width:36px;height:36px;background:#f3f4f6;border-radius:10px;">${icon(iconName, 20)}</td>
      <td valign="middle" style="padding-left:10px;"><p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${HERO_EYEBROW[tone]};">${eyebrow}</p></td>
    </tr></table>
    <h1 style="margin:14px 0 6px;font-size:24px;line-height:1.25;font-weight:700;color:#0f172a;">${title}</h1>
    ${sub ? `<p style="margin:0;font-size:15px;line-height:1.55;color:#4b5563;">${sub}</p>` : ''}`;
}

// signOff: false leaves out the name line under the sign-off, for emails that sign themselves.
function shell(content: string, opts?: { bannerUrl?: string; neutralFooter?: boolean; signOff?: boolean; kind?: string; hero?: string } & EmailBranding) {
  const bannerUrl = opts?.bannerUrl || opts?.emailBannerUrl;
  const logoUrl   = opts?.logoUrl || BANNER;
  const appName   = opts?.appName   || tenant.appName  || 'the platform';
  const appUrl_   = opts?.appUrl    || APP_URL;
  const teamName  = opts?.teamName;
  // opts.kind is still accepted from the callers but no longer drawn: the hero's label says it.

  const headerHtml = bannerUrl
    ? `<tr><td style="padding:0;">
        <img src="${bannerUrl}" alt="${appName}" width="600" style="width:100%;height:auto;display:block;" />
      </td></tr>
      `
    : `<tr><td style="padding:18px 26px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle">${logoUrl
            ? `<img src="${logoUrl}" alt="${appName}" style="height:48px;width:auto;display:block;object-fit:contain;" />`
            : `<span style="font-size:16px;font-weight:700;color:#111827;">${esc(appName)}</span>`}</td>
        </tr></table>
      </td></tr>`;

  return brandEmailColors(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;margin:0 auto;background-color:#ffffff;">

        ${headerHtml}

        ${opts?.hero ? `<tr><td style="padding:26px 26px 0;">${opts.hero}</td></tr>` : ''}

        <!-- Content -->
        <tr><td style="padding:22px 26px 6px;font-size:15px;line-height:1.6;color:#1f2937;">
          <!-- PLATFORM_SYSTEM_EMAIL_CONTENT -->
          ${content}
          ${opts?.signOff === false ? '' : `<p style="margin:2px 0 18px;font-size:15px;color:#4b5563;">${esc(teamName || appName)}</p>`}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:14px 26px 18px;border-top:1px solid #f0f1f3;font-size:12px;line-height:1.5;color:#9ca3af;">
          ${opts?.neutralFooter ? `You received this because this email address is associated with ${appName}.` : `You received this because you are enrolled on ${appName}.`} &middot;
          <a href="${appUrl_}" style="color:#2563eb;">Visit ${appName}</a>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`.split(ICONS).join(`${(appUrl_ || '').replace(/\/$/, '')}/email-icons`), opts?.brandColor);
}

/** The closing line; the shell adds the team or site name under it. */
function signoff(text = 'Best regards,'): string {
  return `<p style="margin:22px 0 0;font-size:15px;font-weight:700;color:#111827;">${text}</p>`;
}

function cta(label: string, url: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;">
    <tr><td style="border-radius:10px;">
      <a href="${url}" style="background-color:#2563eb;color:#ffffff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px;display:inline-block;">${label}</a>
    </td></tr>
  </table>`;
}

/** A second, quieter button: white with a grey outline. */
function ctaGhost(label: string, url: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;">
    <tr><td style="border-radius:10px;">
      <a href="${url}" style="background-color:#ffffff;color:#111827;border:1px solid #d1d5db;padding:12px 21px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:14px;display:inline-block;">${label}</a>
    </td></tr>
  </table>`;
}

function small(text: string, iconName?: string): string {
  return `<p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#6b7280;">${iconName ? `${icon(iconName, 14)}&nbsp; ` : ''}${text}</p>`;
}

function sectionLabel(text: string, color = '#6b7280'): string {
  return `<p style="margin:22px 0 10px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${color};">${text}</p>`;
}

/** A white card with a thin border. */
function card(inner: string, padding = '18px 20px'): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid #e5e7eb;border-radius:14px;">
    <tr><td style="padding:${padding};">${inner}</td></tr>
  </table>`;
}

type CalloutTone = 'good' | 'warn' | 'bad' | 'info';
const CALLOUT: Record<CalloutTone, { bg: string; title: string; text: string }> = {
  good: { bg: '#ecfdf3', title: '#15803d', text: '#166534' },
  warn: { bg: '#fff7e6', title: '#92400e', text: '#78350f' },
  bad:  { bg: '#fef2f2', title: '#b91c1c', text: '#991b1b' },
  info: { bg: '#f3f4f6', title: '#111827', text: '#374151' },
};

/** A tinted note: fill only, no border. */
function callout(tone: CalloutTone, title: string, text?: string): string {
  const c = CALLOUT[tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;background:${c.bg};border-radius:12px;">
    <tr><td style="padding:14px 18px;">
      ${title ? `<p style="margin:0${text ? ' 0 4px' : ''};font-size:14px;font-weight:700;color:${c.title};">${title}</p>` : ''}
      ${text ? `<p style="margin:0;font-size:14px;line-height:1.6;color:${c.text};">${text}</p>` : ''}
    </td></tr>
  </table>`;
}

/** A white pill with a thin coloured outline, for a status on white (Paid, Active). */
function stamp(text: string, tone: 'good' | 'warn' | 'bad' = 'good'): string {
  const c = tone === 'good' ? { fg: '#15803d', line: '#bbf7d0', ic: 'seal-check-green' }
    : tone === 'warn' ? { fg: '#b45309', line: '#fde68a', ic: '' }
    : { fg: '#b91c1c', line: '#fecaca', ic: 'warning-circle-red' };
  return `<span style="display:inline-block;white-space:nowrap;font-size:12.5px;font-weight:700;color:${c.fg};background:#ffffff;border:1px solid ${c.line};padding:4px 11px;border-radius:99px;">${c.ic ? `${icon(c.ic, 14)}&nbsp;` : ''}${text}</span>`;
}

/** Label and value rows inside a card, each with an optional icon. */
function detailRows(rows: Array<{ icon?: string; label: string; value: string; mono?: boolean }>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
    ${rows.map((r, i) => `<tr>
      <td style="padding:11px 0;${i ? 'border-top:1px solid #f0f1f3;' : ''}color:#6b7280;">${r.icon ? `${icon(r.icon, 16)}&nbsp; ` : ''}${r.label}</td>
      <td align="right" style="padding:11px 0;${i ? 'border-top:1px solid #f0f1f3;' : ''}font-weight:700;color:#111827;${r.mono ? 'font-family:Menlo,Consolas,monospace;' : ''}">${r.value}</td>
    </tr>`).join('')}
  </table>`;
}

/** The big figure at the top of a money card: a small label, the amount, and an optional stamp. */
function figureHead(label: string, figure: string, right = '', sub = ''): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td valign="middle">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">${label}</p>
      <p style="margin:0;font-size:32px;line-height:1.15;font-weight:800;color:#0f172a;">${figure}</p>
      ${sub ? `<p style="margin:4px 0 0;font-size:13px;color:#6b7280;">${sub}</p>` : ''}
    </td>
    ${right ? `<td valign="middle" align="right">${right}</td>` : ''}
  </tr></table>`;
}

/** A "3 days left" tile: tinted fill, the number large. */
function countdownTile(days: number): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td align="center" style="background:#fff7e6;border-radius:12px;padding:8px 16px;">
      <p style="margin:0;font-size:26px;line-height:1.1;font-weight:800;color:#b45309;">${days}</p>
      <p style="margin:0;font-size:12px;font-weight:700;color:#92400e;white-space:nowrap;">day${days === 1 ? '' : 's'} left</p>
    </td>
  </tr></table>`;
}

/** Whole days from today to a date (date-only values anchored at noon); null when it does not parse. */
function daysUntil(value: string): number | null {
  const v = (value || '').trim();
  if (!v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const that = new Date(d); that.setHours(12, 0, 0, 0);
  return Math.round((that.getTime() - today.getTime()) / 86400000);
}

/** A dashed vertical line between two steps, under a 34px tile. */
const STEP_GAP = `<tr><td style="padding:0 0 0 16px;font-size:0;line-height:0;"><div style="border-left:2px dashed #d1d5db;height:12px;font-size:0;line-height:0;">&nbsp;</div></td><td></td></tr>`;

/** Steps done in order: a grey icon tile per step, joined by a dashed line. */
function stepTimeline(steps: Array<{ icon: string; title: string; text?: string; tone?: 'good' }>): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
    ${steps.map((s, i) => `${i ? STEP_GAP : ''}<tr>
      <td width="34" valign="top" style="width:34px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="34" height="34" align="center" valign="middle" style="width:34px;height:34px;border-radius:10px;background:${s.tone === 'good' ? '#ecfdf3' : '#f3f4f6'};">${icon(s.icon, 18)}</td></tr></table>
      </td>
      <td valign="top" style="padding:2px 0 0 12px;">
        ${s.title ? `<p style="margin:0;font-size:14px;font-weight:700;color:#111827;">${s.title}</p>` : ''}
        ${s.text ? `<p style="margin:${s.title ? '0' : '6px 0 0'};font-size:${s.title ? '13px' : '14px'};line-height:1.5;color:${s.title ? '#6b7280' : '#374151'};">${s.text}</p>` : ''}
      </td>
    </tr>`).join('')}
  </table>`;
}

/** The kind of a learning item: its menu icon and label. */
function itemKind(item: { isVE?: boolean; isCert?: boolean }): { icon: string; label: string } {
  return item.isVE ? { icon: 'briefcase', label: 'Virtual experience' }
    : item.isCert ? { icon: 'seal-check', label: 'Certification' }
    : { icon: 'play-circle', label: 'Course' };
}

/** The item's cover, or a grey tile with its kind's icon when there is none. Never a letter. */
function coverTile(coverImage: string | null | undefined, kindIcon: string, size = 64): string {
  return coverImage
    ? `<img src="${resolveCoverUrl(coverImage, IMG_EMAIL_THUMB)}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;object-fit:cover;border-radius:10px;border:0;" />`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="${size}" height="${size}" align="center" valign="middle" style="width:${size}px;height:${size}px;border-radius:10px;background:#f3f4f6;">${icon(kindIcon, 28)}</td></tr></table>`;
}

/**
 * A learning item with its cover shown full width on top, as these emails always showed it, then the
 * kind label, title and description. Without a cover it falls back to the compact item card.
 */
function coverCard(item: { title: string; coverImage?: string | null; isVE?: boolean; isCert?: boolean; description?: string | null }, height: number): string {
  if (!item.coverImage) return itemCard(item);
  const k = itemKind(item);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:14px;">
    <tr><td style="padding:0;"><img src="${resolveCoverUrl(item.coverImage, IMG_EMAIL)}" width="600" height="${height}" alt="" style="display:block;width:100%;height:${height}px;object-fit:cover;border:0;border-radius:14px 14px 0 0;" /></td></tr>
    <tr><td style="padding:14px 16px 16px;">
      <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;">${icon(k.icon, 13)}&nbsp; ${k.label}</p>
      <p style="margin:2px 0 0;font-size:16px;font-weight:700;line-height:1.35;color:#111827;">${item.title}</p>
      ${item.description ? `<p style="margin:3px 0 0;font-size:13px;line-height:1.45;color:#6b7280;">${item.description}</p>` : ''}
    </td></tr>
  </table>`;
}

/** A learning item card: cover, kind label with its icon, title, description, and an optional chip. */
function itemCard(item: { title: string; coverImage?: string | null; isVE?: boolean; isCert?: boolean; description?: string | null }, chip = '', highlight = false): string {
  const k = itemKind(item);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${highlight ? '#d1d5db' : '#e5e7eb'};border-radius:14px;">
    <tr>
      <td width="64" valign="middle" style="padding:10px 0 10px 10px;width:64px;">${coverTile(item.coverImage, k.icon)}</td>
      <td valign="middle" style="padding:10px 12px;">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;">${icon(k.icon, 13)}&nbsp; ${k.label}</p>
        <p style="margin:1px 0 0;font-size:15px;font-weight:700;line-height:1.35;color:#111827;">${item.title}</p>
        ${item.description ? `<p style="margin:2px 0 0;font-size:13px;line-height:1.45;color:#6b7280;">${item.description}</p>` : ''}
        ${chip ? `<p style="margin:6px 0 0;"><span style="display:inline-block;font-size:11.5px;font-weight:700;color:#2563eb;background:#f3f4f6;padding:2px 9px;border-radius:99px;">${chip}</span></p>` : ''}
      </td>
    </tr>
  </table>`;
}

/** A numbered (or ticked) circle on the learning journey. */
function journeyDot(state: 'next' | 'todo' | 'done', n: number): string {
  const style = state === 'next' ? 'background:#2563eb;color:#ffffff;'
    : state === 'done' ? 'background:#16a34a;color:#ffffff;'
    : 'background:#ffffff;color:#6b7280;border:2px solid #e5e7eb;';
  const size = state === 'todo' ? 28 : 32;
  return `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="${size}" height="${size}" align="center" valign="middle" style="width:${size}px;height:${size}px;border-radius:50%;${style}font-size:13px;font-weight:700;">${state === 'done' ? icon('check-white', 16) : n}</td></tr></table>`;
}

const JOURNEY_GAP = `<tr><td style="padding:0 0 0 15px;font-size:0;line-height:0;"><div style="border-left:2px dashed #d1d5db;height:12px;font-size:0;line-height:0;">&nbsp;</div></td><td></td></tr>`;

/** A learning path as a dashed journey of item cards that ends at a goal. */
function journey(items: Array<{ title: string; coverImage?: string | null; isVE?: boolean; isCert?: boolean; description?: string | null }>, opts: { done?: boolean; goal?: { title: string; text: string } }): string {
  const rows = items.map((item, i) => `${i ? JOURNEY_GAP : ''}<tr>
      <td width="32" valign="middle" style="width:32px;">${journeyDot(opts.done ? 'done' : i === 0 ? 'next' : 'todo', i + 1)}</td>
      <td valign="middle" style="padding:0 0 0 12px;">${itemCard(item, !opts.done && i === 0 ? 'Up first' : '', !opts.done && i === 0)}</td>
    </tr>`).join('');
  const goal = opts.goal ? `${items.length ? JOURNEY_GAP : ''}<tr>
      <td width="32" valign="middle" style="width:32px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="32" height="32" align="center" valign="middle" style="width:32px;height:32px;border-radius:50%;background:#f3f4f6;">${icon('certificate', 18)}</td></tr></table>
      </td>
      <td valign="middle" style="padding:0 0 0 12px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffbeb;border-radius:14px;"><tr><td style="padding:12px 14px;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#78350f;">${opts.goal.title}</p>
          <p style="margin:0;font-size:13px;color:#92400e;">${opts.goal.text}</p>
        </td></tr></table>
      </td>
    </tr>` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">${rows}${goal}</table>`;
}

/** A coloured progress bar, email-safe (nested tables). */
function bar(pct: number, color = '#16a34a'): string {
  const w = Math.max(3, Math.min(100, Math.round(pct)));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e5e7eb;border-radius:999px;"><tr><td style="padding:0;font-size:0;line-height:0;">
    <table role="presentation" width="${w}%" cellpadding="0" cellspacing="0" style="background:${color};border-radius:999px;"><tr><td height="7" style="font-size:0;line-height:0;">&nbsp;</td></tr></table>
  </td></tr></table>`;
}

/**
 * The score, large, with a bar filled to the real share under it. Email cannot draw part of a
 * circle, so a bar stands in for a ring. Leave pct out for a plain count (no bar).
 */
function scoreRing(label: string, value: string, color = '#16a34a', pct?: number): string {
  return `<table role="presentation" width="96" cellpadding="0" cellspacing="0" style="width:96px;"><tr>
    <td align="center" valign="middle" style="padding:4px 0;">
      <p style="margin:0;font-size:30px;line-height:1;font-weight:800;color:${color === '#111827' ? '#111827' : color};">${value}</p>
      <p style="margin:4px 0 ${pct != null ? '8px' : '0'};font-size:11px;color:#6b7280;">${label}</p>
      ${pct != null ? bar(pct, color) : ''}
    </td>
  </tr></table>`;
}

/** A tinted certificate card: icon, title and one line. Fill only. */
function certificateCard(title: string, line: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;background:#fffbeb;border-radius:14px;">
    <tr>
      <td width="44" valign="middle" style="padding:14px 0 14px 16px;width:44px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="44" height="44" align="center" valign="middle" style="width:44px;height:44px;border-radius:12px;background:#ffffff;">${icon('certificate', 24)}</td></tr></table>
      </td>
      <td valign="middle" style="padding:14px 16px 14px 12px;">
        <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">${title}</p>
        ${line ? `<p style="margin:0;font-size:13px;color:#92400e;">${line}</p>` : ''}
      </td>
    </tr>
  </table>`;
}

/** Parts of an event date for the ticket stub; null when the date does not parse. */
function ticketDate(value?: string): { month: string; day: string; weekday: string } | null {
  const v = (value || '').trim();
  if (!v) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v);
  if (Number.isNaN(d.getTime())) return null;
  return {
    month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    day: String(d.getDate()),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
  };
}

/** An event as a ticket: a brand date stub, a dashed perforation, the details and an action. */
function ticket(data: { title: string; date?: string; rows: Array<{ icon: string; text: string }>; action?: string }): string {
  const t = ticketDate(data.date);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 14px;border:1px solid #e5e7eb;border-radius:14px;">
    <tr>
      ${t ? `<td width="92" align="center" valign="middle" style="width:92px;padding:18px 0;background:#2563eb;color:#ffffff;border-radius:13px 0 0 13px;">
        <p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.1em;color:#ffffff;">${t.month}</p>
        <p style="margin:0;font-size:38px;line-height:1.05;font-weight:800;color:#ffffff;">${t.day}</p>
        <p style="margin:0;font-size:12px;font-weight:700;color:#ffffff;">${t.weekday}</p>
      </td>
      <td width="1" style="width:0;border-left:2px dashed #e5e7eb;font-size:0;">&nbsp;</td>` : ''}
      <td valign="middle" style="padding:16px 18px;">
        <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:#111827;">${data.title}</p>
        ${data.rows.map(r => `<p style="margin:4px 0 0;font-size:14px;color:#374151;">${icon(r.icon, 16)}&nbsp; ${r.text}</p>`).join('')}
        ${data.action || ''}
      </td>
    </tr>
  </table>`;
}

/** A small brand button for inside a card. */
function ctaSmall(label: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:12px 0 0;"><tr><td style="border-radius:10px;">
    <a href="${url}" style="background-color:#2563eb;color:#ffffff;padding:9px 14px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:13px;display:inline-block;">${label}</a>
  </td></tr></table>`;
}

function badgeBlock(badgeName: string, badgeImageUrl: string, badgesUrl: string) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid #e5e7eb;border-radius:14px;">
      <tr>
        <td width="80" valign="middle" style="padding:14px 0 14px 16px;width:80px;">
          <img src="${badgeImageUrl}" alt="${esc(badgeName)}" width="72" height="72" style="display:block;width:72px;height:72px;object-fit:contain;" />
        </td>
        <td valign="middle" style="padding:14px 16px;">
          <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">${icon('medal', 13)}&nbsp; Badge earned</p>
          <p style="margin:2px 0 8px;font-size:16px;font-weight:700;color:#111827;">${esc(badgeName)}</p>
          <a href="${badgesUrl}" style="font-size:13px;font-weight:700;color:#2563eb;text-decoration:none;">View in your profile</a>
        </td>
      </tr>
    </table>
  `;
}

// -- helpers for meeting platform ---
function platformName(url?: string): string {
  if (!url) return '';
  const u = url.toLowerCase();
  if (u.includes('meet.google.com')) return 'Google Meet';
  if (u.includes('zoom.us')) return 'Zoom';
  if (u.includes('teams.microsoft.com') || u.includes('teams.live.com')) return 'Microsoft Teams';
  return '';
}

/** Where an event happens, for the ticket: the location, plus the platform when it is known. */
function eventPlace(location?: string, meetingLink?: string): string {
  return [location, platformName(meetingLink)].filter(Boolean).map(s => esc(s)).join(' | ');
}

// -- 1. Event Registration Confirmation ---
export function confirmationEmail(data: {
  name?: string;
  eventTitle: string;
  eventDate?: string;
  eventTime?: string;
  eventLocation?: string;
  eventTimezone?: string;
  meetingLink?: string;
  joinUrl?: string;
  eventType?: string;
  formUrl: string;
  customTitle?: string;
  customBody?: string;
  bannerUrl?: string;
  branding?: EmailBranding;
}) {
  const { name, eventTitle, eventDate, eventTime, eventLocation, eventTimezone, meetingLink, joinUrl, formUrl, customTitle, customBody, bannerUrl, branding } = data;
  const joinHref = joinUrl || meetingLink;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name || 'there')},</b></p>
    <p style="margin:0 0 14px;">${customBody ? esc(customBody) : 'Your registration has been confirmed. We look forward to seeing you!'}</p>
    ${ticket({
      title: esc(eventTitle),
      date: eventDate,
      rows: [
        ...(eventDate ? [{ icon: 'calendar-blank', text: `Date: ${esc([eventDate, eventTime, eventTimezone].filter(Boolean).join(' | '))}` }] : []),
        ...(eventLocation ? [{ icon: 'map-pin', text: `Location: ${esc(eventLocation)}` }] : []),
        ...(platformName(meetingLink) ? [{ icon: 'video-camera', text: esc(platformName(meetingLink)) }] : []),
      ],
      action: meetingLink ? ctaSmall('Join meeting', joinHref!) : '',
    })}
    ${meetingLink ? small('Keep this link. You will need it to attend.', 'info') : ''}
    ${ctaGhost('View event', formUrl)}
    <p style="margin:0 0 14px;">Keep this email for your records. You'll receive a reminder before the event starts.</p>
    ${signoff()}
  `;

  return shell(content, {
    ...branding, bannerUrl: bannerUrl || undefined, kind: 'Event',
    hero: hero('calendar-dots', 'Event', customTitle ? esc(customTitle) : 'Registration confirmed', '', 'good'),
  });
}


// -- 2. Event Reminder ---
export function reminderEmail(data: {
  name?: string;
  eventTitle: string;
  eventDate?: string;
  eventTime?: string;
  eventLocation?: string;
  eventTimezone?: string;
  meetingLink?: string;
  joinUrl?: string;
  formUrl: string;
  isOneHour?: boolean;
  /** Day-before wording when not isOneHour. A session reminded late can already be today. */
  day?: 'today' | 'tomorrow';
  bannerUrl?: string;
  branding?: EmailBranding;
}) {
  const { name, eventTitle, eventDate, eventTime, eventLocation, eventTimezone, meetingLink, joinUrl, formUrl, isOneHour, day, bannerUrl, branding } = data;
  const joinHref  = joinUrl || meetingLink;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name || 'there')},</b></p>
    <p style="margin:0 0 14px;">This is a friendly reminder that <b>${esc(eventTitle)}</b> ${isOneHour ? 'is starting in <b>1 hour</b>. Get ready!' : `is happening <b>${day ?? 'tomorrow'}</b>.`}</p>
    ${ticket({
      title: esc(eventTitle),
      date: eventDate,
      rows: [
        ...(eventDate ? [{ icon: 'calendar-blank', text: `Date: ${esc([eventDate, eventTime, eventTimezone].filter(Boolean).join(' | '))}` }] : []),
        ...(eventLocation ? [{ icon: 'map-pin', text: `Location: ${esc(eventLocation)}` }] : []),
        ...(platformName(meetingLink) ? [{ icon: 'video-camera', text: esc(platformName(meetingLink)) }] : []),
      ],
      action: meetingLink ? ctaSmall('Join meeting', joinHref!) : '',
    })}
    ${ctaGhost('View event details', formUrl)}
    <p style="margin:0 0 14px;">You can access your dashboard anytime to view your upcoming events.</p>
    ${signoff()}
  `;

  return shell(content, {
    ...branding, bannerUrl: bannerUrl || undefined, kind: 'Reminder',
    hero: hero('calendar-dots', 'Live session', 'Event Reminder', ''),
  });
}


// -- 3. Course Result ---
export function courseResultEmail(data: {
  name?: string;
  courseTitle: string;
  score: number;
  total: number;
  percentage: number;
  passed: boolean;
  points?: number;
  passmark?: number;
  formUrl: string;
  certUrl?: string;
  correctQuestions?: number;
  totalQuestions?: number;
  skills?: Array<{ name: string; correct: number; total: number; pct: number }>;
  badgeName?: string;
  badgeImageUrl?: string;
  recommendations?: Array<{ title: string; slug: string; coverImage?: string | null }>;
  branding?: EmailBranding;
}) {
  const { name, courseTitle, percentage, passed, passmark, formUrl, certUrl, correctQuestions, totalQuestions, skills, badgeName, badgeImageUrl, recommendations, branding } = data;
  const appUrl = branding?.appUrl || process.env.APP_URL || tenant.appUrl;

  const recsHtml = recommendations?.length ? `
    ${sectionLabel('What to take next')}
    <p style="margin:-4px 0 14px;color:#666;font-size:14px;">Based on what you just completed, you might enjoy these:</p>
    ${recommendations.slice(0, 3).map(r => `
      <a href="${appUrl}/${r.slug}?go=1" style="display:block;text-decoration:none;margin-bottom:10px;">
        ${coverCard({ title: esc(r.title), coverImage: r.coverImage, description: 'Start course' }, 140)}
      </a>
    `).join('')}
  ` : '';

  // Embedded performance report (certifications only -- courses do not pass `skills`). Email-safe:
  // a ring for the score and nested-table bars, so it renders without CSS or SVG support.
  const pm = passmark ?? 70;
  // Shown for certification passes (they pass correctQuestions); the per-skill list appears only
  // when skill areas exist. Course/VE emails pass neither, so they are unaffected.
  const resultsHtml = (passed && (correctQuestions != null || (skills && skills.length))) ? `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 14px;border:1px solid #e5e7eb;border-radius:14px;">
      <tr>
        <td width="96" valign="middle" style="padding:18px 0 18px 18px;width:96px;">${scoreRing('Overall score', `${percentage}%`, '#16a34a', percentage)}</td>
        <td valign="middle" style="padding:18px 20px 18px 18px;">
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">Your results</p>
          ${(skills ?? []).map(s => `
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0;"><tr>
              <td width="110" style="font-size:13px;color:#374151;vertical-align:middle;">${esc(s.name)}</td>
              <td style="vertical-align:middle;padding:0 10px;">${bar(s.pct)}</td>
              <td width="40" align="right" style="font-size:13px;font-weight:700;color:#111827;vertical-align:middle;">${s.pct}%</td>
            </tr></table>
          `).join('')}
          ${correctQuestions != null && totalQuestions != null ? `<p style="margin:6px 0 0;font-size:13px;color:#6b7280;">scored ${correctQuestions} of ${totalQuestions}, pass mark ${pm}%</p>` : ''}
        </td>
      </tr>
    </table>
  ` : '';

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name || 'there')},</b></p>
    ${passed ? `
      <p style="margin:0 0 14px;color:#555;">You have successfully completed <b>${esc(courseTitle)}</b>. Your certificate is ready to view, download, and share.</p>
      ${resultsHtml}
      ${certUrl ? cta('View your certificate', certUrl) : cta('View course', formUrl)}
    ` : `
      <p style="margin:0 0 14px;">Thanks for completing <b>${esc(courseTitle)}</b>. Keep practising. You can retake it to improve your score.</p>
      ${cta('Retake course', formUrl)}
    `}
    ${passed && badgeName && badgeImageUrl ? badgeBlock(badgeName, badgeImageUrl, `${appUrl}/student#badges`) : ''}
    ${recsHtml}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: passed ? 'Certificate' : 'Result',
    hero: passed
      ? hero('certificate', 'Course completed', 'Congratulations', '', 'good')
      : hero('arrow-counter-clockwise', 'Course result', 'Not quite there yet', ''),
  });
}


// -- 4. Course OTP Verification ---
export function otpEmail(data: { code: string; courseName?: string; branding?: EmailBranding }) {
  const { code, courseName, branding } = data;

  const content = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;background:#f3f4f6;border-radius:14px;">
      <tr><td align="center" style="padding:22px;">
        <p style="margin:0 0 6px;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6b7280;">Your code</p>
        <p style="margin:0;font-size:34px;font-weight:800;letter-spacing:0.3em;color:#111827;font-family:'Courier New',Courier,monospace;">${code}</p>
      </td></tr>
    </table>
    <p style="margin:0 0 14px;">Enter this code on the course page to continue. It expires in <b>10 minutes</b>. Do not share it with anyone.</p>
    ${small('If you did not request this, you can safely ignore this email.')}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Verification',
    hero: hero('key', 'Verify your email', 'Here is your code', `Use it to start${courseName ? ` <b>${esc(courseName)}</b>` : ' the course'}.`),
  });
}

// -- 5. Student Nudge (not started / in_progress / stalled) ---
export function nudgeEmail(data: {
  name: string;
  contentTitle: string;
  contentType: string;
  status: 'not_started' | 'stalled' | 'in_progress' | 'failed';
  formUrl: string;
  coverImage?: string | null;
  relatedAssignmentTitle?: string;
  branding?: EmailBranding;
}) {
  const { name, contentTitle, contentType, status, formUrl, coverImage, relatedAssignmentTitle, branding } = data;
  const typeLabel = contentType === 'virtual_experience' ? 'virtual experience' : contentType;
  const ctaLabel  = status === 'not_started' ? `Start ${typeLabel}` : status === 'failed' ? `Review and retake ${typeLabel}` : 'Continue where you left off';

  const intro = status === 'not_started'
    ? `We noticed you have not started <b>${contentTitle}</b> yet. We just wanted to reach out with a little encouragement.`
    : status === 'in_progress'
    ? `You are making progress on <b>${contentTitle}</b>. Great work so far! We are reaching out because we want to make sure you do not miss the deadline. Now is the time to push through and finish strong.`
    : status === 'failed'
    ? `You submitted <b>${contentTitle}</b>, but did not pass yet. That is not the end of the road. Review the material, try again, and use this as feedback for your next attempt.`
    : `We noticed you have not visited <b>${contentTitle}</b> in a while. We are checking in because we believe in you and do not want you to miss out.`;

  const nudge = status === 'stalled'
    ? "<b>You've already taken the first step</b>, which is the hardest part. Getting back on track is easier than you think. Remember why you started, and know that each module you complete brings you closer to a real skill you can use."
    : status === 'in_progress'
    ? '<b>You are already on your way</b>. Do not let the momentum slip. Even 20 minutes a day can get you across the finish line. The effort you have already put in is worth protecting. Keep going.'
    : status === 'failed'
    ? '<b>A failed attempt is useful data</b>. It shows exactly where to focus next. Revisit the feedback, strengthen the weak spots, and retake when ready.'
    : 'It only takes a few minutes to begin. Once you start, you will find the content is practical, relevant, and designed to give you real skills. Not just theory.';

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">${intro}</p>
    ${callout('good', 'Why upskilling matters', "In today's fast-moving world, the skills you build today directly shape the opportunities you unlock tomorrow. Every lesson you complete, every challenge you tackle puts you ahead, and the learning you do here is directly relevant to real roles in the industry.")}
    <p style="margin:0 0 14px;color:#374151;">${nudge}</p>
    ${callout('warn', 'Need support? We are here for you.', 'If anything felt unclear, you got stuck, or life simply got in the way. Please do not hesitate to reach out. Our team is available to help you through any challenges. You are not on this journey alone.')}
    ${cta(ctaLabel, formUrl)}
    ${relatedAssignmentTitle ? `
    ${sectionLabel('Related assignment waiting for you')}
    <a href="${formUrl}" style="display:block;text-decoration:none;margin-bottom:16px;">
      ${coverCard({ title: contentTitle, coverImage, isVE: contentType === 'virtual_experience', description: `Complete this course to unlock the <b>"${relatedAssignmentTitle}"</b> assignment, a hands-on task to apply what you have learned.` }, 160)}
    </a>` : ''}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Reminder',
    hero: hero(contentType === 'virtual_experience' ? 'briefcase' : 'play-circle',
      status === 'failed' ? 'Try again' : status === 'not_started' ? 'Ready when you are' : 'Keep going',
      status === 'failed' ? 'You can still pass this' : status === 'not_started' ? 'Your learning is waiting' : 'Pick up where you left off',
      '',
      status === 'in_progress' || status === 'stalled' ? 'warn' : 'info'),
  });
}


// -- 6. 80% Milestone ---
export function milestoneEmail(data: {
  name: string;
  contentTitle: string;
  contentType: string;
  formUrl: string;
  branding?: EmailBranding;
}) {
  const { name, contentTitle, contentType, formUrl, branding } = data;
  const typeLabel = contentType === 'virtual_experience' ? 'virtual experience' : contentType;

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">You are <b>80% of the way through</b> <b>${contentTitle}</b>. That is incredible progress!</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="96" valign="middle" style="width:96px;">${scoreRing('Almost there!', '80%', '#16a34a', 80)}</td>
      <td valign="middle" style="padding-left:16px;">
        <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">${contentTitle}</p>
      </td>
    </tr></table>`)}
    <p style="margin:0 0 14px;color:#374151;">You have put in the hard work and you are so close to the finish line. Do not stop now. Completing this ${typeLabel} will add a real, demonstrable skill to your profile.</p>
    ${callout('warn', 'Did you know?', 'Students who reach 80% completion are <b>3 times more likely to finish</b>. You are already in that group. One final push and you will have something to be genuinely proud of.')}
    ${cta('Finish strong', formUrl)}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Milestone',
    hero: hero('flag-checkered', 'Milestone reached', 'Keep it up', '', 'good'),
  });
}


// -- 7. Weekly Digest ---
export function weeklyDigestEmail(data: {
  name: string;
  completed: { title: string; contentType: string; score?: number | null }[];
  inProgress: { title: string; contentType: string }[];
  notStarted: { title: string; contentType: string }[];
  missedDeadlines: { title: string; contentType: string; daysOverdue: number }[];
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, completed, inProgress, notStarted, missedDeadlines, dashboardUrl, branding } = data;

  const typeLabel = (t: string) => t === 'virtual_experience' ? 'Virtual Experience' : t === 'course' ? 'Course' : t;

  const tile = (bg: string, iconName: string, n: number, label: string, numColor = '#111827') => `
    <td width="25%" align="center" valign="top" style="padding:0 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:12px;"><tr><td align="center" style="padding:12px 4px;">
        ${icon(iconName, 20)}
        <p style="margin:4px 0 0;font-size:24px;line-height:1.1;font-weight:800;color:${numColor};">${n}</p>
        <p style="margin:0;font-size:12px;color:#4b5563;">${label}</p>
      </td></tr></table>
    </td>`;

  const row = (iconName: string, tileBg: string, title: string, sub: string, tinted = false) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;${tinted ? 'background:#fef2f2;' : 'border:1px solid #e5e7eb;'}border-radius:12px;">
      <tr>
        <td width="32" valign="middle" style="padding:10px 0 10px 12px;width:32px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="32" height="32" align="center" valign="middle" style="width:32px;height:32px;border-radius:10px;background:${tileBg};">${icon(iconName, 17)}</td></tr></table>
        </td>
        <td valign="middle" style="padding:10px 12px;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#111827;">${title}</p>
          <p style="margin:0;font-size:12.5px;color:${tinted ? '#b91c1c' : '#6b7280'};">${sub}</p>
        </td>
      </tr>
    </table>`;

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">Here is your weekly learning update. Stay consistent. Every lesson counts.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;"><tr>
      ${tile('#ecfdf3', 'check-circle-green', completed.length, 'Completed')}
      ${tile('#eff4ff', 'lightning', inProgress.length, 'In progress')}
      ${tile('#fef2f2', 'warning-circle-red', missedDeadlines.length, 'Overdue', '#dc2626')}
      ${tile('#f3f4f6', 'hourglass', notStarted.length, 'Not started')}
    </tr></table>

    ${completed.length > 0 ? `
    ${sectionLabel('Completed this week')}
    ${completed.map(item => row('check-circle-green', '#ecfdf3', item.title, `${typeLabel(item.contentType)}${item.score != null ? ` | Score: ${item.score}%` : ''}`)).join('')}` : ''}

    ${inProgress.length > 0 ? `
    ${sectionLabel('Still in progress')}
    ${inProgress.map(item => row('lightning', '#f3f4f6', item.title, `${typeLabel(item.contentType)} | In progress`)).join('')}` : ''}

    ${missedDeadlines.length > 0 ? `
    ${sectionLabel('Overdue: action needed', '#b91c1c')}
    ${missedDeadlines.map(item => row('warning-circle-red', '#ffffff', item.title, `${typeLabel(item.contentType)} | ${item.daysOverdue === 0 ? 'Due today' : `${item.daysOverdue} day${item.daysOverdue > 1 ? 's' : ''} overdue`}`, true)).join('')}
    ${small('These items have passed their deadline. Reach out to your instructor if you need an extension.')}` : ''}

    ${notStarted.length > 0 ? `
    ${sectionLabel('Not started yet')}
    ${notStarted.map(item => row('hourglass', '#f3f4f6', item.title, `${typeLabel(item.contentType)} | Not started`)).join('')}
    ${small('You have been assigned these programs. Starting is the hardest part. Log in and take the first step.')}` : ''}

    ${callout('good', '', '<b>Every week counts.</b> The skills you are building here open doors to real opportunities. Consistency is the single most powerful habit you can build as a learner.')}
    ${cta('Go to my dashboard', dashboardUrl)}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Weekly update',
    hero: hero('chart-line-up', 'Weekly update', 'Your learning this week', ''),
  });
}


// -- 8. Deadline Reminder ---
export function deadlineReminderEmail(data: {
  name: string;
  contentTitle: string;
  contentType: string;
  formUrl: string;
  daysLeft: number;
  branding?: EmailBranding;
}) {
  const { name, contentTitle, contentType, formUrl, daysLeft, branding } = data;
  const typeLabel = contentType === 'course' ? 'course' : contentType === 'assignment' ? 'assignment' : 'virtual experience';
  const kindIcon = contentType === 'course' ? 'play-circle' : contentType === 'assignment' ? 'clipboard-text' : 'briefcase';
  const urgency = daysLeft <= 0 ? 'Your deadline has passed'
    : daysLeft === 1 ? 'You have 1 day left'
    : `You have ${daysLeft} days left`;

  const content = `
    <p style="margin:0 0 14px;">Hi ${esc(name)},</p>
    <p style="margin:0 0 14px;">This is a reminder that your deadline for the following ${typeLabel} is approaching:</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;">${icon(kindIcon, 13)}&nbsp; ${typeLabel}</p>
        <p style="margin:2px 0 0;font-size:16px;font-weight:700;color:#111827;">${contentTitle}</p>
        <p style="margin:6px 0 0;font-size:14px;font-weight:600;color:#ef4444;">${urgency}</p>
      </td>
      <td valign="middle" align="right">${daysLeft > 0 ? countdownTile(daysLeft) : stamp('Deadline passed', 'bad')}</td>
    </tr></table>`)}
    <p style="margin:0 0 14px;">Do not let your progress go to waste. Every skill you build today is an investment in your future career. Log in now and keep going.</p>
    ${callout('good', '', '<b>Quick tip:</b> Even 15 minutes of focused learning counts. You can do this!')}
    ${cta('Complete now', formUrl)}
    <p style="margin:0 0 14px;">If you need any help or have questions, our team is always here for you. Just reply to this email.</p>
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Deadline',
    hero: hero('timer', 'Deadline reminder', urgency, '', 'warn'),
  });
}


// -- 9. Onboarding Welcome ---
export function welcomeEmail(data: { name: string; studentUrl: string; branding?: EmailBranding }) {
  const { name, studentUrl, branding } = data;
  const appName = branding?.appName || tenant.appName;
  const content = `
    <p style="margin:0 0 14px;">We are thrilled to have you on board. You have just taken the first step toward building industry-relevant skills that will shape your career.</p>
    ${sectionLabel('Here is what to expect')}
    ${stepTimeline([
      { icon: 'play-circle', title: '', text: 'Practical courses built around real African industry scenarios' },
      { icon: 'clipboard-text', title: '', text: 'Hands-on assignments to apply what you learn' },
      { icon: 'certificate', title: '', text: 'Certificates to showcase your skills' },
      { icon: 'chart-line-up', title: '', text: 'A leaderboard to track your progress against peers' },
    ])}
    <p style="margin:0 0 14px;color:#374151;">Your cohort and courses are already set up for you. Head to your dashboard and start your first course today.</p>
    ${cta('Go to my dashboard', studentUrl)}
    ${signoff('Welcome aboard,')}
  `;
  return shell(content, {
    ...branding, kind: 'Welcome',
    hero: hero('rocket-launch', 'Welcome', `Welcome to ${esc(appName)}, ${esc(name)}!`, '', 'good'),
  });
}


// -- 10. Onboarding Day-3 Check-in ---
export function day3CheckInEmail(data: { name: string; studentUrl: string; courseTitle?: string; courseUrl?: string; branding?: EmailBranding }) {
  const { name, studentUrl, courseTitle, courseUrl, branding } = data;
  const appName = branding?.appName || tenant.appName;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">It has been a few days since you joined ${appName}. We just wanted to check in. Have you had a chance to explore your courses yet?</p>
    ${courseTitle && courseUrl ? `
    ${sectionLabel('Ready for you')}
    <div style="margin:0 0 14px;">${itemCard({ title: courseTitle, description: 'Start this course and take your first step toward a new skill.' })}</div>
    ${cta('Start course', courseUrl)}` : `
    <p style="margin:0 0 14px;color:#374151;">Log in now and pick a course to get started. Even 15 minutes a day adds up fast.</p>
    ${cta('Browse my courses', studentUrl)}`}
    ${signoff('Cheering you on,')}
  `;
  return shell(content, {
    ...branding, kind: 'Check-in',
    hero: hero('hand-waving', 'Checking in', 'How is it going?', ''),
  });
}


// -- 11. Onboarding Day-7 Encouragement ---
export function day7EncouragementEmail(data: { name: string; studentUrl: string; hasStarted: boolean; coursesCompleted: number; branding?: EmailBranding }) {
  const { name, studentUrl, hasStarted, coursesCompleted, branding } = data;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    ${hasStarted && coursesCompleted > 0 ? `
    <p style="margin:0 0 14px;">One week in and you have already completed <b>${coursesCompleted} course${coursesCompleted > 1 ? 's' : ''}</b>. That is outstanding progress!</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="96" valign="middle" style="width:96px;">${scoreRing('', String(coursesCompleted))}</td>
      <td valign="middle" style="padding-left:16px;">
        <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">Course${coursesCompleted > 1 ? 's' : ''} completed in your first week</p>
      </td>
    </tr></table>`)}
    <p style="margin:0 0 14px;color:#374151;">Keep the momentum going. Every course you complete builds your profile and brings you closer to your career goals.</p>
    ` : hasStarted ? `
    <p style="margin:0 0 14px;">You have started your learning journey, and that is great! The hardest part is always the beginning, and you have done it.</p>
    <p style="margin:0 0 14px;color:#374151;">Even if life got busy, come back and pick up where you left off. Your progress is saved.</p>
    ` : `
    <p style="margin:0 0 14px;">We noticed you have not started a course yet, and that is completely okay. Life gets busy. But we want to make sure you do not miss out.</p>
    <p style="margin:0 0 14px;color:#374151;">Your courses are waiting. It only takes a few minutes to begin, and the skills you build here are directly relevant to real jobs.</p>
    `}
    ${cta('Continue learning', studentUrl)}
    ${signoff('Best,')}
  `;
  return shell(content, {
    ...branding, kind: 'Week one',
    hero: hero('star', 'One week in', 'Your first week', '', hasStarted && coursesCompleted > 0 ? 'good' : 'info'),
  });
}


export function blastEmail(data: {
  subject: string;
  body: string;
  /** The body already as email HTML (lib/email-body.ts); used in place of the plain-text body.
   *  The author's own message then signs itself off: no "Best regards" is added under it. */
  bodyHtml?: string | null;
  senderName?: string;
  formTitle: string;
  formUrl: string;
  bannerUrl?: string;
  ctaLabel?: string;
  /** Recipients may not be enrolled (an event's public registrants): the footer says so neutrally. */
  neutralFooter?: boolean;
  branding?: EmailBranding;
}) {
  const { body, bodyHtml, senderName, formTitle, ctaLabel, neutralFooter, branding } = data;
  // Titles and links arrive from the request: text is escaped, links must be web links.
  const webUrl = (v: unknown) => (typeof v === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(v.trim()) ? v.trim() : '');
  const formUrl = webUrl(data.formUrl);
  const bannerUrl = webUrl(data.bannerUrl);

  const content = `
    ${bodyHtml ?? `<p style="margin:0 0 14px;">${body.replace(/\n\n/g, '</p><p style="margin:0 0 14px;">').replace(/\n/g, '<br>')}</p>`}

    ${formUrl ? cta(esc(ctaLabel || 'View Page'), esc(formUrl)) : ''}
    ${bodyHtml != null ? '' : `
    ${signoff()}
    <p style="margin:2px 0 18px;font-size:15px;color:#4b5563;">${esc(senderName || formTitle)}</p>`}
  `;

  // blastEmail signs with senderName itself, so the shell adds no name line of its own. It is a
  // free-form message, so it has no hero: the author's words are the news.
  return shell(content, { ...branding, bannerUrl: bannerUrl || undefined, neutralFooter, signOff: false, kind: 'Message' });
}

// -- 12. Learning Path Assignment ---
export function learningPathAssignedEmail(data: {
  name: string;
  pathTitle: string;
  pathDescription?: string;
  dashboardUrl: string;
  items: Array<{ title: string; coverImage?: string | null; isVE?: boolean; isCert?: boolean; description?: string }>;
  branding?: EmailBranding;
  /** 'plan' when the path became available through a subscription rather than being assigned. */
  reason?: 'assignment' | 'plan';
  /** The platform's own name, for the plan wording. Never hardcoded: this is multi-tenant. */
  appName?: string;
  /**
   * Track names, on a path with tracks. `items` is then the core only: the learner has not picked
   * a track yet, so no track's content is listed or described as required.
   */
  specializations?: string[];
  /** The path lets learners skip specializing and finish on the core alone. */
  specializationOptional?: boolean;
}) {
  const { name, pathTitle, pathDescription, dashboardUrl, items, branding, reason, appName } = data;
  const optional = data.specializationOptional === true;
  const specializations = (data.specializations ?? []).filter(Boolean);
  const hasTracks = specializations.length > 0;

  const intro = reason === 'plan'
    // Added to a plan they already pay for, not assigned to them. "Enrolled" put a deadline
    // behind something nobody asked them to do.
    ? `We have added a new learning path to ${esc(appName || 'the platform')}:`
    : hasTracks && optional
      ? 'You have been enrolled in a new learning path. You will build essential skills through its core courses, and can go further with a specialization if you choose one. You earn a certificate when you complete the core and any specialization you pick.'
    : hasTracks
      ? 'You have been enrolled in a new learning path. You will build essential skills through its core courses, then go further with a specialization you choose, and earn a certificate when you complete both.'
      : 'You have been enrolled in a new learning path. This is a structured programme designed to build your skills step by step, and you will earn a certificate when you complete every item.';

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">${intro}</p>
    ${pathDescription ? `<div style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#374151;">${pathDescription}</div>` : ''}
    ${items.length > 0 ? `${sectionLabel(hasTracks ? 'Core courses' : "What's included")}${journey(items.slice(0, 6), {})}` : ''}
    ${hasTracks ? callout('info', optional ? 'Plus an optional specialization' : 'Plus your specialization',
      `When you open the path you will choose where to specialize: ${specializations.map(s => `<b>${esc(s)}</b>`).join(', ')}. ${optional ? 'A specialization adds content tailored to your field, or you can choose Core only and complete the path with the core courses.' : 'Your specialization adds content tailored to your field.'}`) : ''}
    ${callout('warn', '', `<b>Complete each item in order</b> to earn your individual course certificates along the way. Once you finish ${hasTracks ? (optional ? 'the core, and your specialization if you choose one' : 'the core and your specialization') : 'the entire path'}, you will receive a <b>Learning Path Certificate</b> to add to your profile.`)}
    ${reason === 'plan'
      ? `<p style="margin:0 0 14px;">Log in now to explore and start learning.</p>${cta('View now', dashboardUrl)}`
      : cta('Start learning', dashboardUrl)}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Learning path',
    hero: hero('stack', 'Your learning path', pathTitle, ''),
  });
}

// -- Recording Published ---
export function recordingPublishedEmail(data: {
  name: string;
  recordingTitle: string;
  newWeeks: number[];
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, recordingTitle, newWeeks, dashboardUrl, branding } = data;

  const weekLabel = newWeeks.length === 1
    ? `Week ${newWeeks[0]}`
    : newWeeks.map(w => `Week ${w}`).join(', ');

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;"><b>${weekLabel}</b> recordings for <b>${recordingTitle}</b> are now available. Log in to watch them and stay on track with your programme.</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="44" valign="middle" style="width:44px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="44" height="44" align="center" valign="middle" style="width:44px;height:44px;border-radius:12px;background:#f3f4f6;">${icon('video-camera', 24)}</td></tr></table>
      </td>
      <td valign="middle" style="padding-left:12px;">
        <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">${recordingTitle}</p>
        <p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${weekLabel}</p>
      </td>
    </tr></table>`, '14px 16px')}
    ${cta('Watch recordings', dashboardUrl)}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Recordings',
    hero: hero('video-camera', 'New recordings', 'Recordings are ready', ''),
  });
}


// -- 13. Learning Path Certificate ---
export function learningPathCertificateEmail(data: {
  name: string;
  pathTitle: string;
  pathDescription?: string;
  certUrl: string;
  items: Array<{ title: string; coverImage?: string | null; isVE?: boolean; isCert?: boolean }>;
  badgeName?: string;
  badgeImageUrl?: string;
  branding?: EmailBranding;
}) {
  const { name, pathTitle, pathDescription, certUrl, items, badgeName, badgeImageUrl, branding } = data;
  const appUrl = branding?.appUrl || process.env.APP_URL || tenant.appUrl;

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;color:#374151;">This is a major achievement. You have completed every item in your learning path and your certificate is ready.</p>
    ${certificateCard(pathTitle, '')}
    ${pathDescription ? `<div style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#374151;">${pathDescription}</div>` : ''}
    ${ctaGhost('View your certificate', certUrl)}
    ${items.length > 0 ? `${sectionLabel('Everything you completed')}${journey(items.slice(0, 6), { done: true })}` : ''}
    ${callout('good', '', 'Add this certificate to your LinkedIn profile and CV to showcase the skills you have built. Every credential you earn makes your profile stronger.')}
    ${badgeName && badgeImageUrl ? badgeBlock(badgeName, badgeImageUrl, `${appUrl}/student#badges`) : ''}
    ${cta('View and download certificate', certUrl)}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Certificate',
    hero: hero('certificate', 'Learning path completed', 'Your certificate is ready', '', 'good'),
  });
}


// -- 14. Course completed -- next up in learning path ---
export function courseCompletedNextUpEmail(data: {
  name: string;
  pathTitle: string;
  completedTitle: string;
  completedNumber: number;
  totalItems: number;
  nextTitle: string;
  nextUrl: string;
  nextCoverImage?: string | null;
  nextIsVE?: boolean;
  nextIsCert?: boolean;
  nextDescription?: string | null;
  branding?: EmailBranding;
}) {
  const { name, pathTitle, completedTitle, completedNumber, totalItems, nextTitle, nextUrl, nextCoverImage, nextIsVE, nextIsCert, nextDescription, branding } = data;

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;color:#374151;">You have completed item ${completedNumber} of ${totalItems} in <b>${pathTitle}</b>. Keep the momentum going!</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 4px;background:#ecfdf3;border-radius:12px;"><tr>
      <td width="28" valign="middle" style="padding:12px 0 12px 14px;width:28px;">${icon('check-circle-green', 22)}</td>
      <td valign="middle" style="padding:12px 14px 12px 10px;">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#15803d;">Just completed</p>
        <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">${completedTitle}</p>
      </td>
    </tr></table>
    ${sectionLabel('Up next')}
    <div style="margin:0 0 14px;">${itemCard({ title: nextTitle, coverImage: nextCoverImage, isVE: nextIsVE, isCert: nextIsCert, description: nextDescription }, '', true)}</div>
    ${cta('Start now', nextUrl)}
    ${signoff('Keep going,')}
  `;

  return shell(content, {
    ...branding, kind: 'Learning path',
    hero: hero('stack', 'Step complete', 'Nice work', '', 'good'),
  });
}


// -- 15. Assignment Graded ---
export function assignmentGradedEmail(data: {
  name: string;
  assignmentTitle: string;
  score: number | null;
  passed: boolean;
  feedback?: string | null;
  studentUrl: string;
  branding?: EmailBranding;
}) {
  const { name, assignmentTitle, score, passed, feedback, studentUrl, branding } = data;

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;color:#555;">Your assignment <b>${esc(assignmentTitle)}</b> has been graded.</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${score != null ? `<td width="96" valign="middle" style="width:96px;">${scoreRing('/100', String(score), passed ? '#16a34a' : '#dc2626', score)}</td>` : ''}
      <td valign="middle" style="${score != null ? 'padding-left:16px;' : ''}">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;">${icon('clipboard-text', 13)}&nbsp; Assignment</p>
        <p style="margin:2px 0 8px;font-size:16px;font-weight:700;color:#111827;">${esc(assignmentTitle)}</p>
        ${stamp(passed ? 'Passed' : 'Failed', passed ? 'good' : 'bad')}
      </td>
    </tr></table>`)}
    ${feedback ? callout(passed ? 'good' : 'bad', 'Instructor Feedback', feedback) : ''}
    <p style="margin:0 0 14px;color:#555;">${passed ? 'Great work! Log in to view your full results.' : "Don't be discouraged. You can review the feedback and resubmit."}</p>
    ${cta('View assignment', studentUrl)}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Grade',
    hero: hero('clipboard-text', 'Assignment graded', 'Your grade is in', '', passed ? 'good' : 'info'),
  });
}


// -- Virtual Experience Reviewed ---
export function veReviewedEmail(data: {
  name: string;
  veTitle: string;
  score: number;
  feedback?: string | null;
  reportCount?: number;
  studentUrl: string;
  branding?: EmailBranding;
}) {
  const { name, veTitle, score, feedback, reportCount = 0, studentUrl, branding } = data;

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;color:#555;">Your instructor has reviewed your work on <b>${esc(veTitle)}</b>.</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="96" valign="middle" style="width:96px;">${scoreRing('/100', String(score), '#111827', score)}</td>
      <td valign="middle" style="padding-left:16px;">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;">${icon('briefcase', 13)}&nbsp; Virtual experience</p>
        <p style="margin:2px 0 0;font-size:16px;font-weight:700;color:#111827;">${esc(veTitle)}</p>
      </td>
    </tr></table>`)}
    ${feedback ? callout('info', 'Instructor Feedback', esc(feedback).replace(/\n/g, '<br>')) : ''}
    <p style="margin:0 0 14px;color:#555;">${reportCount > 0
      ? `Your instructor also wrote ${reportCount === 1 ? 'a detailed report on your uploaded file' : `detailed reports on ${reportCount} of your uploaded files`}. Open the virtual experience on your dashboard to read ${reportCount === 1 ? 'it' : 'them'}.`
      : 'Open the virtual experience on your dashboard to see the review at any time.'}</p>
    ${cta('View dashboard', studentUrl)}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Review',
    hero: hero('briefcase', 'Instructor review', 'Your work has been reviewed', ''),
  });
}


// -- Grace Period Warning ---
export function gracePeriodWarningEmail(data: {
  name: string;
  graceEndDate: string;
  daysLeft: number;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, graceEndDate, daysLeft, dashboardUrl, branding } = data;

  const urgency = daysLeft <= 1
    ? 'Your grace period ends tomorrow'
    : `Your grace period ends in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">A payment installment on your account is overdue. As a courtesy, you have been granted a <b>grace period</b> and your access remains active for now.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;background:#fff7e6;border-radius:14px;"><tr>
      <td width="86" valign="middle" style="padding:14px 0 14px 16px;width:86px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="background:#ffffff;border-radius:12px;padding:8px 14px;">
          <p style="margin:0;font-size:28px;line-height:1.1;font-weight:800;color:${daysLeft <= 1 ? '#dc2626' : '#b45309'};">${Math.max(0, daysLeft)}</p>
          <p style="margin:0;font-size:12px;font-weight:700;color:#92400e;white-space:nowrap;">day${daysLeft === 1 ? '' : 's'} left</p>
        </td></tr></table>
      </td>
      <td valign="middle" style="padding:14px 16px 14px 14px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:${daysLeft <= 1 ? '#dc2626' : '#78350f'};">${urgency}</p>
        <p style="margin:2px 0 0;font-size:14px;color:#92400e;">Make your payment before <b>${graceEndDate}</b> to avoid losing access to your course materials.</p>
      </td>
    </tr></table>
    <p style="margin:0 0 14px;color:#374151;">Once the grace period expires, your access will be restricted until your balance is settled. Please log in and submit a payment confirmation as soon as possible.</p>
    ${sectionLabel('How to pay')}
    ${stepTimeline([
      { icon: 'user-circle', title: '', text: 'Go to your dashboard and open <b>My Plan</b>' },
      { icon: 'receipt', title: '', text: 'Submit a payment confirmation with your method, reference, and amount' },
      { icon: 'check-circle-green', title: '', text: 'Your access will be restored once an admin approves your payment', tone: 'good' },
    ])}
    ${cta('Go to My Plan', dashboardUrl)}
    ${small('If you have already made this payment, please submit a confirmation so our team can verify and restore your full access.')}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Action needed',
    hero: hero('timer', 'Payment overdue', 'Your grace period has started', '', 'warn'),
  });
}


// -- Assignment Due Reminder ---
export function assignmentDueReminderEmail(data: {
  name: string;
  assignmentTitle: string;
  dueDate: string;
  daysLeft: number;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, assignmentTitle, dueDate, daysLeft, dashboardUrl, branding } = data;
  const urgency = daysLeft <= 0 ? 'is due today' : daysLeft === 1 ? 'is due tomorrow' : `is due in ${daysLeft} days`;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">This is a friendly reminder that your assignment <b>${esc(assignmentTitle)}</b> ${urgency}${dueDate ? ` (${esc(dueDate)})` : ''}, and we have not received your submission yet.</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle">
        <p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;">${icon('clipboard-text', 13)}&nbsp; Assignment</p>
        <p style="margin:2px 0 0;font-size:16px;font-weight:700;color:#111827;">${esc(assignmentTitle)}</p>
      </td>
      <td valign="middle" align="right">${daysLeft > 0 ? countdownTile(daysLeft) : stamp('Due today', 'warn')}</td>
    </tr></table>`)}
    ${callout('warn', 'Please submit before the deadline so you do not lose marks.')}
    <p style="margin:0 0 14px;color:#374151;">Log in to your dashboard, open the assignment, and submit your work.</p>
    ${cta('Open assignment', dashboardUrl)}
    ${small('If you have already submitted, you can ignore this message.')}
    ${signoff('Best of luck,')}
  `;
  return shell(content, {
    ...branding, kind: 'Due soon',
    hero: hero('clipboard-text', 'Assignment reminder', 'Your assignment is due soon', '', 'warn'),
  });
}


// -- Overdue Notification ---
export function overdueNotificationEmail(data: {
  name: string;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, dashboardUrl, branding } = data;
  const way = (iconName: string, label: string) => `
    <td width="33%" align="center" valign="top" style="padding:0 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;"><tr><td align="center" style="padding:12px 6px;">
        ${icon(iconName, 24)}
        <p style="margin:6px 0 0;font-size:13px;font-weight:700;color:#111827;">${label}</p>
      </td></tr></table>
    </td>`;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">Your account has an <b>overdue payment</b>. Your access to course materials has been restricted until your balance is settled.</p>
    ${callout('bad', 'Action required: Please make your payment as soon as possible.')}
    ${sectionLabel('How to complete your payment')}
    ${stepTimeline([
      { icon: 'user-circle', title: '', text: 'Log in and open <b>My Plan</b> in your dashboard' },
      { icon: 'credit-card', title: '', text: 'Click the <b>Make Payment</b> tab to view available payment options' },
      { icon: 'bank', title: '', text: 'Make your payment using <b>Bank Transfer</b>, <b>Mobile Money</b>, or <b>Online Payment</b>' },
      { icon: 'receipt', title: '', text: 'Once payment is made, return to <b>My Plan</b> and submit a <b>payment confirmation</b> with your method, reference, and amount' },
      { icon: 'check-circle-green', title: '', text: 'Your access will be restored once our team verifies and approves your confirmation', tone: 'good' },
    ])}
    ${cta('Go to My Plan', dashboardUrl)}
    ${small('If you have already made this payment, please submit a payment confirmation so our team can verify and restore your access promptly.')}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Action needed',
    hero: hero('warning', 'Overdue payment', 'Your access is paused', '', 'warn'),
  });
}


// -- Payment Receipt ---
export function paymentReceiptEmail(data: {
  name: string;
  amount: number;
  currency: string;
  paidAt: string;
  method?: string | null;
  reference?: string | null;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, amount, currency, paidAt, method, reference, dashboardUrl, branding } = data;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">A payment has been recorded on your account. Here are the details:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid #e5e7eb;border-radius:14px;">
      <tr><td style="padding:18px 20px;">${figureHead('Amount', `${esc(currency)} ${Number(amount).toLocaleString()}`, stamp('Paid'))}</td></tr>
      <tr><td style="padding:0 14px;font-size:0;line-height:0;"><div style="border-top:2px dashed #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr>
      <tr><td style="padding:4px 20px 8px;">${detailRows([
        { icon: 'calendar-blank', label: 'Date', value: esc(paidAt) },
        ...(method ? [{ icon: 'device-mobile', label: 'Method', value: esc(method) }] : []),
        ...(reference ? [{ icon: 'hash', label: 'Reference', value: esc(reference), mono: true }] : []),
      ])}</td></tr>
    </table>
    <p style="margin:0 0 14px;color:#374151;">You can view your full payment history and outstanding balance on your dashboard.</p>
    ${cta('View payment history', dashboardUrl)}
    ${small('If you did not expect this payment record, please contact our support team.')}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Receipt',
    hero: hero('credit-card', 'Payment received', `Thank you, ${esc(name)}`, '', 'good'),
  });
}


// -- Book purchase receipt ---
export function bookPurchaseEmail(data: {
  name: string;
  bookTitle: string;
  amount: number;
  currency: string;
  paidAt: string;
  reference: string;
  libraryUrl: string;
  /** A guest purchase (no account): the button opens its download page, open until this date. */
  guestUntil?: string;
  /** A link product (migration 243): it is opened, not downloaded, and has no download limit. */
  link?: boolean;
  branding?: EmailBranding;
}) {
  const { name, bookTitle, amount, currency, paidAt, reference, libraryUrl, guestUntil, link, branding } = data;
  const intro = guestUntil
    ? link
      ? `Thank you for buying <b>${esc(bookTitle)}</b>. Use the button below to open it. The link works until ${esc(guestUntil)}, so save your own copy there before then.`
      : `Thank you for buying <b>${esc(bookTitle)}</b>. Use the button below to download it. The link works until ${esc(guestUntil)}, for up to 5 downloads, so save a copy to keep.`
    : `Thank you for buying <b>${esc(bookTitle)}</b>. It is now in My Products, where you can ${link ? 'open' : 'download'} it at any time.`;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">${intro}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid #e5e7eb;border-radius:14px;">
      <tr><td style="padding:18px 20px;">${figureHead('Amount', `${esc(currency)} ${Number(amount).toFixed(2)}`, stamp('Paid'))}</td></tr>
      <tr><td style="padding:0 14px;font-size:0;line-height:0;"><div style="border-top:2px dashed #e5e7eb;font-size:0;line-height:0;">&nbsp;</div></td></tr>
      <tr><td style="padding:4px 20px 8px;">${detailRows([
        { icon: 'package', label: 'Product', value: esc(bookTitle) },
        { icon: 'calendar-blank', label: 'Date', value: esc(paidAt) },
        { icon: 'hash', label: 'Reference', value: esc(reference), mono: true },
      ])}</td></tr>
    </table>
    ${cta(link ? 'Open your product' : 'Download your product', libraryUrl)}
    ${small('If you did not make this purchase, please contact our support team.')}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Receipt',
    hero: hero('package', 'Purchase complete', 'Thank you for your purchase', '', 'good'),
  });
}


// -- Free digital product (claimed without an account) ---
export function bookFreeDownloadEmail(data: {
  name: string;
  bookTitle: string;
  downloadUrl: string;
  until: string;
  /** A link product (migration 243): it is opened, not downloaded, and has no download limit. */
  link?: boolean;
  branding?: EmailBranding;
}) {
  const { name, bookTitle, downloadUrl, until, link, branding } = data;
  const how = link
    ? `Use the button below to open it. The link works until ${esc(until)}, so save your own copy there before then.`
    : `Use the button below to download it. The link works until ${esc(until)}, for up to 5 downloads, so save a copy to keep.`;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">Here is your free copy of <b>${esc(bookTitle)}</b>. ${how}</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="44" valign="middle" style="width:44px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="44" height="44" align="center" valign="middle" style="width:44px;height:44px;border-radius:12px;background:#f3f4f6;">${icon('package', 24)}</td></tr></table>
      </td>
      <td valign="middle" style="padding-left:12px;">
        <p style="margin:0;font-size:15px;font-weight:700;color:#111827;">${esc(bookTitle)}</p>
      </td>
    </tr></table>`, '14px 16px')}
    ${cta(link ? 'Open your product' : 'Download your product', downloadUrl)}
    ${small('If you did not ask for this, you can ignore this email.')}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Free download',
    hero: hero('download-simple', 'Free download', 'Your free copy is ready', '', 'good'),
  });
}


// -- Digital product launch ---
export function productAnnouncementEmail(data: {
  name: string;
  bookTitle: string;
  priceLabel: string;
  /**
   * The author's message as HTML that is ALREADY SAFE: rich text through sanitizeRichText, or plain
   * text escaped (lib/books/description.ts descriptionHtml does both). Inserted as given.
   */
  messageHtml: string;
  coverUrl?: string;
  productUrl: string;
  branding?: EmailBranding;
}) {
  const { name, bookTitle, priceLabel, messageHtml, coverUrl, productUrl, branding } = data;
  const content = `
    <div style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#374151;">${messageHtml}</div>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="${coverUrl ? 96 : 44}" valign="top" style="width:${coverUrl ? 96 : 44}px;">${coverUrl
        ? `<img src="${esc(coverUrl)}" alt="" width="96" style="display:block;width:96px;height:auto;border-radius:8px;">`
        : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="44" height="44" align="center" valign="middle" style="width:44px;height:44px;border-radius:12px;background:#f3f4f6;">${icon('package', 24)}</td></tr></table>`}</td>
      <td valign="middle" style="padding-left:14px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#111827;">${esc(bookTitle)}</p>
        ${priceLabel ? `<p style="margin:6px 0 0;font-size:15px;font-weight:700;color:#15803d;">${esc(priceLabel)}</p>` : ''}
      </td>
    </tr></table>`, '14px 16px')}
    ${cta('View product', esc(productUrl))}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'New product',
    hero: hero('megaphone', 'Just released', 'Something new for you', `Hi ${esc(name)},`),
  });
}

// -- Subscription payment request ---
export function subscriptionPaymentAssignedEmail(data: {
  name: string;
  planName: string;
  amount: number;
  currency: string;
  dueDate: string;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, planName, amount, currency, dueDate, dashboardUrl, branding } = data;
  const left = daysUntil(dueDate);
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">A payment request has been assigned for your <b>${esc(planName)}</b> subscription.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid #e5e7eb;border-radius:14px;">
      <tr><td style="padding:18px 20px;">${figureHead('Amount', `${esc(currency)} ${Number(amount).toLocaleString()}`, left != null && left >= 0 && left <= 60 ? countdownTile(left) : stamp('Due', 'warn'))}</td></tr>
      <tr><td style="padding:0 20px 8px;">${detailRows([{ icon: 'calendar-blank', label: 'Payment deadline', value: esc(dueDate) }])}</td></tr>
    </table>
    <p style="margin:0 0 14px;color:#374151;">Open <b>My Plan</b> to view the available payment options and submit your confirmation. Access starts after your payment is approved.</p>
    ${cta('View payment request', dashboardUrl)}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Payment due',
    hero: hero('credit-card', 'Payment request', 'A payment is due', ''),
  });
}


// -- Payment Confirmation Acknowledged (student submitted) ---
export function paymentConfirmationAcknowledgedEmail(data: {
  name: string;
  amount: number;
  currency: string;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, amount, currency, dashboardUrl, branding } = data;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">We have received your payment confirmation of <b>${esc(currency)} ${Number(amount).toLocaleString()}</b>. Our team will review and approve it shortly.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid #e5e7eb;border-radius:14px;">
      <tr><td style="padding:18px 20px;">${figureHead('Amount', `${esc(currency)} ${Number(amount).toLocaleString()}`, stamp('In review', 'warn'))}</td></tr>
    </table>
    ${callout('info', '', 'Once approved, your account balance will be updated and your access status will be refreshed automatically.')}
    <p style="margin:0 0 14px;color:#374151;">You can track the status of your confirmation in <b>My Plan</b> on your dashboard.</p>
    ${cta('View My Plan', dashboardUrl)}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Payment',
    hero: hero('credit-card', 'Confirmation received', 'We have your confirmation', ''),
  });
}


// -- Payment Confirmation Approved (student notified) ---
export function paymentConfirmationApprovedEmail(data: {
  name: string;
  amount: number;
  currency: string;
  dashboardUrl: string;
  adminNotes?: string | null;
  branding?: EmailBranding;
}) {
  const { name, amount, currency, dashboardUrl, adminNotes, branding } = data;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">Great news! Your payment confirmation of <b>${esc(currency)} ${Number(amount).toLocaleString()}</b> has been <b style="color:#16a34a;">approved</b>.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid #e5e7eb;border-radius:14px;">
      <tr><td style="padding:18px 20px;">${figureHead('Amount', `${esc(currency)} ${Number(amount).toLocaleString()}`, stamp('Approved'))}</td></tr>
    </table>
    ${callout('good', '', 'Your account balance has been updated and your access status has been refreshed.')}
    ${adminNotes ? `<p style="margin:0 0 14px;color:#374151;"><b>Note from our team:</b> ${esc(adminNotes)}</p>` : ''}
    <p style="margin:0 0 14px;color:#374151;">You can view your updated payment history in <b>My Plan</b> on your dashboard.</p>
    ${cta('View My Plan', dashboardUrl)}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Payment',
    hero: hero('credit-card', 'Payment approved', 'Your payment is approved', '', 'good'),
  });
}


// -- Payment Confirmation Rejected (student notified) ---
export function paymentConfirmationRejectedEmail(data: {
  name: string;
  amount: number;
  currency: string;
  dashboardUrl: string;
  adminNotes?: string | null;
  branding?: EmailBranding;
}) {
  const { name, amount, currency, dashboardUrl, adminNotes, branding } = data;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">Unfortunately, your payment confirmation of <b>${esc(currency)} ${Number(amount).toLocaleString()}</b> could not be verified and has been <b style="color:#dc2626;">rejected</b>.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 18px;border:1px solid #e5e7eb;border-radius:14px;">
      <tr><td style="padding:18px 20px;">${figureHead('Amount', `${esc(currency)} ${Number(amount).toLocaleString()}`, stamp('Not verified', 'bad'))}</td></tr>
    </table>
    ${adminNotes ? callout('bad', '', `<b>Reason:</b> ${esc(adminNotes)}`) : ''}
    <p style="margin:0 0 14px;color:#374151;">Please double-check your payment details and resubmit your confirmation, or contact our support team if you believe this is an error.</p>
    ${cta('Resubmit confirmation', dashboardUrl)}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Action needed',
    hero: hero('credit-card', 'Payment confirmation', 'We could not verify your payment', '', 'warn'),
  });
}


// -- Admin: New Payment Confirmation Pending ---
export function adminPaymentConfirmationEmail(data: {
  studentName: string;
  studentEmail: string;
  amount: number;
  currency: string;
  adminUrl: string;
  branding?: EmailBranding;
}) {
  const { studentName, studentEmail, amount, currency, adminUrl, branding } = data;
  const content = `
    ${card(`${figureHead('Amount', `${esc(currency)} ${Number(amount).toLocaleString()}`, stamp('Pending', 'warn'))}
      <div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>
      ${detailRows([
        { icon: 'user-circle', label: 'Student', value: esc(studentName) },
        { icon: 'envelope', label: 'Email', value: esc(studentEmail) },
      ])}`)}
    ${cta('Review confirmation', adminUrl)}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Review',
    hero: hero('credit-card', 'Payment confirmation', 'A payment is waiting for review', 'A student has submitted a payment confirmation.'),
  });
}

// -- Cohort Invitation ---
export function cohortInviteEmail(data: {
  cohortName: string;
  signupUrl: string;
  branding?: EmailBranding;
}) {
  const { cohortName, signupUrl, branding } = data;
  const appName = branding?.appName || 'the platform';

  const content = `
    <p style="margin:0 0 14px;"><b>Hi there,</b></p>
    <p style="margin:0 0 14px;">You have been invited to join <b>${esc(cohortName)}</b> on ${appName}.</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="44" valign="middle" style="width:44px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="44" height="44" align="center" valign="middle" style="width:44px;height:44px;border-radius:12px;background:#f3f4f6;">${icon('users-three', 24)}</td></tr></table>
      </td>
      <td valign="middle" style="padding-left:12px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#111827;">${esc(cohortName)}</p>
      </td>
    </tr></table>`, '14px 16px')}
    <p style="margin:0 0 14px;">Click the button below to create your account and get started.</p>
    ${cta('Accept invitation', signupUrl)}
    ${small("If you weren't expecting this invitation, you can safely ignore this email.")}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Invitation',
    hero: hero('user-plus', 'Invitation', 'You are invited', ''),
  });
}


// -- Provisioned Student Account ---
export function studentAccountCreatedEmail(data: {
  name?: string | null;
  cohortName: string;
  setupUrl: string;
  branding?: EmailBranding;
}) {
  const { name, cohortName, setupUrl, branding } = data;
  const appName = branding?.appName || 'the platform';

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name || 'there')},</b></p>
    <p style="margin:0 0 14px;">Your student account for <b>${esc(cohortName)}</b> on ${esc(appName)} is ready.</p>
    <p style="margin:0 0 14px;">You do not need to create an account. Set your password with the button below to get started.</p>
    ${cta('Set password', setupUrl)}
    ${small('If you were not expecting this account, you can safely ignore this email.')}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Account',
    hero: hero('key', 'Account', 'Your account is ready', '', 'good'),
  });
}


// -- Existing account added to a cohort ---
// For students who can already sign in: no password link, just where to find the cohort.
export function studentAddedToCohortEmail(data: {
  name?: string | null;
  cohortName: string;
  signInUrl: string;
  branding?: EmailBranding;
}) {
  const { name, cohortName, signInUrl, branding } = data;
  const appName = branding?.appName || 'the platform';

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name || 'there')},</b></p>
    <p style="margin:0 0 14px;">You have been added to <b>${esc(cohortName)}</b> on ${esc(appName)}.</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="44" valign="middle" style="width:44px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="44" height="44" align="center" valign="middle" style="width:44px;height:44px;border-radius:12px;background:#f3f4f6;">${icon('users-three', 24)}</td></tr></table>
      </td>
      <td valign="middle" style="padding-left:12px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#111827;">${esc(cohortName)}</p>
      </td>
    </tr></table>`, '14px 16px')}
    <p style="margin:0 0 14px;">Sign in with your existing account to see your cohort and its content. Your password has not changed.</p>
    ${cta('Sign in', signInUrl)}
    ${small('If you were not expecting this, you can reply to this email and let us know.')}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Cohort',
    hero: hero('users-three', 'New cohort', 'You are in', '', 'good'),
  });
}


// -- 16. Assignment Submission Confirmation ---
export function submissionConfirmEmail(data: {
  name: string;
  assignmentTitle: string;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, assignmentTitle, dashboardUrl, branding } = data;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">Your submission for <b>${esc(assignmentTitle)}</b> has been received. Your instructor will review it and share feedback with you soon.</p>
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle">
        <p style="margin:0;font-size:14px;font-weight:700;color:#15803d;">Submission received</p>
        <p style="margin:2px 0 0;font-size:15px;font-weight:700;color:#111827;">${esc(assignmentTitle)}</p>
      </td>
      <td valign="middle" align="right">${stamp('Submitted')}</td>
    </tr></table>`)}
    ${cta('View submission', dashboardUrl)}
    <p style="margin:0 0 14px;">Well done for submitting. Keep up the great work!</p>
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Submission',
    hero: hero('paper-plane-tilt', 'Assignment', 'Your work is in', '', 'good'),
  });
}


export function groupSubmissionReceivedEmail(data: {
  name: string;
  assignmentTitle: string;
  groupName: string;
  submittedByName?: string | null;
  isParticipant: boolean;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, assignmentTitle, groupName, submittedByName, isParticipant, dashboardUrl, branding } = data;

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">Your group has submitted <b>${esc(assignmentTitle)}</b>.</p>
    ${card(`<p style="margin:0;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;">${icon('clipboard-text', 13)}&nbsp; Assignment</p>
      <p style="margin:2px 0 6px;font-size:16px;font-weight:700;color:#111827;">${esc(assignmentTitle)}</p>
      ${detailRows([
        { icon: 'users-three', label: 'Group', value: esc(groupName) },
        ...(submittedByName ? [{ icon: 'user-circle', label: 'Submitted by', value: esc(submittedByName) }] : []),
      ])}`)}
    ${isParticipant
      ? callout('good', 'You were marked as a participant', 'When this assignment is graded, the grade will be added to your record.')
      : callout('warn', 'You were not marked as a participant', 'You can still view the group submission. If you believe this is incorrect, contact your group leader or instructor.')}
    ${cta('View assignment', dashboardUrl)}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Group submission',
    hero: hero('users-three', 'Group submission', 'Submission received', '', 'good'),
  });
}

// -- 17. At-Risk Student Digest (to instructors) ---
export function atRiskDigestEmail(data: {
  instructorName: string;
  students: { name: string; email: string; riskScore: number; reasons: string[] }[];
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { instructorName, students, dashboardUrl, branding } = data;

  const rows = students.map(s => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;border:1px solid #e5e7eb;border-radius:12px;"><tr>
      <td valign="middle" style="padding:10px 12px;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#111827;">${esc(s.name)}</p>
        <p style="margin:0;font-size:12.5px;color:#6b7280;">${esc(s.email)}</p>
        <p style="margin:4px 0 0;font-size:12.5px;color:#374151;">${s.reasons.map(r => esc(r)).join(', ')}</p>
      </td>
      <td valign="middle" align="right" style="padding:10px 12px;">${stamp(s.riskScore >= 5 ? 'High risk' : 'At risk', s.riskScore >= 5 ? 'bad' : 'warn')}</td>
    </tr></table>`).join('');

  const content = `
    ${rows}
    <div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>
    ${cta('Open dashboard', dashboardUrl)}
    ${small('Sent every Monday. Students are flagged when inactive 7+ days, stalled on content, or have overdue payments.')}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Weekly digest',
    hero: hero('warning', 'At-risk students', `Hi ${esc(instructorName || 'there')}, a few learners need you`, 'These students may need your attention this week.', 'warn'),
  });
}

// -- Badge Earned (standalone notification for course completion badges) ---
export function badgeEarnedEmail(data: {
  name: string;
  contentTitle: string;
  contentType: 'course' | 'virtual_experience' | 'learning_path';
  badgeName: string;
  badgeImageUrl: string;
  certUrl: string;
  badgesUrl: string;
  branding?: EmailBranding;
}) {
  const { name, contentTitle, badgeName, badgeImageUrl, certUrl, badgesUrl, branding } = data;
  const content = `
    ${badgeBlock(badgeName, badgeImageUrl, badgesUrl)}
    <p style="margin:0 0 14px;">Head to your profile to download the badge, add it to LinkedIn, or share it with your network.</p>
    ${cta('View certificate', certUrl)}
    ${signoff('Well done,')}
  `;
  return shell(content, {
    ...branding, kind: 'Badge',
    hero: hero('medal', 'New badge', `Congratulations, ${esc(name)}`, `You completed <b>${esc(contentTitle)}</b>, earned a badge, and your certificate is ready.`, 'good'),
  });
}

// -- Live Session Attendance Report (to instructors + admins) ---
export function attendanceReportEmail(data: {
  eventTitle: string;
  sessionDate: string;
  attended: { name: string; email: string; joinedAt: string }[];
  missed: { name: string; email: string }[];
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { eventTitle, sessionDate, attended, missed, dashboardUrl, branding } = data;
  const total = attended.length + missed.length;
  const dateLabel = new Date(sessionDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const person = (s: { name: string; email: string }, status: string, tone: 'good' | 'bad', time: string) => `
    <tr>
      <td style="padding:9px 0;border-top:1px solid #f0f1f3;">
        <p style="margin:0;font-size:14px;font-weight:700;color:#111827;">${esc(s.name)}</p>
        <p style="margin:0;font-size:12.5px;color:#6b7280;">${esc(s.email)}</p>
      </td>
      <td align="right" style="padding:9px 0;border-top:1px solid #f0f1f3;font-size:12.5px;color:#6b7280;">${stamp(status, tone)}${time ? `<br>${time}` : ''}</td>
    </tr>`;

  const content = `
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="96" valign="middle" style="width:96px;">${scoreRing(`of ${total}`, String(attended.length), attended.length > 0 ? '#16a34a' : '#dc2626', total ? (attended.length / total) * 100 : 0)}</td>
      <td valign="middle" style="padding-left:16px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#111827;">${esc(eventTitle)}</p>
        <p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${icon('calendar-blank', 14)}&nbsp; ${esc(dateLabel)}</p>
      </td>
    </tr></table>`)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
      ${attended.map(s => person(s, 'Attended', 'good', s.joinedAt ? new Date(s.joinedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '')).join('')}
      ${missed.map(s => person(s, 'Missed', 'bad', '')).join('')}
    </table>
    ${cta('View full attendance report', dashboardUrl)}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Attendance',
    hero: hero('calendar-dots', 'Attendance report', 'How today\'s session went', 'Here is who joined the live session.'),
  });
}

// -- Missed Session Nudge (to absent students) ---
export function missedSessionEmail(data: {
  name: string;
  eventTitle: string;
  sessionDate: string;
  joinUrl?: string;
  meetingLink?: string;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, eventTitle, sessionDate, joinUrl, meetingLink, dashboardUrl, branding } = data;
  const joinHref  = joinUrl || meetingLink;
  const dateLabel = new Date(sessionDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">We noticed you missed <b>${esc(eventTitle)}</b> on <b>${esc(dateLabel)}</b>.</p>
    <p style="margin:0 0 14px;color:#374151;">No worries - we would love to see you at the next session. The link below will take you straight in.</p>
    ${joinHref ? ticket({
      title: esc(eventTitle),
      rows: platformName(meetingLink || joinHref) ? [{ icon: 'video-camera', text: esc(platformName(meetingLink || joinHref)) }] : [],
      action: ctaSmall('Join next session', joinHref),
    }) : cta('Go to dashboard', dashboardUrl)}
    ${small('If you have any questions or ran into an issue joining, please reply to this email and we will help you out.')}
    ${signoff()}
  `;

  return shell(content, {
    ...branding, kind: 'Missed session',
    hero: hero('calendar-x', 'Missed session', 'We missed you', '', 'warn'),
  });
}


// -- Open Certificate (manual issuance for events / programs) ---
export function openCertificateEmail(data: {
  recipientName: string;
  programName:   string;
  issuedDate:    string;
  certUrl:       string;
  branding?:     EmailBranding;
}) {
  const { recipientName, programName, issuedDate, certUrl, branding } = data;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(recipientName)},</b></p>
    <p style="margin:0 0 14px;color:#374151;">Congratulations! Your certificate for <b>${esc(programName)}</b> is ready.</p>
    ${certificateCard(`Program: ${esc(programName)}`, `Issued: ${esc(issuedDate)}`)}
    <p style="margin:0 0 14px;color:#374151;">You can view, download, and share your certificate using the link below. It includes a button to add it directly to your LinkedIn profile.</p>
    ${cta('View certificate', certUrl)}
    ${signoff('Congratulations,')}
  `;
  return shell(content, {
    ...branding, kind: 'Certificate',
    hero: hero('certificate', 'Certificate issued', 'Your certificate is ready', '', 'good'),
  });
}


export function groupAssignedEmail(data: {
  recipientName: string;
  groupName:     string;
  cohortName:    string;
  description?:  string;
  members:       { full_name: string; is_leader: boolean }[];
  dashboardUrl:  string;
  branding?:     EmailBranding;
}) {
  const { recipientName, groupName, cohortName, description, members, dashboardUrl, branding } = data;

  const memberRows = members.map((m, i) => `
    <tr>
      <td style="padding:9px 0;${i ? 'border-top:1px solid #f0f1f3;' : ''}font-size:14px;color:#111827;">${icon('user-circle', 16)}&nbsp; ${esc(m.full_name)}</td>
      <td align="right" style="padding:9px 0;${i ? 'border-top:1px solid #f0f1f3;' : ''}">${m.is_leader ? `<span style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;background:#f3f4f6;padding:3px 9px;border-radius:99px;">Leader</span>` : ''}</td>
    </tr>`).join('');

  const leader = members.find(m => m.is_leader);
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(recipientName)},</b></p>
    <p style="margin:0 0 14px;color:#374151;">You have been added to a group for <b>${esc(cohortName)}</b>.</p>
    ${card(`<p style="margin:0 0 4px;font-size:18px;font-weight:700;color:#111827;">${icon('users-three', 18)}&nbsp; ${esc(groupName)}</p>
      ${description ? `<p style="margin:0 0 8px;font-size:13px;color:#6b7280;">${esc(description)}</p>` : ''}
      ${leader ? `<p style="margin:8px 0 0;font-size:14px;color:#374151;"><b>Group Leader:</b> ${esc(leader.full_name)}</p>` : ''}
      <p style="margin:12px 0 2px;font-size:14px;font-weight:600;color:#374151;">Group Members</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${memberRows}</table>`)}
    <p style="margin:0 0 14px;color:#374151;">Your group assignments will appear on your student dashboard. The group leader will complete and submit on behalf of the group.</p>
    ${cta('Go to dashboard', dashboardUrl)}
    ${signoff('Good luck!')}
  `;
  return shell(content, {
    ...branding, kind: 'Group',
    hero: hero('users-three', 'New group', 'Meet your group', ''),
  });
}


// Shared by the two subscription emails. A date-only value (subscription_payment_requests
// .due_date is a `date` column, so PostgREST returns "2026-09-01") parses as UTC midnight
// and renders a day early anywhere west of UTC -- this file already hit that twice, hence
// the noon anchor. Timestamps come through untouched.
function subscriptionDay(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Date(dateOnly ? `${value}T12:00:00` : value)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function subscriptionMonths(durationMonths: number): string {
  return `${durationMonths} month${durationMonths === 1 ? '' : 's'}`;
}

/** The access period as a bar from start to end, with both dates under it. */
function accessTimeline(start: string, end: string, startLabel = 'Access starts', endLabel = 'Access ends'): string {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 0;"><tr>
      <td width="14" style="width:14px;padding:0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="14" height="14" style="width:14px;height:14px;border-radius:50%;background:#2563eb;color:#ffffff;font-size:0;line-height:0;">&nbsp;</td></tr></table></td>
      <td style="padding:0;">${bar(100, '#e5e7eb')}</td>
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 0;font-size:13px;"><tr>
      <td><b style="color:#111827;">${esc(start)}</b><br><span style="color:#6b7280;">${startLabel}</span></td>
      <td align="right"><b style="color:#111827;">${esc(end)}</b><br><span style="color:#6b7280;">${endLabel}</span></td>
    </tr></table>`;
}

/** The plan card: a crown tile, the plan name and length, a status, and its rows. */
function planCard(planName: string, sub: string, status: string, inner: string): string {
  return card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td width="42" valign="middle" style="width:42px;">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="42" height="42" align="center" valign="middle" style="width:42px;height:42px;border-radius:12px;background:#f3f4f6;">${icon('crown', 22)}</td></tr></table>
      </td>
      <td valign="middle" style="padding-left:12px;">
        <p style="margin:0;font-size:16px;font-weight:700;color:#111827;">${esc(planName)}</p>
        <p style="margin:2px 0 0;font-size:13px;color:#6b7280;">${sub}</p>
      </td>
      <td valign="middle" align="right">${status}</td>
    </tr></table>${inner}`);
}

// -- Subscription activated or renewed (student notified) ---
// Sent when access actually starts or is extended, which is the moment a learner needs
// the dates. Both the "recorded as already paid" path and the payment-approval path use
// this, so a learner who pays normally is told exactly as much as one an admin records
// manually.
export function subscriptionActivatedEmail(data: {
  name: string;
  planName: string;
  durationMonths: number;
  periodStart: string;
  periodEnd: string;
  isActivation: boolean;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, planName, durationMonths, periodStart, periodEnd, isActivation, dashboardUrl, branding } = data;

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">${isActivation
      ? `Your subscription to <b>${esc(planName)}</b> is now active.`
      : `Your subscription to <b>${esc(planName)}</b> has been extended.`}</p>
    ${callout('good', '', `Your access runs from <b>${esc(subscriptionDay(periodStart))}</b> to <b>${esc(subscriptionDay(periodEnd))}</b>.`)}
    ${planCard(planName, `Duration: ${esc(subscriptionMonths(durationMonths))}`, stamp('Active'),
      accessTimeline(subscriptionDay(periodStart), subscriptionDay(periodEnd), 'Access starts', 'Access expires'))}
    ${cta('Go to my dashboard', `${dashboardUrl}/student`)}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Subscription',
    hero: hero('credit-card', isActivation ? 'Subscription active' : 'Subscription extended', 'You are all set', '', 'good'),
  });
}


// -- New individual learner welcome (account + plan in one message) ---
// A learner created through subscription enrollment used to receive two emails moments
// apart: one to set up their account, one about their plan. Whether those are separate
// concepts internally is not the learner's problem, and the two could arrive in either
// order -- "go to your dashboard" landing before they could log in. This is the single
// message both flows send instead. Access details only, never payment details.
export function individualLearnerWelcomeEmail(data: {
  name: string;
  planName: string;
  durationMonths: number;
  setupUrl: string;
  // A learner can be enrolled, never open this email, and later be renewed. The second
  // message still needs the setup link, but must not read as a brand-new subscription.
  isRenewal: boolean;
  // Paid: access already runs. Request: access starts once the payment is approved.
  access: { kind: 'active'; periodStart: string; periodEnd: string }
    | { kind: 'awaiting_payment'; amount: number; currency: string; dueDate: string };
  branding?: EmailBranding;
}) {
  const { name, planName, durationMonths, setupUrl, isRenewal, access, branding } = data;

  const status = access.kind === 'active'
    ? callout('good', '', `Your access to <b>${esc(planName)}</b> runs from <b>${esc(subscriptionDay(access.periodStart))}</b> to <b>${esc(subscriptionDay(access.periodEnd))}</b>.`)
    // Amber, not green: this learner still owes money, and the settled-payment green would
    // read as "all done".
    : callout('warn', '', `Your place on <b>${esc(planName)}</b> is reserved. Access begins once your payment is confirmed.`);

  const plan = access.kind === 'active'
    ? planCard(planName, `Duration: ${esc(subscriptionMonths(durationMonths))}`, stamp('Active'),
      accessTimeline(subscriptionDay(access.periodStart), subscriptionDay(access.periodEnd), 'Access starts', 'Access expires'))
    : planCard(planName, `Duration: ${esc(subscriptionMonths(durationMonths))}`, stamp('Awaiting payment', 'warn'),
      `<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>${detailRows([
        { icon: 'credit-card', label: 'Amount due', value: `${esc(access.currency)} ${Number(access.amount).toFixed(2)}` },
        { icon: 'calendar-blank', label: 'Pay by', value: esc(subscriptionDay(access.dueDate)) },
      ])}`);

  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">${isRenewal
      ? `Your subscription to <b>${esc(planName)}</b> has been extended. You have not set a password yet, so use the button below to finish setting up your account.`
      : 'Your account is ready. Set your password using the button below, then sign in to get started.'}</p>
    ${cta(isRenewal ? 'Finish setting up my account' : 'Set up my account', setupUrl)}
    ${status}
    ${plan}
    ${access.kind === 'awaiting_payment'
      ? '<p style="margin:0 0 14px;color:#374151;">You can submit your payment confirmation from <b>My Plan</b> once you are signed in.</p>'
      : ''}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Welcome',
    hero: hero('key', isRenewal ? 'Finish your setup' : 'Welcome', 'Set up your account', '', access.kind === 'active' ? 'good' : 'info'),
  });
}


// -- Subscription expiring soon (student notified) ---
// Expiry is automatic and silent: access simply disappears on the period end with nothing
// sent. This is the one lifecycle notice a learner cannot infer from an admin action.
export function subscriptionExpiringEmail(data: {
  name: string;
  planName: string;
  periodEnd: string;
  daysLeft: number;
  dashboardUrl: string;
  branding?: EmailBranding;
}) {
  const { name, planName, periodEnd, daysLeft, dashboardUrl, branding } = data;
  const days = `${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">Your subscription to <b>${esc(planName)}</b> ends in <b>${esc(days)}</b>.</p>
    ${callout('warn', '', `Access ends on <b>${esc(subscriptionDay(periodEnd))}</b>. After that date your courses and materials will no longer be available until the subscription is renewed.`)}
    ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="middle">${detailRows([
        { label: 'Plan', value: esc(planName) },
        { icon: 'calendar-blank', label: 'Access ends', value: esc(subscriptionDay(periodEnd)) },
      ])}</td>
      <td width="100" valign="middle" align="right" style="padding-left:16px;">${countdownTile(daysLeft)}</td>
    </tr></table>`, '6px 20px')}
    <p style="margin:0 0 14px;color:#374151;">To continue, contact your instructor to arrange your renewal.</p>
    ${cta('Go to my dashboard', `${dashboardUrl}/student`)}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Subscription',
    hero: hero('timer', 'Subscription ending', 'Your access ends soon', '', 'warn'),
  });
}


/** A learner started a subscription checkout and did not finish it. */
export function abandonedCheckoutEmail(data: {
  name: string;
  planName: string;
  /** For example "3 months" or "1 year". */
  duration: string;
  /** Currency and amount, for example "GHS 450.00". */
  price: string;
  actionUrl: string;
  branding?: EmailBranding;
}) {
  const { name, planName, duration, price, actionUrl, branding } = data;
  const content = `
    <p style="margin:0 0 14px;"><b>Hi ${esc(name)},</b></p>
    <p style="margin:0 0 14px;">You started subscribing to <b>${esc(planName)}</b> (${esc(duration)}, ${esc(price)}) and did not finish. Your place is still here whenever you want it.</p>
    ${planCard(planName, esc(duration), stamp('Not finished', 'warn'),
      `<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>${detailRows([{ icon: 'credit-card', label: 'Price', value: esc(price) }])}`)}
    ${cta('Finish your payment', esc(actionUrl))}
    ${small('Nothing has been charged, and you owe nothing. If you have changed your mind, you can ignore this email.')}
    ${signoff()}
  `;
  return shell(content, {
    ...branding, kind: 'Checkout',
    hero: hero('credit-card', 'Checkout', 'Still interested?', ''),
  });
}

