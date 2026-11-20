'use client';

// One group, sliding in from the right: its members and leader, with Add members, Email members,
// Edit details and Delete.

import { useEffect, useState, type ReactNode } from 'react';
import { Mail, MoreHorizontal, Pencil, Plus, Star, Trash2, UserMinus, X } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { getJson, sendJson } from '@/components/dashboard/subscriptions/api';
import { FloatingMenu, menuPosition, type MenuPosition } from '@/components/dashboard/subscriptions/Menus';
import { DISPLAY_FONT, Pill, btnClass, btnStyle, learnerName } from '@/components/dashboard/subscriptions/ui';
import { AddMembersModal, EditGroupModal } from './GroupModals';

export function GroupDrawer({ groupId, banner, onClose, onChanged, onEmail, onDelete, notify, C }: {
  groupId: string;
  /** The page's latest message, shown here too since the panel covers the page. */
  banner: ReactNode;
  onClose: () => void;
  /** Reads the group list again after a change made here. */
  onChanged: () => Promise<void>;
  onEmail: (group: any) => void;
  onDelete: (group: any) => void;
  notify: (ok: boolean, text: string) => void;
  C: ThemeColors;
}) {
  const [group, setGroup] = useState<any>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [menu, setMenu] = useState<{ member: any; position: MenuPosition } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);

  // Mounted with key={groupId}, so an answer for a group no longer open is dropped.
  useEffect(() => {
    let live = true;
    getJson(`/api/groups/${groupId}`, 'Could not load this group.')
      .then((data) => { if (live) { setGroup(data.group); setError(''); } })
      .catch((err) => { if (live) setError(err.message); });
    return () => { live = false; };
  }, [groupId, version]);

  const refresh = async () => { setVersion((v) => v + 1); await onChanged(); };
  const members: any[] = group?.group_members ?? [];

  async function act(member: any, run: () => Promise<unknown>, done: string) {
    setMenu(null);
    try {
      await run();
      notify(true, done);
      await refresh();
    } catch (err: any) {
      notify(false, `${learnerName(member.students)}: ${err.message}`);
    }
  }
  const makeLeader = (m: any) => act(m, () => sendJson(`/api/groups/${groupId}`, 'PUT', { leader_student_id: m.student_id }, 'Failed to change the leader.'), `${learnerName(m.students)} now leads ${group.name}`);
  const remove = (m: any) => act(m, () => sendJson(`/api/groups/${groupId}/members`, 'DELETE', { student_id: m.student_id }, 'Failed to remove the member.'), `${learnerName(m.students)} removed from ${group.name}`);

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" style={{ background: 'rgba(4,8,20,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={group?.name ?? 'Group'} className="w-full max-w-lg h-full overflow-y-auto flex flex-col" style={{ background: C.card }}>
        <div className="flex items-start gap-3 px-6 py-5" style={{ borderBottom: `1px solid ${C.divider}` }}>
          <div className="min-w-0 flex-1">
            <h3 className="text-[22px] leading-7 font-semibold truncate" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>{group?.name ?? 'Loading...'}</h3>
            {group?.description && <p className="text-sm" style={{ color: C.muted }}>{group.description}</p>}
            {group?.cohorts?.name && <div className="mt-2"><Pill tone="mute" C={C}>{group.cohorts.name}</Pill></div>}
          </div>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-full grid place-items-center flex-shrink-0" style={{ background: C.pill, color: C.muted }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {error ? (
          <div className="m-6 rounded-xl p-4 text-center" style={{ background: C.errorBg }}>
            <p className="text-sm" style={{ color: C.errorText }}>{error}</p>
            <button onClick={() => setVersion((v) => v + 1)} className="mt-2 text-xs font-semibold underline underline-offset-2" style={{ color: C.text }}>Try again</button>
          </div>
        ) : group && (
          <div className="px-6 py-5 grid gap-6">
            {banner}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAdding(true)} className={btnClass} style={btnStyle('pri', C)}><Plus className="w-4 h-4" />Add members</button>
              <button type="button" onClick={() => onEmail(group)} disabled={!members.length} className={btnClass} style={btnStyle('sec', C)}><Mail className="w-4 h-4" />Email members</button>
              <button type="button" onClick={() => setEditing(true)} className={btnClass} style={btnStyle('sec', C)}><Pencil className="w-4 h-4" />Edit details</button>
            </div>
            <section>
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <h4 className="text-base font-semibold" style={{ color: C.text, fontFamily: DISPLAY_FONT }}>Members</h4>
                <span className="text-xs" style={{ color: C.muted }}>{members.length}</span>
              </div>
              {!members.length ? (
                <p className="text-sm" style={{ color: C.muted }}>No members yet. Add some from the learners in this cohort.</p>
              ) : members.map((m, i) => (
                <div key={m.id ?? m.student_id} className="flex items-center gap-3 py-3" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold flex flex-wrap items-center gap-2" style={{ color: C.text }}>
                      {m.students?.full_name || 'No name'}
                      {m.is_leader && <Pill tone="good" dot C={C}>Leader</Pill>}
                    </p>
                    <p className="text-xs truncate" style={{ color: C.muted }}>{m.students?.email}</p>
                  </div>
                  <button type="button" aria-label={`Actions for ${learnerName(m.students)}`} onClick={(e) => setMenu(menu?.member.student_id === m.student_id ? null : { member: m, position: menuPosition(e.currentTarget, 150) })}
                    className="w-8 h-8 rounded-[10px] inline-grid place-items-center flex-shrink-0"
                    style={menu?.member.student_id === m.student_id ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}>
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </section>
            <div style={{ borderTop: `1px solid ${C.divider}` }} />
            <button type="button" onClick={() => onDelete(group)} className={`${btnClass} justify-self-start`} style={btnStyle('danger', C)}><Trash2 className="w-4 h-4" />Delete group</button>
          </div>
        )}
      </div>

      {menu && (
        <FloatingMenu
          position={menu.position}
          label="member actions"
          onClose={() => setMenu(null)}
          C={C}
          items={[
            ...(menu.member.is_leader ? [] : [
              { label: 'Make leader', sub: (() => { const lead = members.find((x) => x.is_leader); return lead ? `Replaces ${learnerName(lead.students)}` : 'Leads the group'; })(), icon: Star, onClick: () => makeLeader(menu.member) },
              null,
            ]),
            { label: 'Remove from group', sub: 'They stay in the cohort', icon: UserMinus, danger: true, onClick: () => remove(menu.member) },
          ]}
        />
      )}
      {adding && group && <AddMembersModal group={group} onClose={() => setAdding(false)} C={C} onAdded={async (text) => { notify(true, text); await refresh(); }} />}
      {editing && group && <EditGroupModal group={group} onClose={() => setEditing(false)} C={C} onSaved={async () => { notify(true, 'Group updated'); await refresh(); }} />}
    </div>
  );
}
