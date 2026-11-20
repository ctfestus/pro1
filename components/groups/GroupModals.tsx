'use client';

// The Groups page's pop-ups: New group, Auto-generate, Add members and Edit details.

import { useEffect, useState, type ReactNode } from 'react';
import { Wand2 } from 'lucide-react';
import { MenuSelect } from '@/components/MenuSelect';
import type { ThemeColors } from '@/lib/theme';
import { getJson, sendJson } from '@/components/dashboard/subscriptions/api';
import { BUTTON, FIELD, Modal, inputStyle } from '@/components/dashboard/subscriptions/Modal';
import { Switch } from '@/components/dashboard/subscriptions/PlanForm';
import { plural } from '@/components/dashboard/subscriptions/ui';
import { Tick } from '@/components/dashboard/cohorts/CohortModals';
import { SearchBox } from '@/components/dashboard/cohorts/StudentsTab';
import { matches } from '@/components/dashboard/cohorts/shared';

export type Cohort = { id: string; name: string };

function Field({ label, aside, children, C }: { label: string; aside?: ReactNode; children: ReactNode; C: ThemeColors }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <span className="text-xs font-semibold" style={{ color: C.muted }}>{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Footer({ onCancel, children, C }: { onCancel: () => void; children: ReactNode; C: ThemeColors }) {
  return (
    <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-6">
      <button type="button" onClick={onCancel} className={BUTTON} style={{ background: C.pill, color: C.text }}>Cancel</button>
      {children}
    </div>
  );
}

const primary = (C: ThemeColors) => ({ background: C.cta, color: C.ctaText });

function CohortSelect({ cohorts, value, onChange, C }: { cohorts: Cohort[]; value: string; onChange: (id: string) => void; C: ThemeColors }) {
  return (
    <Field label="Cohort" C={C}>
      <MenuSelect field searchable label="Cohort" placeholder="Select cohort" value={value} options={cohorts.map((c) => ({ value: c.id, label: c.name }))} onChange={onChange} C={C} />
    </Field>
  );
}

/** Learners in a cohort who are not in any group, read from the server for that cohort. */
function useUngrouped(cohortId: string) {
  const [state, setState] = useState<{ cohortId: string; students: any[] | null; error: string }>({ cohortId: '', students: null, error: '' });
  useEffect(() => {
    if (!cohortId) return;
    let live = true;
    getJson(`/api/groups/available-students?cohortId=${cohortId}`, 'Could not load the learners.')
      .then((data) => { if (live) setState({ cohortId, students: data.students ?? [], error: '' }); })
      .catch((err) => { if (live) setState({ cohortId, students: [], error: err.message }); });
    return () => { live = false; };
  }, [cohortId]);
  // An answer for a cohort no longer chosen is not shown.
  return state.cohortId === cohortId ? state : { cohortId, students: null, error: '' };
}

/** A searchable list of learners with tick boxes. */
function LearnerPicker({ students, picked, onChange, empty, C }: { students: any[] | null; picked: string[]; onChange: (ids: string[]) => void; empty: string; C: ThemeColors }) {
  const [search, setSearch] = useState('');
  if (students === null) return <p className="text-sm py-4" style={{ color: C.muted }}>Loading learners...</p>;
  if (!students.length) return <p className="text-sm py-4" style={{ color: C.muted }}>{empty}</p>;
  const shown = students.filter((s) => matches(s, search.trim().toLowerCase()));
  const toggle = (id: string) => onChange(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="grid gap-1">
      <div className="flex mb-1"><SearchBox value={search} onChange={setSearch} placeholder="Search by name or email" C={C} inModal /></div>
      {shown.length === 0 && <p className="text-sm py-4 text-center" style={{ color: C.muted }}>No learners match.</p>}
      <div className="max-h-64 overflow-y-auto">
        {shown.map((s, i) => (
          <button key={s.id} type="button" role="checkbox" aria-checked={picked.includes(s.id)} onClick={() => toggle(s.id)} className="w-full flex items-center gap-3 py-3 text-left" style={i ? { borderTop: `1px solid ${C.divider}` } : undefined}>
            <Tick on={picked.includes(s.id)} C={C} />
            <span className="min-w-0">
              <span className="block text-sm font-semibold truncate" style={{ color: C.text }}>{s.full_name || 'No name'}</span>
              <span className="block text-xs truncate" style={{ color: C.muted }}>{s.email}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function NewGroupModal({ cohorts, initialCohort, onCreated, onClose, C }: {
  cohorts: Cohort[]; initialCohort: string; onCreated: (groupId: string, text: string, ok: boolean) => void; onClose: () => void; C: ThemeColors;
}) {
  const [cohortId, setCohortId] = useState(initialCohort);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ungrouped = useUngrouped(cohortId);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const { group } = await sendJson('/api/groups', 'POST', { name: name.trim(), cohort_id: cohortId, description: description.trim() || null }, 'Failed to create the group.');
      if (picked.length) {
        try {
          await sendJson(`/api/groups/${group.id}/members`, 'POST', { student_ids: picked }, 'Failed to add the members.');
        } catch (err: any) {
          onCreated(group.id, `${group.name} was created, but its members were not added: ${err.message}`, false);
          return;
        }
      }
      onCreated(group.id, picked.length ? `${group.name} created with ${plural(picked.length, 'member')}` : `${group.name} created`, true);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="New group" eyebrow="A team inside one cohort" onClose={onClose} C={C} error={error || ungrouped.error}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (cohortId && name.trim() && !busy) create(); }}>
        <CohortSelect cohorts={cohorts} value={cohortId} onChange={(id) => { setCohortId(id); setPicked([]); }} C={C} />
        <Field label="Name" C={C}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="For example, Team Baobab" className={FIELD} style={inputStyle(C)} /></Field>
        <Field label="Description (optional)" C={C}><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the group is for" className={FIELD} style={inputStyle(C)} /></Field>
        {cohortId && (
          <Field label="Members (optional)" aside={picked.length > 0 && <span className="text-xs" style={{ color: C.muted }}>{picked.length} selected</span>} C={C}>
            <LearnerPicker students={ungrouped.students} picked={picked} onChange={setPicked} empty="Every learner in this cohort is already in a group." C={C} />
          </Field>
        )}
        <Footer onCancel={onClose} C={C}>
          <button type="submit" disabled={busy || !cohortId || !name.trim()} className={BUTTON} style={primary(C)}>
            {busy ? 'Creating...' : picked.length ? `Create group with ${plural(picked.length, 'member')}` : 'Create group'}
          </button>
        </Footer>
      </form>
    </Modal>
  );
}

export function AutoGenerateModal({ cohorts, initialCohort, onDone, onClose, C }: {
  cohorts: Cohort[]; initialCohort: string; onDone: (text: string) => void; onClose: () => void; C: ThemeColors;
}) {
  const [cohortId, setCohortId] = useState(initialCohort);
  const [size, setSize] = useState('4');
  const [prefix, setPrefix] = useState('Group');
  const [shuffle, setShuffle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ungrouped = useUngrouped(cohortId);
  const n = ungrouped.students?.length ?? 0;
  const per = Number(size);
  const validSize = Number.isInteger(per) && per >= 2 && per <= 50;
  const full = validSize ? Math.floor(n / per) : 0;
  const rest = validSize ? n % per : 0;
  // "2 groups of 4 and 1 of 1": the server fills groups in order, so the last one takes the rest.
  const plan = [full ? `${plural(full, 'group')} of ${per}` : '', rest ? `${full ? '1' : '1 group'} of ${rest}` : ''].filter(Boolean).join(' and ');

  async function generate() {
    setBusy(true);
    setError('');
    try {
      const data = await sendJson('/api/groups/auto-generate', 'POST', { cohort_id: cohortId, group_size: per, name_prefix: prefix.trim() || 'Group', shuffle }, 'Auto-generate failed.');
      onDone(`Created ${plural(data.groups_created ?? 0, 'group')} and placed ${data.students_assigned ?? 0} of ${plural(data.students_total ?? 0, 'learner')}`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Auto-generate groups" eyebrow="Splits learners without a group into equal teams" onClose={onClose} C={C} error={error || ungrouped.error}>
      <div className="grid gap-4">
        <CohortSelect cohorts={cohorts} value={cohortId} onChange={setCohortId} C={C} />
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Learners per group" C={C}><input inputMode="numeric" value={size} onChange={(e) => setSize(e.target.value)} className={FIELD} style={inputStyle(C)} /></Field>
          <Field label="Name prefix" C={C}>
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Group" className={FIELD} style={inputStyle(C)} />
            <p className="text-xs mt-2" style={{ color: C.muted }}>{prefix.trim() || 'Group'} 1, {prefix.trim() || 'Group'} 2 and so on</p>
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold" style={{ color: C.text }}>Shuffle learners first</p>
            <p className="text-xs" style={{ color: C.muted }}>Mixes them up before splitting them into groups</p>
          </div>
          <Switch on={shuffle} onChange={setShuffle} label="Shuffle learners first" C={C} />
        </div>
        {cohortId && (
          <div className="rounded-xl px-4 py-3" style={{ background: C.page }}>
            {ungrouped.students === null ? (
              <p className="text-sm" style={{ color: C.muted }}>Counting learners...</p>
            ) : (
              <>
                <p className="text-sm font-semibold" style={{ color: C.text }}>{plural(n, 'learner')} without a group</p>
                <p className="text-xs mt-1" style={{ color: C.muted }}>
                  {!n ? 'Nothing to generate.' : !validSize ? 'Choose a group size from 2 to 50.' : `Makes ${plan}. The first learner in each group becomes its leader.`}
                </p>
              </>
            )}
          </div>
        )}
      </div>
      <Footer onCancel={onClose} C={C}>
        <button type="button" disabled={busy || !cohortId || !n || !validSize} onClick={generate} className={BUTTON} style={primary(C)}>
          <Wand2 className="w-4 h-4" />
          {busy ? 'Generating...' : 'Generate groups'}
        </button>
      </Footer>
    </Modal>
  );
}

export function AddMembersModal({ group, onAdded, onClose, C }: { group: any; onAdded: (text: string) => Promise<void>; onClose: () => void; C: ThemeColors }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ungrouped = useUngrouped(group.cohort_id);

  async function add() {
    setBusy(true);
    setError('');
    try {
      await sendJson(`/api/groups/${group.id}/members`, 'POST', { student_ids: picked }, 'Failed to add the members.');
      await onAdded(`${plural(picked.length, 'member')} added to ${group.name}`);
      onClose();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Add members" eyebrow={`${group.name}, from learners in this cohort without a group`} onClose={onClose} C={C} error={error || ungrouped.error}>
      <LearnerPicker students={ungrouped.students} picked={picked} onChange={setPicked} empty="Every learner in this cohort is already in a group." C={C} />
      <Footer onCancel={onClose} C={C}>
        <button type="button" disabled={busy || !picked.length} onClick={add} className={BUTTON} style={primary(C)}>
          {busy ? 'Adding...' : picked.length ? `Add ${plural(picked.length, 'member')}` : 'Add members'}
        </button>
      </Footer>
    </Modal>
  );
}

export function EditGroupModal({ group, onSaved, onClose, C }: { group: any; onSaved: () => Promise<void>; onClose: () => void; C: ThemeColors }) {
  const [name, setName] = useState(group.name ?? '');
  const [description, setDescription] = useState(group.description ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      await sendJson(`/api/groups/${group.id}`, 'PUT', { name: name.trim(), description: description.trim() || null }, 'Failed to save the group.');
      await onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit details" eyebrow={group.name} onClose={onClose} C={C} error={error}>
      <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !busy) save(); }}>
        <Field label="Name" C={C}><input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={FIELD} style={inputStyle(C)} /></Field>
        <Field label="Description (optional)" C={C}><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What the group is for" className={FIELD} style={inputStyle(C)} /></Field>
        <Footer onCancel={onClose} C={C}>
          <button type="submit" disabled={busy || !name.trim()} className={BUTTON} style={primary(C)}>{busy ? 'Saving...' : 'Save changes'}</button>
        </Footer>
      </form>
    </Modal>
  );
}
