'use client';

// Assignments section + AssignmentDetail (and the dynamic AI-review players they use),
// extracted verbatim from app/student/page.tsx. Only AssignmentsSection is exported;
// AssignmentDetail is file-internal.

import { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { motion } from 'motion/react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/components/ThemeProvider';
import { sanitizeRichText } from '@/lib/sanitize';
import { RichTextEditor } from '@/components/RichTextEditor';
import { buildReviewNotes, parseReviewNotes, isFullReport } from '@/lib/reviewRecord';
import { LIGHT_C } from '@/lib/theme';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { getStudentMode } from '@/lib/student-mode-client';
import { Sk, EmptyState, StatusBadge } from '@/components/student/shared';
import {
  BookOpen, ClipboardList, Users, ChevronDown, X, CheckCircle, AlertCircle, Star,
  ExternalLink, Loader2, FileText, Plus, ArrowLeft, Upload, RefreshCw, Check,
} from 'lucide-react';

// --- Assignments section ---
const CodeReviewPlayer        = dynamic(() => import('@/components/CodeReviewPlayer'),        { ssr: false, loading: () => <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#888' }}/></div> });
const ExcelReviewPlayer       = dynamic(() => import('@/components/ExcelReviewPlayer'),       { ssr: false, loading: () => <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#888' }}/></div> });
const DashboardCritiquePlayer = dynamic(() => import('@/components/DashboardCritiquePlayer'), { ssr: false, loading: () => <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#888' }}/></div> });
const DocumentReviewPlayer    = dynamic(() => import('@/components/DocumentReviewPlayer'),    { ssr: false, loading: () => <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#888' }}/></div> });
const AssignmentExperiencePlayer = dynamic(() => import('@/components/AssignmentExperiencePlayer'), { ssr: false, loading: () => <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: '#888' }}/></div> });

function AssignmentDetail({ assignment, userId, studentName, studentEmail, C, onBack }: { assignment: any; userId: string; studentName: string; studentEmail: string; C: typeof LIGHT_C; onBack: () => void }) {
  type ReadyFile = { name: string; url: string; status: 'uploading' | 'done' | 'error'; error?: string };
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  // Student Mode is read-only for graded work: an instructor/admin viewing a
  // student may review but must never submit on the student's behalf.
  const inStudentMode = useRef(!!getStudentMode()).current;
  const [submission, setSubmission] = useState<any>(null);
  const [savedFiles, setSavedFiles] = useState<any[]>([]);
  const [resources, setResources] = useState<any[]>([]);
  const [responseText, setResponseText] = useState('');
  const [links, setLinks] = useState<string[]>(['']);
  const [readyFiles, setReadyFiles] = useState<ReadyFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [loadingSub, setLoadingSub] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // VE-specific state
  const [veForm, setVeForm]           = useState<any>(null);
  const [veProgress, setVeProgress]   = useState<any>(null);
  const [sessionToken, setSessionToken] = useState('');
  const [veLoading, setVeLoading]     = useState(false);

  // Group-specific state
  const isGroupAssignment = (assignment.group_ids?.length ?? 0) > 0;
  const [myGroupId, setMyGroupId]             = useState<string | null>(null);
  const [groupMembers, setGroupMembers]       = useState<any[]>([]);
  const [hoveredMember, setHoveredMember] = useState<string | null>(null);
  const [popupRect, setPopupRect]         = useState<DOMRect | null>(null);
  const [isLeader, setIsLeader]               = useState(false);
  const [selectedParticipants, setSelectedParticipants] = useState<string[]>([]);
  const [workspaceNotes, setWorkspaceNotes] = useState('');
  const [workspaceLinks, setWorkspaceLinks] = useState<{ url: string; label?: string }[]>([{ url: '', label: '' }]);
  const [workspaceSaving, setWorkspaceSaving] = useState(false);
  const [workspaceError, setWorkspaceError] = useState('');
  const [groupPanelTab, setGroupPanelTab] = useState<'members' | 'connect'>('members');
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const toggleParticipant = (id: string) =>
    setSelectedParticipants(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const assignmentType = assignment.type ?? 'standard';
  const isAiType = ['code_review', 'excel_review', 'dashboard_critique', 'document_review'].includes(assignmentType);
  const isVeType = assignmentType === 'virtual_experience';

  useEffect(() => {
    const load = async () => {
      // If group assignment, resolve student's group membership first
      let resolvedGroupId: string | null = null;
      if (isGroupAssignment) {
        const { data: memberRow } = await supabase
          .from('group_members')
          .select('group_id, is_leader')
          .eq('student_id', userId)
          .maybeSingle();
        if (memberRow) {
          resolvedGroupId = memberRow.group_id;
          setMyGroupId(memberRow.group_id);
          setIsLeader(memberRow.is_leader ?? false);
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token ?? '';
          const memberRes = await fetch(`/api/student/group-members?groupId=${memberRow.group_id}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const memberJson = memberRes.ok ? await memberRes.json() : { members: [] };
          const grpMembers = memberJson.members ?? [];
          setGroupMembers(grpMembers);
          if (memberRow.is_leader) {
            setSelectedParticipants((grpMembers ?? []).map((m: any) => m.student_id as string));
          }
          const workspaceRes = await fetch(`/api/assignments/group-workspace?assignmentId=${assignment.id}&groupId=${memberRow.group_id}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (workspaceRes.ok) {
            const workspaceJson = await workspaceRes.json();
            const workspace = workspaceJson.workspace ?? {};
            setWorkspaceNotes(workspace.notes ?? '');
            const loadedLinks = Array.isArray(workspace.links) ? workspace.links : [];
            setWorkspaceLinks(loadedLinks.length ? loadedLinks : [{ url: '', label: '' }]);
          }
        }
      }

      const subQuery = isGroupAssignment && resolvedGroupId
        ? supabase.from('assignment_submissions')
            .select('*, submitted_by_student:students!submitted_by(full_name)')
            .eq('assignment_id', assignment.id)
            .eq('group_id', resolvedGroupId)
            .maybeSingle()
        : supabase.from('assignment_submissions')
            .select('*').eq('assignment_id', assignment.id).eq('student_id', userId).maybeSingle();

      const [{ data: sub }, { data: res }] = await Promise.all([
        subQuery,
        supabase.from('assignment_resources')
          .select('id, name, url, resource_type').eq('assignment_id', assignment.id).order('created_at'),
      ]);
      if (sub) {
        setSubmission(sub);
        setResponseText(sub.response_text ?? '');
        // Restore participant selection from saved submission
        if (sub.participants?.length) setSelectedParticipants(sub.participants);
        const { data: files } = await supabase.from('assignment_submission_files')
          .select('*').eq('submission_id', sub.id).order('uploaded_at');
        setSavedFiles(files ?? []);
      }
      setResources(res ?? []);
      setLoadingSub(false);

      // Load VE data if this is a virtual_experience assignment
      if (isVeType && assignment.config?.ve_form_id) {
        setVeLoading(true);
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token ?? '';
          setSessionToken(token);
          const veRes = await fetch(`/api/ve-for-assignment?veId=${assignment.config.ve_form_id}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const veData = veRes.ok ? (await veRes.json()).ve : null;
          if (veData) {
            setVeForm({
              id: veData.id,
              slug: veData.slug,
              config: {
                isVirtualExperience: true as const,
                title: veData.title,
                company: veData.company,
                role: veData.role,
                industry: veData.industry,
                modules: veData.modules ?? [],
                tagline: veData.tagline,
                coverImage: veData.cover_image,
                managerName: veData.manager_name,
                managerTitle: veData.manager_title,
                dataset: veData.dataset,
                background: veData.background,
              },
            });
          }
          // Graded group members review the submitter's work, not their own prep.
          const reviewGroupSubmission = isGroupAssignment && resolvedGroupId
            && sub?.status === 'graded' && sub?.submitted_by && sub.submitted_by !== userId;
          const progressUrl = reviewGroupSubmission
            ? `/api/guided-project-progress?formId=${assignment.config.ve_form_id}&groupId=${resolvedGroupId}&assignmentId=${assignment.id}`
            : `/api/guided-project-progress?formId=${assignment.config.ve_form_id}&studentId=${userId}`;
          const res = await fetch(progressUrl, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            const json = await res.json();
            if (json.attempt?.progress) setVeProgress(json.attempt.progress);
          }
        } finally {
          setVeLoading(false);
        }
      }
    };
    load();
  }, [assignment.id, userId, isVeType, isGroupAssignment, assignment.config?.ve_form_id]);

  const ALLOWED_TYPES = new Set([
    'application/pdf',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'text/csv', 'text/plain',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip',
  ]);
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    e.target.value = '';
    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) {
        setReadyFiles(prev => [...prev, { name: file.name, url: '', status: 'error', error: 'File type not allowed. Accepted: PDF, images, Word, Excel, PowerPoint, CSV, ZIP.' }]);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        setReadyFiles(prev => [...prev, { name: file.name, url: '', status: 'error', error: 'File exceeds the 10 MB size limit.' }]);
        continue;
      }
      const key = `${Date.now()}-${file.name}`;
      const path = `submissions/${assignment.id}/${userId}/${key}`;
      setReadyFiles(prev => [...prev, { name: file.name, url: '', status: 'uploading' }]);
      const { error: upErr } = await supabase.storage.from('form-assets').upload(path, file, { upsert: true });
      if (upErr) {
        console.error('[upload]', upErr.message);
        setReadyFiles(prev => prev.map(f => f.name === file.name && f.status === 'uploading' ? { ...f, status: 'error', error: 'Upload failed. Please try again.' } : f));
      } else {
        const { data: { publicUrl } } = supabase.storage.from('form-assets').getPublicUrl(path);
        setReadyFiles(prev => prev.map(f => f.name === file.name && f.status === 'uploading' ? { ...f, url: publicUrl, status: 'done' } : f));
      }
    }
  }

  async function saveWorkspace() {
    if (!myGroupId) return;
    setWorkspaceSaving(true);
    setWorkspaceError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const payload = {
        assignmentId: assignment.id,
        groupId: myGroupId,
        notes: sanitizeRichText(workspaceNotes),
        links: workspaceLinks.filter(l => l.url.trim()).map(l => ({ url: l.url.trim(), label: (l.label ?? '').trim() })),
        files: [],
      };
      const res = await fetch('/api/assignments/group-workspace', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save workspace');
      const workspace = json.workspace ?? {};
      setWorkspaceNotes(workspace.notes ?? '');
      const loadedLinks = Array.isArray(workspace.links) ? workspace.links : [];
      setWorkspaceLinks(loadedLinks.length ? loadedLinks : [{ url: '', label: '' }]);
    } catch (err: any) {
      setWorkspaceError(err?.message || 'Could not save workspace. Please try again.');
    } finally {
      setWorkspaceSaving(false);
    }
  }

  const removeWorkspaceLink = (i: number) => setWorkspaceLinks(prev => prev.filter((_, idx) => idx !== i));

  async function handleSubmit(asDraft: boolean) {
    setSubmitError('');
    if (inStudentMode) { setSubmitError('Submitting on a student behalf is disabled in Student Mode.'); return; }
    setSubmitting(true);
    try {
      const newStatus = asDraft ? 'draft' : 'submitted';
      const submittedAt = asDraft ? undefined : new Date().toISOString();
      let sub = submission;
      const participantIds = isGroupAssignment
        ? Array.from(new Set(selectedParticipants))
        : selectedParticipants;
      if (isGroupAssignment && !asDraft && participantIds.length === 0) {
        throw new Error('Select at least one participant before submitting.');
      }

      const sanitizedResponse = sanitizeRichText(responseText);
      if (sub) {
        const updatePayload: any = { response_text: sanitizedResponse, status: newStatus };
        if (submittedAt) updatePayload.submitted_at = submittedAt;
        if (isGroupAssignment) {
          updatePayload.submitted_by = userId;
          updatePayload.participants = participantIds;
        }
        const { error } = await supabase.from('assignment_submissions')
          .update(updatePayload)
          .eq('id', sub.id);
        if (error) throw error;
        sub = { ...sub, ...updatePayload };
      } else {
        const insertPayload: any = { assignment_id: assignment.id, student_id: userId, response_text: sanitizedResponse, status: newStatus };
        if (submittedAt) insertPayload.submitted_at = submittedAt;
        if (isGroupAssignment && myGroupId) {
          insertPayload.group_id = myGroupId;
          insertPayload.submitted_by = userId;
          insertPayload.participants = participantIds;
        }
        const { data, error } = await supabase.from('assignment_submissions')
          .insert(insertPayload)
          .select().single();
        if (error) throw error;
        sub = data;
      }
      setSubmission(sub);

      // Link already-uploaded files + links to the submission
      const newFileRecords: any[] = [];
      for (const f of readyFiles.filter(f => f.status === 'done')) {
        newFileRecords.push({ submission_id: sub.id, file_name: f.name, file_url: f.url });
      }
      const validLinks = links.filter(l => l.trim());
      for (const url of validLinks) {
        newFileRecords.push({ submission_id: sub.id, file_name: null, file_url: url.trim() });
      }
      if (newFileRecords.length) {
        const { data: inserted, error: fileErr } = await supabase.from('assignment_submission_files').insert(newFileRecords).select();
        if (fileErr) throw fileErr;
        setSavedFiles(prev => [...prev, ...(inserted ?? [])]);
      }

      setReadyFiles([]);
      setLinks(['']);
      if (!asDraft) {
        setSubmitSuccess(true);
        fetch('/api/assignments/submit-confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignment_id: assignment.id }),
        }).catch(() => {});
        setTimeout(() => onBack(), 2500);
      }
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to save. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const removeLink = (i: number) => setLinks(prev => prev.filter((_, idx) => idx !== i));
  const removeReadyFile = (i: number) => setReadyFiles(prev => prev.filter((_, idx) => idx !== i));
  const removeSavedFile = async (fileId: string) => {
    await supabase.from('assignment_submission_files').delete().eq('id', fileId);
    setSavedFiles(prev => prev.filter(f => f.id !== fileId));
  };

  async function handleResubmit() {
    if (!submission) return;
    setSubmitError('');
    if (inStudentMode) { setSubmitError('Resubmitting on a student behalf is disabled in Student Mode.'); return; }
    setSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const res = await fetch('/api/assignments/resubmit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ submissionId: submission.id }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to resubmit');
      setSubmission((prev: any) => ({ ...prev, status: 'draft', score: null, feedback: null, graded_by: null, graded_at: null }));
    } catch (err: any) {
      setSubmitError(err?.message || 'Failed to resubmit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function autoSubmit(aiScore: number | null, summaryText: string) {
    if (inStudentMode) { setSubmitError('Submitting on a student behalf is disabled in Student Mode.'); return; }
    const participantIds = Array.from(new Set(selectedParticipants));
    if (isGroupAssignment && myGroupId && participantIds.length === 0) {
      setSubmitError('Select at least one participant before submitting.');
      return;
    }

    const score = aiScore != null ? Math.round(aiScore) : null;
    const payload: any = {
      assignment_id: assignment.id,
      student_id: userId,
      response_text: summaryText,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    };
    if (score != null) payload.score = score;
    if (isGroupAssignment && myGroupId) {
      payload.group_id = myGroupId;
      payload.submitted_by = userId;
      payload.participants = participantIds;
    }
    const conflictCol = isGroupAssignment && myGroupId ? 'group_id,assignment_id' : 'student_id,assignment_id';
    const { data, error } = await supabase.from('assignment_submissions')
      .upsert(payload, { onConflict: conflictCol })
      .select().single();
    if (error) {
      setSubmitError(error.message || 'Failed to submit. Please try again.');
      return;
    }
    if (data) setSubmission(data);
  }

  const isParticipant = !isGroupAssignment
    || !submission
    || submission.status === 'draft'
    || (Array.isArray(submission.participants) && submission.participants.includes(userId));
  const isGraded = submission?.status === 'graded' && isParticipant;
  const isSubmitted = submission?.status === 'submitted' && isParticipant;
  const uploading = readyFiles.some(f => f.status === 'uploading');
  const hasContent = responseText.trim() || readyFiles.some(f => f.status === 'done') || links.some(l => l.trim()) || savedFiles.length > 0;

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 mb-3 text-xs font-medium"
        style={{ color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        <ArrowLeft className="w-3.5 h-3.5"/> Back to assignments
      </button>
      <h1 className="text-[22px] font-bold tracking-tight mb-5" style={{ color: C.text }}>{assignment.title}</h1>

      {submitSuccess && (
        <div className="flex items-center gap-3 rounded-2xl px-5 py-4 mb-5"
          style={{ background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.25)' }}>
          <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: '#10b981' }}/>
          <div>
            <p className="text-sm font-semibold" style={{ color: '#10b981' }}>Assignment submitted successfully!</p>
            <p className="text-xs mt-0.5" style={{ color: C.muted }}>Returning to assignments...</p>
          </div>
        </div>
      )}

      {/* Assignment brief -- only render card if there is content to show */}
      {(assignment.cover_image || (submission && isParticipant) || assignment._course_title || assignment.scenario || assignment.brief || assignment.tasks || assignment.requirements || resources.length > 0) && (
      <div className="rounded-2xl mb-4 overflow-hidden" style={{ background: C.card }}>
        {/* Cover image */}
        {assignment.cover_image && (
          <div className="px-4 pt-4">
            <img
              src={resolveCoverUrl(assignment.cover_image)}
              alt={assignment.title}
              className="w-full object-cover rounded-xl"
              style={{ maxHeight: 220 }}
              onError={e => (e.currentTarget.style.display = 'none')}
            />
          </div>
        )}

        {/* Status badge */}
        {submission && isParticipant && (
          <div className="px-6 pt-5 pb-4">
            <StatusBadge status={submission.status}/>
          </div>
        )}

        {/* Related course card */}
        {assignment._course_title && (
          <>
            <div style={{ borderTop: `1px solid ${C.divider}` }}/>
            <div className="px-6 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-3" style={{ color: C.faint }}>Related Course</p>
              <a
                href={`/${assignment._course_slug || assignment.related_course}`}
                className="flex items-center gap-3 no-underline transition-all hover:opacity-80"
                style={theme === 'dark'
                  ? { background: C.pill, borderRadius: 10 }
                  : { background: '#fff', border: `1px solid ${C.divider}`, borderRadius: 10, boxShadow: '0 1px 4px rgba(0,0,0,0.07)' }}
              >
                {/* Cover image with padding */}
                <div className="flex-shrink-0 p-2">
                  <div className="relative w-16 h-16 rounded-lg overflow-hidden flex items-center justify-center" style={{ background: `${C.green}18` }}>
                    <BookOpen className="w-6 h-6" style={{ color: C.green }}/>
                    {assignment._course_cover && <img src={resolveCoverUrl(assignment._course_cover)} alt={assignment._course_title} className="absolute inset-0 w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />}
                  </div>
                </div>
                {/* Text */}
                <div className="flex-1 min-w-0 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: C.green }}>Course</p>
                  <p className="text-[13px] font-semibold leading-snug truncate" style={{ color: C.text }}>{assignment._course_title}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: C.faint }}>Review course material before submitting</p>
                </div>
                <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 mr-4" style={{ color: C.faint }}/>
              </a>
            </div>
          </>
        )}

        {assignment.scenario && (
          <>
            <div style={{ borderTop: `1px solid ${C.divider}` }}/>
            <div className="px-6 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Scenario</p>
              <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(assignment.scenario) }}/>
            </div>
          </>
        )}

        {assignment.brief && (
          <>
            <div style={{ borderTop: `1px solid ${C.divider}` }}/>
            <div className="px-6 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Brief</p>
              <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(assignment.brief) }}/>
            </div>
          </>
        )}

        {assignment.tasks && (
          <>
            <div style={{ borderTop: `1px solid ${C.divider}` }}/>
            <div className="px-6 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Tasks</p>
              <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(assignment.tasks) }}/>
            </div>
          </>
        )}

        {assignment.requirements && (
          <>
            <div style={{ borderTop: `1px solid ${C.divider}` }}/>
            <div className="px-6 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Requirements</p>
              <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(assignment.requirements) }}/>
            </div>
          </>
        )}

        {resources.length > 0 && (
          <>
            <div style={{ borderTop: `1px solid ${C.divider}` }}/>
            <div className="px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: C.faint }}>Resources</p>
              <div className="flex flex-col gap-2">
                {resources.map((r: any) => (
                  <a key={r.id} href={r.url} target="_blank" rel="noreferrer"
                    className="group flex items-center gap-3 no-underline rounded-2xl px-4 py-3 transition-all"
                    style={{ background: C.pill, border: `1px solid ${C.divider}` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.page; (e.currentTarget as HTMLElement).style.borderColor = '#0e09dd33'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.pill; (e.currentTarget as HTMLElement).style.borderColor = C.divider; }}>
                    <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
                      style={{ background: r.resource_type === 'file' ? 'rgba(14,9,221,0.08)' : 'rgba(4,83,241,0.08)' }}>
                      {r.resource_type === 'file'
                        ? <FileText className="w-4 h-4" style={{ color: '#0e09dd' }}/>
                        : <ExternalLink className="w-4 h-4" style={{ color: '#0453f1' }}/>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium truncate" style={{ color: C.text }}>{r.name || r.url}</p>
                      {r.name && <p className="text-[11px] truncate mt-0.5" style={{ color: C.faint }}>{r.resource_type === 'file' ? 'File' : 'Link'}</p>}
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: C.faint }}/>
                  </a>
                ))}
              </div>
            </div>
          </>
        )}

      </div>
      )}

      {/* Group panel */}
      {isGroupAssignment && groupMembers.length > 0 && (
        <div className="rounded-2xl px-4 py-3 mb-4" style={{ background: C.card }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="inline-flex rounded-xl p-1" style={{ background: C.pill }}>
              {(['members', 'connect'] as const).map(tab => (
                <button key={tab} onClick={() => setGroupPanelTab(tab)}
                  className="px-4 py-1.5 rounded-lg text-xs font-bold transition-all"
                  style={{ background: groupPanelTab === tab ? C.card : 'transparent', color: groupPanelTab === tab ? C.text : C.muted, border: 'none', cursor: 'pointer', boxShadow: groupPanelTab === tab ? '0 1px 4px rgba(0,0,0,0.08)' : 'none' }}>
                  {tab === 'members' ? 'Members' : 'Connect'}
                </button>
              ))}
            </div>
            {groupPanelTab === 'members' && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: C.pill, color: C.muted }}>{groupMembers.length} members</span>
            )}
          </div>
          {groupPanelTab === 'members' && (
          <div className="flex items-center gap-3 flex-wrap pt-1">
            {groupMembers.map((m: any) => {
              const s = m.students ?? {};
              const isMe = m.student_id === userId;
              const initial = (s.full_name?.[0] ?? '?').toUpperCase();
              const isHovered = hoveredMember === m.id;
              return (
                <div key={m.id} className="relative flex-shrink-0"
                  onMouseEnter={(e) => { setHoveredMember(m.id); setPopupRect((e.currentTarget as HTMLElement).getBoundingClientRect()); }}
                  onMouseLeave={() => { setHoveredMember(null); setPopupRect(null); }}
                  onClick={(e) => {
                    if (isHovered) { setHoveredMember(null); setPopupRect(null); }
                    else { setHoveredMember(m.id); setPopupRect((e.currentTarget as HTMLElement).getBoundingClientRect()); }
                  }}>
                  {/* Avatar ring */}
                  <div className="w-12 h-12 rounded-full p-[2px] cursor-pointer"
                    style={{ background: isMe ? C.green : m.is_leader ? '#f59e0b' : C.pill }}>
                    <div className="w-full h-full rounded-full overflow-hidden" style={{ background: C.card }}>
                      {s.avatar_url
                        ? <img src={s.avatar_url} alt="" className="w-full h-full object-cover rounded-full"/>
                        : <div className="w-full h-full flex items-center justify-center text-sm font-bold rounded-full"
                            style={{ background: isMe ? `${C.green}22` : C.pill, color: isMe ? C.green : C.muted }}>
                            {initial}
                          </div>
                      }
                    </div>
                  </div>
                  {/* Leader star badge */}
                  {m.is_leader && (
                    <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center z-10"
                      style={{ background: '#f59e0b', boxShadow: '0 1px 4px rgba(245,158,11,0.5)' }}>
                      <Star className="w-2 h-2 fill-white" style={{ color: 'white' }}/>
                    </div>
                  )}
                  {/* Fixed-position profile popup - renders at viewport level, never clips */}
                  {isHovered && popupRect && (() => {
                    const POPUP_W = 176;
                    const vw = window.innerWidth;
                    const avatarCenterX = popupRect.left + popupRect.width / 2;
                    const rawLeft = avatarCenterX - POPUP_W / 2;
                    const left = Math.max(8, Math.min(vw - POPUP_W - 8, rawLeft));
                    const caretLeft = Math.round(avatarCenterX - left - 7);
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 6, scale: 0.94 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.15, ease: 'easeOut' }}
                        style={{ position: 'fixed', bottom: window.innerHeight - popupRect.top + 10, left, width: POPUP_W, zIndex: 9999, borderRadius: 16, padding: 12, background: C.card, border: `1px solid ${C.pill}`, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', transformOrigin: 'bottom center' }}>
                        <div className="flex flex-col items-center gap-1.5">
                          <div className="w-14 h-14 rounded-full overflow-hidden border-2"
                            style={{ borderColor: isMe ? C.green : m.is_leader ? '#f59e0b' : C.pill }}>
                            {s.avatar_url
                              ? <img src={s.avatar_url} alt="" loading="lazy" className="w-full h-full object-cover"/>
                              : <div className="w-full h-full flex items-center justify-center text-lg font-bold"
                                  style={{ background: isMe ? `${C.green}22` : C.pill, color: isMe ? C.green : C.muted }}>
                                  {initial}
                                </div>
                            }
                          </div>
                          <p className="text-sm font-semibold text-center leading-tight" style={{ color: C.text }}>{s.full_name ?? '--'}</p>
                          <div className="flex items-center justify-center gap-1.5 flex-wrap">
                            {m.is_leader && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#f59e0b18', color: '#f59e0b' }}>Leader</span>}
                            {isMe && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${C.green}18`, color: C.green }}>you</span>}
                          </div>
                        </div>
                        {/* Caret always points at the avatar center */}
                        <div style={{ position: 'absolute', top: '100%', left: caretLeft, width: 0, height: 0, borderLeft: '7px solid transparent', borderRight: '7px solid transparent', borderTop: `7px solid ${C.pill}` }}/>
                      </motion.div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
          )}
          {groupPanelTab === 'connect' && (
          <div className="pt-1">
            {isLeader && <div className="flex justify-end mb-4">
              <button
                onClick={saveWorkspace}
                disabled={workspaceSaving}
                className="px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 disabled:opacity-60"
                style={{ background: C.cta, color: C.ctaText, border: 'none', cursor: workspaceSaving ? 'not-allowed' : 'pointer' }}>
                {workspaceSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Check className="w-3.5 h-3.5"/>}
                Save Links
              </button>
            </div>}

            <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: C.faint }}>Meeting & File Links</p>
            <p className="text-sm mb-3 leading-relaxed" style={{ color: C.muted }}>{isLeader ? 'Add where the real collaboration will happen: WhatsApp, Google Meet, Zoom, Google Docs, Notion, GitHub, or similar.' : 'Use these links to join your group discussion or open the shared working document.'}</p>
            <div className="space-y-2">
              {isLeader ? workspaceLinks.map((link, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_28px] gap-2 items-center">
                  <input value={link.label ?? ''} onChange={e => setWorkspaceLinks(prev => prev.map((l, idx) => idx === i ? { ...l, label: e.target.value } : l))} placeholder={i === 0 ? 'WhatsApp / meeting / file' : 'Label'} style={{ minWidth: 0, padding: '10px 12px', borderRadius: 10, background: C.input, color: C.text, fontSize: 14, outline: 'none' }}/>
                  <input value={link.url} onChange={e => setWorkspaceLinks(prev => prev.map((l, idx) => idx === i ? { ...l, url: e.target.value } : l))} placeholder="https://..." style={{ minWidth: 0, padding: '10px 12px', borderRadius: 10, background: C.input, color: C.text, fontSize: 14, outline: 'none' }}/>
                  <button onClick={() => removeWorkspaceLink(i)} disabled={workspaceLinks.length === 1} className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30" style={{ background: C.pill, color: C.faint, border: 'none', cursor: workspaceLinks.length === 1 ? 'not-allowed' : 'pointer' }}>
                    <X className="w-3.5 h-3.5"/>
                  </button>
                </div>
              )) : workspaceLinks.filter(link => link.url.trim()).length > 0 ? (
                workspaceLinks.filter(link => link.url.trim()).map((link, i) => (
                  <a key={`${link.url}-${i}`} href={link.url.trim()} target="_blank" rel="noreferrer" className="flex items-center gap-3 no-underline rounded-xl px-3 py-2 transition-all" style={{ background: C.pill, border: `1px solid ${C.divider}`, color: C.text }}>
                    <ExternalLink className="w-4 h-4 flex-shrink-0" style={{ color: C.green }}/>
                    <div className="min-w-0 flex-1">
                      <p className="text-base font-semibold truncate" style={{ color: C.text }}>{link.label || 'Open meeting or file link'}</p>
                      <p className="text-sm truncate" style={{ color: C.faint }}>{link.url}</p>
                    </div>
                  </a>
                ))
              ) : (
                <p className="text-xs rounded-lg px-3 py-2" style={{ background: C.thumbBg, color: C.muted }}>No meeting or file link has been shared yet.</p>
              )}
            </div>
            {isLeader && <button onClick={() => setWorkspaceLinks(prev => [...prev, { url: '', label: '' }])} className="mt-2 text-xs font-medium flex items-center gap-1" style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.green, padding: 0 }}>
              <Plus className="w-3.5 h-3.5"/> Add meeting or file link
            </button>}

            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Optional Draft Notes</p>
              {isLeader ? (
                <RichTextEditor value={workspaceNotes} onChange={setWorkspaceNotes} placeholder="Optional: summarize decisions, divide responsibilities, or draft the final response. This is not meant to replace your group conversation." />
              ) : workspaceNotes ? (
                <div className="rounded-xl p-4" style={{ background: C.input }}>
                  <div className="rich-content text-sm" style={{ color: C.text }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(workspaceNotes) }}/>
                </div>
              ) : (
                <p className="text-xs rounded-lg px-3 py-2" style={{ background: C.thumbBg, color: C.muted }}>No draft notes have been shared yet.</p>
              )}
            </div>
            {workspaceError && <p className="text-xs mt-3" style={{ color: '#ef4444' }}>{workspaceError}</p>}
          </div>
          )}
        </div>
      )}

      {/* Group coordination */}
      {false && isGroupAssignment && myGroupId && (
        <div className="rounded-2xl mb-4 overflow-hidden" style={{ background: C.card }}>
          <button
            type="button"
            onClick={() => setWorkspaceOpen(v => !v)}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest mb-1" style={{ color: C.faint }}>Group Coordination</p>
              <p className="text-xs" style={{ color: C.muted }}>
                {workspaceOpen
                  ? isLeader ? 'Add meeting links, working document links, and optional draft notes for your group.' : 'Open meeting links and working documents shared by your group leader.'
                  : `${workspaceLinks.filter(l => l.url.trim()).length} meeting/file link${workspaceLinks.filter(l => l.url.trim()).length === 1 ? '' : 's'} · ${workspaceNotes ? 'draft notes saved' : 'no draft notes'}`}
              </p>
            </div>
            <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${workspaceOpen ? 'rotate-180' : ''}`} style={{ color: C.faint }}/>
          </button>

          {workspaceOpen && (
          <div className="px-5 pb-5">
            {isLeader && <div className="flex justify-end mb-4">
              <button
                onClick={saveWorkspace}
                disabled={workspaceSaving}
                className="px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 disabled:opacity-60"
                style={{ background: C.cta, color: C.ctaText, border: 'none', cursor: workspaceSaving ? 'not-allowed' : 'pointer' }}>
                {workspaceSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Check className="w-3.5 h-3.5"/>}
                Save Links
              </button>
            </div>}

          <div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: C.faint }}>Meeting & File Links</p>
              <p className="text-sm mb-3 leading-relaxed" style={{ color: C.muted }}>{isLeader ? 'Add where the real collaboration will happen: WhatsApp, Google Meet, Zoom, Google Docs, Notion, GitHub, or similar.' : 'Use these links to join your group discussion or open the shared working document.'}</p>
              <div className="space-y-2">
                {isLeader ? workspaceLinks.map((link, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_28px] gap-2 items-center">
                    <input
                      value={link.label ?? ''}
                      onChange={e => setWorkspaceLinks(prev => prev.map((l, idx) => idx === i ? { ...l, label: e.target.value } : l))}
                      placeholder={i === 0 ? 'WhatsApp / meeting / file' : 'Label'}
                      style={{ minWidth: 0, padding: '10px 12px', borderRadius: 10, background: C.input, color: C.text, fontSize: 14, outline: 'none' }}
                    />
                    <input
                      value={link.url}
                      onChange={e => setWorkspaceLinks(prev => prev.map((l, idx) => idx === i ? { ...l, url: e.target.value } : l))}
                      placeholder="https://..."
                      style={{ minWidth: 0, padding: '10px 12px', borderRadius: 10, background: C.input, color: C.text, fontSize: 14, outline: 'none' }}
                    />
                    <button onClick={() => removeWorkspaceLink(i)} disabled={workspaceLinks.length === 1}
                      className="w-7 h-7 rounded-lg flex items-center justify-center disabled:opacity-30"
                      style={{ background: C.pill, color: C.faint, border: 'none', cursor: workspaceLinks.length === 1 ? 'not-allowed' : 'pointer' }}>
                      <X className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                )) : workspaceLinks.filter(link => link.url.trim()).length > 0 ? (
                  workspaceLinks.filter(link => link.url.trim()).map((link, i) => (
                    <a key={`${link.url}-${i}`} href={link.url.trim()} target="_blank" rel="noreferrer"
                      className="flex items-center gap-3 no-underline rounded-xl px-3 py-2 transition-all"
                      style={{ background: C.pill, border: `1px solid ${C.divider}`, color: C.text }}>
                      <ExternalLink className="w-4 h-4 flex-shrink-0" style={{ color: C.green }}/>
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-semibold truncate" style={{ color: C.text }}>{link.label || 'Open meeting or file link'}</p>
                        <p className="text-sm truncate" style={{ color: C.faint }}>{link.url}</p>
                      </div>
                    </a>
                  ))
                ) : (
                  <p className="text-xs rounded-lg px-3 py-2" style={{ background: C.thumbBg, color: C.muted }}>No meeting or file link has been shared yet.</p>
                )}
              </div>
              {isLeader && <button onClick={() => setWorkspaceLinks(prev => [...prev, { url: '', label: '' }])}
                className="mt-2 text-xs font-medium flex items-center gap-1"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.green, padding: 0 }}>
                <Plus className="w-3.5 h-3.5"/> Add meeting or file link
              </button>}
            </div>
          </div>

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Optional Draft Notes</p>
            {isLeader ? (
              <RichTextEditor value={workspaceNotes} onChange={setWorkspaceNotes} placeholder="Optional: summarize decisions, divide responsibilities, or draft the final response. This is not meant to replace your group conversation." />
            ) : workspaceNotes ? (
              <div className="rounded-xl p-4" style={{ background: C.input }}>
                <div className="rich-content text-sm" style={{ color: C.text }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(workspaceNotes) }}/>
              </div>
            ) : (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: C.thumbBg, color: C.muted }}>No draft notes have been shared yet.</p>
            )}
          </div>
          {workspaceError && <p className="text-xs mt-3" style={{ color: '#ef4444' }}>{workspaceError}</p>}
          </div>
          )}
        </div>
      )}

      {/* Participant selection -- all group assignment types, leader only */}
      {!loadingSub && isGroupAssignment && isLeader && groupMembers.length > 0 && !isGraded && (
        <div className="rounded-2xl p-4 mb-4" style={{ background: C.card }}>
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: C.faint }}>Mark Participants</p>
          <p className="text-xs mb-3" style={{ color: C.muted }}>Indicate the members who participated in this assignment. Only checked members will receive this grade.</p>
          <div className="flex flex-col gap-2">
            {groupMembers.map((m: any) => {
              const s = m.students ?? {};
              return (
                <label key={m.student_id} className="flex items-center gap-3 cursor-pointer rounded-xl px-3 py-2"
                  style={{ background: C.page, border: `1px solid ${C.divider}` }}>
                  <input type="checkbox" checked={selectedParticipants.includes(m.student_id)}
                    onChange={() => toggleParticipant(m.student_id)}
                    style={{ width: 15, height: 15, accentColor: C.cta, cursor: 'pointer' }}/>
                  <span className="text-sm" style={{ color: C.text }}>{s.full_name}</span>
                  {m.is_leader && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#f59e0b22', color: '#f59e0b' }}>Leader</span>}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* AI / VE tools -- rendered outside the card, full-width */}
      {!loadingSub && isAiType && (
        <div className="mb-4">
          {/* Graded state shown above the player */}
          {isGraded && (
            <div className="rounded-2xl p-5 mb-4" style={{ background: C.card }}>
              {(() => {
                const passed = submission.score != null && submission.score >= 85;
                const failed = submission.score != null && submission.score < 85;
                return (
                  <>
                    <div className="flex items-center gap-3 flex-wrap mb-2">
                      <StatusBadge status="graded"/>
                      {submission.score != null && <span className="text-sm font-semibold" style={{ color: passed ? '#10b981' : '#ef4444' }}>Score: {submission.score}</span>}
                      {passed && <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>Passed</span>}
                      {failed && <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.10)', color: '#ef4444' }}>Failed</span>}
                    </div>
                    {submission.feedback && (
                      <div className="rounded-xl p-4" style={{ background: passed ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.07)', border: `1px solid ${passed ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.22)'}` }}>
                        <p className="text-xs font-semibold mb-1" style={{ color: passed ? '#10b981' : '#ef4444' }}>Instructor Feedback</p>
                        <div className="rich-content text-sm" dangerouslySetInnerHTML={{ __html: sanitizeRichText(submission.feedback) }}/>
                      </div>
                    )}
                    {failed && (
                      <button onClick={handleResubmit} disabled={submitting}
                        className="mt-3 w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                        style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1.5px solid rgba(239,68,68,0.25)' }}>
                        {submitting ? <Loader2 className="w-4 h-4 animate-spin"/> : <RefreshCw className="w-4 h-4"/>}
                        Resubmit Assignment
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {isGroupAssignment && !isLeader && (
            <p className="text-xs text-center py-2 px-4 rounded-xl mb-3" style={{ background: C.thumbBg, color: C.muted }}>
              You can work through this assignment to prepare. Your group leader will submit for the group.
            </p>
          )}
          {assignmentType === 'code_review' && (
            <CodeReviewPlayer
              reqId={assignment.id}
              isDark={isDark}
              accentColor={C.green}
              completed={isGraded || isSubmitted}
              savedResult={(() => { const rep = parseReviewNotes(submission?.response_text)?.report; return isFullReport('code_review', rep) ? rep : undefined; })()}
              rubric={assignment.config?.rubric}
              schema={assignment.config?.schema}
              minScore={assignment.config?.minScore}
              onComplete={isGroupAssignment && !isLeader ? () => {} : (result: any) => autoSubmit(result.overallScore, buildReviewNotes('code_review', result, submission?.response_text))}
            />
          )}
          {assignmentType === 'excel_review' && (
            <ExcelReviewPlayer
              reqId={assignment.id}
              isDark={isDark}
              accentColor={C.green}
              completed={isGraded || isSubmitted}
              savedResult={(() => { const rep = parseReviewNotes(submission?.response_text)?.report; return isFullReport('excel_review', rep) ? rep : undefined; })()}
              rubric={assignment.config?.rubric}
              context={assignment.config?.context}
              minScore={assignment.config?.minScore}
              onComplete={isGroupAssignment && !isLeader ? () => {} : (result: any) => autoSubmit(result.overallScore, buildReviewNotes('excel_review', result, submission?.response_text))}
            />
          )}
          {assignmentType === 'dashboard_critique' && (
            <DashboardCritiquePlayer
              reqId={assignment.id}
              isDark={isDark}
              accentColor={C.green}
              completed={isGraded || isSubmitted}
              savedResult={parseReviewNotes(submission?.response_text)?.report}
              rubric={assignment.config?.rubric}
              onComplete={isGroupAssignment && !isLeader ? () => {} : (result: any) => autoSubmit(result.audit?.overallScore ?? null, buildReviewNotes('dashboard_critique', result, submission?.response_text))}
            />
          )}
          {assignmentType === 'document_review' && (
            <DocumentReviewPlayer
              reqId={assignment.id}
              isDark={isDark}
              accentColor={C.green}
              completed={isGraded || isSubmitted}
              savedResult={(() => { if ((assignment.config?.documentReviewMode ?? 'ai_only') === 'manual') return undefined; const rep = parseReviewNotes(submission?.response_text)?.report; return isFullReport('document_review', rep) ? rep : undefined; })()}
              rubric={assignment.config?.rubric}
              context={assignment.config?.context}
              minScore={assignment.config?.minScore}
              documentReviewMode={assignment.config?.documentReviewMode ?? 'ai_only'}
              onComplete={isGroupAssignment && !isLeader ? () => {} : (result: any) => autoSubmit(result.overallScore || null, buildReviewNotes('document_review', result, submission?.response_text, { documentReviewMode: assignment.config?.documentReviewMode ?? 'ai_only' }))}
            />
          )}
        </div>
      )}

      {/* VE player */}
      {!loadingSub && isVeType && (
        <div className="mb-4" style={{ fontFamily: "'Google Sans', 'Inter', sans-serif" }}>
          {isGraded && (
            <div className="rounded-2xl p-5 mb-4" style={{ background: C.card }}>
              <div className="flex items-center gap-3">
                <StatusBadge status="graded"/>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>Completed</span>
              </div>
              {submission.feedback && (
                <div className="mt-3 rounded-xl p-4" style={{ background: 'rgba(16,185,129,0.08)' }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: '#10b981' }}>Instructor Feedback</p>
                  <div className="rich-content text-sm" dangerouslySetInnerHTML={{ __html: sanitizeRichText(submission.feedback) }}/>
                </div>
              )}
            </div>
          )}
          {veLoading && <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: C.faint }}/></div>}
          {!veLoading && !veForm && <p className="text-sm text-center py-6" style={{ color: C.faint }}>Virtual Experience not found.</p>}
          {!veLoading && veForm && (
            <>
              {isGroupAssignment && !isLeader && (
                <p className="text-xs text-center py-2 px-4 rounded-xl mb-3" style={{ background: C.thumbBg, color: C.muted }}>
                  You can work through this experience to prepare. Your group leader will submit for the group.
                </p>
              )}
              <AssignmentExperiencePlayer
                formId={veForm.id}
                config={veForm.config}
                userId={userId}
                studentName={studentName}
                studentEmail={studentEmail}
                sessionToken={sessionToken}
                assignmentId={assignment.id}
                initialProgress={veProgress}
                graded={isGraded}
                isDark={isDark}
                groupId={isGroupAssignment && isLeader ? myGroupId ?? undefined : undefined}
                participants={isGroupAssignment && isLeader ? selectedParticipants : undefined}
                canSubmit={!isGroupAssignment || isLeader}
                submitted={isSubmitted}
                onComplete={isGroupAssignment && !isLeader ? () => {} : (submission) => { if (submission) setSubmission(submission); }}
              />
            </>
          )}
        </div>
      )}

      {/* Submission panel -- standard type only */}
      {assignmentType === 'standard' && (
      <div className="rounded-2xl p-6" style={{ background: C.card }}>
        <h3 className="text-sm font-bold mb-4" style={{ color: C.text }}>
          {isGroupAssignment ? 'Group Submission' : 'Your Submission'}
        </h3>
        {loadingSub ? (
          <div className="space-y-2"><Sk h={14} w="60%"/><Sk h={100}/></div>
        ) : isGroupAssignment && !isLeader && !isGraded ? (
          <div>
            {submission ? (
              <>
                <div className="mb-4 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: C.thumbBg, color: C.muted }}>
                  Final group submission preview. Only selected participants receive the grade when this is graded.
                </div>
                {submission.response_text ? (
                  <div className="rounded-xl p-4 mb-4" style={{ background: C.input }}>
                    <div className="rich-content text-sm" style={{ color: C.text }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(submission.response_text) }}/>
                  </div>
                ) : (
                  <p className="text-sm mb-4" style={{ color: C.faint }}>No written response was included.</p>
                )}
                {savedFiles.length > 0 && (
                  <div className="mb-4 flex flex-col gap-2">
                    {savedFiles.map(f => (
                      <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer"
                        className="group flex items-center gap-3 no-underline rounded-2xl px-4 py-3 transition-all"
                        style={{ background: C.pill, border: `1px solid ${C.divider}` }}>
                        <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
                          style={{ background: f.file_name ? 'rgba(16,185,129,0.10)' : 'rgba(4,83,241,0.08)' }}>
                          {f.file_name ? <FileText className="w-4 h-4" style={{ color: '#10b981' }}/> : <ExternalLink className="w-4 h-4" style={{ color: '#0453f1' }}/>}
                        </div>
                        <span className="text-[13px] font-medium flex-1 truncate" style={{ color: C.text }}>{f.file_name || f.file_url}</span>
                        <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: C.faint }}/>
                      </a>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-xs rounded-lg px-3 py-2" style={{ background: C.thumbBg, color: C.muted }}>
                Only your group leader can submit the final work. Use the shared workspace above to prepare with your group, and you can view the submission here once it has been made.
              </p>
            )}
          </div>
        ) : isGraded ? (
          <div>
            {submission.response_text && (
              <div className="rounded-xl p-4 mb-4" style={{ background: C.input }}>
                <div className="rich-content text-sm" style={{ color: C.text }} dangerouslySetInnerHTML={{ __html: sanitizeRichText(submission.response_text) }}/>
              </div>
            )}
            {savedFiles.length > 0 && (
              <div className="mb-4 flex flex-col gap-2">
                {savedFiles.map(f => (
                  <a key={f.id} href={f.file_url} target="_blank" rel="noreferrer"
                    className="group flex items-center gap-3 no-underline rounded-2xl px-4 py-3 transition-all"
                    style={{ background: C.pill, border: `1px solid ${C.divider}` }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = C.page; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = C.pill; }}>
                    <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
                      style={{ background: f.file_name ? 'rgba(16,185,129,0.10)' : 'rgba(4,83,241,0.08)' }}>
                      {f.file_name ? <FileText className="w-4 h-4" style={{ color: '#10b981' }}/> : <ExternalLink className="w-4 h-4" style={{ color: '#0453f1' }}/>}
                    </div>
                    <span className="text-[13px] font-medium flex-1 truncate" style={{ color: C.text }}>{f.file_name || f.file_url}</span>
                    <ExternalLink className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: C.faint }}/>
                  </a>
                ))}
              </div>
            )}
            {(() => {
              const passed = submission.score != null && submission.score >= 85;
              const failed = submission.score != null && submission.score < 85;
              return (
                <>
                  <div className="flex items-center gap-3 flex-wrap">
                    <StatusBadge status="graded"/>
                    {submission.score != null && (
                      <span className="text-sm font-semibold" style={{ color: passed ? '#10b981' : '#ef4444' }}>
                        Score: {submission.score}
                      </span>
                    )}
                    {passed && <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981' }}>Passed</span>}
                    {failed && <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.10)', color: '#ef4444' }}>Failed</span>}
                  </div>
                  {submission.feedback && (
                    <div className="mt-3 rounded-xl p-4"
                      style={{ background: passed ? 'rgba(16,185,129,0.08)' : failed ? 'rgba(239,68,68,0.07)' : C.thumbBg }}>
                      <p className="text-xs font-semibold mb-1" style={{ color: passed ? '#10b981' : failed ? '#ef4444' : C.faint }}>Instructor Feedback</p>
                      <div className="rich-content text-sm" dangerouslySetInnerHTML={{ __html: sanitizeRichText(submission.feedback) }}/>
                    </div>
                  )}
                  {failed && (
                    <button
                      onClick={handleResubmit}
                      disabled={submitting}
                      className="mt-4 w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
                      style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1.5px solid rgba(239,68,68,0.25)' }}
                    >
                      {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                      Resubmit Assignment
                    </button>
                  )}
                </>
              );
            })()}
          </div>
        ) : (
          <div>
            {isSubmitted && (
              <div className="mb-4 px-3 py-2 rounded-lg text-xs font-medium" style={{ background: C.thumbBg, color: C.green }}>
                Submitted - you can still edit and resubmit until graded.
              </div>
            )}

            {/* Response text */}
            <div className="mb-4">
              <RichTextEditor value={responseText} onChange={setResponseText} placeholder="Write your response here…" />
            </div>

            {/* Saved attachments (editable) */}
            {savedFiles.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: C.faint }}>Saved Attachments</p>
                <div className="flex flex-col gap-2">
                  {savedFiles.map(f => (
                    <div key={f.id} className="flex items-center gap-3 rounded-2xl px-4 py-3"
                      style={{ background: C.pill, border: `1px solid ${C.divider}` }}>
                      <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center"
                        style={{ background: f.file_name ? 'rgba(16,185,129,0.10)' : 'rgba(4,83,241,0.08)' }}>
                        {f.file_name ? <FileText className="w-4 h-4" style={{ color: '#10b981' }}/> : <ExternalLink className="w-4 h-4" style={{ color: '#0453f1' }}/>}
                      </div>
                      <a href={f.file_url} target="_blank" rel="noreferrer"
                        className="flex-1 truncate text-[13px] font-medium hover:underline"
                        style={{ color: C.text }}>{f.file_name || f.file_url}</a>
                      <button onClick={() => removeSavedFile(f.id)}
                        className="flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center transition-colors"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint }}>
                        <X className="w-3.5 h-3.5"/>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Links */}
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Add Links</p>
              <div className="space-y-2">
                {links.map((link, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input
                      type="url" value={link} onChange={e => setLinks(prev => prev.map((l, idx) => idx === i ? e.target.value : l))}
                      placeholder="https://github.com/your-repo"
                      style={{ flex: 1, padding: '8px 12px', borderRadius: 10, background: C.input, color: C.text, fontSize: 13, outline: 'none' }}
                    />
                    {links.length > 1 && (
                      <button onClick={() => removeLink(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint }}>
                        <X className="w-4 h-4"/>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button onClick={() => setLinks(prev => [...prev, ''])}
                className="mt-2 text-xs font-medium flex items-center gap-1"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.green, padding: 0 }}>
                <Plus className="w-3.5 h-3.5"/> Add another link
              </button>
            </div>

            {/* File upload */}
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: C.faint }}>Upload Files</p>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium"
                style={{ background: C.pill, color: C.muted, border: `1px solid ${C.divider}`, cursor: 'pointer' }}>
                <Upload className="w-4 h-4"/> Choose files
              </button>
              {readyFiles.length > 0 && (
                <div className="mt-2 space-y-1">
                  {readyFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg"
                      style={{ background: f.status === 'done' ? 'rgba(16,185,129,0.08)' : f.status === 'error' ? 'rgba(239,68,68,0.08)' : C.page, border: `1px solid ${f.status === 'done' ? 'rgba(16,185,129,0.25)' : f.status === 'error' ? 'rgba(239,68,68,0.25)' : C.divider}` }}>
                      {f.status === 'uploading' && <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" style={{ color: C.faint }}/>}
                      {f.status === 'done' && <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#10b981' }}/>}
                      {f.status === 'error' && <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" style={{ color: '#ef4444' }}/>}
                      <span className="flex-1 truncate" style={{ color: f.status === 'done' ? '#10b981' : f.status === 'error' ? '#ef4444' : C.muted }}>
                        {f.name}{f.status === 'uploading' ? ' - uploading...' : f.status === 'done' ? ' - uploaded' : ` - failed: ${f.error}`}
                      </span>
                      {f.status !== 'uploading' && (
                        <button type="button" onClick={() => removeReadyFile(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.faint, padding: 0 }}>
                          <X className="w-3 h-3"/>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {submitError && <p className="text-xs mb-3" style={{ color: '#ef4444' }}>{submitError}</p>}

            {(!isGroupAssignment || isLeader) && (
              inStudentMode ? (
                <p className="text-xs" style={{ color: C.faint }}>Submitting is disabled in Student Mode.</p>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => handleSubmit(true)} disabled={submitting}
                    className="px-4 py-2 rounded-xl text-sm font-semibold"
                    style={{ background: C.pill, color: C.muted, border: `1px solid ${C.divider}`, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.6 : 1 }}>
                    Save Draft
                  </button>
                  <button onClick={() => handleSubmit(false)} disabled={submitting || uploading || !hasContent}
                    className="px-5 py-2 rounded-xl text-sm font-semibold dashboard-cta"
                    style={{ background: C.cta, color: C.ctaText, border: 'none', cursor: (submitting || uploading || !hasContent) ? 'not-allowed' : 'pointer', opacity: (submitting || uploading || !hasContent) ? 0.6 : 1 }}>
                    {submitting ? 'Submitting...' : uploading ? 'Uploading...' : isSubmitted ? 'Resubmit' : 'Submit'}
                  </button>
                </div>
              )
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export function AssignmentsSection({ userId, studentName, studentEmail, C }: { userId: string; studentName: string; studentEmail: string; C: typeof LIGHT_C }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [{ data: student }, { data: gmRow }] = await Promise.all([
        supabase.from('students').select('cohort_id').eq('id', userId).maybeSingle(),
        supabase.from('group_members').select('group_id').eq('student_id', userId).maybeSingle(),
      ]);
      if (!student?.cohort_id) { setLoading(false); return; }

      const myGroupId: string | null = gmRow?.group_id ?? null;

      // Build assignment filter: cohort match OR group match
      let assignmentQuery = supabase.from('assignments')
        .select('id, title, scenario, brief, tasks, requirements, cover_image, status, created_at, deadline_date, related_course, type, config, group_ids')
        .eq('status', 'published')
        .order('created_at', { ascending: false });

      if (myGroupId) {
        assignmentQuery = assignmentQuery.or(
          `cohort_ids.cs.{${student.cohort_id}},group_ids.cs.{${myGroupId}}`
        );
      } else {
        assignmentQuery = assignmentQuery.contains('cohort_ids', [student.cohort_id]);
      }

      // Submissions: individual + any group submission for this student's group
      let subsQuery = supabase
        .from('assignment_submissions')
        .select('assignment_id, status, score, group_id, participants');
      if (myGroupId) {
        subsQuery = subsQuery.or(`student_id.eq.${userId},group_id.eq.${myGroupId}`);
      } else {
        subsQuery = subsQuery.eq('student_id', userId);
      }

      const [{ data: assignments }, { data: subs }] = await Promise.all([
        assignmentQuery,
        subsQuery,
      ]);

      // Resolve related course data from courses table
      const courseIds = [...new Set((assignments ?? []).map((a: any) => a.related_course).filter(Boolean))];
      let courseMap: Record<string, { title: string; slug: string; coverImage?: string }> = {};
      if (courseIds.length) {
        const { data: courseRows } = await supabase.from('courses').select('id, title, slug, cover_image').in('id', courseIds);
        courseMap = Object.fromEntries((courseRows ?? []).map((c: any) => [c.id, {
          title: c.title,
          slug: c.slug,
          coverImage: c.cover_image || null,
        }]));
      }

      const subMap = Object.fromEntries((subs ?? [])
        .filter((s: any) => !s.group_id || (Array.isArray(s.participants) && s.participants.includes(userId)))
        .map(s => [s.assignment_id, s]));
      setItems((assignments ?? []).map((a: any) => ({
        ...a,
        _sub: subMap[a.id] ?? null,
        _course_title:  a.related_course ? (courseMap[a.related_course]?.title ?? null) : null,
        _course_slug:   a.related_course ? (courseMap[a.related_course]?.slug ?? null) : null,
        _course_cover:  a.related_course ? (courseMap[a.related_course]?.coverImage ?? null) : null,
      })));
      setLoading(false);
    };
    load();
  }, [userId, refreshKey]);

  if (selected) return <AssignmentDetail assignment={selected} userId={userId} studentName={studentName} studentEmail={studentEmail} C={C} onBack={() => { setSelected(null); setRefreshKey(k => k + 1); }}/>;

  const skCard = (
    <div className="rounded-2xl overflow-hidden" style={{ background: C.card }}>
      <Sk h={140} r={0}/><div className="p-4 space-y-2"><Sk h={15} w="70%"/><Sk h={11} w="50%"/></div>
    </div>
  );

  if (loading) return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{[0,1,2,3].map(i => <div key={i}>{skCard}</div>)}</div>;

  if (!items.length) return (
    <EmptyState icon={ClipboardList} title="No assignments" body="You do not have any assignments assigned yet."/>
  );

  const AssignmentCard = ({ item, i }: { item: any; i: number }) => {
    const isSubmitted = item._sub && item._sub.status !== 'draft';
    const nowMs = Date.now();
    const daysLeft = (item.deadline_date && !isSubmitted)
      ? Math.ceil((new Date(item.deadline_date).getTime() - nowMs) / 86400000)
      : null;
    const deadlineLabel = daysLeft === null ? null
      : daysLeft < 0  ? 'Overdue'
      : daysLeft === 0 ? 'Due today'
      : `${daysLeft}d left`;
    const deadlineColor = daysLeft === null ? null
      : daysLeft < 0  ? '#ef4444'
      : daysLeft <= 3 ? '#f59e0b'
      : '#6b7280';

    return (
    <motion.button key={item.id} onClick={() => setSelected(item)}
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
      className="text-left rounded-2xl overflow-hidden group"
      style={{ background: C.card, cursor: 'pointer' }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = C.hoverShadow)}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = C.cardShadow)}>
      <div className="relative h-40 overflow-hidden" style={{ background: C.thumbBg }}>
        <div className="absolute inset-0 flex items-center justify-center text-4xl font-black" style={{ color: C.green, opacity: 0.25 }}>{item.title?.[0]?.toUpperCase()}</div>
        {item.cover_image && <img src={resolveCoverUrl(item.cover_image)} alt={item.title} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" onError={e => (e.currentTarget.style.display = 'none')}/>}
        {(item.group_ids?.length > 0) && (
          <div className="absolute top-2 left-2">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: C.cta, color: C.ctaText, backdropFilter: 'blur(4px)' }}>
              <Users className="w-3 h-3"/> Group
            </span>
          </div>
        )}
        {item._sub && (
          <div className="absolute top-2 right-2">
            {item._sub.status === 'graded'
              ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: item._sub.score >= 85 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: item._sub.score >= 85 ? '#10b981' : '#ef4444', border: `1px solid ${item._sub.score >= 85 ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                  {item._sub.score >= 85 ? 'Passed' : 'Failed'}
                </span>
              : item._sub.status === 'submitted'
              ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(124,58,237,0.12)', color: '#7c3aed', border: '1px solid rgba(124,58,237,0.25)' }}>
                  Submitted
                </span>
              : item._sub.status === 'draft'
              ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: 'rgba(0,0,0,0.08)', color: '#888', border: '1px solid rgba(0,0,0,0.12)' }}>
                  Draft
                </span>
              : null}
          </div>
        )}
      </div>
      <div className="px-3 py-2.5">
        <h3 className="text-sm font-semibold leading-snug mb-1" style={{ color: C.text }}>{item.title}</h3>
        {deadlineLabel && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full mb-2"
            style={{ background: `${deadlineColor ?? '#6b7280'}18`, color: deadlineColor ?? '#6b7280' }}>
            ⏰ {deadlineLabel}
          </span>
        )}
        <div className="flex items-center justify-between">
          {!item._sub
            ? <span className="text-[11px] font-medium" style={{ color: C.muted }}>Not Submitted</span>
            : item._sub.status === 'graded'
            ? <span className="text-[11px] font-semibold" style={{ color: item._sub.score >= 85 ? '#10b981' : '#ef4444' }}>Graded · {item._sub.score}%</span>
            : item._sub.status === 'submitted'
            ? <span className="text-[11px] font-semibold" style={{ color: '#7c3aed' }}>Submitted</span>
            : <span className="text-[11px] font-medium" style={{ color: C.muted }}>Not Submitted</span>}
          <span className="inline-block text-xs font-semibold px-4 py-1.5 rounded-full" style={{ background: C.green, color: '#fff' }}>
            {!item._sub || item._sub.status === 'draft' ? 'Start' : 'View'}
          </span>
        </div>
      </div>
    </motion.button>
  );
  };

  // Group by course
  const grouped: Record<string, any[]> = {};
  for (const item of items) {
    const key = item._course_title ?? '__none__';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  }
  const courseKeys = Object.keys(grouped).filter(k => k !== '__none__').sort();
  if (grouped['__none__']) courseKeys.push('__none__');

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: C.text }}>Assignments</h1>
      </div>
      {courseKeys.map(key => (
        <div key={key}>
          <div className="flex items-center gap-2 mb-4">
            {key !== '__none__'
              ? <><BookOpen className="w-3.5 h-3.5" style={{ color: C.green }}/><p className="text-xs font-bold uppercase tracking-widest" style={{ color: C.green }}>{key}</p></>
              : <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.faint }}>General</p>
            }
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: C.pill, color: C.faint }}>{grouped[key].length}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {grouped[key].map((item, i) => <AssignmentCard key={item.id} item={item} i={i}/>)}
          </div>
        </div>
      ))}
    </div>
  );
}
