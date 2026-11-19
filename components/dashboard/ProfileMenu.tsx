'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { Settings, User, LogOut, ChevronDown, GraduationCap } from 'lucide-react';
import { useC } from '@/lib/theme';
import { loadGoogleFont, getFontById } from '@/lib/fonts';

// --- ProfileMenu ---
const PROFILE_MENU_FONT = "'Google Sans Text', sans-serif";

export function ProfileMenu({ user, profile, onSignOut }: { user: any; profile: any; onSignOut: () => void }) {
  const C = useC();
  const [open, setOpen] = useState(false);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { loadGoogleFont(getFontById('google-sans-text')); }, []);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && btnRef.current && !btnRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const name     = profile?.full_name || profile?.name || user?.email?.split('@')[0] || 'User';
  const username = profile?.username;
  const initials = name.slice(0, 2).toUpperCase();
  const avatar   = profile?.avatar_url;

  return (
    <div className="relative" style={{ fontFamily: PROFILE_MENU_FONT }}>
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border transition-all hover:shadow-sm"
        style={{ background: C.card, borderColor: C.cardBorder, fontFamily: PROFILE_MENU_FONT }}
      >
        <div className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: C.lime, color: C.green }}>
          {avatar ? <img src={avatar} alt={name} className="w-full h-full object-cover"/> : <span>{initials}</span>}
        </div>
        <span className="hidden sm:inline text-sm font-medium max-w-[120px] truncate" style={{ color: C.text }}>{name}</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color: C.faint }}/>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div ref={menuRef}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-56 rounded-2xl overflow-hidden z-50"
            style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', fontFamily: PROFILE_MENU_FONT }}
          >
            <div className="px-4 py-4 border-b" style={{ borderColor: C.divider }}>
              <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{name}</p>
              {username
                ? <p className="text-xs mt-0.5" style={{ color: C.faint }}>@{username}</p>
                : <p className="text-xs mt-0.5 truncate" style={{ color: C.faint }}>{user?.email}</p>
              }
            </div>
            <div className="py-2">
              {profile?.role === 'staff' && (
                <Link href="/student" onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm transition-colors ff-hover"
                  style={{ color: C.text }}>
                  <GraduationCap className="w-4 h-4" style={{ color: C.text }}/> My Learning
                </Link>
              )}
              {username && (
                <Link href={`/u/${username}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 text-sm transition-colors ff-hover"
                  style={{ color: C.text }}>
                  <User className="w-4 h-4" style={{ color: C.text }}/> View public profile
                </Link>
              )}
              <Link href="/settings" onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-3 text-sm transition-colors ff-hover"
                style={{ color: C.text }}>
                <Settings className="w-4 h-4" style={{ color: C.text }}/> Settings
              </Link>
            </div>
            <div className="border-t py-2" style={{ borderColor: C.divider }}>
              <button onClick={() => { setOpen(false); onSignOut(); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors"
                style={{ color: C.deleteText }}
                onMouseEnter={e => (e.currentTarget.style.background = C.signOutHover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <LogOut className="w-4 h-4"/> Sign out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
