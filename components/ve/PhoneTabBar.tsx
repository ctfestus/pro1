'use client';

import { Briefcase, FolderOpen, ListChecks, MessageSquare } from 'lucide-react';

export type PhoneTab = 'work' | 'missions' | 'files' | 'ask';

/** Phone only: the player's sections at the bottom of the screen, like a work phone. Sits above the
 * Files drawer and the mission list so the learner can switch straight between them. */
export function PhoneTabBar({ active, onSelect, askLabel, canAsk, filesNew, isDark, accentColor, muted }: {
  active: PhoneTab;
  onSelect: (tab: PhoneTab) => void;
  /** "Ask Kofi" */
  askLabel: string;
  /** The ask chat needs a brief that has arrived; until then the tab is shown but disabled. */
  canAsk: boolean;
  /** New files since Files was last opened: a pulsing dot on the tab. */
  filesNew: boolean;
  isDark: boolean;
  accentColor: string;
  muted: string;
}) {
  const tabs: { id: PhoneTab; label: string; Icon: typeof Briefcase; disabled?: boolean }[] = [
    { id: 'work', label: 'Work', Icon: Briefcase },
    { id: 'missions', label: 'Missions', Icon: ListChecks },
    { id: 'files', label: 'Files', Icon: FolderOpen },
    { id: 'ask', label: askLabel, Icon: MessageSquare, disabled: !canAsk },
  ];
  return (
    <nav aria-label="Sections" className="sm:hidden relative z-[75] flex-shrink-0 grid grid-cols-4"
      style={{
        background: isDark ? '#1a1a1a' : '#ffffff',
        borderTop: `1px solid ${isDark ? 'rgba(255,255,255,0.07)' : 'rgba(15,23,42,0.07)'}`,
        paddingBottom: 'max(6px, env(safe-area-inset-bottom, 0px))',
      }}>
      {tabs.map(({ id, label, Icon, disabled }) => {
        const on = active === id;
        return (
          <button key={id} onClick={() => onSelect(id)} disabled={disabled} aria-current={on ? 'page' : undefined}
            className="flex flex-col items-center gap-0.5 pt-2 pb-1 text-[11px] font-semibold disabled:opacity-40 truncate"
            style={{ color: on ? accentColor : muted }}>
            <span className="relative">
              <Icon className="w-5 h-5" />
              {id === 'files' && filesNew && (
                <span className="absolute -top-0.5 -right-1 flex h-2.5 w-2.5" aria-label="New files">
                  <span className="absolute inline-flex h-full w-full rounded-full animate-ping motion-reduce:animate-none" style={{ background: '#D93025', opacity: 0.6 }} />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: '#D93025' }} />
                </span>
              )}
            </span>
            <span className="truncate max-w-full px-1">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
