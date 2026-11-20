'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { PanelLeftClose, PanelLeftOpen, Settings } from 'lucide-react';
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

export function Sidebar({ sidebarOpen, setSidebarOpen, C, profile, user, isStaff, activeSection, goSection, navAccent, theme }: {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  C: typeof LIGHT_C;
  profile: any;
  user: any;
  isStaff: boolean;
  activeSection: SectionId;
  goSection: (id: SectionId) => void;
  navAccent: string;
  theme: string;
}) {
  // On a desktop the sidebar can shrink to its icons. Remembered on this browser; phones keep the
  // full slide-in menu, so every collapsed style below applies from md up only.
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  const toggleCollapsed = () => writeCollapsed(!collapsed);
  // Hidden only while collapsed on a desktop.
  const label = collapsed ? 'md:hidden' : '';

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
          className={`fixed md:sticky top-14 z-20 md:z-10 h-[calc(100vh-56px)] flex-shrink-0 flex flex-col w-[248px] transition-[transform,width] duration-300
            ${collapsed ? 'md:w-[72px]' : ''}
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
          style={{ background: C.nav }}>

          {/* User info */}
          <div className={`px-5 pt-5 pb-4 border-b ${collapsed ? 'md:px-0' : ''}`} style={{ borderColor: C.divider }}>
            <div className={`flex items-center gap-3 ${collapsed ? 'md:flex-col' : ''}`} title={collapsed ? profile?.full_name || user?.email : undefined}>
              <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: C.lime, color: C.green }}>
                {profile?.avatar_url
                  ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover"/>
                  : (profile?.full_name || profile?.name || user?.email || 'U').slice(0, 2).toUpperCase()}
              </div>
              <div className={`min-w-0 flex-1 ${label}`}>
                <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{profile?.full_name || profile?.name || user?.email?.split('@')[0]}</p>
                <p className="text-[11px] truncate capitalize" style={{ color: C.faint }}>{profile?.role || 'Instructor'}</p>
              </div>
              <button
                type="button"
                onClick={toggleCollapsed}
                aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'}
                title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
                className="hidden md:grid w-8 h-8 rounded-lg place-items-center flex-shrink-0 transition-opacity hover:opacity-70"
                style={{ background: C.pill, color: C.muted }}>
                {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Nav groups */}
          <nav className={`flex-1 overflow-y-auto overflow-x-hidden px-3 py-4 space-y-5 ${collapsed ? 'md:px-0' : ''}`}>
            {NAV_GROUPS.map(group => {
              const visibleItems = group.items
                .map(id => NAV_ITEMS.find(n => n.id === id)!)
                .filter(item => item && (!item.adminOnly || profile?.role === 'admin') && (!isStaff || STAFF_SECTION_IDS.has(item.id)));
              if (!visibleItems.length) return null;
              return (
                <div key={group.label}>
                  <p className={`px-3 mb-2 text-[11px] font-semibold tracking-widest uppercase ${label}`}
                    style={{ color: C.faint }}>{group.label}</p>
                  {collapsed && <div className="hidden md:block mx-auto mb-2 w-6" style={{ borderTop: `1px solid ${C.divider}` }} />}
                  <div className="space-y-0.5">
                    {visibleItems.map(item => {
                      const isActive = activeSection === item.id;
                      const isSoon = COMING_SOON.includes(item.id);
                      return (
                        <button key={item.id}
                          onClick={() => { goSection(item.id); setSidebarOpen(false); }}
                          title={collapsed ? item.label : undefined}
                          aria-label={collapsed ? item.label : undefined}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left ${collapsed ? 'md:justify-center md:px-0' : ''}`}
                          style={{ color: isActive ? navAccent : C.muted }}
                          onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = C.text; }}
                          onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = C.muted; }}
                        >
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors"
                            style={{ background: isActive ? `${navAccent}18` : C.pill }}>
                            <item.Icon className="w-4 h-4"
                              style={{ color: isActive ? navAccent : theme === 'dark' ? 'rgba(255,255,255,0.35)' : '#9ca3af' }}/>
                          </div>
                          <span className={`flex-1 truncate font-normal ${label}`}>{item.label}</span>
                          {isSoon && (
                            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${label}`}
                              style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed' }}>
                              Soon
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* External page links (e.g. Open Certificates) */}
            {!isStaff && NAV_LINK_GROUPS.map(group => (
              <div key={group.label}>
                <p className={`px-3 mb-2 text-[11px] font-semibold tracking-widest uppercase ${label}`}
                  style={{ color: C.faint }}>{group.label}</p>
                {collapsed && <div className="hidden md:block mx-auto mb-2 w-6" style={{ borderTop: `1px solid ${C.divider}` }} />}
                <div className="space-y-0.5">
                  {group.items.map(item => (
                    <Link key={item.id} href={item.href}
                      title={collapsed ? item.label : undefined}
                      aria-label={collapsed ? item.label : undefined}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-left ${collapsed ? 'md:justify-center md:px-0' : ''}`}
                      style={{ color: C.muted, textDecoration: 'none' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.muted; }}
                    >
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: C.pill }}>
                        <item.Icon className="w-4 h-4"
                          style={{ color: theme === 'dark' ? 'rgba(255,255,255,0.35)' : '#9ca3af' }} />
                      </div>
                      <span className={`flex-1 truncate font-normal ${label}`}>{item.label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Sidebar footer */}
          <div className={`px-3 pb-4 pt-2 border-t ${collapsed ? 'md:px-0' : ''}`} style={{ borderColor: C.divider }}>
            {!isStaff && <Link href="/settings"
              title={collapsed ? 'Settings' : undefined}
              aria-label={collapsed ? 'Settings' : undefined}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-normal transition-colors ${collapsed ? 'md:justify-center md:px-0' : ''}`}
              style={{ color: C.muted }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = C.text; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = C.muted; }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: C.pill }}>
                <Settings className="w-4 h-4" style={{ color: theme === 'dark' ? 'rgba(255,255,255,0.35)' : '#9ca3af' }}/>
              </div>
              <span className={label}>Settings</span>
            </Link>}
          </div>
        </aside>
    </>
  );
}
