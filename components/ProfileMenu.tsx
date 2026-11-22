'use client';

// The signed-in person's menu in the top bar: one for the dashboard, the student pages and the
// landing pages, with the links their role has.

import { useEffect, useRef, useState, type ElementType } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { Award, BarChart3, ChevronDown, GraduationCap, LayoutDashboard, LogOut, Settings, User } from 'lucide-react';
import { DARK_C, LIGHT_C, useC } from '@/lib/theme';
import { initials } from '@/components/dashboard/subscriptions/ui';

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

  const item = (href: string, Icon: ElementType, label: string, external?: boolean) => (
    <Link key={label} href={href} onClick={() => setOpen(false)} {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
      className="flex items-center gap-3 px-3 py-2 rounded-[10px] text-sm font-medium ff-hover" style={{ color: C.text, textDecoration: 'none' }}>
      <Icon className="w-4 h-4 flex-shrink-0" />{label}
    </Link>
  );
  const face = (size: string, text: string) => (
    <span className={`${size} rounded-full overflow-hidden grid place-items-center ${text} font-bold flex-shrink-0`} style={{ background: C.pill, color: C.muted }}>
      {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : initials(name)}
    </span>
  );

  return (
    <div ref={ref} className="relative" style={fontFamily ? { fontFamily } : undefined}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu"
        className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full" style={{ background: C.card, boxShadow: `inset 0 0 0 1px ${C.divider}` }}>
        {face('w-8 h-8', 'text-xs')}
        <span className="hidden sm:inline text-sm font-semibold max-w-[140px] truncate" style={{ color: C.text }}>{name}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: C.muted }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div role="menu" initial={{ opacity: 0, scale: 0.96, y: -6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full mt-2 w-[272px] rounded-2xl overflow-hidden z-50"
            style={{ background: C.card, boxShadow: `0 20px 60px rgba(0,0,0,0.14), 0 0 0 1px ${C.divider}` }}>
            <div className="flex items-center gap-3 px-4 py-3.5" style={{ borderBottom: `1px solid ${C.divider}` }}>
              {face('w-10 h-10', 'text-sm')}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{name}</p>
                <p className="text-xs truncate mt-0.5" style={{ color: C.muted }}>{username ? `@${username}` : user?.email}</p>
              </div>
            </div>
            <div className="p-1.5">
              {teaches && item('/dashboard', BarChart3, 'Instructor dashboard')}
              {role === 'staff' && item('/dashboard#events', LayoutDashboard, 'Staff dashboard')}
              {/* Pages that do not load the profile cannot tell the role; they keep the plain link. */}
              {!role && item('/dashboard', LayoutDashboard, 'Dashboard')}
              {item('/student#courses', GraduationCap, 'My learning')}
              {item('/student#certificates', Award, 'My certificates')}
              {username && item(teaches ? `/u/${username}` : `/s/${username}`, User, 'View public profile', true)}
              {item('/settings', Settings, 'Settings')}
            </div>
            <div className="p-1.5" style={{ borderTop: `1px solid ${C.divider}` }}>
              <button type="button" onClick={() => { setOpen(false); onSignOut(); }}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-[10px] text-sm font-medium ff-hover" style={{ color: C.deleteText }}>
                <LogOut className="w-4 h-4 flex-shrink-0" /> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
