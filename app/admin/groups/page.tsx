'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { LIGHT_C, DARK_C, useC } from '@/lib/theme';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Loader2, X, Search, Star, Mail, Edit2, ChevronLeft, Wand2, UserPlus } from 'lucide-react';


type Cohort = { id: string; name: string };
type Student = { id: string; full_name: string; email: string; avatar_url?: string | null };
type GroupMember = { id: string; student_id: string; is_leader: boolean; students: Student };
type Group = {
  id: string; name: string; description: string | null; cohort_id: string;
  created_at: string; cohorts: { name: string } | null; group_members: GroupMember[];
};

async function authHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

function Avatar({ name, url, size = 30, C }: { name?: string; url?: string | null; size?: number; C: typeof LIGHT_C }) {
  if (url) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: C.pill, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, color: C.muted, flexShrink: 0 }}>
      {(name?.[0] ?? '?').toUpperCase()}
    </div>
  );
}

function StudentPickerRow({ student, selected, onToggle, C }: { student: Student; selected: boolean; onToggle: () => void; C: typeof LIGHT_C }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: '100%', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 10px',
        background: selected ? (C === DARK_C ? 'rgba(62,147,255,0.1)' : 'rgba(0,191,99,0.08)') : 'transparent',
        border: `1px solid ${selected ? C.cta : 'transparent'}`,
        borderRadius: 8, cursor: 'pointer',
      }}>
      <Avatar name={student.full_name} url={student.avatar_url} size={30} C={C} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{student.full_name}</div>
        <div style={{ fontSize: 11, color: C.faint, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{student.email}</div>
      </div>
      <div style={{
        width: 18, height: 18, borderRadius: 4, border: `2px solid ${selected ? C.cta : C.cardBorder}`,
        background: selected ? C.cta : 'transparent', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {selected && (
          <svg viewBox="0 0 10 8" width="10" height="8" fill="none">
            <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </button>
  );
}

export default function AdminGroupsPage() {
  const C = useC();
  const router = useRouter();

  const [groups, setGroups] = useState<Group[]>([]);
  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [cohortFilter, setCohortFilter] = useState(() =>
    typeof window !== 'undefined' ? (new URLSearchParams(window.location.search).get('cohortId') ?? '') : '',
  );
  const [loading, setLoading] = useState(true);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  // Available (ungrouped) students for selected cohort
  const [availableStudents, setAvailableStudents] = useState<Student[]>([]);
  const [loadingStudents, setLoadingStudents] = useState(false);

  // Panel mode: null | 'create' | 'autogen'
  const [panel, setPanel] = useState<null | 'create' | 'autogen'>(null);

  // Create form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newMemberIds, setNewMemberIds] = useState<string[]>([]);
  const [createSearch, setCreateSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  // Auto-generate
  const [autoGenSize, setAutoGenSize] = useState(4);
  const [autoGenPrefix, setAutoGenPrefix] = useState('Group');
  const [autoGenShuffle, setAutoGenShuffle] = useState(true);
  const [autoGenning, setAutoGenning] = useState(false);
  const [autoGenResult, setAutoGenResult] = useState('');
  const [autoGenError, setAutoGenError] = useState('');

  // Group detail
  const [editingName, setEditingName] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addSelectedIds, setAddSelectedIds] = useState<string[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);
  const [removingMember, setRemovingMember] = useState('');
  const [notifying, setNotifying] = useState(false);
  const [notifyMsg, setNotifyMsg] = useState('');

  // Auth check
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/auth'); return; }
      supabase.from('students').select('role').eq('id', session.user.id).single()
        .then(({ data }) => {
          if (!data || !['admin', 'instructor'].includes(data.role)) router.replace('/dashboard');
        });
    });
  }, [router]);

  const fetchAvailableStudents = useCallback(async (cohortId: string) => {
    if (!cohortId) { setAvailableStudents([]); return; }
    setLoadingStudents(true);
    const headers = await authHeaders();
    const res = await fetch(`/api/groups/available-students?cohortId=${cohortId}`, { headers });
    if (res.ok) {
      const { students } = await res.json();
      setAvailableStudents(students ?? []);
    }
    setLoadingStudents(false);
  }, []);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    const headers = await authHeaders();
    const url = cohortFilter ? `/api/groups?cohortId=${cohortFilter}` : '/api/groups';
    const res = await fetch(url, { headers });
    if (res.ok) {
      const { groups: data } = await res.json();
      setGroups(data ?? []);
    }
    setLoading(false);
  }, [cohortFilter]);

  useEffect(() => {
    supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name')
      .then(({ data }) => { if (data) setCohorts(data); });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchGroups();
  }, [fetchGroups]);

  // Reload available students whenever the cohort filter changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAvailableStudents(cohortFilter);
    setNewMemberIds([]);
    setCreateSearch('');
  }, [cohortFilter, fetchAvailableStudents]);

  async function fetchGroupDetail(id: string) {
    const headers = await authHeaders();
    const res = await fetch(`/api/groups/${id}`, { headers });
    if (res.ok) {
      const { group } = await res.json();
      setSelectedGroup(group);
      setEditName(group.name);
      setEditDesc(group.description ?? '');
      setAddSelectedIds([]);
      setAddSearch('');
      setNotifyMsg('');
      // Refresh available students for this group's cohort
      await fetchAvailableStudents(group.cohort_id);
    }
  }

  async function handleCreate() {
    if (!newName.trim() || !cohortFilter) { setCreateError('Select a cohort and enter a group name'); return; }
    setCreating(true); setCreateError('');
    const headers = await authHeaders();
    const res = await fetch('/api/groups', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), cohort_id: cohortFilter, description: newDesc.trim() || null }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      setCreateError(error || 'Failed to create group');
      setCreating(false);
      return;
    }
    const { group } = await res.json();
    if (newMemberIds.length > 0 && group?.id) {
      await fetch(`/api/groups/${group.id}/members`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ student_ids: newMemberIds }),
      });
    }
    setPanel(null); setNewName(''); setNewDesc(''); setNewMemberIds([]); setCreateSearch('');
    await fetchGroups();
    if (group?.id) fetchGroupDetail(group.id);
    setCreating(false);
  }

  async function handleAddSelectedMembers() {
    if (!selectedGroup || addSelectedIds.length === 0) return;
    setAddingMembers(true);
    const headers = await authHeaders();
    await fetch(`/api/groups/${selectedGroup.id}/members`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_ids: addSelectedIds }),
    });
    await fetchGroupDetail(selectedGroup.id);
    setAddingMembers(false);
  }

  async function handleRemoveMember(studentId: string) {
    if (!selectedGroup) return;
    setRemovingMember(studentId);
    const headers = await authHeaders();
    await fetch(`/api/groups/${selectedGroup.id}/members`, {
      method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: studentId }),
    });
    await fetchGroupDetail(selectedGroup.id);
    setRemovingMember('');
  }

  async function handleSetLeader(studentId: string, isCurrentLeader: boolean) {
    if (!selectedGroup) return;
    const headers = await authHeaders();
    await fetch(`/api/groups/${selectedGroup.id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ leader_student_id: isCurrentLeader ? '' : studentId }),
    });
    await fetchGroupDetail(selectedGroup.id);
  }

  async function handleSaveEdit() {
    if (!selectedGroup || !editName.trim()) return;
    setSavingEdit(true);
    const headers = await authHeaders();
    await fetch(`/api/groups/${selectedGroup.id}`, {
      method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim(), description: editDesc.trim() || null }),
    });
    setEditingName(false);
    await fetchGroupDetail(selectedGroup.id);
    fetchGroups();
    setSavingEdit(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this group? All members will be unassigned.')) return;
    const headers = await authHeaders();
    await fetch(`/api/groups/${id}`, { method: 'DELETE', headers });
    if (selectedGroup?.id === id) setSelectedGroup(null);
    await fetchGroups();
    await fetchAvailableStudents(cohortFilter || selectedGroup?.cohort_id || '');
  }

  async function handleNotify() {
    if (!selectedGroup) return;
    setNotifying(true); setNotifyMsg('');
    const headers = await authHeaders();
    const res = await fetch('/api/groups/notify', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ group_id: selectedGroup.id }),
    });
    const { sent, error } = await res.json();
    setNotifyMsg(error ? `Error: ${error}` : `Notified ${sent} member${sent !== 1 ? 's' : ''}`);
    setNotifying(false);
  }

  async function handleAutoGen() {
    if (!cohortFilter) { setAutoGenError('Select a cohort above first'); return; }
    if (autoGenSize < 2) { setAutoGenError('Group size must be at least 2'); return; }
    setAutoGenning(true); setAutoGenResult(''); setAutoGenError('');
    const headers = await authHeaders();
    const res = await fetch('/api/groups/auto-generate', {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cohort_id: cohortFilter, group_size: autoGenSize, name_prefix: autoGenPrefix.trim() || 'Group', shuffle: autoGenShuffle }),
    });
    const data = await res.json();
    if (!res.ok) {
      setAutoGenError(data.error || 'Auto-generate failed');
    } else {
      setAutoGenResult(`Created ${data.groups_created} group${data.groups_created !== 1 ? 's' : ''}, assigned ${data.students_assigned} of ${data.students_total} student${data.students_total !== 1 ? 's' : ''}`);
      await fetchGroups();
      await fetchAvailableStudents(cohortFilter);
    }
    setAutoGenning(false);
  }

  // Filtered lists
  const createList = availableStudents.filter(s =>
    !createSearch ||
    s.full_name?.toLowerCase().includes(createSearch.toLowerCase()) ||
    s.email?.toLowerCase().includes(createSearch.toLowerCase())
  );

  const existingMemberIds = new Set(selectedGroup?.group_members?.map(m => m.student_id) ?? []);
  const addList = availableStudents.filter(s =>
    !existingMemberIds.has(s.id) && (
      !addSearch ||
      s.full_name?.toLowerCase().includes(addSearch.toLowerCase()) ||
      s.email?.toLowerCase().includes(addSearch.toLowerCase())
    )
  );

  const inp = (extra?: React.CSSProperties): React.CSSProperties => ({
    width: '100%', padding: '9px 12px', borderRadius: 8, border: `1px solid ${C.cardBorder}`,
    background: C.input, color: C.text, fontSize: 14, outline: 'none', boxSizing: 'border-box',
    ...extra,
  });

  const sectionLabel: React.CSSProperties = {
    fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
  };

  return (
    <div style={{ minHeight: '100vh', background: C.page, color: C.text, fontFamily: 'inherit' }}>
      {/* Nav */}
      <div style={{ background: C.nav, borderBottom: `1px solid ${C.navBorder}`, padding: '0 24px', display: 'flex', alignItems: 'center', gap: 12, height: 56 }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
          <ChevronLeft size={16} /> Back
        </button>
        <span style={{ color: C.divider }}>|</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>Groups</span>
      </div>

      <div style={{ maxWidth: 1140, margin: '0 auto', padding: '24px 20px' }}>
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Groups</h1>
          <select
            style={{ ...inp({ width: 'auto', flex: 1, maxWidth: 280, margin: 0 }) }}
            value={cohortFilter}
            onChange={e => { setCohortFilter(e.target.value); setSelectedGroup(null); }}>
            <option value="">All cohorts</option>
            {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={() => setPanel(panel === 'autogen' ? null : 'autogen')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: panel === 'autogen' ? C.cta : C.pill, color: panel === 'autogen' ? C.ctaText : C.text, border: `1px solid ${panel === 'autogen' ? C.cta : C.cardBorder}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Wand2 size={14} /> Auto-generate
            </button>
            <button
              onClick={() => setPanel(panel === 'create' ? null : 'create')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: panel === 'create' ? C.cta : C.cta, color: C.ctaText, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              <Plus size={14} /> New Group
            </button>
          </div>
        </div>

        {/* Auto-generate panel */}
        {panel === 'autogen' && (
          <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Auto-generate Groups</div>
                <div style={{ fontSize: 13, color: C.faint, marginTop: 2 }}>
                  Automatically splits all ungrouped students in the cohort into equal-sized groups.
                </div>
              </div>
              <button onClick={() => { setPanel(null); setAutoGenResult(''); setAutoGenError(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint }}><X size={16} /></button>
            </div>
            {!cohortFilter && (
              <div style={{ padding: '10px 14px', background: C.errorBg, border: `1px solid ${C.errorBorder}`, borderRadius: 8, fontSize: 13, color: C.errorText, marginBottom: 14 }}>
                Select a cohort at the top before auto-generating.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <div>
                <label style={{ ...sectionLabel, display: 'block' }}>Students per group</label>
                <input type="number" min={2} max={50} style={inp()} value={autoGenSize}
                  onChange={e => setAutoGenSize(Math.max(2, parseInt(e.target.value) || 2))} disabled={!cohortFilter} />
              </div>
              <div>
                <label style={{ ...sectionLabel, display: 'block' }}>Name prefix</label>
                <input style={inp()} placeholder="Group" value={autoGenPrefix}
                  onChange={e => setAutoGenPrefix(e.target.value)} disabled={!cohortFilter} />
              </div>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 14, userSelect: 'none' as const }}>
              <input type="checkbox" checked={autoGenShuffle} onChange={e => setAutoGenShuffle(e.target.checked)} disabled={!cohortFilter} />
              Shuffle students randomly before grouping
            </label>
            {autoGenError && <p style={{ fontSize: 13, color: C.errorText, margin: '0 0 10px' }}>{autoGenError}</p>}
            {autoGenResult && <p style={{ fontSize: 13, color: C.successText, margin: '0 0 10px' }}>{autoGenResult}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleAutoGen} disabled={autoGenning || !cohortFilter}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: !cohortFilter ? 0.45 : 1 }}>
                {autoGenning ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Wand2 size={14} />}
                {autoGenning ? 'Generating...' : 'Generate Groups'}
              </button>
              <button onClick={() => { setPanel(null); setAutoGenResult(''); setAutoGenError(''); }}
                style={{ padding: '9px 18px', background: C.pill, color: C.text, border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Create group panel */}
        {panel === 'create' && (
          <div style={{ background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  New Group{cohortFilter ? ` - ${cohorts.find(c => c.id === cohortFilter)?.name}` : ''}
                </div>
                <div style={{ fontSize: 13, color: C.faint, marginTop: 2 }}>Name the group and select members to add.</div>
              </div>
              <button onClick={() => { setPanel(null); setNewName(''); setNewDesc(''); setNewMemberIds([]); setCreateSearch(''); setCreateError(''); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint }}><X size={16} /></button>
            </div>
            {!cohortFilter && (
              <div style={{ padding: '10px 14px', background: C.errorBg, border: `1px solid ${C.errorBorder}`, borderRadius: 8, fontSize: 13, color: C.errorText, marginBottom: 14 }}>
                Select a cohort at the top before creating a group.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
              {/* Left: name + description */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ ...sectionLabel, display: 'block' }}>Group name</label>
                  <input style={inp()} placeholder="e.g. Alpha Team" value={newName}
                    onChange={e => setNewName(e.target.value)} disabled={!cohortFilter} />
                </div>
                <div>
                  <label style={{ ...sectionLabel, display: 'block' }}>Description <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
                  <textarea style={{ ...inp(), minHeight: 80, resize: 'vertical' as const }} placeholder="What is this group for?"
                    value={newDesc} onChange={e => setNewDesc(e.target.value)} disabled={!cohortFilter} />
                </div>
              </div>

              {/* Right: member picker */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={sectionLabel}>Members</span>
                  {newMemberIds.length > 0 && (
                    <span style={{ fontSize: 12, color: C.cta, fontWeight: 600 }}>{newMemberIds.length} selected</span>
                  )}
                </div>
                {loadingStudents ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}><Loader2 size={18} style={{ animation: 'spin 1s linear infinite', color: C.faint }} /></div>
                ) : !cohortFilter ? (
                  <div style={{ fontSize: 13, color: C.faint, padding: '12px 0' }}>Select a cohort to see available students.</div>
                ) : availableStudents.length === 0 ? (
                  <div style={{ fontSize: 13, color: C.faint, padding: '12px 0' }}>All students in this cohort are already in groups.</div>
                ) : (
                  <>
                    <div style={{ position: 'relative', marginBottom: 8 }}>
                      <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.faint, pointerEvents: 'none' }} />
                      <input style={{ ...inp({ paddingLeft: 30 }) }} placeholder="Search students..." value={createSearch} onChange={e => setCreateSearch(e.target.value)} />
                    </div>
                    <div style={{ border: `1px solid ${C.cardBorder}`, borderRadius: 10, overflow: 'hidden', maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, padding: 4 }}>
                      {createList.length === 0
                        ? <div style={{ padding: '10px 12px', fontSize: 13, color: C.faint }}>No students match your search.</div>
                        : createList.map(s => (
                          <StudentPickerRow
                            key={s.id}
                            student={s}
                            selected={newMemberIds.includes(s.id)}
                            onToggle={() => setNewMemberIds(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                            C={C}
                          />
                        ))
                      }
                    </div>
                  </>
                )}
              </div>
            </div>

            {createError && <p style={{ fontSize: 13, color: C.errorText, margin: '12px 0 0' }}>{createError}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button onClick={handleCreate} disabled={creating || !cohortFilter || !newName.trim()}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 20px', background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: (!cohortFilter || !newName.trim()) ? 0.45 : 1 }}>
                {creating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
                {creating ? 'Creating...' : `Create Group${newMemberIds.length > 0 ? ` with ${newMemberIds.length} member${newMemberIds.length !== 1 ? 's' : ''}` : ''}`}
              </button>
              <button onClick={() => { setPanel(null); setNewName(''); setNewDesc(''); setNewMemberIds([]); setCreateSearch(''); setCreateError(''); }}
                style={{ padding: '9px 18px', background: C.pill, color: C.text, border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Two-column layout */}
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
          {/* Groups list */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite', color: C.faint }} />
              </div>
            ) : groups.length === 0 ? (
              <div style={{ textAlign: 'center', color: C.faint, padding: '60px 0', fontSize: 14 }}>
                {cohortFilter ? 'No groups for this cohort yet.' : 'No groups yet.'} Use the buttons above to create one.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {groups.map(g => {
                  const memberCount = g.group_members?.length ?? 0;
                  const leader = g.group_members?.find(m => m.is_leader);
                  const isSelected = selectedGroup?.id === g.id;
                  return (
                    <div
                      key={g.id}
                      onClick={() => fetchGroupDetail(g.id)}
                      style={{
                        background: C.card, border: `1px solid ${isSelected ? C.cta : C.cardBorder}`,
                        borderRadius: 10, padding: '14px 16px', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 12,
                        boxShadow: isSelected ? `0 0 0 2px ${C.cta}22` : 'none',
                      }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>{g.name}</div>
                        <div style={{ fontSize: 12, color: C.faint, marginTop: 3, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <span>{(g.cohorts as any)?.name}</span>
                          <span>{memberCount} member{memberCount !== 1 ? 's' : ''}</span>
                          {leader && <span>Leader: {leader.students?.full_name}</span>}
                        </div>
                      </div>
                      {/* Avatars preview */}
                      <div style={{ display: 'flex' }}>
                        {(g.group_members ?? []).slice(0, 4).map((m, i) => (
                          <div key={m.student_id ?? i} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: 4 - i }}>
                            <Avatar name={m.students?.full_name} url={m.students?.avatar_url} size={26} C={C} />
                          </div>
                        ))}
                        {memberCount > 4 && (
                          <div style={{ width: 26, height: 26, borderRadius: '50%', background: C.pill, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: C.muted, marginLeft: -8 }}>
                            +{memberCount - 4}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(g.id); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, padding: 4, flexShrink: 0 }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Group detail panel */}
          {selectedGroup && (
            <div style={{ width: 380, flexShrink: 0, background: C.card, border: `1px solid ${C.cardBorder}`, borderRadius: 12, alignSelf: 'flex-start', position: 'sticky', top: 20, overflow: 'hidden' }}>
              {/* Panel header */}
              <div style={{ padding: '16px 16px 0' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                  {editingName ? (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, paddingRight: 8 }}>
                      <input style={inp()} value={editName} onChange={e => setEditName(e.target.value)} autoFocus />
                      <textarea style={{ ...inp(), minHeight: 60, resize: 'vertical' as const }} value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description (optional)" />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={handleSaveEdit} disabled={savingEdit}
                          style={{ padding: '6px 14px', background: C.cta, color: C.ctaText, border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                          {savingEdit ? '...' : 'Save'}
                        </button>
                        <button onClick={() => setEditingName(false)}
                          style={{ padding: '6px 12px', background: C.pill, color: C.text, border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 16, color: C.text }}>{selectedGroup.name}</div>
                      {selectedGroup.description && <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>{selectedGroup.description}</div>}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0, marginLeft: 8 }}>
                    {!editingName && (
                      <button onClick={() => setEditingName(true)}
                        title="Edit name"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, padding: 4, borderRadius: 6 }}>
                        <Edit2 size={14} />
                      </button>
                    )}
                    <button onClick={() => { setSelectedGroup(null); setEditingName(false); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, padding: 4, borderRadius: 6 }}>
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Cohort tag */}
                <div style={{ display: 'inline-block', background: C.pill, color: C.muted, fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 20, marginBottom: 14 }}>
                  {(selectedGroup.cohorts as any)?.name}
                </div>
              </div>

              <div style={{ borderTop: `1px solid ${C.divider}` }} />

              {/* Members */}
              <div style={{ padding: '14px 16px' }}>
                <div style={sectionLabel}>Members ({selectedGroup.group_members?.length ?? 0})</div>
                {(selectedGroup.group_members?.length ?? 0) === 0 ? (
                  <div style={{ fontSize: 13, color: C.faint, padding: '8px 0' }}>No members yet. Add some below.</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(selectedGroup.group_members ?? []).map(m => (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', background: C.page, borderRadius: 8 }}>
                        <Avatar name={m.students?.full_name} url={m.students?.avatar_url} size={30} C={C} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {m.students?.full_name}
                            {m.is_leader && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', background: 'rgba(245,158,11,0.12)', padding: '1px 6px', borderRadius: 10 }}>Leader</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: C.faint }}>{m.students?.email}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          <button
                            title={m.is_leader ? 'Current leader' : 'Make leader'}
                            onClick={() => { if (!m.is_leader) handleSetLeader(m.student_id, false); }}
                            disabled={m.is_leader}
                            style={{ background: 'none', border: 'none', cursor: m.is_leader ? 'default' : 'pointer', color: m.is_leader ? '#f59e0b' : C.faint, padding: 4, borderRadius: 6 }}>
                            <Star size={13} fill={m.is_leader ? '#f59e0b' : 'none'} />
                          </button>
                          <button
                            onClick={() => handleRemoveMember(m.student_id)}
                            disabled={removingMember === m.student_id}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, padding: 4, borderRadius: 6 }}>
                            {removingMember === m.student_id
                              ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                              : <X size={13} />}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ borderTop: `1px solid ${C.divider}` }} />

              {/* Add members */}
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={sectionLabel}>Add Members</div>
                  {addSelectedIds.length > 0 && (
                    <span style={{ fontSize: 12, color: C.cta, fontWeight: 600 }}>{addSelectedIds.length} selected</span>
                  )}
                </div>
                {loadingStudents ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: C.faint }} /></div>
                ) : addList.length === 0 && !addSearch ? (
                  <div style={{ fontSize: 13, color: C.faint, padding: '6px 0 10px' }}>
                    {availableStudents.length === 0 ? 'All cohort students are already in groups.' : 'All available students are already in this group.'}
                  </div>
                ) : (
                  <>
                    <div style={{ position: 'relative', marginBottom: 8 }}>
                      <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.faint, pointerEvents: 'none' }} />
                      <input style={{ ...inp({ paddingLeft: 30 }) }} placeholder="Search available students..." value={addSearch} onChange={e => setAddSearch(e.target.value)} />
                    </div>
                    <div style={{ border: `1px solid ${C.cardBorder}`, borderRadius: 10, overflow: 'hidden', maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, padding: 4 }}>
                      {addList.length === 0
                        ? <div style={{ padding: '10px 12px', fontSize: 13, color: C.faint }}>No students match your search.</div>
                        : addList.map(s => (
                          <StudentPickerRow
                            key={s.id}
                            student={s}
                            selected={addSelectedIds.includes(s.id)}
                            onToggle={() => setAddSelectedIds(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                            C={C}
                          />
                        ))
                      }
                    </div>
                    {addSelectedIds.length > 0 && (
                      <button onClick={handleAddSelectedMembers} disabled={addingMembers}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, padding: '8px 16px', background: C.cta, color: C.ctaText, border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                        {addingMembers ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <UserPlus size={13} />}
                        {addingMembers ? 'Adding...' : `Add ${addSelectedIds.length} Member${addSelectedIds.length !== 1 ? 's' : ''}`}
                      </button>
                    )}
                  </>
                )}
              </div>

              <div style={{ borderTop: `1px solid ${C.divider}` }} />

              {/* Notify + delete */}
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  onClick={handleNotify}
                  disabled={notifying || (selectedGroup.group_members?.length ?? 0) === 0}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 0', background: C.pill, color: C.text, border: `1px solid ${C.cardBorder}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {notifying ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={13} />}
                  Notify Members by Email
                </button>
                {notifyMsg && (
                  <p style={{ fontSize: 12, color: notifyMsg.startsWith('Error') ? C.errorText : C.successText, margin: 0, textAlign: 'center' }}>
                    {notifyMsg}
                  </p>
                )}
                <button
                  onClick={() => handleDelete(selectedGroup.id)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 0', background: 'transparent', color: C.errorText, border: `1px solid ${C.errorBorder}`, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  <Trash2 size={13} /> Delete Group
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
