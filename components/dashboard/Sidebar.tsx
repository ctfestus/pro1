'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeftToLine, ArrowRightToLine } from 'lucide-react';
import { GearSix } from '@phosphor-icons/react';
import { LIGHT_C } from '@/lib/theme';
import { NAV_ITEMS, NAV_GROUPS, NAV_LINK_GROUPS, STAFF_SECTION_IDS, COMING_SOON, type SectionId } from '@/components/dashboard/nav';

// Whether the desktop sidebar is shrunk to its icons, remembered on this browser. Kept in memory
// as well, so the button still works where storage is blocked.
const COLLAPSED_KEY = 'ff-dashboard-sidebar';
let collapsedInMemory = false;
const collapseListeners = new Set<() => void>();
function readCollapsed() {
  try { return localStorage.getItem(COLLAPSED_KEY) === 'collapsed'; } catch { return collapsedInMemory; }
}
function writeCollapsed(value: boolean) {
  collapsedInMemory = value;
  try { localStorage.setItem(COLLAPSED_KEY, value ? 'collapsed' : 'open'); } catch { /* storage blocked */ }
  collapseListeners.forEach((listener) => listener());
}
function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { collapseListeners.delete(listener); window.removeEventListener('storage', listener); };
}

export function Sidebar({ sidebarOpen, setSidebarOpen, C, profile, isStaff, activeSection, goSection, theme }: {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  C: typeof LIGHT_C;
  profile: any;
  isStaff: boolean;
  activeSection: SectionId;
  goSection: (id: SectionId) => void;
  theme: string;
}) {
  // On a desktop the sidebar can shrink to its icons. Remembered on this browser; phones keep the
  // full slide-in menu, so every collapsed style below applies from md up only.
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const toggleCollapsed = () => writeCollapsed(!collapsed);
  // Hidden only while collapsed on a desktop.
  const label = collapsed ? 'md:hidden' : '';
  // The student menu's look: plain duotone icons on 40px rows, the open page a grey row with dark
  // text (and its icon solid), a lighter grey on hover.
  const selected = theme === 'dark' ? 'rgba(255,255,255,0.08)' : '#E8EBF0';
  const hover    = theme === 'dark' ? 'rgba(255,255,255,0.04)' : '#F1F3F6';
  const row = `flex h-10 w-full items-center gap-3.5 rounded-xl px-3 text-left text-[15px] transition-colors ${collapsed ? 'md:mx-auto md:w-10 md:justify-center md:px-0' : ''}`;
  const onEnter = (active: boolean) => (e: React.MouseEvent) => { if (!active) { const el = e.currentTarget as HTMLElement; el.style.color = C.text; el.style.background = hover; } };
  const onLeave = (active: boolean) => (e: React.MouseEvent) => { if (!active) { const el = e.currentTarget as HTMLElement; el.style.color = C.muted; el.style.background = 'transparent'; } };
  const groupHead = (text: string, first: boolean) => (
    <>
      {/* Each group after the first opens with a line, then its heading (hidden when folded). */}
      {!first && <div className={`my-4 h-px ${collapsed ? 'md:mx-auto md:w-8' : ''}`} style={{ background: C.divider }} />}
      <p className={`mb-2 px-3 text-xs font-semibold uppercase tracking-[0.06em] ${label}`} style={{ color: C.faint }}>{text}</p>
    </>
  );
  const groups = NAV_GROUPS.map(group => ({
    label: group.label,
    items: group.items
      .map(id => NAV_ITEMS.find(n => n.id === id)!)
      .filter(item => item && (!item.adminOnly || profile?.role === 'admin') && (!isStaff || STAFF_SECTION_IDS.has(item.id))),
  })).filter(group => group.items.length);

  return (
    <>
        {/* Mobile overlay */}
        <AnimatePresence>
          {sidebarOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-20 md:hidden" style={{ background: 'rgba(0,0,0,0.4)' }}
              onClick={() => setSidebarOpen(false)}/>
          )}
        </AnimatePresence>

        {/* -- Sidebar -- */}
        <aside
          className={`fixed md:sticky top-14 z-20 md:z-10 h-[calc(100vh-56px)] flex-shrink-0 flex flex-col w-[264px] transition-[transform,width] duration-300
            ${collapsed ? 'md:w-[72px]' : ''}
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
          style={{ background: C.nav, borderRight: `1px solid ${C.divider}` }}>

          <nav className="flex-1 overflow-y-auto overflow-x-hidden px-4 pt-4 pb-3" aria-label="Dashboard menu">
            {groups.map((group, groupIdx) => (
              <div key={group.label}>
                {groupHead(group.label, groupIdx === 0)}
                <div className="flex flex-col gap-1">
                  {group.items.map(item => {
                    const isActive = activeSection === item.id;
                    return (
                      <button key={item.id} type="button"
                        onClick={() => { goSection(item.id); setSidebarOpen(false); }}
                        title={collapsed ? item.label : undefined}
                        aria-label={collapsed ? item.label : undefined}
                        aria-current={isActive ? 'page' : undefined}
                        className={`${row} ${isActive ? 'font-semibold' : 'font-medium'}`}
                        style={{ color: isActive ? C.text : C.muted, background: isActive ? selected : 'transparent' }}
                        onMouseEnter={onEnter(isActive)} onMouseLeave={onLeave(isActive)}>
                        <item.Icon size={20} weight={isActive ? 'fill' : 'duotone'} className="flex-shrink-0" />
                        <span className={`flex-1 truncate ${label}`}>{item.label}</span>
                        {COMING_SOON.includes(item.id) && (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${label}`} style={{ background: C.pill, color: C.muted }}>Soon</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* External page links (e.g. Open Certificates) */}
            {!isStaff && NAV_LINK_GROUPS.map(group => (
              <div key={group.label}>
                {groupHead(group.label, false)}
                <div className="flex flex-col gap-1">
                  {group.items.map(item => (
                    <Link key={item.id} href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={`${row} font-medium`}
                      style={{ color: C.muted, textDecoration: 'none' }}
                      onMouseEnter={onEnter(false)} onMouseLeave={onLeave(false)}>
                      <item.Icon size={20} weight="duotone" className="flex-shrink-0" />
                      <span className={`flex-1 truncate ${label}`}>{item.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Settings at the foot of the menu. */}
          {!isStaff && (
            <div className="px-4 py-3" style={{ borderTop: `1px solid ${C.divider}` }}>
              <Link href="/settings"
                title={collapsed ? 'Settings' : undefined}
                aria-label={collapsed ? 'Settings' : undefined}
                className={`${row} font-medium`}
                style={{ color: C.muted }}
                onMouseEnter={onEnter(false)} onMouseLeave={onLeave(false)}>
                <GearSix size={20} weight="duotone" className="flex-shrink-0" />
                <span className={label}>Settings</span>
              </Link>
            </div>
          )}

          {/* The fold control: a square tab straddling the menu's right edge just above Settings, as
              on the student menu (desktop only). */}
          <button type="button" onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'} title={collapsed ? 'Expand menu' : 'Collapse menu'}
            className="absolute bottom-[72px] z-10 hidden h-11 w-9 place-items-center transition-colors md:grid"
            style={{ left: 'calc(100% - 18px)', background: C.nav, color: C.text }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = hover; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.nav; }}>
            {collapsed ? <ArrowRightToLine className="h-5 w-5" /> : <ArrowLeftToLine className="h-5 w-5" />}
          </button>
        </aside>
    </>
  );
}
