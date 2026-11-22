'use client';

// The signed-in person's menu in the top bar: one for the dashboard, the student pages and the
// landing pages, with the links their role has.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { ArrowUpRight, Certificate, ChartBar, GearSix, PlayCircle, SignOut, SquaresFour, UserCircle, type Icon as PhosphorIcon } from '@phosphor-icons/react';
import { DARK_C, LIGHT_C, useC } from '@/lib/theme';

export function ProfileMenu({ user, profile, onSignOut, dark, fontFamily }: {
  user: any;
  /** The students row, or null where the page does not load it (then the role is unknown). */
  profile: any;
  onSignOut: () => void;
  /** Landing pages draw their own light or dark; elsewhere the menu follows the theme. */
  dark?: boolean;
  fontFamily?: string;
}) {
  const themed = useC();
  const C = dark === undefined ? themed : dark ? DARK_C : LIGHT_C;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const name = profile?.full_name || profile?.name || user?.email?.split('@')[0] || 'User';
  const username = profile?.username;
  const avatar = profile?.avatar_url && /^https?:\/\//.test(profile.avatar_url) ? profile.avatar_url : null;
  const role: string | undefined = profile?.role;
  const teaches = role === 'instructor' || role === 'admin';

  // The left menus' look: duotone icons on 40px rows, a light grey on hover.
  const hover = C.page === DARK_C.page ? 'rgba(255,255,255,0.06)' : '#F1F3F6';
  const rowClass = 'flex h-10 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors';
  const onEnter = (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = hover; };
  const onLeave = (e: React.MouseEvent) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; };
  const item = (href: string, Icon: PhosphorIcon, label: string, external?: boolean) => (
    <Link key={label} href={href} onClick={() => setOpen(false)} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className={rowClass} style={{ color: C.text, textDecoration: 'none' }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <Icon size={20} weight="duotone" className="flex-shrink-0" style={{ color: C.muted }} />
      <span className="flex-1 truncate">{label}</span>
      {external && <ArrowUpRight size={14} className="flex-shrink-0" style={{ color: C.faint }} />}
    </Link>
  );
  // The person's photo, or a person icon: no initials.
  const face = (size: number) => (
    <span className="grid flex-shrink-0 place-items-center overflow-hidden rounded-full" style={{ width: size, height: size, background: C.pill, color: C.muted }}>
      {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <UserCircle size={Math.round(size * 0.7)} weight="duotone" />}
    </span>
  );

  return (
    <div ref={ref} className="relative" style={fontFamily ? { fontFamily } : undefined}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
        {face(32)}
        <span className="hidden sm:inline text-sm font-semibold max-w-[140px] truncate" style={{ color: C.text }}>{name}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: C.muted }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, scale: 0.96, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full mt-2 w-[288px] rounded-2xl overflow-hidden z-50"
            style={{ background: C.card, boxShadow: `0 20px 60px rgba(0,0,0,0.14), 0 0 0 1px ${C.divider}` }}>
            <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
              {face(44)}
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold truncate" style={{ color: C.text }}>{name}</p>
                <p className="text-[13px] truncate mt-0.5" style={{ color: C.muted }}>{username ? `@${username}` : user?.email}</p>
              </div>
            </div>
            <div className="flex flex-col gap-0.5 p-2">
              {teaches && item('/dashboard', ChartBar, 'Instructor dashboard')}
              {role === 'staff' && item('/dashboard#events', SquaresFour, 'Staff dashboard')}
              {/* Pages that do not load the profile cannot tell the role; they keep the plain link. */}
              {!role && item('/dashboard', SquaresFour, 'Dashboard')}
              {item('/student#courses', PlayCircle, 'My learning')}
              {item('/student#certificates', Certificate, 'My certificates')}
              {username && item(teaches ? `/u/${username}` : `/s/${username}`, UserCircle, 'View public profile', true)}
              {item('/settings', GearSix, 'Settings')}
            </div>
            <div className="p-2" style={{ borderTop: `1px solid ${C.divider}` }}>
              <button type="button" onClick={() => { setOpen(false); onSignOut(); }}
                className={rowClass} style={{ color: C.deleteText }} onMouseEnter={onEnter} onMouseLeave={onLeave}>
                <SignOut size={20} weight="duotone" className="flex-shrink-0" /> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
