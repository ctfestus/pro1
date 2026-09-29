'use client';

import { useState, useEffect, useLayoutEffect, useRef, useContext, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/ThemeProvider';
import { sanitizeRichText } from '@/lib/sanitize';
import {
  Plus, FileText, BarChart3, ExternalLink, Trash2, Edit2, Share2, Check, Copy, X,
  CalendarDays, AlignLeft, ChevronDown, ChevronRight, ChevronLeft, BookOpen, MapPin,
  Download, Briefcase, Video, Database, MoreVertical, Send, Code2, ShieldCheck,
} from 'lucide-react';
import { LIGHT_C, useC, cardStyle } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { exportContent } from '@/lib/dashboard-export';
import { SYNC_ENABLED } from '@/lib/sync';
import { getLastScheduledSessionDate, getNextScheduledSessionDate } from '@/lib/event-sessions';
import { usePushStatus, PushStatusPill } from '@/components/dashboard/primitives';
import { IsStaffContext } from '@/components/dashboard/context';

// --- Social share SVGs ---
const SHARE_PLATFORMS = [
  { id: 'twitter',  label: 'X',         icon: <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>, href: (u:string,t:string,d:string) => `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${t}\n${d}`)}&url=${encodeURIComponent(u)}` },
  { id: 'linkedin', label: 'LinkedIn',   icon: <svg viewBox="0 0 24 24" fill="#0A66C2" className="w-4 h-4"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>, href: (u:string) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}` },
  { id: 'facebook', label: 'Facebook',   icon: <svg viewBox="0 0 24 24" fill="#1877F2" className="w-4 h-4"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>, href: (u:string) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}` },
  { id: 'whatsapp', label: 'WhatsApp',   icon: <svg viewBox="0 0 24 24" fill="#25D366" className="w-4 h-4"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>, href: (u:string,t:string,d:string) => `https://wa.me/?text=${encodeURIComponent(`${t}\n${d}\n\n${u}`)}` },
];

// --- ShareMenu (portal) ---
function ShareMenu({ form, triggerRect, onClose }: { form: any; triggerRect: DOMRect; onClose: () => void }) {
  const C = useC();
  const menuRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const url   = `${window.location.origin}/${form.slug || form.id}`;
  const title = form.title as string;
  const desc  = (form.description || '').replace(/<[^>]*>/g, '') as string;

  useLayoutEffect(() => {
    const menuH = menuRef.current?.offsetHeight ?? 320;
    const menuW = 288;
    const gap = 8;
    const vp = window.innerHeight;
    const spaceAbove = triggerRect.top;
    const spaceBelow = vp - triggerRect.bottom;
    let top = (spaceAbove >= menuH + gap || spaceAbove > spaceBelow) ? triggerRect.top - menuH - gap : triggerRect.bottom + gap;
    let left = triggerRect.right - menuW;
    if (left < 8) left = 8;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- legitimate DOM measurement pattern
    setPos({ top, left });
  }, [triggerRect]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('scroll', onClose, true);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('scroll', onClose, true); };
  }, [onClose]);

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(url); } catch { window.prompt('Copy link:', url); }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return createPortal(
    <motion.div ref={menuRef}
      initial={{ opacity: 0, scale: 0.95, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: 6 }}
      transition={{ duration: 0.15 }}
      style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999, zIndex: 9999, width: 288, visibility: pos ? 'visible' : 'hidden', background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', overflow: 'hidden' }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: C.divider }}>
        <span className="text-sm font-semibold" style={{ color: C.text }}>Share</span>
        <button onClick={onClose} className="transition-colors hover:opacity-60" style={{ color: C.faint }}><X className="w-4 h-4"/></button>
      </div>
      {form.config?.coverImage && (
        <div className="mx-4 mt-3 rounded-xl overflow-hidden border h-20" style={{ borderColor: C.cardBorder }}>
          <img src={resolveCoverUrl(form.config.coverImage)} alt={title} className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')}/>
        </div>
      )}
      <div className="px-4 py-3 border-b" style={{ borderColor: C.divider }}>
        <p className="text-sm font-medium truncate" style={{ color: C.text }}>{title}</p>
        {desc && <p className="text-xs mt-0.5 line-clamp-2" style={{ color: C.muted }}>{desc}</p>}
      </div>
      <div className="px-4 py-3 border-b" style={{ borderColor: C.divider }}>
        <div className="flex items-center gap-2 rounded-xl overflow-hidden border" style={{ background: C.input, borderColor: C.cardBorder }}>
          <span className="flex-1 text-xs px-3 py-2 truncate" style={{ color: C.faint }}>{url}</span>
          <button onClick={copyLink} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-l flex-shrink-0"
            style={{ background: C.lime, color: C.green, borderColor: C.cardBorder }}>
            {copied ? <Check className="w-3.5 h-3.5"/> : <Copy className="w-3.5 h-3.5"/>}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-[11px] uppercase tracking-wider font-semibold mb-2.5" style={{ color: C.faint }}>Share on</p>
        <div className="grid grid-cols-4 gap-2">
          {SHARE_PLATFORMS.map(({ id, label, icon, href }) => (
            <a key={id} href={href(url, title, desc)} target="_blank" rel="noreferrer" title={label}
              className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl transition-colors group ff-hover"
              style={{ background: C.pill }}>
              <span className="transition-transform group-hover:scale-110">{icon}</span>
              <span className="text-[10px] transition-colors" style={{ color: C.faint }}>{label}</span>
            </a>
          ))}
        </div>
      </div>
    </motion.div>,
    document.body
  );
}

// Single "Create Course" button with a dropdown of creation methods.
export function CreateCourseMenu({ C }: { C: any }) {
  const [open, setOpen] = useState(false);
  const options = [
    { href: '/create?type=course',          label: 'Blank Course',        desc: 'Build from scratch',                        Icon: Plus,     color: C.cta },
    { href: '/create?type=sql-course',      label: 'SQL Course AI',       desc: 'Generate a full SQL course with exercises', Icon: Database, color: '#3b82f6' },
    { href: '/create?type=python-course',   label: 'Python Course AI',    desc: 'Generate a data analysis course with Python exercises', Icon: Code2, color: '#f59e0b' },
    { href: '/create?type=doc-course',      label: 'Document to Course',  desc: 'Turn a PDF, deck, or guide into a course',  Icon: FileText, color: C.green },
    { href: '/create/certification',        label: 'Certification Exam',  desc: 'Timed, protected exam that issues a certificate', Icon: ShieldCheck, color: '#10b981' },
  ];
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90"
        style={{ background: C.cta, color: C.ctaText }}>
        <Plus className="w-4 h-4"/> Create Course
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} style={{ opacity: 0.85 }}/>
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}/>
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -4 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-2 w-72 rounded-2xl overflow-hidden z-50 py-1.5 text-left"
              style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: '0 8px 32px rgba(0,0,0,0.14)' }}>
              {options.map(opt => (
                <Link key={opt.href} href={opt.href} onClick={() => setOpen(false)}
                  className="flex items-start gap-3 px-3.5 py-2.5 transition-colors ff-hover">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${opt.color}18` }}>
                    <opt.Icon className="w-4 h-4" style={{ color: opt.color }}/>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold leading-tight" style={{ color: C.text }}>{opt.label}</p>
                    <p className="text-xs mt-0.5 leading-snug" style={{ color: C.faint }}>{opt.desc}</p>
                  </div>
                </Link>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Card actions kebab (consolidates per-card actions into one top-right menu) ---
export type CardAction = {
  key: string; label: string; Icon: any; danger?: boolean;
  href?: string; external?: boolean; onClick?: () => void; share?: boolean;
};

// One "more options" (vertical-dots) menu for a content card. Renders the dropdown in a portal
// so it is never clipped by the card's overflow-hidden thumbnail. `share` actions reuse the
// existing ShareMenu popover (shareMenuOpen/setShareMenuOpen only needed if a share action exists).
export function CardActionsMenu({ form, actions, shareMenuOpen, setShareMenuOpen, triggerClassName, triggerStyle }: {
  form: any; actions: CardAction[]; shareMenuOpen?: string | null; setShareMenuOpen?: (id: string | null) => void;
  /** Override the trigger's look when the menu does not sit on a thumbnail (e.g. list cards). */
  triggerClassName?: string; triggerStyle?: CSSProperties;
}) {
  const C = useC();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [shareRect, setShareRect] = useState<DOMRect | null>(null);
  const MENU_W = 188;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    let left = r.right - MENU_W;
    if (left < 8) left = 8;
    if (left + MENU_W > window.innerWidth - 8) left = window.innerWidth - MENU_W - 8;
    setPos({ top: r.bottom + 6, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('scroll', close, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('scroll', close, true); };
  }, [open]);

  const run = (a: CardAction) => {
    setOpen(false);
    if (a.share) {
      if (btnRef.current && setShareMenuOpen) { setShareRect(btnRef.current.getBoundingClientRect()); setShareMenuOpen(form.id); }
      return;
    }
    a.onClick?.();
  };

  const itemCls = "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors ff-hover";

  return (
    <>
      <button ref={btnRef} type="button" title="More options" aria-label="More options"
        onClick={e => { e.stopPropagation(); e.preventDefault(); setOpen(o => !o); }}
        className={triggerClassName ?? 'p-1.5 rounded-full backdrop-blur-md transition-all hover:scale-110'}
        style={triggerStyle ?? { background: C.overlayBtn, color: C.overlayText }}>
        <MoreVertical className={triggerClassName ? 'w-4 h-4' : 'w-3.5 h-3.5'}/>
      </button>
      {open && pos && createPortal(
        <div ref={menuRef} onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_W, zIndex: 9999, background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.14)', overflow: 'hidden', padding: 4 }}>
          {actions.map(a => {
            const inner = <><a.Icon className="w-3.5 h-3.5 flex-shrink-0"/><span>{a.label}</span></>;
            const color = a.danger ? '#ef4444' : C.text;
            if (a.href) {
              return a.external
                ? <a key={a.key} href={a.href} target="_blank" rel="noreferrer" onClick={() => setOpen(false)} className={itemCls} style={{ color }}>{inner}</a>
                : <Link key={a.key} href={a.href} onClick={() => setOpen(false)} className={itemCls} style={{ color }}>{inner}</Link>;
            }
            return <button key={a.key} type="button" onClick={() => run(a)} className={itemCls} style={{ color }}>{inner}</button>;
          })}
        </div>,
        document.body
      )}
      <AnimatePresence>
        {shareMenuOpen === form.id && shareRect && <ShareMenu form={form} triggerRect={shareRect} onClose={() => setShareMenuOpen?.(null)}/>}
      </AnimatePresence>
    </>
  );
}

// --- Form type helpers ---
export function getFormType(form: any): 'course' | 'event' | 'form' | 'virtual_experience' {
  if (form.content_type === 'virtual_experience' || form.content_type === 'guided_project' || form.config?.isVirtualExperience || form.config?.isGuidedProject) return 'virtual_experience';
  if (form.content_type === 'course' || form.config?.isCourse) return 'course';
  if (form.content_type === 'event'  || form.config?.eventDetails?.isEvent) return 'event';
  return 'form';
}

function getTypeMeta(C: typeof LIGHT_C) {
  return {
    course:         { label: 'Course',         Icon: BookOpen,     badgeBg: '#0e09dd',    badgeText: '#ffffff'       },
    event:          { label: 'Event',          Icon: CalendarDays, badgeBg: '#00a4ef',    badgeText: '#ffffff'       },
    form:           { label: 'Form',           Icon: AlignLeft,    badgeBg: C.formBadgeBg, badgeText: C.formBadgeText },
    virtual_experience: { label: 'Virtual Experience', Icon: Briefcase,    badgeBg: '#ff9933',    badgeText: '#111111'       },
  };
}

// --- Card illustrations ---
function EventIllustration() {
  return (
    <svg viewBox="0 0 240 148" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%' }}>
      {/* Card drop shadow */}
      <rect x="57" y="17" width="110" height="90" rx="10" fill="rgba(0,97,40,0.10)"/>
      {/* Calendar card body */}
      <rect x="55" y="15" width="110" height="90" rx="10" fill="white"/>
      {/* Green header -- rounded top corners only */}
      <path d="M65,15 H155 Q165,15 165,25 V50 H55 V25 Q55,15 65,15 Z" fill="#00bf63"/>
      {/* Calendar ring hooks */}
      <rect x="80" y="10" width="6" height="11" rx="3" fill="#ADEE66"/>
      <rect x="134" y="10" width="6" height="11" rx="3" fill="#ADEE66"/>
      {/* Month label placeholder */}
      <rect x="98" y="21" width="24" height="4" rx="2" fill="rgba(255,255,255,0.35)"/>
      {/* Date number block */}
      <rect x="103" y="29" width="34" height="16" rx="5" fill="rgba(255,255,255,0.18)"/>
      <rect x="107" y="32" width="26" height="9" rx="2.5" fill="rgba(255,255,255,0.65)"/>

      {/* Schedule row 1 */}
      <circle cx="68" cy="64" r="3.5" fill="#ADEE66"/>
      <rect x="76" y="62" width="60" height="4" rx="2" fill="#d4eddd"/>
      <rect x="76" y="62" width="38" height="4" rx="2" fill="#9ad4b0"/>

      {/* Schedule row 2 */}
      <circle cx="68" cy="77" r="3.5" fill="#00bf63" opacity="0.65"/>
      <rect x="76" y="75" width="60" height="4" rx="2" fill="#d4eddd"/>
      <rect x="76" y="75" width="52" height="4" rx="2" fill="#9ad4b0"/>

      {/* Schedule row 3 */}
      <circle cx="68" cy="90" r="3.5" fill="#ADEE66" opacity="0.8"/>
      <rect x="76" y="88" width="60" height="4" rx="2" fill="#d4eddd"/>
      <rect x="76" y="88" width="26" height="4" rx="2" fill="#9ad4b0"/>

      {/* Ticket -- bottom-right, tilted */}
      <g transform="rotate(-13, 182, 108)">
        {/* Ticket body */}
        <rect x="154" y="93" width="56" height="28" rx="6" fill="#ADEE66"/>
        {/* Stub divider */}
        <line x1="172" y1="96" x2="172" y2="118" stroke="#00bf63" strokeWidth="1" strokeDasharray="2.5,2" opacity="0.4"/>
        {/* Barcode lines in stub area */}
        <rect x="178" y="99" width="2"  height="16" rx="1" fill="#00bf63" opacity="0.3"/>
        <rect x="182" y="99" width="1"  height="16" rx="1" fill="#00bf63" opacity="0.3"/>
        <rect x="185" y="99" width="3"  height="16" rx="1" fill="#00bf63" opacity="0.3"/>
        <rect x="190" y="99" width="1"  height="16" rx="1" fill="#00bf63" opacity="0.3"/>
        <rect x="193" y="99" width="2"  height="16" rx="1" fill="#00bf63" opacity="0.3"/>
        <rect x="197" y="99" width="1"  height="16" rx="1" fill="#00bf63" opacity="0.3"/>
        <rect x="200" y="99" width="3"  height="16" rx="1" fill="#00bf63" opacity="0.3"/>
      </g>

      {/* Location pin -- left floating */}
      <path d="M28,36 C28,29 38,29 38,36 C38,43 33,51 33,51 C33,51 28,43 28,36 Z" fill="#00bf63" opacity="0.85"/>
      <circle cx="33" cy="36" r="3.5" fill="white"/>

      {/* Attendee avatar row */}
      <circle cx="78"  cy="131" r="9" fill="#d4eddd" stroke="white" strokeWidth="2"/>
      <circle cx="94"  cy="131" r="9" fill="#a8d9bb" stroke="white" strokeWidth="2"/>
      <circle cx="110" cy="131" r="9" fill="#ADEE66" stroke="white" strokeWidth="2"/>
      <circle cx="126" cy="131" r="9" fill="#d4eddd" stroke="white" strokeWidth="2"/>
      {/* +more pill */}
      <rect x="134" y="122" width="26" height="18" rx="9" fill="#00bf63"/>
      <rect x="138" y="128" width="18" height="3" rx="1.5" fill="white" opacity="0.85"/>
      <rect x="141" y="133" width="12" height="3" rx="1.5" fill="white" opacity="0.55"/>

      {/* Floating accents */}
      <circle cx="36"  cy="14" r="4"   fill="#ADEE66" opacity="0.75"/>
      <circle cx="200" cy="20" r="5"   fill="#ADEE66" opacity="0.5"/>
      <circle cx="216" cy="68" r="2.5" fill="#00bf63" opacity="0.3"/>
      <circle cx="22"  cy="98" r="2.5" fill="#ADEE66" opacity="0.5"/>
      {/* Sparkle */}
      <path d="M207,42 L208.5,38 L210,42 L214,43.5 L210,45 L208.5,49 L207,45 L203,43.5 Z" fill="#ADEE66" opacity="0.8"/>
    </svg>
  );
}

function CourseIllustration() {
  return (
    <svg viewBox="0 0 240 148" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%' }}>
      {/* Desk surface */}
      <rect x="0" y="118" width="240" height="30" rx="0" fill="#d97706" opacity="0.13"/>
      {/* Laptop base */}
      <path d="M28 118 L212 118 L205 126 L35 126 Z" fill="#d97706" opacity="0.35"/>
      {/* Laptop body */}
      <rect x="44" y="28" width="152" height="90" rx="8" fill="#fef3c7"/>
      <rect x="44" y="28" width="152" height="90" rx="8" stroke="#d97706" strokeWidth="1.5" opacity="0.3"/>
      {/* Screen content - code lines */}
      <rect x="58" y="42" width="55" height="5" rx="2.5" fill="#f59e0b" opacity="0.7"/>
      <rect x="58" y="52" width="40" height="4" rx="2" fill="#d97706" opacity="0.5"/>
      <rect x="64" y="61" width="48" height="4" rx="2" fill="#f59e0b" opacity="0.45"/>
      <rect x="64" y="70" width="35" height="4" rx="2" fill="#d97706" opacity="0.5"/>
      <rect x="58" y="79" width="52" height="4" rx="2" fill="#f59e0b" opacity="0.4"/>
      <rect x="64" y="88" width="38" height="4" rx="2" fill="#d97706" opacity="0.45"/>
      {/* Video play circle */}
      <circle cx="152" cy="73" r="26" fill="#fbbf24" opacity="0.2"/>
      <circle cx="152" cy="73" r="18" fill="#f59e0b" opacity="0.3"/>
      <path d="M147 65 L162 73 L147 81 Z" fill="#d97706" opacity="0.8"/>
      {/* Graduation cap */}
      <rect x="170" y="10" width="48" height="6" rx="2" fill="#d97706" opacity="0.65"/>
      <path d="M158 16 L218 16 L218 32 Q194 42 194 42 Q170 32 170 32 Z" fill="#fbbf24" opacity="0.55"/>
      <rect x="215" y="16" width="3" height="22" rx="1.5" fill="#d97706" opacity="0.6"/>
      <circle cx="216" cy="39" r="5" fill="#fbbf24" opacity="0.8"/>
      {/* Certificate scroll */}
      <rect x="12" y="52" width="26" height="34" rx="4" fill="#fef3c7"/>
      <rect x="12" y="52" width="26" height="34" rx="4" stroke="#f59e0b" strokeWidth="1.5" opacity="0.5"/>
      <rect x="16" y="58" width="18" height="3" rx="1.5" fill="#d97706" opacity="0.5"/>
      <rect x="16" y="64" width="14" height="3" rx="1.5" fill="#f59e0b" opacity="0.4"/>
      <circle cx="25" cy="75" r="5" fill="#f59e0b" opacity="0.3"/>
      {/* Floating dots */}
      <circle cx="22" cy="30" r="3.5" fill="#fcd34d" opacity="0.7"/>
      <circle cx="14" cy="100" r="2.5" fill="#fbbf24" opacity="0.5"/>
      <circle cx="228" cy="85" r="3" fill="#fcd34d" opacity="0.5"/>
    </svg>
  );
}

function FormIllustration() {
  return (
    <svg viewBox="0 0 240 148" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%' }}>
      {/* Background accent circles */}
      <circle cx="22" cy="42" r="28" fill="#d1fae5" opacity="0.5"/>
      <circle cx="218" cy="108" r="22" fill="#a7f3d0" opacity="0.4"/>
      {/* Main form paper */}
      <rect x="58" y="12" width="124" height="124" rx="10" fill="white" opacity="0.85"/>
      <rect x="58" y="12" width="124" height="124" rx="10" stroke="#10b981" strokeWidth="1.5" opacity="0.25"/>
      {/* Form title */}
      <rect x="72" y="24" width="72" height="7" rx="3.5" fill="#059669" opacity="0.7"/>
      <rect x="72" y="35" width="50" height="4" rx="2" fill="#6ee7b7" opacity="0.6"/>
      {/* Row 1 */}
      <rect x="72" y="51" width="4" height="4" rx="1" fill="#10b981" opacity="0.4"/>
      <rect x="80" y="51" width="46" height="4" rx="2" fill="#d1fae5"/>
      <circle cx="155" cy="53" r="7" fill="#10b981" opacity="0.15"/>
      <path d="M152 53.5 L154.5 56 L158.5 51" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Row 2 */}
      <rect x="72" y="63" width="4" height="4" rx="1" fill="#10b981" opacity="0.4"/>
      <rect x="80" y="63" width="56" height="4" rx="2" fill="#d1fae5"/>
      <circle cx="155" cy="65" r="7" fill="#10b981" opacity="0.15"/>
      <path d="M152 65.5 L154.5 68 L158.5 63" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* Row 3 */}
      <rect x="72" y="75" width="4" height="4" rx="1" fill="#10b981" opacity="0.4"/>
      <rect x="80" y="75" width="38" height="4" rx="2" fill="#d1fae5"/>
      <circle cx="155" cy="77" r="7" fill="#6ee7b7" opacity="0.25"/>
      {/* Row 4 */}
      <rect x="72" y="87" width="4" height="4" rx="1" fill="#10b981" opacity="0.3"/>
      <rect x="80" y="87" width="62" height="4" rx="2" fill="#d1fae5" opacity="0.7"/>
      {/* Text area */}
      <rect x="72" y="101" width="96" height="20" rx="5" fill="#ecfdf5"/>
      <rect x="78" y="107" width="56" height="3" rx="1.5" fill="#6ee7b7" opacity="0.7"/>
      <rect x="78" y="113" width="38" height="3" rx="1.5" fill="#6ee7b7" opacity="0.5"/>
      {/* Submit button */}
      <rect x="96" y="126" width="48" height="14" rx="7" fill="#059669"/>
      <rect x="103" y="131" width="34" height="3" rx="1.5" fill="white" opacity="0.85"/>
    </svg>
  );
}

function StorefrontIllustration() {
  return (
    <svg viewBox="0 0 240 148" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', width: '100%' }}>
      {/* Sky / background */}
      <rect x="0" y="0" width="240" height="148" fill="#f5f3ff" opacity="0"/>
      {/* Building */}
      <rect x="24" y="32" width="192" height="116" rx="6" fill="#ede9fe" opacity="0.6"/>
      {/* Awning */}
      <rect x="18" y="38" width="204" height="22" rx="4" fill="#7c3aed" opacity="0.55"/>
      <path d="M18 60 Q38 70 58 60 Q78 70 98 60 Q118 70 138 60 Q158 70 178 60 Q198 70 218 60 L222 60 L222 60" stroke="white" strokeWidth="2" fill="none" opacity="0.45" strokeLinecap="round"/>
      {/* Store sign on awning */}
      <rect x="85" y="43" width="70" height="12" rx="3" fill="white" opacity="0.65"/>
      <rect x="92" y="47" width="56" height="4" rx="2" fill="#6d28d9" opacity="0.6"/>
      {/* Left window */}
      <rect x="36" y="68" width="72" height="65" rx="5" fill="white" opacity="0.7"/>
      <rect x="40" y="72" width="64" height="57" rx="3" fill="#faf5ff"/>
      {/* Window shelves */}
      <rect x="40" y="107" width="64" height="2" fill="#c4b5fd" opacity="0.5"/>
      <rect x="40" y="90" width="64" height="2" fill="#c4b5fd" opacity="0.4"/>
      {/* Products on shelves */}
      <rect x="46" y="94" width="14" height="13" rx="2" fill="#8b5cf6" opacity="0.45"/>
      <rect x="64" y="91" width="11" height="16" rx="2" fill="#7c3aed" opacity="0.35"/>
      <rect x="79" y="95" width="16" height="12" rx="2" fill="#a78bfa" opacity="0.45"/>
      <rect x="48" y="111" width="18" height="16" rx="2" fill="#c4b5fd" opacity="0.5"/>
      <rect x="70" y="113" width="13" height="14" rx="2" fill="#8b5cf6" opacity="0.35"/>
      {/* Door */}
      <rect x="132" y="80" width="68" height="68" rx="5" fill="white" opacity="0.6"/>
      <rect x="136" y="84" width="60" height="60" rx="3" fill="#faf5ff"/>
      <path d="M166 84 L166 148" stroke="#c4b5fd" strokeWidth="1.5" opacity="0.5"/>
      {/* Door handle */}
      <circle cx="158" cy="114" r="4" fill="#7c3aed" opacity="0.5"/>
      {/* Ground */}
      <rect x="0" y="140" width="240" height="8" fill="#7c3aed" opacity="0.1"/>
      {/* Floating bag top-right */}
      <rect x="190" y="8" width="32" height="30" rx="5" fill="#ddd6fe" opacity="0.7"/>
      <path d="M196 14 Q196 8 206 8 Q216 8 216 14" stroke="#7c3aed" strokeWidth="2" fill="none" strokeLinecap="round"/>
      <circle cx="206" cy="22" r="3" fill="#7c3aed" opacity="0.35"/>
      {/* Stars */}
      <circle cx="14" cy="22" r="3.5" fill="#a78bfa" opacity="0.6"/>
      <circle cx="8" cy="72" r="2.5" fill="#c4b5fd" opacity="0.5"/>
      <circle cx="230" cy="120" r="2" fill="#a78bfa" opacity="0.4"/>
    </svg>
  );
}

// --- CreateSection ---
const CREATE_CARDS = [
  {
    type: 'event',
    title: 'Event pages',
    desc: 'Registration, ticketing & schedules.',
    href: '/create?type=event',
    illBg: '#f7fee7',
    illBgDark: '#0c1a04',
    Illustration: EventIllustration,
    comingSoon: false,
  },
  {
    type: 'course',
    title: 'Online courses',
    desc: 'Lessons, quizzes & certificates.',
    href: '/create?type=course',
    illBg: '#fef6e4',
    illBgDark: '#1a1305',
    Illustration: CourseIllustration,
    comingSoon: false,
  },
  {
    type: 'form',
    title: 'Smart forms',
    desc: 'Custom fields, logic & analytics.',
    href: '/create?type=survey',
    illBg: '#ecfdf5',
    illBgDark: '#061510',
    Illustration: FormIllustration,
    comingSoon: false,
  },
  {
    type: 'storefront',
    title: 'Sell products',
    desc: 'Digital products & services.',
    href: '#',
    illBg: '#f5f3ff',
    illBgDark: '#100820',
    Illustration: StorefrontIllustration,
    comingSoon: true,
  },
];

function CreateSection({ C }: { C: typeof LIGHT_C }) {
  const { theme } = useTheme();
  const isDark = theme !== 'light';

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: C.faint }}>Create</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {CREATE_CARDS.map((card) => {
          const IllComp = card.Illustration;
          const cardStyle = {
            background: isDark ? C.card : 'white',
            boxShadow: C.cardShadow,
            opacity: card.comingSoon ? 0.58 : 1,
            transition: 'box-shadow 0.2s',
          };
          const cardClass = `flex flex-col rounded-2xl overflow-hidden ${card.comingSoon ? 'cursor-default' : 'cursor-pointer'}`;
          const hoverHandlers = card.comingSoon ? {} : {
            onMouseEnter: (e: React.MouseEvent<HTMLElement>) => { (e.currentTarget as HTMLElement).style.boxShadow = C.hoverShadow; },
            onMouseLeave: (e: React.MouseEvent<HTMLElement>) => { (e.currentTarget as HTMLElement).style.boxShadow = C.cardShadow; },
          };
          return (
            <motion.div key={card.type}
              whileHover={card.comingSoon ? {} : { y: -3 }}
              transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
              className="group"
            >
              {card.comingSoon ? (
                <div className={cardClass} style={cardStyle}>
                  {/* Text */}
                  <div className="px-4 pt-4 pb-3">
                    <div className="flex items-start justify-between">
                      <p className="text-[13px] font-semibold leading-snug" style={{ color: C.text }}>{card.title}</p>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full ml-2 flex-shrink-0 mt-0.5"
                        style={{ background: isDark ? 'rgba(124,58,237,0.14)' : '#f5f3ff', color: '#7c3aed' }}>
                        Soon
                      </span>
                    </div>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: C.faint }}>{card.desc}</p>
                  </div>
                  {/* Illustration */}
                  <div className="mx-3 mb-3 rounded-xl overflow-hidden"
                    style={{ background: isDark ? card.illBgDark : card.illBg }}>
                    <IllComp />
                  </div>
                </div>
              ) : (
                <Link href={card.href} className={cardClass} style={cardStyle} {...hoverHandlers}>
                  {/* Text */}
                  <div className="px-4 pt-4 pb-3">
                    <p className="text-[13px] font-semibold leading-snug" style={{ color: C.text }}>{card.title}</p>
                    <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: C.faint }}>{card.desc}</p>
                  </div>
                  {/* Illustration */}
                  <div className="mx-3 mb-3 rounded-xl overflow-hidden"
                    style={{ background: isDark ? card.illBgDark : card.illBg }}>
                    <IllComp />
                  </div>
                </Link>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// --- FormCard ---
function FormCard({ form, index, shareMenuOpen, setShareMenuOpen, setFormToDelete }: {
  form: any; index: number; shareMenuOpen: string | null; setShareMenuOpen: (id: string | null) => void; setFormToDelete: (id: string) => void;
}) {
  const C = useC();
  const router = useRouter();
  const type = getFormType(form);
  const meta = getTypeMeta(C)[type];
  const [coverError, setCoverError] = useState(false);
  const { state: pushState, msg: pushMsg, push } = usePushStatus('course', form.id);
  const canPush = SYNC_ENABLED && form.content_type === 'course';

  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: index * 0.06, duration: 0.4, ease: [0.22,1,0.36,1] }}
      className="group flex flex-col rounded-3xl p-3 gap-3"
      style={{ background: C.card, transition: 'transform 0.25s' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; }}
    >
      {/* Thumbnail */}
      <div role="button" tabIndex={0}
        onClick={() => router.push(`/dashboard/${form.id}`)}
        onKeyDown={e => e.key === 'Enter' && router.push(`/dashboard/${form.id}`)}
        className="relative h-44 w-full overflow-hidden cursor-pointer rounded-2xl flex-shrink-0"
        style={{ background: C.thumbBg }}>
        {(form.config?.coverImage && !coverError)
          ? <img src={resolveCoverUrl(form.config.coverImage)} alt={form.title} loading="lazy" onError={() => setCoverError(true)} className="block w-full h-full object-cover group-hover:scale-105 transition-transform duration-700 ease-out"/>
          : <div className="w-full h-full flex items-center justify-center group-hover:scale-105 transition-transform duration-700 ease-out">
              <meta.Icon className="w-10 h-10 opacity-20" style={{ color: C.green }}/>
            </div>
        }
        {/* Actions menu */}
        <div className="absolute top-3 right-3" onClick={e => e.stopPropagation()}>
          <CardActionsMenu form={form} shareMenuOpen={shareMenuOpen} setShareMenuOpen={setShareMenuOpen}
            actions={[
              { key: 'edit', label: 'Edit', Icon: Edit2, href: `/dashboard/${form.id}?tab=settings` },
              { key: 'preview', label: 'Preview', Icon: ExternalLink, href: `/${form.slug || form.id}`, external: true },
              { key: 'share', label: 'Share', Icon: Share2, share: true },
              { key: 'export', label: 'Export', Icon: Download, onClick: () => exportContent(form) },
              ...(canPush ? [{ key: 'push', label: 'Push to platform', Icon: Send, onClick: push } as CardAction] : []),
              { key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onClick: () => setFormToDelete(form.id) },
            ]}/>
        </div>
        <PushStatusPill state={pushState} msg={pushMsg} className="top-3 left-3"/>
      </div>

      {/* Content */}
      <div className="px-3 pb-3 flex-1 flex flex-col">
        <Link href={`/dashboard/${form.id}`} className="block">
          <h3 className="text-sm font-semibold truncate mb-1 hover:opacity-70 transition-opacity" style={{ color: C.text }}>{form.title}</h3>
        </Link>
        {form.status === 'draft' && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold mb-1" style={{ background: 'rgba(251,191,36,0.12)', color: '#f59e0b' }}>DRAFT</span>
        )}
        {type === 'event' && form.config?.eventDetails?.date && (
          <p className="text-xs mb-1 flex items-center gap-1" style={{ color: C.green }}>
            <CalendarDays className="w-3 h-3"/>
            {new Date(form.config.eventDetails.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </p>
        )}


        {/* Footer: informational only (actions live in the card's top-right menu). */}
        {type !== 'course' && (
          <div className="flex items-center gap-1.5 text-xs font-medium pt-3 border-t mt-auto" style={{ borderColor: C.divider, color: C.faint }}>
            <BarChart3 className="w-3.5 h-3.5"/>
            {form._response_count ?? 0} responses
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Group courses by their category/tool; named tools alphabetical, "Other" last
export function groupFormsByCategory(forms: any[]): [string, any[]][] {
  const groups = new Map<string, any[]>();
  for (const f of forms) {
    const key = (f.category ?? '').trim() || 'Other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === 'Other') return 1;
    if (b[0] === 'Other') return -1;
    return a[0].localeCompare(b[0]);
  });
}

// One tool group rendered as a titled, horizontally-scrolling carousel of course cards
export function CourseToolRow({ tool, forms, shareMenuOpen, setShareMenuOpen, setFormToDelete }: {
  tool: string; forms: any[]; shareMenuOpen: string | null; setShareMenuOpen: (id: string | null) => void; setFormToDelete: (id: string) => void;
}) {
  const C = useC();
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollByCards = (dir: number) => scrollRef.current?.scrollBy({ left: dir * 340, behavior: 'smooth' });
  return (
    <section className="rounded-2xl p-5 sm:p-6 mb-6" style={{ ...cardStyle(C) }}>
      <div className="flex items-center justify-between gap-4 mb-4">
        <h2 className="text-lg sm:text-xl font-bold truncate" style={{ color: C.text }}>{tool}</h2>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => scrollByCards(-1)} aria-label="Scroll left"
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <ChevronLeft className="w-4 h-4"/>
          </button>
          <button onClick={() => scrollByCards(1)} aria-label="Scroll right"
            className="w-9 h-9 rounded-full grid place-items-center transition-opacity hover:opacity-70"
            style={{ border: `1px solid ${C.cardBorder}`, color: C.muted }}>
            <ChevronRight className="w-4 h-4"/>
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex gap-6 overflow-x-auto pb-2 snap-x" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {forms.map((form, idx) => (
          <div key={form.id} className="flex-shrink-0 w-[300px] snap-start">
            <FormCard form={form} index={idx} shareMenuOpen={shareMenuOpen} setShareMenuOpen={setShareMenuOpen} setFormToDelete={setFormToDelete}/>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- EventCard (timeline) ---
const MEETING_LOGOS: Record<string, string> = {
  meet:  'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Meet.png',
  zoom:  'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Zoom.png',
  teams: 'https://gmokwtuyxccnjwpmifug.supabase.co/storage/v1/object/public/form-assets/Logos/Teams.png',
};
function MeetingProviderIcon({ provider, isVirtual }: { provider?: string; isVirtual: boolean }) {
  if (!isVirtual) return <MapPin className="w-4 h-4 flex-shrink-0" style={{ color: '#888' }}/>;
  const p = (provider || '').toLowerCase();
  const src = p.includes('zoom') ? MEETING_LOGOS.zoom : p.includes('teams') || p.includes('microsoft') ? MEETING_LOGOS.teams : MEETING_LOGOS.meet;
  return <img src={src} alt={provider} style={{ width: 16, height: 16, objectFit: 'contain', flexShrink: 0 }}/>;
}

export function EventCard({ form, index, isLast, shareMenuOpen, setShareMenuOpen, setFormToDelete }: {
  form: any; index: number; isLast: boolean; shareMenuOpen: string | null; setShareMenuOpen: (id: string | null) => void; setFormToDelete: (id: string) => void;
}) {
  const C = useC();
  const isStaff = useContext(IsStaffContext);
  const ev = form.config?.eventDetails ?? {};
  const schedule = {
    event_date: ev.date ?? null,
    timezone: ev.timezone ?? null,
    recurrence: ev.recurrence ?? 'once',
    recurrence_end_date: ev.recurrenceEndDate ?? null,
    recurrence_days: Array.isArray(ev.recurrenceDays) ? ev.recurrenceDays : [],
  };
  const nextSessionDate = getNextScheduledSessionDate(schedule);
  const lastSessionDate = nextSessionDate ? null : getLastScheduledSessionDate(schedule);
  const displayDate = nextSessionDate ?? lastSessionDate ?? ev.date ?? null;
  const dateObj = displayDate ? new Date(`${displayDate}T00:00:00`) : null;
  const _today = new Date(); _today.setHours(0, 0, 0, 0);
  const isPast = dateObj
    ? !nextSessionDate && dateObj < _today
    : false;
  const isPrivate = !!ev.isPrivate;
  const isVirtual = (ev.eventType || '').toLowerCase() === 'virtual';
  const [coverError, setCoverError] = useState(false);
  const showImage = !!(form.config?.coverImage && !coverError);

  const eventRepeats = !!ev.recurrence && ev.recurrence !== 'once';
  const displayDateLabel = dateObj
    ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  const dateLabel = displayDateLabel && eventRepeats && !isPast && nextSessionDate
    ? `Next: ${displayDateLabel}`
    : displayDateLabel;

  const providerName = isVirtual
    ? ((ev.meetingLink || '').includes('zoom') ? 'Zoom' : (ev.meetingLink || '').includes('teams') ? 'Microsoft Teams' : 'Google Meet')
    : 'In-Person';

  return (
    <div className="relative flex gap-3">
      {/* Timeline */}
      <div className="flex flex-col items-center flex-shrink-0" style={{ paddingTop: '26px' }}>
        <div className="w-3 h-3 rounded-full border-2 z-10 flex-shrink-0"
          style={{ borderColor: isPast ? '#ccc' : C.green, background: isPast ? '#e0e0e0' : C.lime }}/>
        {!isLast && (
          <div className="w-px mt-1 flex-1"
            style={{ background: `repeating-linear-gradient(to bottom, ${C.faint}70 0px, ${C.faint}70 5px, transparent 5px, transparent 9px)` }}/>
        )}
      </div>

      {/* Content */}
      <motion.div
        className="flex-1 mb-5"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: isPast ? 0.65 : 1, y: 0 }}
        whileHover={{ opacity: 1 }}
        transition={{ delay: index * 0.07, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* Card with padding -- padding IS the whitespace around the rounded thumbnail. Flat at rest (border = the separator), soft lift on hover. */}
        <div className="relative rounded-2xl p-4 flex gap-4 group transition-shadow duration-200"
          style={{ ...cardStyle(C) }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = C.hoverShadow; }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}>
          <div className="absolute top-3 right-3 z-10">
            <CardActionsMenu form={form} shareMenuOpen={shareMenuOpen} setShareMenuOpen={setShareMenuOpen}
              actions={[
                { key: 'edit', label: 'Edit', Icon: Edit2, href: `/dashboard/${form.id}?tab=settings` },
                { key: 'preview', label: 'Preview', Icon: ExternalLink, href: `/${form.slug || form.id}`, external: true },
                { key: 'share', label: 'Share', Icon: Share2, share: true },
                { key: 'export', label: 'Export', Icon: Download, onClick: () => exportContent(form) },
                ...(!isStaff ? [{ key: 'delete', label: 'Delete', Icon: Trash2, danger: true, onClick: () => setFormToDelete(form.id) }] : []),
              ]}/>
          </div>

          {/* Rounded square cover image -- 180×180 */}
          <div className="relative w-[180px] h-[180px] rounded-2xl overflow-hidden flex-shrink-0 group/img"
            style={{ background: C.thumbBg }}>
            {showImage
              ? <img src={resolveCoverUrl(form.config.coverImage)} alt={form.title} onError={() => setCoverError(true)}
                  className="w-full h-full object-cover"/>
              : <div className="w-full h-full flex flex-col items-center justify-center gap-0.5">
                  {dateObj
                    ? <>
                        <span className="text-2xl font-black leading-none" style={{ color: C.green }}>{dateObj.toLocaleDateString(undefined, { day: '2-digit' })}</span>
                        <span className="text-[10px] font-bold tracking-widest" style={{ color: C.green }}>{dateObj.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</span>
                      </>
                    : <CalendarDays className="w-8 h-8" style={{ color: C.faint }}/>
                  }
                </div>
            }
          </div>

          {/* Text content */}
          <div className="flex-1 min-w-0 flex flex-col gap-2 justify-center">
            {/* Row 1: Date · Time pill + Mode pill */}
            <div className="flex items-center gap-2 flex-wrap">
              {dateLabel && (
                <span className="text-xs font-medium px-2.5 py-1 rounded-full"
                  style={{ background: C.pill, color: C.muted }}>
                  {dateLabel}{ev.time && ` · ${ev.time}`}
                </span>
              )}
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ border: `1.5px solid ${isVirtual ? C.green + '70' : C.faint + '60'}`, color: isVirtual ? C.green : C.muted }}>
                {isVirtual ? 'Virtual' : 'In-Person'}
              </span>
              {isPrivate && <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ background: '#fff0f0', color: '#ef4444' }}>🔒 Private</span>}
              {isPast && <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={{ background: C.pill, color: C.faint }}>Past</span>}
            </div>

            {/* Row 2: Provider logo + name + note / location */}
            <div className="flex items-center gap-1.5">
              <MeetingProviderIcon provider={providerName} isVirtual={isVirtual}/>
              <span className="text-xs" style={{ color: C.muted }}>
                <span className="font-medium">{providerName}</span>
                {isVirtual
                  ? <span style={{ color: C.faint }}> · Link shared after registration</span>
                  : ev.location
                  ? <span style={{ color: C.faint }}> · {ev.location}</span>
                  : null
                }
              </span>
            </div>

            {/* Title */}
            <h3 className="text-sm font-bold leading-snug line-clamp-2" style={{ color: C.text }}>{form.title}</h3>
            {form.status === 'draft' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ background: 'rgba(251,191,36,0.12)', color: '#f59e0b' }}>DRAFT</span>
            )}

            {/* Description */}
            {form.config?.description && (
              <div className="text-xs leading-relaxed line-clamp-2 rich-content" style={{ color: C.muted }}
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(form.config.description) }} />
            )}

            {/* Footer: responses + Insights (actions live in the card's top-right menu) */}
            <div className="flex items-center justify-between pt-2 border-t mt-1" style={{ borderColor: C.divider }}>
              <span className="text-xs flex items-center gap-1" style={{ color: C.faint }}>
                <BarChart3 className="w-3 h-3"/>{form._response_count ?? 0} responses
              </span>
              <Link href={`/dashboard/${form.id}`} className="text-xs font-medium hover:opacity-60 transition-opacity" style={{ color: C.green }}>Insights</Link>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
