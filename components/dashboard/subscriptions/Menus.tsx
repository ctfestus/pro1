'use client';

// The two floating menus on the Subscriptions page: Assign subscription, and a subscriber's actions.

import type { ElementType } from 'react';
import { ArrowLeftRight, CalendarClock, History, Send, Trash2, Upload, UserPlus, XCircle } from 'lucide-react';
import { modalStyle, type ThemeColors } from '@/lib/theme';
import type { SubscriberAction } from './ManageSubscriberModal';
import { IconChip, palette } from './ui';

type Position = { top: number; right: number };
type Item = { label: string; sub: string; icon: ElementType; onClick: () => void; disabled?: boolean; danger?: boolean };

/** Where a menu opens: under its button, or above it when there is no room below. */
export function menuPosition(button: HTMLElement, height: number): Position {
  const rect = button.getBoundingClientRect();
  return {
    top: rect.bottom + height + 10 > window.innerHeight ? Math.max(12, rect.top - height) : rect.bottom + 8,
    right: Math.max(12, window.innerWidth - rect.right),
  };
}

function FloatingMenu({ position, label, items, onClose, C }: { position: Position; label: string; items: (Item | null)[]; onClose: () => void; C: ThemeColors }) {
  const P = palette(C);
  return (
    <>
      <button aria-label={`Close ${label}`} className="fixed inset-0 z-[70] cursor-default" onClick={onClose} />
      <div role="menu" aria-label={label} className="fixed z-[75] w-72 max-w-[calc(100vw-24px)] rounded-2xl p-2 grid" style={{ ...modalStyle(C), ...position }}>
        {items.map((item, index) => item === null ? (
          <div key={index} className="my-1 mx-2" style={{ borderTop: `1px solid ${C.divider}` }} />
        ) : (
          <button
            key={item.label}
            role="menuitem"
            onClick={item.onClick}
            disabled={item.disabled}
            className="w-full flex items-center gap-3 rounded-xl p-2 text-left disabled:opacity-50"
            style={{ color: item.danger ? P.bad : C.text }}
          >
            <IconChip color={item.danger ? P.bad : C.text} background={item.danger ? P.badSoft : C.pill}><item.icon className="w-4 h-4" /></IconChip>
            <span>
              <span className="block text-sm font-semibold">{item.label}</span>
              <span className="block text-xs" style={{ color: C.muted }}>{item.sub}</span>
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function AssignMenu({ position, onClose, onOne, onMany, manyDisabled, C }: {
  position: Position; onClose: () => void; onOne: () => void; onMany: () => void; manyDisabled: boolean; C: ThemeColors;
}) {
  return (
    <FloatingMenu
      position={position}
      label="subscription assignment menu"
      onClose={onClose}
      C={C}
      items={[
        { label: 'One learner', sub: 'Give access now or send a payment request', icon: UserPlus, onClick: onOne },
        { label: 'Many learners', sub: 'Paste emails or a CSV for one plan', icon: Upload, onClick: onMany, disabled: manyDisabled },
      ]}
    />
  );
}

export function SubscriberMenu({ sub, position, onClose, onAction, onHistory, onRevoke, onDelete, C }: {
  sub: any;
  position: Position;
  onClose: () => void;
  onAction: (action: SubscriberAction) => void;
  onHistory: () => void;
  onRevoke: () => void;
  onDelete: () => void;
  C: ThemeColors;
}) {
  const items: (Item | null)[] = [
    { label: 'Change plan', sub: 'Keeps the dates and price', icon: ArrowLeftRight, onClick: () => onAction('change-plan') },
    { label: 'Request payment', sub: 'Send a renewal request', icon: Send, onClick: () => onAction('request-payment') },
    { label: 'Extend access', sub: 'Add time, paid or free', icon: CalendarClock, onClick: () => onAction('extend-access') },
    { label: 'Payment history', sub: 'Every payment and request', icon: History, onClick: onHistory },
    null,
  ];
  if (sub.status === 'active') items.push({ label: 'Revoke access', sub: 'Ends access today', icon: XCircle, onClick: onRevoke, danger: true });
  items.push({ label: 'Delete account', sub: 'Removes the learner for good', icon: Trash2, onClick: onDelete, danger: true });
  return <FloatingMenu position={position} label="subscriber actions" items={items} onClose={onClose} C={C} />;
}
