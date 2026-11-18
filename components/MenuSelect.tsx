'use client';

// A select drawn as a field and a floating menu, for filter bars (Explore). Same keyboard
// behaviour as a native select: arrows move, Enter or Space picks, Escape closes, and focus
// leaving the control closes it. Application forms have their own (ApplicationQuestionFields).

import { useId, useRef, useState, type ElementType, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ChevronDown } from 'lucide-react';
import { LIGHT_C } from '@/lib/theme';

// The selected option's tick and icon: the ocean blue the student menu uses.
const PICKED = '#3E93FF';

export type MenuOption<V extends string> = { value: V; label: string; icon?: ElementType };

export function MenuSelect<V extends string>({ label, value, options, onChange, C }: {
  /** What the control chooses, for screen readers ("Content type"). */
  label: string;
  value: V;
  options: readonly MenuOption<V>[];
  onChange: (value: V) => void;
  C: typeof LIGHT_C;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = options.find(o => o.value === value) ?? options[0];
  const CurrentIcon = current?.icon;
  const isLight = C.page === LIGHT_C.page;

  const show = () => {
    setActive(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
    // Safari does not focus a clicked button, and closing on outside click relies on blur.
    buttonRef.current?.focus();
  };
  const choose = (v: V) => {
    onChange(v);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { show(); return; }
      setActive(i => (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      setOpen(false);
    } else if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault();
      choose(options[active].value);
    }
  };

  return (
    <div className="relative" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className="flex items-center gap-2.5 rounded-xl py-2 pl-3 pr-4 text-sm font-medium outline-none transition-colors focus-visible:!outline-none"
        style={{ background: C.card, color: C.text, border: `1px solid ${open ? (isLight ? '#b6bcc6' : 'rgba(255,255,255,0.28)') : C.cardBorder}` }}
      >
        {CurrentIcon && <CurrentIcon className="h-4 w-4 flex-shrink-0" style={{ color: C.muted }} />}
        <span className="whitespace-nowrap">{current?.label}</span>
        <ChevronDown className={`ml-3 h-4 w-4 flex-shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} style={{ color: C.faint }} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={listId}
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 top-[calc(100%+8px)] z-40 min-w-[230px] origin-top-left rounded-2xl p-1.5"
            style={{
              background: C.card,
              border: `1px solid ${C.cardBorder}`,
              boxShadow: isLight ? '0 16px 40px rgba(15,23,42,0.14), 0 2px 6px rgba(15,23,42,0.06)' : '0 16px 40px rgba(0,0,0,0.5)',
            }}
          >
            {options.map((o, i) => {
              const selected = o.value === value;
              const Icon = o.icon;
              return (
                <button
                  key={o.value}
                  id={`${listId}-${i}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  // Keep focus on the trigger while an option is pressed.
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => choose(o.value)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors"
                  style={{ background: i === active ? C.pill : 'transparent', color: C.text, fontWeight: selected ? 600 : 400 }}
                >
                  {Icon && (
                    <span className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg"
                      style={{ background: selected ? `${PICKED}1a` : C.pill, color: selected ? PICKED : C.muted }}>
                      <Icon className="h-4 w-4" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {selected && <Check className="h-4 w-4 flex-shrink-0" strokeWidth={2.5} style={{ color: PICKED }} />}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
