'use client';

// Extracted verbatim from app/dashboard/page.tsx -- no behavior or styling changes.

import { useState, useEffect, useContext } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Edit2, GraduationCap, Loader2, Mail, MoreVertical, Plus, Search, Trash2, Upload, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { IsStaffContext } from '@/components/dashboard/context';
import { LIGHT_C, cardStyle, modalStyle } from '@/lib/theme';

function formatAdmissionDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '--';
}

function admissionStatus(row: any) {
  const student = row.student ?? {};
  if (student.last_login_at) return { label: 'Signed in', at: student.last_login_at, color: '#16a34a', bg: 'rgba(34,197,94,0.12)' };
  if (student.onboarding_done) return { label: 'Onboarded', at: student.onboarding_completed_at, color: '#2563eb', bg: 'rgba(37,99,235,0.12)' };
  if (student.password_set_at) return { label: 'Password set', at: student.password_set_at, color: '#7c3aed', bg: 'rgba(124,58,237,0.12)' };
  if (student.password_setup_started_at) return { label: 'Link opened', at: student.password_setup_started_at, color: '#d97706', bg: 'rgba(245,158,11,0.16)' };
  if (student.setup_email_sent_at) return { label: 'Email sent', at: student.setup_email_sent_at, color: '#0284c7', bg: 'rgba(14,165,233,0.14)' };
  if (student.account_provisioned_at) return { label: 'Created', at: student.account_provisioned_at, color: '#64748b', bg: 'rgba(100,116,139,0.14)' };
  return { label: row.student_id ? 'Account linked' : 'Admission only', at: row.created_at, color: '#64748b', bg: 'rgba(100,116,139,0.14)' };
}

export function CohortsSection({ C }: { C: typeof LIGHT_C }) {
  const isStaff = useContext(IsStaffContext);
  const isLight = C.text === '#111';
  const [cohorts, setCohorts]           = useState<any[]>([]);
  const [students, setStudents]         = useState<any[]>([]);
  const [courses, setCourses]           = useState<any[]>([]);
  const [ves, setVes]                   = useState<any[]>([]);
  const [learningPaths, setLearningPaths] = useState<any[]>([]);
  const [assignmentsList, setAssignmentsList] = useState<any[]>([]);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [selectedCohort, setSelectedCohort] = useState<any | null>(null);
  const [search, setSearch]             = useState('');
  const [selected, setSelected]         = useState<Set<string>>(new Set());
  const [assigning, setAssigning]       = useState(false);
  const [showCreate, setShowCreate]     = useState(false);
  const [newName, setNewName]           = useState('');
  const [newDesc, setNewDesc]           = useState('');
  const [newStartDate, setNewStartDate] = useState('');
  const [newEndDate, setNewEndDate]     = useState('');
  const [toast, setToast]               = useState<{ ok: boolean; text: string } | null>(null);
  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [viewMode, setViewMode]         = useState<'list' | 'detail'>('list');
  const [activeTab, setActiveTab]       = useState<'students' | 'manage' | 'courses' | 'payment' | 'admissions'>('students');
  const [reassignId, setReassignId]     = useState<string | null>(null);
  const [admissionsList, setAdmissionsList] = useState<any[]>([]);
  const [admissionsLoading, setAdmissionsLoading] = useState(false);
  const [menuOpenId, setMenuOpenId]     = useState<string | null>(null);
  const [editOpen, setEditOpen]         = useState(false);
  const [editForm, setEditForm]         = useState({ name: '', description: '', start_date: '', end_date: '' });
  const [editSaving, setEditSaving]     = useState(false);
  const [courseSearch, setCourseSearch] = useState('');
  const [togglingCourse, setTogglingCourse] = useState<string | null>(null);

  // Admissions import
  const [admissionsOpen,   setAdmissionsOpen]   = useState(false);
  const [admissionsCsv,    setAdmissionsCsv]    = useState('');
  const [admissionsRows,   setAdmissionsRows]   = useState<any[]>([]);
  const [admissionsSaving, setAdmissionsSaving] = useState(false);
  const [admissionsResult, setAdmissionsResult] = useState<{ inserted: number; updated: number; provisioned: number; setupEmailsSent: number; errors: any[] } | null>(null);
  const [admissionsError,  setAdmissionsError]  = useState('');

  const blankAdmissionForm = { email: '', full_name: '', total_fee: '', payment_plan: 'flexible', amount_paid: '', paid_at: '', payment_method: '', payment_reference: '', notes: '' };
  const [addAdmissionOpen,   setAddAdmissionOpen]   = useState(false);
  const [addAdmissionForm,   setAddAdmissionForm]   = useState(blankAdmissionForm);
  const [addAdmissionSaving, setAddAdmissionSaving] = useState(false);
  const [addAdmissionError,  setAddAdmissionError]  = useState('');
  const [addAdmissionLog,    setAddAdmissionLog]    = useState<{ email: string; name: string; status: string }[]>([]);
  const [paymentSettings, setPaymentSettings] = useState({
    total_fee: '',
    currency: 'GHS',
    deposit_percent: '50',
    payment_plan: 'flexible',
    installment_count: '3',
    post_bootcamp_access_months: '3',
    grace_period_days: '',
    start_date: '',
    end_date: '',
  });
  const [paymentSettingsSaving, setPaymentSettingsSaving] = useState(false);
  const [paymentSettingsError, setPaymentSettingsError] = useState('');
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text });
    setTimeout(() => setToast(null), 3000);
  };

  const parseAdmissionsCsv = (text: string) => {
    setAdmissionsError('');
    if (!text.trim()) { setAdmissionsRows([]); return; }
    const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
    // Detect CSV: first line contains an 'email' column header
    const firstLineLower = lines[0].toLowerCase();
    if (firstLineLower.includes('email') && lines.length >= 2) {
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
      const rows = lines.slice(1).map(line => {
        const vals = line.split(',');
        const obj: any = {};
        headers.forEach((h, i) => { obj[h] = (vals[i] ?? '').trim(); });
        return obj;
      }).filter(r => r.email);
      setAdmissionsRows(rows);
    } else {
      // Plain email list: each line is an email address
      const rows = lines
        .map(l => l.trim().toLowerCase())
        .filter(l => l.includes('@'))
        .map(email => ({ email }));
      setAdmissionsRows(rows);
    }
  };

  const handleAdmissionsImport = async () => {
    if (!selectedCohort || admissionsRows.length === 0) return;
    setAdmissionsSaving(true); setAdmissionsError(''); setAdmissionsResult(null);
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const res = await fetch('/api/admissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ cohortId: selectedCohort.id, rows: admissionsRows }),
      }).then(r => r.json());
      if (res.error) { setAdmissionsError(res.error); }
      else {
        setAdmissionsResult({
          inserted: res.inserted ?? 0,
          updated: res.updated ?? 0,
          provisioned: res.provisioned ?? 0,
          setupEmailsSent: res.setupEmailsSent ?? 0,
          errors: res.errors ?? [],
        });
        setAdmissionsCsv(''); setAdmissionsRows([]);
        await Promise.all([loadAdmissions(selectedCohort.id), refreshStudents()]);
      }
    } catch { setAdmissionsError('Import failed. Please try again.'); }
    setAdmissionsSaving(false);
  };

  const handleAddAdmission = async (closeAfter: boolean) => {
    if (!selectedCohort || !addAdmissionForm.email.trim()) return;
    setAddAdmissionSaving(true); setAddAdmissionError('');
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const row: any = { email: addAdmissionForm.email.trim().toLowerCase() };
      if (addAdmissionForm.full_name.trim())         row.full_name          = addAdmissionForm.full_name.trim();
      if (addAdmissionForm.total_fee.trim())         row.total_fee          = addAdmissionForm.total_fee.trim();
      if (addAdmissionForm.payment_plan)             row.payment_plan       = addAdmissionForm.payment_plan;
      if (addAdmissionForm.amount_paid.trim())       row.amount_paid        = addAdmissionForm.amount_paid.trim();
      if (addAdmissionForm.paid_at.trim())           row.paid_at            = addAdmissionForm.paid_at.trim();
      if (addAdmissionForm.payment_method.trim())    row.payment_method     = addAdmissionForm.payment_method.trim();
      if (addAdmissionForm.payment_reference.trim()) row.payment_reference  = addAdmissionForm.payment_reference.trim();
      if (addAdmissionForm.notes.trim())             row.notes              = addAdmissionForm.notes.trim();
      const res = await fetch('/api/admissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ cohortId: selectedCohort.id, rows: [row] }),
      }).then(r => r.json());
      if (res.error) { setAddAdmissionError(res.error); }
      else if (res.errors?.length > 0) { setAddAdmissionError(res.errors[0].error); }
      else {
        const status = res.inserted > 0 ? 'added' : 'updated';
        setAddAdmissionLog(prev => [{ email: row.email, name: row.full_name ?? '', status }, ...prev]);
        setAddAdmissionForm(blankAdmissionForm);
        await Promise.all([loadAdmissions(selectedCohort.id), refreshStudents()]);
        if (closeAfter) { setAddAdmissionOpen(false); setAddAdmissionLog([]); }
      }
    } catch { setAddAdmissionError('Failed to save. Please try again.'); }
    setAddAdmissionSaving(false);
  };

  const refreshStudents = async () => {
    const { data } = await supabase
      .from('students')
      .select('id, full_name, email, cohort_id, role')
      .eq('role', 'student')
      .order('full_name');
    setStudents(data ?? []);
  };

  const load = async () => {
    const [{ data: c }, { data: s }, { data: cr }, { data: veData }, { data: lpData }, { data: asgnData }] = await Promise.all([
      supabase.from('cohorts').select('*').eq('cohort_kind', 'bootcamp').order('created_at', { ascending: false }),
      supabase.from('students').select('id, full_name, email, cohort_id, role').eq('role', 'student').order('full_name'),
      supabase.from('courses').select('id, title, status, cohort_ids, available_to_everyone').order('created_at', { ascending: false }),
      supabase.from('virtual_experiences').select('id, title, status, cohort_ids').order('created_at', { ascending: false }),
      supabase.from('learning_paths').select('id, title, status, cohort_ids').order('created_at', { ascending: false }),
      supabase.from('assignments').select('id, title, status, cohort_ids').order('created_at', { ascending: false }),
    ]);
    if (asgnData === null) console.error('[assignments list fetch] returned null - check error in Promise.all');
    setCohorts(c ?? []);
    setStudents(s ?? []);
    setCourses(cr ?? []);
    setVes(veData ?? []);
    setLearningPaths(lpData ?? []);
    setAssignmentsList(asgnData ?? []);
    if (c?.length && !selectedCohort) setSelectedCohort(c[0]);
    setLoading(false);
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (isStaff) {
      setAdmissionsList([]);
      return;
    }
    if (selectedCohort?.id) loadAdmissions(selectedCohort.id);
    else setAdmissionsList([]);
  }, [isStaff, selectedCohort?.id]);

  useEffect(() => {
    if (isStaff) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && selectedCohort?.id) loadAdmissions(selectedCohort.id);
    });
    return () => subscription.unsubscribe();
  }, [isStaff, selectedCohort?.id]);

  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element).closest?.('.cohort-menu-btn')) setMenuOpenId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  const loadAdmissions = async (cohortId: string) => {
    setAdmissionsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setAdmissionsLoading(false); return; }
      const [admissionsRes, cohortRes] = await Promise.all([
        fetch(`/api/admissions?cohortId=${cohortId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }),
        supabase.from('cohorts').select('start_date, end_date').eq('id', cohortId).single(),
      ]);
      const admissionsJson = await admissionsRes.json();
      setAdmissionsList(admissionsJson.admissions ?? admissionsJson.intakes ?? []);
      const settings = admissionsJson.settings;
      const cohortDates = cohortRes.data;
      setPaymentSettings({
        total_fee:                   settings?.total_fee != null ? String(settings.total_fee) : '',
        currency:                    settings?.currency ?? 'GHS',
        deposit_percent:             settings?.deposit_percent != null ? String(settings.deposit_percent) : '50',
        payment_plan:                settings?.payment_plan ?? 'flexible',
        installment_count:           settings?.installment_count != null ? String(settings.installment_count) : '3',
        post_bootcamp_access_months: settings?.post_bootcamp_access_months != null ? String(settings.post_bootcamp_access_months) : '3',
        grace_period_days:           settings?.grace_period_days != null ? String(settings.grace_period_days) : '',
        start_date:                  cohortDates?.start_date ?? '',
        end_date:                    cohortDates?.end_date ?? '',
      });
    } catch {
      // network error -- leave existing state, will retry on next cohort select
    } finally {
      setAdmissionsLoading(false);
    }
  };

  const savePaymentSettings = async () => {
    if (!selectedCohort) return;
    if (!Number(paymentSettings.total_fee)) {
      setPaymentSettingsError('Total fee is required before importing or assigning students.');
      return;
    }
    if (!paymentSettings.start_date) {
      setPaymentSettingsError('Cohort start date is required so installment due dates are calculated correctly.');
      return;
    }
    setPaymentSettingsSaving(true);
    setPaymentSettingsError('');
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const [settingsRes] = await Promise.all([
        fetch('/api/admissions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            action:   'save-settings',
            cohortId: selectedCohort.id,
            settings: paymentSettings,
          }),
        }).then(r => r.json()),
        supabase.from('cohorts').update({
          start_date: paymentSettings.start_date,
          end_date:   paymentSettings.end_date || null,
          updated_at: new Date().toISOString(),
        }).eq('id', selectedCohort.id),
      ]);
      if (settingsRes.error) setPaymentSettingsError(settingsRes.error);
      else {
        setCohorts(prev => prev.map(c => c.id === selectedCohort.id
          ? { ...c, start_date: paymentSettings.start_date, end_date: paymentSettings.end_date || null }
          : c
        ));
        showToast(true, 'Payment settings saved');
      }
    } catch {
      setPaymentSettingsError('Failed to save payment settings.');
    }
    setPaymentSettingsSaving(false);
  };

  const openEdit = (c: any) => {
    setSelectedCohort(c);
    setViewMode('detail');
    setActiveTab('students');
    setSearch('');
    setSelected(new Set());
    setReassignId(null);
    setCourseSearch('');
    setMenuOpenId(null);
  };

  const openEditMeta = (c: any) => {
    setEditForm({ name: c.name, description: c.description ?? '', start_date: c.start_date ?? '', end_date: c.end_date ?? '' });
    setEditOpen(true);
    setMenuOpenId(null);
  };

  const saveEdit = async () => {
    if (!selectedCohort || !editForm.name.trim()) return;
    setEditSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/cohorts/${selectedCohort.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({
        name:        editForm.name.trim(),
        description: editForm.description.trim() || null,
        start_date:  editForm.start_date || null,
        end_date:    editForm.end_date || null,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) showToast(false, json.error || 'Failed to update cohort.');
    else {
      const data = json.cohort;
      setCohorts(prev => prev.map(c => c.id === selectedCohort.id ? data : c));
      setSelectedCohort(data);
      setEditOpen(false);
      showToast(true, 'Cohort updated');
    }
    setEditSaving(false);
  };

  const toggleContentAssignment = async (
    contentTable: string,
    itemId: string,
    currentIds: string[],
    setter: React.Dispatch<React.SetStateAction<any[]>>,
  ) => {
    if (!selectedCohort) return;
    setTogglingCourse(itemId);
    const already = currentIds.includes(selectedCohort.id);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      showToast(false, 'Session expired. Please refresh.');
      setTogglingCourse(null);
      return;
    }

    try {
      const sendAssignment = (confirmRestriction = false) => fetch('/api/cohort-content-assignment', {
        method: already ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ contentId: itemId, contentTable, cohortId: selectedCohort.id, confirmRestriction }),
      });
      let res = await sendAssignment();
      let json = await res.json().catch(() => ({}));

      if (res.status === 409 && json.requiresConfirmation) {
        if (!window.confirm(json.error)) {
          setTogglingCourse(null);
          return;
        }
        // The confirmed retry is a new request, so the server re-reads the
        // course and applies the change against its current access state.
        res = await sendAssignment(true);
        json = await res.json().catch(() => ({}));
      }

      if (!res.ok) {
        showToast(false, json.error || (already ? 'Failed to remove from cohort.' : 'Failed to assign to cohort.'));
        setTogglingCourse(null);
        return;
      }

      const newIds = already
        ? currentIds.filter(id => id !== selectedCohort.id)
        : (Array.isArray(json.cohortIds) ? json.cohortIds : [...currentIds, selectedCohort.id]);
      setter(prev => prev.map(item => item.id === itemId
        ? { ...item, cohort_ids: newIds, ...(contentTable === 'courses' && !already ? { available_to_everyone: false } : {}) }
        : item));

      if (already) {
        showToast(true, 'Removed from cohort');
      } else if (json.notifyError) {
        showToast(false, json.notifyError);
      } else {
        showToast(true, 'Assigned to cohort');
      }
    } catch (err) {
      console.error('[toggleContentAssignment] network error:', err);
      showToast(false, 'Network error. Please try again.');
    }

    setTogglingCourse(null);
  };

  const createCohort = async () => {
    if (!newName.trim()) return;
    if (!newStartDate) { showToast(false, 'Start date is required.'); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from('cohorts')
      .insert({
        name:        newName.trim(),
        description: newDesc.trim() || null,
        start_date:  newStartDate,
        end_date:    newEndDate || null,
        created_by:  user!.id,
      })
      .select().single();
    if (error) { showToast(false, error.message); }
    else {
      setNewName(''); setNewDesc(''); setNewStartDate(''); setNewEndDate(''); setShowCreate(false);
      setCohorts(prev => [data, ...prev]);
      setSelectedCohort(data);
      showToast(true, `"${data.name}" created`);
    }
    setSaving(false);
  };

  const deleteCohort = async (id: string) => {
    setDeletingId(id);
    await supabase.from('cohorts').delete().eq('id', id);
    setCohorts(prev => prev.filter(c => c.id !== id));
    setStudents(prev => prev.map(s => s.cohort_id === id ? { ...s, cohort_id: null } : s));
    if (selectedCohort?.id === id) setSelectedCohort(cohorts.find(c => c.id !== id) ?? null);
    setDeletingId(null);
  };

  const assignStudent = async (studentId: string, cohortId: string | null) => {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ action: 'assign-student', studentId, cohortId }),
    }).then(r => r.json());
    if (res.error) {
      showToast(false, res.error);
      return false;
    }
    setStudents(prev => prev.map(s => s.id === studentId ? { ...s, cohort_id: cohortId } : s));
    return true;
  };

  const assignSelected = async () => {
    if (!selectedCohort || !selected.size) return;
    setAssigning(true);
    const results = await Promise.all([...selected].map(id => assignStudent(id, selectedCohort.id)));
    const added = results.filter(Boolean).length;
    if (added > 0) showToast(true, `${added} student${added > 1 ? 's' : ''} added to "${selectedCohort.name}"`);
    setSelected(new Set());
    setAssigning(false);
  };

  const handleDeleteUser = async (studentId: string, label: string) => {
    if (!window.confirm(`Permanently delete "${label}"? This removes them from Supabase Auth and cannot be undone.`)) return;
    setDeletingUserId(studentId);
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/admin/delete-user', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
      body: JSON.stringify({ userId: studentId }),
    }).then(r => r.json());
    if (res.error) {
      showToast(false, res.error);
    } else {
      setStudents(prev => prev.filter(s => s.id !== studentId));
      showToast(true, `${label} deleted`);
    }
    setDeletingUserId(null);
  };

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const cohortStudents  = students.filter(s => s.cohort_id === selectedCohort?.id);
  const q = search.trim().toLowerCase();
  const unassigned = students.filter(s => !s.cohort_id && (
    !q || (s.full_name ?? '').toLowerCase().includes(q) || s.email.toLowerCase().includes(q)
  ));
  const allUnassigned = students.filter(s => !s.cohort_id);
  const cohortCourseCount = (cohortId: string) =>
    [...courses, ...ves, ...learningPaths, ...assignmentsList]
      .filter(c => Array.isArray(c.cohort_ids) && c.cohort_ids.includes(cohortId)).length;

  const TYPE_META: Record<string, { label: string; color: string; bg: string; setter: React.Dispatch<React.SetStateAction<any[]>>; table: string }> = {
    course:             { label: 'Course',            color: '#2563eb', bg: 'rgba(37,99,235,0.1)',  setter: setCourses,         table: 'courses' },
    virtual_experience: { label: 'Virtual Experience', color: '#7c3aed', bg: 'rgba(124,58,237,0.1)', setter: setVes,              table: 'virtual_experiences' },
    learning_path:      { label: 'Learning Path',      color: '#0891b2', bg: 'rgba(8,145,178,0.1)',  setter: setLearningPaths,   table: 'learning_paths' },
    assignment:         { label: 'Assignment',          color: '#d97706', bg: 'rgba(217,119,6,0.1)',  setter: setAssignmentsList, table: 'assignments' },
  };

  const allContent = [
    ...courses.map(c => ({ ...c, _type: 'course' })),
    ...ves.map(v => ({ ...v, _type: 'virtual_experience' })),
    ...learningPaths.map(l => ({ ...l, _type: 'learning_path' })),
    ...assignmentsList.map(a => ({ ...a, _type: 'assignment' })),
  ].filter(c => !isStaff || c.status === 'published');
  const cq = courseSearch.trim().toLowerCase();
  const filteredContent = allContent.filter(c =>
    !cq || (c.title ?? '').toLowerCase().includes(cq)
  );

  const card  = cardStyle(C);
  const input = { background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text };

  const TABS = [
    { id: 'students',   label: `Students (${cohortStudents.length})` },
    { id: 'manage',     label: `Manage (${allUnassigned.length} unassigned)` },
    { id: 'courses',    label: `Assign Courses` },
    { id: 'payment',    label: 'Payment' },
    { id: 'admissions', label: `Admissions (${admissionsList.length})` },
  ] as const;
  const visibleTabs = isStaff ? TABS.filter(t => t.id === 'students' || t.id === 'courses') : TABS;

  useEffect(() => {
    if (isStaff && activeTab !== 'students' && activeTab !== 'courses') setActiveTab('students');
  }, [activeTab, isStaff]);

  function Avatar({ name, email, size = 8 }: { name?: string; email: string; size?: number }) {
    const label = (name ?? email)[0].toUpperCase();
    const colors = ['#3b82f6','#8b5cf6','#ec4899','#f59e0b','#10b981','#06b6d4'];
    const bg = colors[(label.charCodeAt(0)) % colors.length];
    return (
      <div className="rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 text-white"
        style={{ background: bg, width: size * 4, height: size * 4, fontSize: size < 8 ? 10 : 12 }}>
        {label}
      </div>
    );
  }

  if (loading) return (
    <div className="flex justify-center py-24">
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }}/>
    </div>
  );

  return (
    <div className="space-y-5">

      {/* Toast */}
      {toast && createPortal(
        <div className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg"
          style={{ background: toast.ok ? '#16a34a' : '#dc2626', color: '#fff', minWidth: 220, maxWidth: 360 }}>
          {toast.ok ? <Check className="w-4 h-4 flex-shrink-0"/> : <X className="w-4 h-4 flex-shrink-0"/>}
          {toast.text}
        </div>,
        document.body
      )}

      {/* ===================== LIST VIEW ===================== */}
      {viewMode === 'list' && (
        <div className="rounded-2xl" style={{ ...cardStyle(C) }}>
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: `1px solid ${C.divider}` }}>
            <div>
              <h2 className="text-lg font-bold leading-none" style={{ color: C.text }}>Cohorts</h2>
            </div>
            {!isStaff && <div className="flex items-center gap-2 flex-shrink-0">
              <Link href="/admin/groups"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold no-underline transition-opacity hover:opacity-80"
                style={{ background: C.pill, color: C.muted }}>
                <Users className="w-4 h-4"/> Groups
              </Link>
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
                style={{ background: C.cta, color: C.ctaText }}>
                <Plus className="w-4 h-4"/> New Cohort
              </button>
            </div>}
          </div>

          {/* Table header */}
          <div className="grid grid-cols-[1fr_48px] sm:grid-cols-[1fr_100px_100px_48px] px-5 py-3.5" style={{ borderBottom: `1px solid ${C.divider}` }}>
            <span className="text-[10px] font-semibold uppercase tracking-[0.07em]" style={{ color: C.faint }}>Cohort</span>
            <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-[0.07em] text-center" style={{ color: C.faint }}>Students</span>
            <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-[0.07em] text-center" style={{ color: C.faint }}>Courses</span>
            <div/>
          </div>

          {cohorts.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-2">
              <GraduationCap className="w-8 h-8 opacity-20" style={{ color: C.faint }}/>
              <p className="text-sm" style={{ color: C.faint }}>No cohorts yet</p>
              {!isStaff && <button onClick={() => setShowCreate(true)} className="text-xs font-semibold mt-1 underline underline-offset-2" style={{ color: C.green }}>Create your first cohort</button>}
            </div>
          ) : cohorts.map((c, i) => {
            const studentCount = students.filter(s => s.cohort_id === c.id).length;
            const cCount = cohortCourseCount(c.id);
            return (
              <div key={c.id}
                className="grid grid-cols-[1fr_48px] sm:grid-cols-[1fr_100px_100px_48px] items-center px-5 py-3.5"
                style={{ borderBottom: i < cohorts.length - 1 ? `1px solid ${C.divider}` : 'none' }}>
                {/* Name + description */}
                <div className="min-w-0 pr-4">
                  <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{c.name}</p>
                  {c.description && <p className="text-xs truncate mt-0.5" style={{ color: C.faint }}>{c.description}</p>}
                </div>
                {/* Students */}
                <p className="hidden sm:block text-sm font-semibold text-center" style={{ color: C.text }}>{studentCount}</p>
                {/* Courses */}
                <p className="hidden sm:block text-sm font-semibold text-center" style={{ color: C.text }}>{cCount}</p>
                {/* 3-dots menu */}
                <div className="relative cohort-menu-btn flex-shrink-0 flex justify-end">
                  <button
                    onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}
                    className="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70"
                    style={{ color: C.muted, background: menuOpenId === c.id ? C.pill : 'transparent' }}>
                    <MoreVertical className="w-4 h-4"/>
                  </button>
                  {menuOpenId === c.id && (
                    <div className="absolute right-0 top-9 z-50 rounded-xl overflow-hidden w-40"
                      style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: isLight ? '0 12px 32px rgba(0,0,0,0.16)' : '0 4px 16px rgba(0,0,0,0.35)' }}>
                      <button onClick={e => { e.stopPropagation(); openEdit(c); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70"
                        style={{ color: C.text }}>
                        <ChevronRight className="w-3.5 h-3.5 flex-shrink-0"/> Open
                      </button>
                      {!isStaff && (
                        <button onClick={e => { e.stopPropagation(); setMenuOpenId(null); if (window.confirm(`Delete "${c.name}"?`)) deleteCohort(c.id); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-medium text-left transition-opacity hover:opacity-70"
                          style={{ color: '#ef4444' }}>
                          {deletingId === c.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Trash2 className="w-3.5 h-3.5"/>}
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===================== DETAIL VIEW ===================== */}
      {viewMode === 'detail' && selectedCohort && (
        <div className="rounded-2xl overflow-hidden" style={card}>
          {/* Detail header with back button */}
          <div className="px-5 py-4 border-b flex items-center gap-3" style={{ borderColor: C.divider }}>
            <button onClick={() => { setViewMode('list'); setMenuOpenId(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80 flex-shrink-0"
              style={{ background: C.pill, color: C.muted }}>
              <ArrowLeft className="w-3.5 h-3.5"/> Back
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold truncate" style={{ color: C.text }}>{selectedCohort.name}</p>
              {selectedCohort.description && <p className="text-xs mt-0.5 truncate" style={{ color: C.faint }}>{selectedCohort.description}</p>}
            </div>
            <button onClick={() => openEditMeta(selectedCohort)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all hover:opacity-80 flex-shrink-0"
              style={{ background: C.pill, color: C.muted }}>
              <Edit2 className="w-3.5 h-3.5"/> Edit Details
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b overflow-x-auto" style={{ borderColor: C.divider }}>
                {visibleTabs.map(t => (
                  <button key={t.id}
                    onClick={() => { setActiveTab(t.id as any); setSearch(''); setSelected(new Set()); setReassignId(null); setCourseSearch(''); }}
                    className="px-4 py-2.5 text-[13px] font-semibold whitespace-nowrap transition-colors relative flex-shrink-0"
                    style={{ color: activeTab === t.id ? C.green : C.muted }}>
                    {t.label}
                    {activeTab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: C.green }}/>}
                  </button>
                ))}
              </div>

              {/* --- Students tab --- */}
              {activeTab === 'students' && (
                <div>
                  <div className="px-5 py-3 border-b" style={{ borderColor: C.divider }}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: C.input, border: `1px solid ${C.cardBorder}` }}>
                      <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>
                      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search members..." className="w-full bg-transparent text-sm focus:outline-none" style={{ color: C.text }}/>
                      {search && <button onClick={() => setSearch('')}><X className="w-3.5 h-3.5" style={{ color: C.faint }}/></button>}
                    </div>
                  </div>
                  <div className="max-h-[500px] overflow-y-auto">
                    {cohortStudents.length === 0 ? (
                      <div className="flex flex-col items-center py-14 gap-2">
                        <UserPlus className="w-8 h-8 opacity-20" style={{ color: C.faint }}/>
                        <p className="text-sm" style={{ color: C.faint }}>No students in this cohort yet</p>
                        {!isStaff && <button onClick={() => setActiveTab('manage')} className="text-xs font-semibold mt-1 underline underline-offset-2" style={{ color: C.green }}>Add from unassigned</button>}
                      </div>
                    ) : cohortStudents
                        .filter(s => !search || (s.full_name ?? '').toLowerCase().includes(search.toLowerCase()) || s.email.toLowerCase().includes(search.toLowerCase()))
                        .map(s => (
                          <div key={s.id} style={{ borderBottom: `1px solid ${C.divider}` }}>
                            <div className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-black/[0.02]">
                              <Avatar name={s.full_name} email={s.email}/>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{s.full_name || '--'}</p>
                                <p className="text-xs truncate" style={{ color: C.faint }}>{s.email}</p>
                              </div>
                              {!isStaff && <div className="flex items-center gap-1 transition-all">
                                <button onClick={() => setReassignId(reassignId === s.id ? null : s.id)}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-blue-500/10"
                                  style={{ color: '#3b82f6' }}>
                                  <ArrowRight className="w-3.5 h-3.5"/> Move
                                </button>
                                <button onClick={async () => { if (!window.confirm(`Remove ${s.full_name || s.email} from this bootcamp cohort? Their bootcamp payment history will be preserved, and they will become eligible for an individual subscription.`)) return; if (await assignStudent(s.id, null)) showToast(true, `${s.full_name || s.email} removed and eligible for individual subscription`); setReassignId(null); }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-red-500/10"
                                  style={{ color: '#ef4444' }}>
                                  <UserMinus className="w-3.5 h-3.5"/> Remove
                                </button>
                                <button onClick={() => handleDeleteUser(s.id, s.full_name || s.email)} disabled={deletingUserId === s.id}
                                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-red-500/10 disabled:opacity-40"
                                  style={{ color: '#dc2626' }}>
                                  {deletingUserId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Trash2 className="w-3.5 h-3.5"/>}
                                  Delete
                                </button>
                              </div>}
                            </div>
                            {!isStaff && reassignId === s.id && (
                              <div className="mx-4 mb-4 rounded-2xl overflow-hidden"
                                style={{ background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: `0 8px 32px rgba(0,0,0,${isLight ? '0.10' : '0.40'})` }}>
                                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.divider}` }}>
                                  <div>
                                    <p className="text-sm font-semibold" style={{ color: C.text }}>Move to cohort</p>
                                    <p className="text-xs mt-0.5" style={{ color: C.faint }}>Select destination for {s.full_name || s.email}</p>
                                  </div>
                                  <button onClick={() => setReassignId(null)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/5" style={{ color: C.faint }}>
                                    <X className="w-3.5 h-3.5"/>
                                  </button>
                                </div>
                                {cohorts.filter(c => c.id !== selectedCohort?.id).length === 0 ? (
                                  <div className="flex flex-col items-center py-6 gap-1.5">
                                    <Users className="w-6 h-6 opacity-20" style={{ color: C.faint }}/>
                                    <p className="text-xs" style={{ color: C.faint }}>No other cohorts available</p>
                                  </div>
                                ) : (
                                  <div className="p-2 flex flex-col gap-1">
                                    {cohorts.filter(c => c.id !== selectedCohort?.id).map(c => {
                                      const cnt = students.filter(st => st.cohort_id === c.id).length;
                                      return (
                                        <button key={c.id}
                                          onClick={async () => { if (await assignStudent(s.id, c.id)) showToast(true, `${s.full_name || s.email} moved to "${c.name}"`); setReassignId(null); }}
                                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
                                          style={{ background: isLight ? '#f7f8f9' : '#1c1c1c' }}
                                          onMouseEnter={e => (e.currentTarget.style.background = isLight ? '#e8f5ee' : '#0d2016')}
                                          onMouseLeave={e => (e.currentTarget.style.background = isLight ? '#f7f8f9' : '#1c1c1c')}>
                                          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0" style={{ background: C.pill, color: C.muted }}>
                                            {c.name[0].toUpperCase()}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{c.name}</p>
                                            <p className="text-xs" style={{ color: C.faint }}>{cnt} student{cnt !== 1 ? 's' : ''}</p>
                                          </div>
                                          <ArrowRight className="w-4 h-4 flex-shrink-0" style={{ color: C.green }}/>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                    }
                  </div>
                </div>
              )}

              {/* --- Manage Students tab --- */}
              {!isStaff && activeTab === 'manage' && (
                <div>
                  <div className="px-5 py-3 flex items-center gap-3 border-b" style={{ borderColor: C.divider }}>
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: C.input, border: `1px solid ${C.cardBorder}` }}>
                      <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>
                      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search unassigned..." className="w-full bg-transparent text-sm focus:outline-none" style={{ color: C.text }}/>
                      {search && <button onClick={() => setSearch('')}><X className="w-3.5 h-3.5" style={{ color: C.faint }}/></button>}
                    </div>
                    {selected.size > 0 && (
                      <button onClick={assignSelected} disabled={assigning}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap disabled:opacity-50"
                        style={{ background: C.cta, color: C.ctaText }}>
                        {assigning ? <Loader2 className="w-4 h-4 animate-spin"/> : <UserPlus className="w-4 h-4"/>}
                        Add {selected.size} to cohort
                      </button>
                    )}
                  </div>
                  <div className="max-h-[500px] overflow-y-auto">
                    {unassigned.length > 0 && (
                      <div className="flex items-center gap-3 px-5 py-2.5" style={{ background: isLight ? '#fafafa' : '#161616' }}>
                        <input type="checkbox"
                          checked={unassigned.length > 0 && unassigned.every(s => selected.has(s.id))}
                          onChange={e => setSelected(e.target.checked ? new Set(unassigned.map(s => s.id)) : new Set())}
                          className="w-4 h-4 rounded cursor-pointer accent-green-600"/>
                        <p className="text-xs font-medium" style={{ color: C.muted }}>
                          {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
                        </p>
                      </div>
                    )}
                    {unassigned.length === 0 ? (
                      <div className="flex flex-col items-center py-14 gap-2">
                        <Check className="w-8 h-8 opacity-20" style={{ color: C.faint }}/>
                        <p className="text-sm" style={{ color: C.faint }}>
                          {search ? 'No matches found' : 'All students are assigned to a cohort'}
                        </p>
                      </div>
                    ) : unassigned.map(s => (
                      <div key={s.id} className="group flex items-center gap-3 px-5 py-3 transition-colors"
                        style={{ background: selected.has(s.id) ? (isLight ? '#e8f5ee' : '#0d2016') : 'transparent', borderBottom: `1px solid ${C.divider}` }}>
                        <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleSelect(s.id)} className="w-4 h-4 rounded cursor-pointer accent-green-600"/>
                        <div className="flex-1 flex items-center gap-3 min-w-0 cursor-pointer" onClick={() => toggleSelect(s.id)}>
                          <Avatar name={s.full_name} email={s.email}/>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{s.full_name || '--'}</p>
                            <p className="text-xs truncate" style={{ color: C.faint }}>{s.email}</p>
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); handleDeleteUser(s.id, s.full_name || s.email); }}
                          disabled={deletingUserId === s.id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:bg-red-500/10 disabled:opacity-40"
                          style={{ color: '#dc2626' }}>
                          {deletingUserId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Trash2 className="w-3.5 h-3.5"/>}
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* --- Assign Content tab --- */}
              {activeTab === 'courses' && (
                <div>
                  <div className="px-5 py-3 border-b" style={{ borderColor: C.divider }}>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: C.input, border: `1px solid ${C.cardBorder}` }}>
                      <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: C.faint }}/>
                      <input value={courseSearch} onChange={e => setCourseSearch(e.target.value)} placeholder="Search content..." className="w-full bg-transparent text-sm focus:outline-none" style={{ color: C.text }}/>
                      {courseSearch && <button onClick={() => setCourseSearch('')}><X className="w-3.5 h-3.5" style={{ color: C.faint }}/></button>}
                    </div>
                  </div>
                  <div className="max-h-[500px] overflow-y-auto">
                    {filteredContent.length === 0 ? (
                      <div className="flex flex-col items-center py-14 gap-2">
                        <BookOpen className="w-8 h-8 opacity-20" style={{ color: C.faint }}/>
                        <p className="text-sm" style={{ color: C.faint }}>{courseSearch ? 'No content matches' : 'No content yet'}</p>
                      </div>
                    ) : filteredContent.map(item => {
                      const meta = TYPE_META[item._type];
                      const assigned = Array.isArray(item.cohort_ids) && item.cohort_ids.includes(selectedCohort.id);
                      const toggling = togglingCourse === item.id;
                      const isPublished = item.status === 'published';
                      return (
                        <div key={`${item._type}-${item.id}`}
                          className={`flex items-center gap-3 px-5 py-3 transition-colors ${isPublished ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}
                          style={{ borderBottom: `1px solid ${C.divider}`, background: assigned ? (isLight ? '#f0fdf4' : '#0a1f12') : 'transparent' }}
                          onClick={() => isPublished && !toggling && toggleContentAssignment(meta.table, item.id, item.cohort_ids ?? [], meta.setter)}
                          title={!isPublished ? 'Publish this content before assigning it to a cohort' : undefined}>
                          <div className="flex-shrink-0">
                            {toggling ? (
                              <Loader2 className="w-4 h-4 animate-spin" style={{ color: C.faint }}/>
                            ) : (
                              <div className="w-4 h-4 rounded flex items-center justify-center border-2 transition-colors"
                                style={{ background: assigned ? '#16a34a' : 'transparent', borderColor: assigned ? '#16a34a' : C.cardBorder }}>
                                {assigned && <Check className="w-2.5 h-2.5 text-white"/>}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate" style={{ color: C.text }}>{item.title || 'Untitled'}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                                style={{ background: meta.bg, color: meta.color }}>
                                {meta.label}
                              </span>
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${item.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                                {item.status ?? 'draft'}
                              </span>
                              {item._type === 'course' && item.available_to_everyone === true && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium" style={{ background: C.pill, color: C.muted }}>
                                  Everyone
                                </span>
                              )}
                            </div>
                          </div>
                          {assigned && <span className="text-xs font-semibold flex-shrink-0" style={{ color: '#16a34a' }}>Assigned</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* --- Payment Settings tab --- */}
              {!isStaff && activeTab === 'payment' && (
                <div className="p-5 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    {[
                      { label: 'Total Fee', key: 'total_fee', type: 'number', placeholder: '3000' },
                      { label: 'Currency', key: 'currency', type: 'text', placeholder: 'GHS' },
                      { label: 'Deposit %', key: 'deposit_percent', type: 'number', placeholder: '50' },
                      { label: 'Installments', key: 'installment_count', type: 'number', placeholder: '3', min: 3 },
                      { label: 'Extra Months', key: 'post_bootcamp_access_months', type: 'number', placeholder: '3' },
                      { label: 'Grace Period (days)', key: 'grace_period_days', type: 'number', placeholder: 'None' },
                    ].map(f => (
                      <div key={f.key}>
                        <label className="block text-xs font-semibold mb-1" style={{ color: C.faint }}>{f.label}</label>
                        <input type={f.type} value={(paymentSettings as any)[f.key]} placeholder={f.placeholder}
                          min={(f as any).min}
                          onChange={e => setPaymentSettings(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                          style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                      </div>
                    ))}
                    <div>
                      <label className="block text-xs font-semibold mb-1" style={{ color: C.faint }}>Plan</label>
                      <select value={paymentSettings.payment_plan}
                        onChange={e => setPaymentSettings(prev => ({ ...prev, payment_plan: e.target.value }))}
                        className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                        style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}>
                        <option value="flexible">Flexible</option>
                        <option value="full">Full</option>
                        <option value="sponsored">Sponsored</option>
                        <option value="waived">Waived</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[{ label: 'Cohort Start Date*', key: 'start_date' }, { label: 'Cohort End Date', key: 'end_date' }].map(f => (
                      <div key={f.key}>
                        <label className="block text-xs font-semibold mb-1" style={{ color: C.faint }}>{f.label}</label>
                        <input type="date" value={(paymentSettings as any)[f.key]}
                          onChange={e => setPaymentSettings(prev => ({ ...prev, [f.key]: e.target.value }))}
                          className="w-full rounded-lg px-3 py-2.5 text-sm outline-none"
                          style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: C.faint }}>
                    Changing the start date updates pending (not yet signed-up) students automatically.
                    Installment due dates for already signed-up students are not changed -- use the Edit button in Payments to adjust those individually.
                  </p>
                  {paymentSettingsError && <p className="text-xs" style={{ color: '#dc2626' }}>{paymentSettingsError}</p>}
                  <button onClick={savePaymentSettings} disabled={paymentSettingsSaving}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40"
                    style={{ background: C.cta, color: C.ctaText }}>
                    {paymentSettingsSaving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
                    Save Payment Settings
                  </button>
                </div>
              )}

              {/* --- New Admissions tab --- */}
              {!isStaff && activeTab === 'admissions' && (
                <div className="p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setAddAdmissionOpen(true); setAddAdmissionLog([]); setAddAdmissionError(''); setAddAdmissionForm(blankAdmissionForm); }}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
                      style={{ background: C.cta, color: C.ctaText }}>
                      <UserPlus className="w-4 h-4"/> Add Student
                    </button>
                    <button onClick={() => { setAdmissionsOpen(v => !v); setAdmissionsResult(null); setAdmissionsError(''); }}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
                      style={{ background: C.pill, color: C.muted }}>
                      <Upload className="w-4 h-4"/> {admissionsOpen ? 'Hide CSV Import' : 'Import CSV'}
                    </button>
                  </div>
                  {admissionsOpen && (
                    <div className="rounded-2xl p-4 space-y-4" style={{ background: isLight ? '#fafafa' : '#161616', border: `1px solid ${C.cardBorder}` }}>
                      <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
                        Paste a CSV or upload a file. Required column: <strong>email</strong>. Optional: <strong>full_name, total_fee, payment_plan, amount_paid, paid_at, payment_method, payment_reference, notes</strong>.
                        Missing fee/plan values fall back to this cohort&apos;s payment settings.
                      </p>
                      <div className="flex items-center gap-2">
                        <input type="file" accept=".csv,text/csv" className="hidden" id="admissions-csv-file"
                          onChange={e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = ev => { const text = ev.target?.result as string; setAdmissionsCsv(text); parseAdmissionsCsv(text); };
                            reader.readAsText(file);
                            e.target.value = '';
                          }}/>
                        <label htmlFor="admissions-csv-file" className="cursor-pointer text-xs font-semibold px-3 py-2 rounded-lg" style={{ background: C.pill, color: C.muted }}>Upload CSV file</label>
                        <span className="text-xs" style={{ color: C.faint }}>or paste below</span>
                      </div>
                      <textarea value={admissionsCsv} onChange={e => { setAdmissionsCsv(e.target.value); parseAdmissionsCsv(e.target.value); }}
                        rows={5} placeholder={`email,full_name,total_fee,payment_plan,amount_paid\nstudent@example.com,Jane Doe,3000,flexible,1500`}
                        className="w-full rounded-xl px-3 py-2.5 text-xs font-mono resize-none focus:outline-none"
                        style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                      {admissionsError && <p className="text-xs" style={{ color: '#dc2626' }}>{admissionsError}</p>}
                      {admissionsRows.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold" style={{ color: C.muted }}>{admissionsRows.length} row{admissionsRows.length !== 1 ? 's' : ''} parsed -- preview:</p>
                          <div className="rounded-xl overflow-x-auto" style={{ border: `1px solid ${C.cardBorder}`, maxHeight: 200 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                              <thead><tr style={{ background: C.pill }}>
                                {Object.keys(admissionsRows[0]).map(h => <th key={h} style={{ padding: '6px 10px', textAlign: 'left', color: C.faint, fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>)}
                              </tr></thead>
                              <tbody>
                                {admissionsRows.slice(0, 5).map((r, i) => (
                                  <tr key={i} style={{ borderTop: `1px solid ${C.divider}` }}>
                                    {Object.values(r).map((v: any, j) => <td key={j} style={{ padding: '5px 10px', color: C.text, whiteSpace: 'nowrap' }}>{v}</td>)}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            {admissionsRows.length > 5 && <div className="px-4 py-2 text-xs" style={{ color: C.faint, borderTop: `1px solid ${C.divider}` }}>...and {admissionsRows.length - 5} more rows</div>}
                          </div>
                        </div>
                      )}
                      {admissionsResult && (
                        <div className="rounded-xl px-4 py-3 space-y-1" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
                          <p className="text-xs font-semibold" style={{ color: '#16a34a' }}>
                            Import complete -- {admissionsResult.inserted} admission{admissionsResult.inserted !== 1 ? 's' : ''} added, {admissionsResult.updated} updated, {admissionsResult.provisioned} setup link{admissionsResult.provisioned !== 1 ? 's' : ''} prepared, {admissionsResult.setupEmailsSent} email{admissionsResult.setupEmailsSent !== 1 ? 's' : ''} sent
                          </p>
                          {admissionsResult.errors.length > 0 && <p className="text-xs" style={{ color: '#dc2626' }}>{admissionsResult.errors.length} error(s): {admissionsResult.errors.map((e: any) => e.email).join(', ')}</p>}
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button onClick={() => { setAdmissionsOpen(false); setAdmissionsCsv(''); setAdmissionsRows([]); setAdmissionsResult(null); }}
                          className="flex-1 py-2 rounded-xl text-sm font-semibold" style={{ background: C.pill, color: C.muted }}>Cancel</button>
                        <button onClick={handleAdmissionsImport} disabled={admissionsSaving || admissionsRows.length === 0}
                          className="flex-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ background: C.cta, color: C.ctaText }}>
                          {admissionsSaving ? <span className="flex items-center justify-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin"/> Importing...</span>
                            : `Import ${admissionsRows.length > 0 ? admissionsRows.length + ' ' : ''}Student${admissionsRows.length !== 1 ? 's' : ''}`}
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Admissions history */}
                  <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
                    <div className="px-4 py-3 flex items-center gap-2.5 border-b" style={{ borderColor: C.divider }}>
                      <Mail className="w-4 h-4" style={{ color: C.muted }}/>
                      <p className="text-sm font-semibold" style={{ color: C.text }}>Admissions History</p>
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: C.pill, color: C.muted }}>{admissionsList.length}</span>
                    </div>
                    {admissionsLoading ? (
                      <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: C.faint }}/></div>
                    ) : admissionsList.length === 0 ? (
                      <div className="flex flex-col items-center py-10 gap-1.5">
                        <Mail className="w-8 h-8 opacity-20" style={{ color: C.faint }}/>
                        <p className="text-sm" style={{ color: C.faint }}>No admissions yet</p>
                        <p className="text-xs" style={{ color: C.faint }}>Add or import students to create accounts and send setup emails.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: C.pill }}>
                              {['Student', 'Payment', 'Setup Status', 'Last Login', 'Imported'].map(h => (
                                <th key={h} style={{ padding: '10px 12px', textAlign: h === 'Payment' ? 'right' : 'left', color: C.faint, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {admissionsList.map((row, i) => {
                              const status = admissionStatus(row);
                              const studentName = row.student?.full_name || row.full_name || 'No name';
                              const email = row.student?.email || row.email || '';
                              const paid = Number(row.amount_paid_initial ?? 0);
                              const total = Number(row.total_fee ?? 0);
                              return (
                                <tr key={row.id} style={{ borderTop: i === 0 ? 'none' : `1px solid ${C.divider}` }}>
                                  <td style={{ padding: '10px 12px', color: C.text, minWidth: 180 }}>
                                    <p className="font-semibold truncate" style={{ margin: 0, color: C.text }}>{studentName}</p>
                                    <p className="truncate" style={{ margin: '2px 0 0', color: C.muted, fontSize: 11 }}>{email}</p>
                                  </td>
                                  <td style={{ padding: '10px 12px', color: C.muted, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                    <p style={{ margin: 0 }}>{row.currency ?? 'GHS'} {paid.toLocaleString()} / {total.toLocaleString()}</p>
                                    <p style={{ margin: '2px 0 0', fontSize: 11 }}>{row.payment_plan ?? 'flexible'}</p>
                                  </td>
                                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold" style={{ background: status.bg, color: status.color }}>{status.label}</span>
                                    <p style={{ margin: '4px 0 0', color: C.faint, fontSize: 11 }}>{formatAdmissionDate(status.at)}</p>
                                  </td>
                                  <td style={{ padding: '10px 12px', color: C.muted, whiteSpace: 'nowrap' }}>
                                    {formatAdmissionDate(row.student?.last_login_at)}
                                  </td>
                                  <td style={{ padding: '10px 12px', color: C.muted, whiteSpace: 'nowrap' }}>
                                    {formatAdmissionDate(row.created_at)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
        </div>
      )}

      {/* Create Cohort Modal */}
      {!isStaff && showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ ...modalStyle(C) }}
            onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div>
                <h3 className="text-base font-bold" style={{ color: C.text }}>New Cohort</h3>
                <p className="text-xs mt-0.5" style={{ color: C.muted }}>Create a new student cohort</p>
              </div>
              <button onClick={() => setShowCreate(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5" style={{ color: C.faint }}>
                <X className="w-4 h-4"/>
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Name *</label>
                <input value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && createCohort()}
                  placeholder="e.g. Cohort 3" autoFocus className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={input}/>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Description</label>
                <input value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="Optional description"
                  className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={input}/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Start Date *</label>
                  <input type="date" value={newStartDate} onChange={e => setNewStartDate(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={input}/>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>End Date</label>
                  <input type="date" value={newEndDate} onChange={e => setNewEndDate(e.target.value)}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={input}/>
                </div>
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: C.pill, color: C.muted }}>Cancel</button>
              <button onClick={createCohort} disabled={saving || !newName.trim() || !newStartDate}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: C.cta, color: C.ctaText }}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Plus className="w-4 h-4"/>}
                Create Cohort
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Cohort Modal */}
      {editOpen && selectedCohort && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => setEditOpen(false)}>
          <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ ...modalStyle(C) }}
            onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-4 flex items-center justify-between" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div>
                <h3 className="text-base font-bold" style={{ color: C.text }}>Edit Cohort</h3>
                <p className="text-xs mt-0.5" style={{ color: C.muted }}>{selectedCohort.name}</p>
              </div>
              <button onClick={() => setEditOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5" style={{ color: C.faint }}>
                <X className="w-4 h-4"/>
              </button>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Name *</label>
                <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Cohort name" autoFocus className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={input}/>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Description</label>
                <input value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Optional description" className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={input}/>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Start Date</label>
                  <input type="date" value={editForm.start_date} onChange={e => setEditForm(p => ({ ...p, start_date: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={input}/>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>End Date</label>
                  <input type="date" value={editForm.end_date} onChange={e => setEditForm(p => ({ ...p, end_date: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none" style={input}/>
                </div>
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-2">
              <button onClick={() => setEditOpen(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold" style={{ background: C.pill, color: C.muted }}>Cancel</button>
              <button onClick={saveEdit} disabled={editSaving || !editForm.name.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: C.cta, color: C.ctaText }}>
                {editSaving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Admission Modal */}
      {!isStaff && addAdmissionOpen && selectedCohort && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => { setAddAdmissionOpen(false); setAddAdmissionLog([]); }}>
          <div className="w-full max-w-lg rounded-2xl overflow-hidden flex flex-col max-h-[92vh]"
            style={{ ...modalStyle(C) }}
            onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-5 pb-4 flex items-start justify-between flex-shrink-0" style={{ borderBottom: `1px solid ${C.divider}` }}>
              <div>
                <h3 className="text-base font-bold" style={{ color: C.text }}>Add Student</h3>
                <p className="text-xs mt-0.5" style={{ color: C.muted }}>{selectedCohort.name}</p>
              </div>
              <button onClick={() => { setAddAdmissionOpen(false); setAddAdmissionLog([]); }} className="text-xs font-semibold px-2.5 py-1 rounded-lg" style={{ background: C.pill, color: C.muted }}>Close</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Email *</label>
                  <input type="email" value={addAdmissionForm.email} placeholder="student@example.com"
                    onChange={e => setAddAdmissionForm(p => ({ ...p, email: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Full Name</label>
                  <input type="text" value={addAdmissionForm.full_name} placeholder="Jane Doe"
                    onChange={e => setAddAdmissionForm(p => ({ ...p, full_name: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Total Fee</label>
                    <input type="number" value={addAdmissionForm.total_fee} placeholder="Cohort default"
                      onChange={e => setAddAdmissionForm(p => ({ ...p, total_fee: e.target.value }))}
                      className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Payment Plan</label>
                    <select value={addAdmissionForm.payment_plan} onChange={e => setAddAdmissionForm(p => ({ ...p, payment_plan: e.target.value }))}
                      className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}>
                      <option value="flexible">Flexible</option>
                      <option value="full">Full</option>
                      <option value="sponsored">Sponsored</option>
                      <option value="waived">Waived</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Amount Paid</label>
                    <input type="number" value={addAdmissionForm.amount_paid} placeholder="0"
                      onChange={e => setAddAdmissionForm(p => ({ ...p, amount_paid: e.target.value }))}
                      className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Date Paid</label>
                    <input type="date" value={addAdmissionForm.paid_at} onChange={e => setAddAdmissionForm(p => ({ ...p, paid_at: e.target.value }))}
                      className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Payment Method</label>
                    <input type="text" value={addAdmissionForm.payment_method} placeholder="e.g. bank transfer"
                      onChange={e => setAddAdmissionForm(p => ({ ...p, payment_method: e.target.value }))}
                      className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Reference</label>
                    <input type="text" value={addAdmissionForm.payment_reference} placeholder="Transaction ref"
                      onChange={e => setAddAdmissionForm(p => ({ ...p, payment_reference: e.target.value }))}
                      className="w-full rounded-xl px-3 py-2 text-sm outline-none" style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold mb-1" style={{ color: C.muted }}>Notes</label>
                  <textarea value={addAdmissionForm.notes} placeholder="Optional notes..."
                    rows={2} onChange={e => setAddAdmissionForm(p => ({ ...p, notes: e.target.value }))}
                    className="w-full rounded-xl px-3 py-2 text-sm resize-none outline-none" style={{ background: C.input, border: `1px solid ${C.cardBorder}`, color: C.text }}/>
                </div>
              </div>
              {addAdmissionError && <p className="text-xs" style={{ color: '#dc2626' }}>{addAdmissionError}</p>}
              {addAdmissionLog.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.cardBorder}` }}>
                  <div className="px-3 py-2 text-xs font-semibold" style={{ background: C.pill, color: C.muted }}>Added this session ({addAdmissionLog.length})</div>
                  <div className="divide-y" style={{ borderColor: C.divider }}>
                    {addAdmissionLog.map((entry, i) => (
                      <div key={i} className="px-3 py-2 flex items-center justify-between">
                        <div>
                          <p className="text-xs font-medium" style={{ color: C.text }}>{entry.email}</p>
                          {entry.name && <p className="text-xs" style={{ color: C.muted }}>{entry.name}</p>}
                        </div>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: entry.status === 'added' ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)', color: entry.status === 'added' ? '#16a34a' : '#2563eb' }}>
                          {entry.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 flex gap-2 flex-shrink-0" style={{ borderTop: `1px solid ${C.divider}` }}>
              <button onClick={() => handleAddAdmission(false)} disabled={addAdmissionSaving || !addAdmissionForm.email.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: C.pill, color: C.text }}>
                {addAdmissionSaving ? 'Saving...' : 'Save & Add Another'}
              </button>
              <button onClick={() => handleAddAdmission(true)} disabled={addAdmissionSaving || !addAdmissionForm.email.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
                style={{ background: C.cta, color: C.ctaText }}>
                {addAdmissionSaving ? 'Saving...' : 'Save & Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
