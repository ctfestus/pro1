'use client';

// The Students section of a cohort: its learners, with Move, Remove and Delete account in a menu,
// and the Add learners and Move pop-ups.

import { useState } from 'react';
import { ArrowRight, MoreHorizontal, Plus, Search, Trash2, UserMinus } from 'lucide-react';
import type { ThemeColors } from '@/lib/theme';
import { FloatingMenu, menuPosition, type MenuPosition } from '../subscriptions/Menus';
import { BUTTON, Modal } from '../subscriptions/Modal';
import { Card, Pill, btnClass, btnStyle, learnerName, palette, plural, shortDate } from '../subscriptions/ui';
import { accountStatus } from '../students/shared';
import { ConfirmModal, Tick } from './CohortModals';
import { cohortStatus, dateRange, matches } from './shared';

type Actions = {
  /** Puts a learner in a cohort, or in none. Returns false when it failed (the page says why). */
  assign: (student: any, cohortId: string | null) => Promise<boolean>;
  deleteAccount: (student: any) => Promise<boolean>;
  notify: (ok: boolean, text: string) => void;
};

export function SearchBox({ value, onChange, placeholder, C, inModal }: { value: string; onChange: (v: string) => void; placeholder: string; C: ThemeColors; inModal?: boolean }) {
  return (
    <label className="field-shell flex items-center gap-2 h-10 px-3 rounded-xl flex-1 min-w-[220px]" style={{ background: inModal ? C.input : C.card, boxShadow: `inset 0 0 0 1px ${C.divider}`, color: C.faint }}>
      <Search className="w-4 h-4 flex-shrink-0" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="bg-transparent outline-none text-sm w-full" style={{ color: C.text }} />
    </label>
  );
}

function DeleteAccountConfirm({ student, onDone, onClose, deleteAccount, C }: { student: any; onDone: () => void; onClose: () => void; deleteAccount: Actions['deleteAccount']; C: ThemeColors }) {
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmModal
      title="Delete account?"
      eyebrow={learnerName(student)}
      body="This permanently deletes their account and sign-in. It cannot be undone."
      action="Delete account"
      danger
      busy={busy}
      onClose={onClose}
      onConfirm={async () => { setBusy(true); if (await deleteAccount(student)) onDone(); else setBusy(false); }}
      C={C}
    />
  );
}

function AddLearnersModal({ cohort, students, assign, deleteAccount, notify, onClose, C }: { cohort: any; students: any[]; onClose: () => void; C: ThemeColors } & Actions) {
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<any>(null);
  const unassigned = students.filter((s) => !s.cohort_id);
  const shown = unassigned.filter((s) => matches(s, search.trim().toLowerCase()));
  const allPicked = shown.length > 0 && shown.every((s) => picked.has(s.id));
  const toggle = (id: string) => setPicked((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function add() {
    setBusy(true);
    const chosen = unassigned.filter((s) => picked.has(s.id));
    const results = await Promise.all(chosen.map((s) => assign(s, cohort.id)));
    const added = results.filter(Boolean).length;
    if (added) notify(results.every(Boolean), `${plural(added, 'learner')} added to ${cohort.name}`);
    if (results.every(Boolean)) onClose();
    else { setPicked(new Set(chosen.filter((_, i) => !results[i]).map((s) => s.id))); setBusy(false); }
  }

  return (
    <Modal title="Add learners" eyebrow="Learners who are not in any cohort yet" onClose={onClose} C={C}>
      <div className="grid gap-3">
        <div className="flex"><SearchBox value={search} onChange={setSearch} placeholder="Search by name or email" C={C} inModal /></div>
        {shown.length === 0 ? (
          <p className="text-sm py-6 text-center" style={{ color: C.muted }}>{search ? 'No learners match.' : 'Every learner is in a cohort.'}</p>
        ) : (
          <div>
            <button type="button" onClick={() => setPicked(allPicked ? new Set() : new Set(shown.map((s) => s.id)))} className="flex items-center gap-3 py-2 text-xs font-semibold" style={{ color: C.muted }}>
              <Tick on={allPicked} C={C} />
              {picked.size ? `${picked.size} selected` : 'Select all'}
            </button>
            {shown.map((s) => (
              <div key={s.id} className="flex items-center gap-3 py-3" style={{ borderTop: `1px solid ${C.divider}` }}>
                <button type="button" role="checkbox" aria-checked={picked.has(s.id)} onClick={() => toggle(s.id)} className="flex items-center gap-3 min-w-0 flex-1 text-left">
                  <Tick on={picked.has(s.id)} C={C} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold truncate" style={{ color: C.text }}>{s.full_name || 'No name'}</span>
                    <span className="block text-xs truncate" style={{ color: C.muted }}>{s.email}</span>
                  </span>
                </button>
                <button type="button" onClick={() => setDeleting(s)} aria-label={`Delete ${learnerName(s)}'s account`} className="w-8 h-8 rounded-[10px] grid place-items-center flex-shrink-0" style={{ background: palette(C).badSoft, color: palette(C).bad }}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs" style={{ color: C.muted }}>New to the platform? Use Admit student in Admissions instead.</p>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
        <button type="button" disabled={busy || !picked.size} onClick={add} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
          {busy ? 'Adding...' : picked.size ? `Add ${plural(picked.size, 'learner')}` : 'Add learners'}
        </button>
      </div>
      {deleting && (
        <DeleteAccountConfirm student={deleting} deleteAccount={deleteAccount} C={C} onClose={() => setDeleting(null)}
          onDone={() => { setPicked((prev) => { const next = new Set(prev); next.delete(deleting.id); return next; }); setDeleting(null); }} />
      )}
    </Modal>
  );
}

function MoveModal({ student, cohort, cohorts, assign, notify, onClose, C }: { student: any; cohort: any; cohorts: any[]; assign: Actions['assign']; notify: Actions['notify']; onClose: () => void; C: ThemeColors }) {
  const P = palette(C);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const others = cohorts.filter((c) => c.id !== cohort.id && c.name.toLowerCase().includes(search.trim().toLowerCase()));
  const statusLine = (c: any) => {
    const status = cohortStatus(c);
    return `${status.label}, ${dateRange(c)}`;
  };
  return (
    <Modal title={`Move ${learnerName(student)}`} eyebrow={`From ${cohort.name}`} onClose={onClose} C={C}>
      <div className="grid gap-3">
        <div className="flex"><SearchBox value={search} onChange={setSearch} placeholder="Search cohorts by name" C={C} inModal /></div>
        <div role="radiogroup" aria-label="Cohort to move to">
          {others.length === 0 && <p className="text-sm py-6 text-center" style={{ color: C.muted }}>{search ? 'No cohorts match.' : 'There are no other cohorts.'}</p>}
          {others.map((c, i) => (
            <button key={c.id} type="button" role="radio" aria-checked={target === c.id} onClick={() => setTarget(c.id)} className="w-full flex items-center gap-3 py-3 text-left" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
              <span className="w-[18px] h-[18px] rounded-full grid place-items-center flex-shrink-0" style={target === c.id ? { background: P.sel } : { boxShadow: `inset 0 0 0 2px ${C.faint}` }}>
                {target === c.id && <span className="w-1.5 h-1.5 rounded-full" style={{ background: P.onSel }} />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold truncate" style={{ color: C.text }}>{c.name}</span>
                <span className="block text-xs" style={{ color: C.muted }}>{statusLine(c)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
        <button type="button" onClick={onClose} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
        <button type="button" disabled={busy || !target} onClick={async () => { setBusy(true); if (await assign(student, target)) { notify(true, `${learnerName(student)} moved to ${cohorts.find((c) => c.id === target)?.name}`); onClose(); } else setBusy(false); }} className={BUTTON} style={{ background: C.cta, color: C.ctaText }}>
          {busy ? 'Moving...' : 'Move learner'}
        </button>
      </div>
    </Modal>
  );
}

export function StudentsTab({ cohort, cohorts, students, isStaff, assign, deleteAccount, notify, C }: { cohort: any; cohorts: any[]; students: any[]; isStaff: boolean; C: ThemeColors } & Actions) {
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState<{ student: any; position: MenuPosition } | null>(null);
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<any>(null);
  const [removing, setRemoving] = useState<any>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [deleting, setDeleting] = useState<any>(null);
  const members = students.filter((s) => s.cohort_id === cohort.id);
  const shown = members.filter((s) => matches(s, search.trim().toLowerCase()));

  const kebab = (s: any) => isStaff ? null : (
    <button type="button" aria-label={`Actions for ${learnerName(s)}`} onClick={(e) => setMenu(menu?.student.id === s.id ? null : { student: s, position: menuPosition(e.currentTarget, 210) })}
      className="w-8 h-8 rounded-[10px] inline-grid place-items-center flex-shrink-0"
      style={menu?.student.id === s.id ? { background: C.text, color: C.card } : { background: C.pill, color: C.muted }}>
      <MoreHorizontal className="w-4 h-4" />
    </button>
  );
  const lastSignIn = (s: any) => s.last_login_at ? shortDate(s.last_login_at) : 'Never';

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={search} onChange={setSearch} placeholder="Search by name or email" C={C} />
        {!isStaff && (
          <button type="button" onClick={() => setAdding(true)} className={btnClass} style={btnStyle('sec', C)}>
            <Plus className="w-4 h-4" />
            Add learners
          </button>
        )}
      </div>
      <Card C={C} className="overflow-hidden">
        {shown.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm" style={{ color: C.muted }}>
            {members.length ? 'No learners match.' : isStaff ? 'No learners in this cohort yet.' : 'No learners in this cohort yet. Add learners, or admit new ones in Admissions.'}
          </p>
        ) : (
          <>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full min-w-[600px] text-sm table-fixed">
                <colgroup><col style={{ width: '46%' }} /><col style={{ width: '24%' }} /><col style={{ width: '20%' }} />{!isStaff && <col style={{ width: 72 }} />}</colgroup>
                <thead><tr>{['Learner', 'Account', 'Last sign-in', ...(isStaff ? [] : [''])].map((h, i) => <th key={i} className="text-left px-4 py-3 text-xs font-semibold whitespace-nowrap" style={{ color: C.faint }}>{h}</th>)}</tr></thead>
                <tbody>
                  {shown.map((s) => {
                    const status = accountStatus(s);
                    return (
                      <tr key={s.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                        <td className="px-4 py-3">
                          <p className="font-semibold truncate" style={{ color: C.text }}>{s.full_name || 'No name'}</p>
                          <p className="text-xs truncate" style={{ color: C.muted }}>{s.email}</p>
                        </td>
                        <td className="px-4 py-3"><Pill tone={status.tone} dot C={C}>{status.label}</Pill></td>
                        <td className="px-4 py-3 text-xs" style={{ color: s.last_login_at ? C.text : C.muted }}>{lastSignIn(s)}</td>
                        {!isStaff && <td className="pl-2 pr-5 py-3 text-right">{kebab(s)}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="md:hidden">
              {shown.map((s, i) => {
                const status = accountStatus(s);
                return (
                  <div key={s.id} className="grid gap-3 px-4 py-4" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{s.full_name || 'No name'}</p>
                        <p className="text-xs truncate" style={{ color: C.muted }}>{s.email}</p>
                      </div>
                      {kebab(s)}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <Pill tone={status.tone} dot C={C}>{status.label}</Pill>
                      <span className="text-xs" style={{ color: C.muted }}>{s.last_login_at ? `Signed in ${lastSignIn(s)}` : 'Never signed in'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {menu && (
        <FloatingMenu
          position={menu.position}
          label="learner actions"
          onClose={() => setMenu(null)}
          C={C}
          items={[
            { label: 'Move to another cohort', sub: 'Pick the cohort in a pop-up', icon: ArrowRight, onClick: () => { setMoving(menu.student); setMenu(null); } },
            { label: 'Remove from cohort', sub: 'They keep their account', icon: UserMinus, onClick: () => { setRemoving(menu.student); setMenu(null); } },
            null,
            { label: 'Delete account', sub: 'Permanent, asks you to confirm', icon: Trash2, danger: true, onClick: () => { setDeleting(menu.student); setMenu(null); } },
          ]}
        />
      )}
      {adding && <AddLearnersModal cohort={cohort} students={students} assign={assign} deleteAccount={deleteAccount} notify={notify} onClose={() => setAdding(false)} C={C} />}
      {moving && <MoveModal student={moving} cohort={cohort} cohorts={cohorts} assign={assign} notify={notify} onClose={() => setMoving(null)} C={C} />}
      {removing && (
        <ConfirmModal
          title="Remove from cohort?"
          eyebrow={learnerName(removing)}
          body="Their bootcamp payment history is kept, and they can then be given an individual subscription."
          action="Remove from cohort"
          busy={removeBusy}
          onClose={() => setRemoving(null)}
          onConfirm={async () => { setRemoveBusy(true); if (await assign(removing, null)) notify(true, `${learnerName(removing)} removed from ${cohort.name}. They can now get an individual subscription.`); setRemoveBusy(false); setRemoving(null); }}
          C={C}
        />
      )}
      {deleting && <DeleteAccountConfirm student={deleting} deleteAccount={deleteAccount} onClose={() => setDeleting(null)} onDone={() => setDeleting(null)} C={C} />}
    </div>
  );
}
