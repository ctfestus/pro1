'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { uploadCoverImage } from '@/lib/uploadToCloudinary';
import { resolveCoverUrl } from '@/lib/cloudinary-url';
import { ImageLibrary } from '@/components/ImageLibrary';
import { LIGHT_C, DARK_C, useC } from '@/lib/theme';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Plus, Trash2, Loader2, Save, Link as LinkIcon, Upload, X, Briefcase, ClipboardList, Eye, Images, FileText, Blocks, Video, FolderOpen, Settings, CheckCircle2, Circle, ChevronLeft, ChevronRight } from 'lucide-react';
import dynamic from 'next/dynamic';
const AssignmentExperiencePlayer = dynamic(() => import('@/components/AssignmentExperiencePlayer'), { ssr: false });
const StandardAssignmentPlayer = dynamic(() => import('@/components/StandardAssignmentPlayer'), { ssr: false });
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RichTextEditor } from '@/components/RichTextEditor';
import { LessonEditor } from '@/components/lesson/LessonEditor';
import { sanitizeRichText, sanitizePlainText } from '@/lib/sanitize';
import { ScenariosEditor } from '@/components/create/ScenariosEditor';
import type { AssignmentScenario } from '@/lib/assignment-scenarios';
import { stripAnswerKeys, extractAnswerKeys, validateScenarioConfig, DEFAULT_PASS_MARK } from '@/lib/assignment-scenarios';
import { ALLOWED_SOLUTION_EXTENSIONS, isAllowedSolutionFile, isCompleteSolution, requestSolutionCleanup } from '@/lib/assignment-solutions';
import type { LessonDoc } from '@/lib/lesson-doc';


type AssignmentType = 'standard' | 'code_review' | 'excel_review' | 'dashboard_critique' | 'virtual_experience' | 'document_review';

// The two types offered when creating a NEW assignment. A Standard assignment is now built
// from scenarios + tasks (any mix of formats). The legacy single-purpose AI types below are
// no longer offered up front, but existing assignments of those types stay fully editable.
const ASSIGNMENT_TYPES: { value: AssignmentType; label: string; icon: React.ReactNode; description: string }[] = [
  { value: 'standard',            label: 'Standard',           icon: <ClipboardList style={{ width: 15, height: 15 }}/>,    description: 'Build scenarios and tasks of any kind (written, upload, multiple choice, AI review)' },
  { value: 'virtual_experience',  label: 'Virtual Experience', icon: <Briefcase style={{ width: 15, height: 15 }}/>,        description: 'Embed a full virtual experience' },
];

// Labels for every type, including the retired ones, so an existing legacy assignment still
// shows a correct badge when edited.
const LEGACY_TYPE_LABELS: Record<string, string> = {
  code_review: 'Code Review', excel_review: 'Excel Review',
  dashboard_critique: 'Dashboard', document_review: 'Document Review',
};

interface Resource {
  id: string;
  name: string;
  url: string;
  resource_type: 'link' | 'file';
}

// A solution entry being authored. Files are uploaded to the private solutions bucket as soon as
// they are picked (`storage_path` is what gets stored); links carry a URL instead.
interface SolutionDraft {
  id: string;
  name: string;
  kind: 'file' | 'link';
  storage_path?: string;
  url?: string;
}

interface Course {
  id: string;
  title: string;
}

interface VEForm {
  id: string;
  title: string;
  slug: string;
}

// "relation does not exist" / "not in the schema cache" -- the solutions table (migration 144) has
// not been applied on this environment.
function isMissingSolutionsTable(err: any): boolean {
  const code = err?.code ?? '';
  return code === '42P01' || code === 'PGRST205' || /schema cache/i.test(err?.message ?? '');
}

function inputStyle(C: typeof LIGHT_C) {
  return {
    width: '100%', minHeight: 46, padding: '11px 14px', borderRadius: 12, border: `1px solid ${C.cardBorder}`,
    background: C.card, color: C.text, fontSize: 13.5, outline: 'none',
    boxShadow: '0 1px 0 rgba(15,23,42,.02)', transition: 'border-color .15s ease, box-shadow .15s ease',
  } as React.CSSProperties;
}
function textareaStyle(C: typeof LIGHT_C) {
  return { ...inputStyle(C), minHeight: 112, resize: 'vertical' as const, lineHeight: 1.6, fontFamily: 'inherit' };
}
function labelStyle(C: typeof LIGHT_C) {
  return { display: 'block', fontSize: 12, fontWeight: 750, color: C.muted, marginBottom: 8, letterSpacing: '.01em' } as React.CSSProperties;
}
function hintStyle(C: typeof LIGHT_C) {
  return { fontSize: 11.5, lineHeight: 1.5, color: C.faint, marginTop: 6 } as React.CSSProperties;
}

export default function CreateAssignmentPage() {
  const activePalette = useC();
  const isDark = activePalette.page === DARK_C.page;
  // Keep Assignment Studio green in light mode without changing the tenant palette elsewhere.
  // Dark mode retains its existing canonical ocean accent.
  const C = isDark ? activePalette : LIGHT_C;
  const router = useRouter();

  const [editId, setEditId]       = useState<string | null>(null);
  const [activeStudioTab, setActiveStudioTab] = useState<'type' | 'build' | 'content' | 'resources' | 'settings' | 'publish'>('type');
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [courses, setCourses]     = useState<Course[]>([]);
  const [veForms, setVeForms]     = useState<VEForm[]>([]);

  // Assignment type + config
  const [assignmentType, setAssignmentType] = useState<AssignmentType>('standard');
  const [rubricText, setRubricText]         = useState('');        // one criterion per line
  const [minScore, setMinScore]             = useState<number>(70);
  const [passingScore, setPassingScore]     = useState<number>(DEFAULT_PASS_MARK); // submission pass grade
  const [schema, setSchema]                 = useState('');        // for code_review
  const [context, setContext]               = useState('');        // for excel_review
  const [veFormId, setVeFormId]             = useState('');        // for virtual_experience
  const [scenarios, setScenarios]           = useState<AssignmentScenario[]>([]); // for standard
  const [introDoc, setIntroDoc]             = useState<LessonDoc | undefined>(undefined); // standard overview (interactive)
  const [introBody, setIntroBody]           = useState('');   // HTML fallback of introDoc

  // Core fields
  const [title, setTitle]                         = useState('');
  const [scenario, setScenario]                   = useState('');
  const [brief, setBrief]                         = useState('');
  const [tasks, setTasks]                         = useState('');
  const [requirements, setRequirements]           = useState('');
  const [submissionInstructions, setSubmissionInstructions] = useState('');
  const [relatedCourse, setRelatedCourse]         = useState('');
  const [coverImage, setCoverImage]               = useState('');
  const [showCoverLibrary, setShowCoverLibrary]   = useState(false);
  const [status, setStatus]                       = useState<'draft' | 'published'>('draft');
  const [originalStatus, setOriginalStatus]       = useState<'draft' | 'published'>('draft');
  const [resources, setResources]                 = useState<Resource[]>([]);
  const [solutions, setSolutions]                 = useState<SolutionDraft[]>([]);
  const [solutionUploading, setSolutionUploading] = useState(false);
  // Every solution file this assignment referenced when the editor opened, plus anything uploaded
  // since. After a successful save these are offered for cleanup: whatever the saved assignment no
  // longer references gets removed from the private bucket (the server re-checks, so a file another
  // assignment still uses is kept).
  const uploadedSolutionPaths = useRef<Set<string>>(new Set());
  const [cohorts, setCohorts]                     = useState<{ id: string; name: string }[]>([]);
  const [selectedCohortIds, setSelectedCohortIds] = useState<string[]>([]);
  const [originalCohortIds, setOriginalCohortIds] = useState<string[]>([]);
  const [groups, setGroups]                       = useState<{ id: string; name: string; cohort_id: string }[]>([]);
  const [selectedGroupIds, setSelectedGroupIds]   = useState<string[]>([]);
  const [originalGroupIds, setOriginalGroupIds]   = useState<string[]>([]);
  const [audienceMode, setAudienceMode]           = useState<'cohorts' | 'groups'>('cohorts');
  const [deadlineDate, setDeadlineDate]           = useState('');
  const [coverUploading, setCoverUploading]       = useState(false);
  const [resourceUploading, setResourceUploading] = useState<Record<string, boolean>>({});
  const [extracting, setExtracting]               = useState<string | null>(null); // label of file being processed
  const [showPreview, setShowPreview]             = useState(false);
  const [previewVeConfig, setPreviewVeConfig]     = useState<any>(null);
  const [loadingPreviewVe, setLoadingPreviewVe]   = useState(false);
  const [editorReady, setEditorReady]             = useState(false);
  const autoPreviewOpened = useRef(false);
  const previewButtonRef = useRef<HTMLButtonElement>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const solutionFileRef = useRef<HTMLInputElement>(null);
  const resourceFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const rubricFileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const toggleCohort = (id: string) =>
    setSelectedCohortIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleGroup = (id: string) =>
    setSelectedGroupIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('edit');
    setEditId(id);

    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const { data: profile } = await supabase
        .from('students').select('role').eq('id', session.user.id).single();
      if (!profile || !['instructor', 'admin'].includes(profile.role)) {
        router.replace('/dashboard'); return;
      }

      const [{ data: coursesData }, { data: cohortsData }, { data: veData }, groupsRes] = await Promise.all([
        supabase.from('courses').select('id, title').eq('user_id', session.user.id).order('title'),
        supabase.from('cohorts').select('id, name').eq('cohort_kind', 'bootcamp').order('name'),
        supabase.from('virtual_experiences').select('id, title, slug').eq('user_id', session.user.id).order('title'),
        fetch('/api/groups', { headers: { Authorization: `Bearer ${session.access_token}` } }).then(r => r.json()),
      ]);
      if (coursesData) setCourses(coursesData);
      if (cohortsData) setCohorts(cohortsData);
      if (veData) setVeForms(veData.map((v: any) => ({ id: v.id, title: v.title || 'Untitled VE', slug: v.slug })));
      if (groupsRes?.groups) setGroups(groupsRes.groups.map((g: any) => ({ id: g.id, name: g.name, cohort_id: g.cohort_id })));

      if (id) {
        const [{ data }, { data: resData }, { data: solData }] = await Promise.all([
          supabase.from('assignments').select('*').eq('id', id).single(),
          supabase.from('assignment_resources').select('*').eq('assignment_id', id),
          supabase.from('assignment_solutions').select('*').eq('assignment_id', id).order('created_at'),
        ]);
        if (data) {
          setTitle(data.title ?? '');
          setScenario(data.scenario ?? '');
          setBrief(data.brief ?? '');
          setTasks(data.tasks ?? '');
          setRequirements(data.requirements ?? '');
          setSubmissionInstructions(data.submission_instructions ?? '');
          setRelatedCourse(data.related_course ?? '');
          setCoverImage(data.cover_image ?? '');
          const loadedStatus = (data.status ?? 'draft') as 'draft' | 'published';
          setStatus(loadedStatus);
          setOriginalStatus(loadedStatus);
          if (data.deadline_date) setDeadlineDate(data.deadline_date);
          if (data.cohort_ids?.length) {
            setSelectedCohortIds(data.cohort_ids);
            setOriginalCohortIds(data.cohort_ids);
          }
          if (data.group_ids?.length) {
            setSelectedGroupIds(data.group_ids);
            setOriginalGroupIds(data.group_ids);
            setAudienceMode('groups');
          }
          if (data.type) setAssignmentType(data.type);
          if (data.config) {
            const cfg = data.config;
            if (cfg.rubric?.length) setRubricText(cfg.rubric.join('\n'));
            if (cfg.minScore != null) setMinScore(cfg.minScore);
            if (cfg.passingScore != null) setPassingScore(cfg.passingScore);
            if (cfg.schema) setSchema(cfg.schema);
            if (cfg.context) setContext(cfg.context);
            if (cfg.ve_form_id) setVeFormId(cfg.ve_form_id);
            if (Array.isArray(cfg.scenarios)) {
              // Answer keys live in a server-only table; re-inject them into the editor state.
              const { data: keyRow } = await supabase.from('assignment_answer_keys').select('keys').eq('assignment_id', id).maybeSingle();
              const keys = (keyRow?.keys ?? {}) as Record<string, string>;
              setScenarios(cfg.scenarios.map((s: any) => ({
                ...s,
                tasks: (s.tasks ?? []).map((t: any) => (t.type === 'mcq' && keys[t.id] != null ? { ...t, correctAnswer: keys[t.id] } : t)),
              })));
            }
            if (cfg.introDoc) setIntroDoc(cfg.introDoc);
            if (cfg.introBody) setIntroBody(cfg.introBody);
          }
        }
        if (resData) setResources(resData.map((r: any) => ({ id: r.id, name: r.name, url: r.url, resource_type: r.resource_type })));
        if (solData) {
          setSolutions(solData.map((s: any) => ({ id: s.id, name: s.name, kind: s.kind, storage_path: s.storage_path ?? undefined, url: s.url ?? undefined })));
          for (const s of solData) if (s.storage_path) uploadedSolutionPaths.current.add(s.storage_path);
        }
      }
      setEditorReady(true);
    };
    init();
  }, [router]);

  function buildConfig(): Record<string, any> | null {
    const rubric = rubricText.split('\n').map(s => s.trim()).filter(Boolean);
    const base: Record<string, any> | null = (() => {
      switch (assignmentType) {
        case 'standard':           return scenarios.length ? { scenarios: stripAnswerKeys(scenarios), ...(introDoc ? { introDoc } : {}), ...(introBody.trim() ? { introBody: sanitizeRichText(introBody) } : {}) } : null;
        case 'code_review':        return { rubric, minScore, ...(schema.trim() ? { schema: schema.trim() } : {}) };
        case 'excel_review':       return { rubric, minScore, ...(context.trim() ? { context: context.trim() } : {}) };
        case 'dashboard_critique': return { rubric };
        case 'document_review':    return { rubric, minScore, ...(context.trim() ? { context: context.trim() } : {}) };
        case 'virtual_experience': return veFormId ? { ve_form_id: veFormId } : null;
        default:                   return null;
      }
    })();
    if (!base) return null;
    // The submission passing grade applies to every assignment type (resubmit / solution release /
    // grade notifications / pass-fail all read it). Clamp to a sane 1-100.
    return { ...base, passingScore: Math.min(100, Math.max(1, Math.round(passingScore))) };
  }

  // -- Solution files (released to a student only after their submission is graded) ---
  function addSolutionLink() {
    setSolutions(prev => [...prev, { id: crypto.randomUUID(), name: '', kind: 'link', url: '' }]);
  }
  function removeSolution(id: string) { setSolutions(prev => prev.filter(s => s.id !== id)); }
  function updateSolution(id: string, field: 'name' | 'url', value: string) {
    setSolutions(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }

  // Files upload immediately (like resource files) so the editor only ever holds a storage path.
  // The object goes to the PRIVATE solutions bucket via the service-role route -- there is no
  // public URL, so nothing is exposed before the assignment is even saved.
  async function handleSolutionFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    setSolutionUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      for (const file of files) {
        if (!isAllowedSolutionFile(file.name)) throw new Error(`File type not allowed: ${file.name}`);
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch('/api/assignments/solution-upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: fd,
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Solution upload failed.');
        uploadedSolutionPaths.current.add(json.path);
        setSolutions(prev => [...prev, { id: crypto.randomUUID(), name: file.name, kind: 'file', storage_path: json.path }]);
      }
    } catch (err: any) {
      setError(err?.message || 'Solution upload failed.');
    } finally {
      setSolutionUploading(false);
    }
  }

  function addResource() {
    setResources(prev => [...prev, { id: crypto.randomUUID(), name: '', url: '', resource_type: 'link' }]);
  }
  function removeResource(id: string) { setResources(prev => prev.filter(r => r.id !== id)); }
  function updateResource(id: string, field: keyof Resource, value: string) {
    setResources(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
  }

  async function handleExtractRubric(label: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setExtracting(label);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const form = new FormData();
      form.append('file', file);
      form.append('label', label);

      const res = await fetch('/api/extract-rubric', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Extraction failed.'); return; }

      const incoming: string[] = json.criteria ?? [];
      setRubricText(prev => {
        const existing = prev.trim();
        return existing ? `${existing}\n${incoming.join('\n')}` : incoming.join('\n');
      });
    } catch {
      setError('Failed to extract rubric. Please try again.');
    } finally {
      setExtracting(null);
      e.target.value = '';
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const trimmedTitle = title.trim();
    if (!trimmedTitle) { setError('Title is required.'); return; }
    if (assignmentType === 'virtual_experience' && !veFormId) {
      setError('Please select a Virtual Experience.'); return;
    }
    // Block publishing an incomplete scenario assignment (drafts may stay incomplete).
    if (assignmentType === 'standard' && status === 'published') {
      const vErrs = validateScenarioConfig({ scenarios });
      if (vErrs.length) { setError(vErrs.slice(0, 3).join(' ') + (vErrs.length > 3 ? ` (+${vErrs.length - 3} more)` : '')); return; }
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace('/auth'); return; }

      const wantPublished = status === 'published';

      // B-lite publish safety: a published assignment must never exist without its matching
      // answer keys / resources. So always write the CONTENT as a draft first (creating, or
      // flipping an already-published edit back to draft in the same atomic update), save keys
      // and resources, and only THEN flip to published. If any step fails it stays a draft.
      const draftPayload: any = {
        title:                    trimmedTitle,
        scenario:                 sanitizeRichText(scenario) || null,
        brief:                    sanitizeRichText(brief) || null,
        tasks:                    sanitizeRichText(tasks) || null,
        requirements:             sanitizeRichText(requirements) || null,
        submission_instructions:  sanitizeRichText(submissionInstructions) || null,
        related_course:           relatedCourse || null,
        cover_image:              coverImage.trim() || null,
        status:                   'draft',
        cohort_ids:               audienceMode === 'cohorts' ? selectedCohortIds : [],
        group_ids:                audienceMode === 'groups'  ? selectedGroupIds  : [],
        deadline_date:            deadlineDate || null,
        type:                     assignmentType,
        config:                   buildConfig(),
      };

      // Resources/solutions are replaced by inserting the new rows first and deleting the old ones
      // only afterwards (see below). Capture the existing ids here but do NOT delete yet, so a
      // failure mid-save can never leave the draft with its old data already gone.
      const oldResourceIds: string[] = [];
      const oldSolutionIds: string[] = [];
      let assignmentId = editId;
      if (editId) {
        const { error: updateError } = await supabase.from('assignments').update(draftPayload).eq('id', editId);
        if (updateError) throw updateError;
        const { data: oldRes, error: oldResErr } = await supabase.from('assignment_resources').select('id').eq('assignment_id', editId);
        if (oldResErr) throw new Error('Could not read existing resources. The assignment was left as a draft - please try saving again.');
        oldResourceIds.push(...(oldRes ?? []).map((r: any) => r.id));
        // Tolerated when the table itself is missing (a tenant that has not applied migration 144
        // yet): editing an assignment must not break there. A real save of solutions still errors
        // loudly below.
        const { data: oldSol, error: oldSolErr } = await supabase.from('assignment_solutions').select('id').eq('assignment_id', editId);
        if (oldSolErr && !isMissingSolutionsTable(oldSolErr)) throw new Error('Could not read existing solution files. The assignment was left as a draft - please try saving again.');
        oldSolutionIds.push(...(oldSol ?? []).map((s: any) => s.id));
      } else {
        const { data: assignment, error: assignmentError } = await supabase
          .from('assignments').insert({ ...draftPayload, created_by: session.user.id }).select('id').single();
        if (assignmentError) throw assignmentError;
        assignmentId = assignment.id;
      }
      if (!assignmentId) throw new Error('Assignment could not be resolved.');

      // MCQ answer keys (server-only table). On failure the assignment stays a draft.
      if (assignmentType === 'standard') {
        const { error: keyErr } = await supabase.from('assignment_answer_keys')
          .upsert({ assignment_id: assignmentId, keys: extractAnswerKeys(scenarios) }, { onConflict: 'assignment_id' });
        if (keyErr) throw new Error('Could not save the answer keys. The assignment was left as a draft - please try saving again.');
      }

      const validResources = resources.filter(r => r.name.trim() && r.url.trim());
      if (validResources.length > 0) {
        const { error: resourcesError } = await supabase.from('assignment_resources').insert(
          validResources.map(r => ({ assignment_id: assignmentId, name: r.name.trim(), url: r.url.trim(), resource_type: r.resource_type }))
        );
        if (resourcesError) throw new Error('Could not save resources. The assignment was left as a draft - please try saving again.');
      }

      // Solution files: instructor-only until a student's submission is graded (RLS + private
      // bucket, migration 144). Same draft-first safety as resources.
      const validSolutions = solutions.filter(isCompleteSolution);
      if (validSolutions.length > 0) {
        const { error: solutionsError } = await supabase.from('assignment_solutions').insert(
          validSolutions.map(s => ({
            assignment_id: assignmentId,
            name: s.name.trim(),
            kind: s.kind,
            storage_path: s.kind === 'file' ? s.storage_path : null,
            url: s.kind === 'link' ? s.url!.trim() : null,
          }))
        );
        if (solutionsError) {
          throw new Error(isMissingSolutionsTable(solutionsError)
            ? 'Solution files need database migration 144 on this environment. The assignment was left as a draft.'
            : 'Could not save the solution files. The assignment was left as a draft - please try saving again.');
        }
      }

      // The new rows are in, so now remove the ones this edit replaced. Deleting AFTER the inserts
      // means any failure above left the originals intact (the draft never loses its data); the
      // worst case here is old + new both lingering on a draft, which the instructor can re-save.
      if (editId && oldResourceIds.length) {
        const { error: delErr } = await supabase.from('assignment_resources').delete().in('id', oldResourceIds);
        if (delErr) throw new Error('Saved the new resources but could not remove the previous ones. The assignment was left as a draft - please try saving again.');
      }
      if (editId && oldSolutionIds.length) {
        const { error: delSolErr } = await supabase.from('assignment_solutions').delete().in('id', oldSolutionIds);
        if (delSolErr && !isMissingSolutionsTable(delSolErr)) throw new Error('Saved the new solution files but could not remove the previous ones. The assignment was left as a draft - please try saving again.');
      }

      // Flip to published only after content, keys, resources, and solutions all saved.
      if (wantPublished) {
        const { error: pubErr } = await supabase.from('assignments').update({ status: 'published' }).eq('id', assignmentId);
        if (pubErr) throw new Error('Content saved, but publishing failed. The assignment is a draft - please try publishing again.');
      }

      // Send notification emails after publication succeeds (before navigating away).
      if (wantPublished) {
        const isPublishingNow = !editId || originalStatus !== 'published';
        const cohortsToNotify = audienceMode === 'cohorts'
          ? (isPublishingNow ? selectedCohortIds : selectedCohortIds.filter(id => !originalCohortIds.includes(id)))
          : [];
        const groupsToNotify = audienceMode === 'groups'
          ? (isPublishingNow ? selectedGroupIds : selectedGroupIds.filter(id => !originalGroupIds.includes(id)))
          : [];
        if (cohortsToNotify.length > 0 || groupsToNotify.length > 0) {
          const notifyRes = await fetch('/api/assignments/notify-cohorts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ assignmentId, cohortIds: cohortsToNotify, groupIds: groupsToNotify }),
          });
          if (!notifyRes.ok) {
            const notifyJson = await notifyRes.json().catch(() => ({}));
            throw new Error(notifyJson.error || 'Assignment published but notification failed.');
          }
        }
      }

      // Bin any solution file this assignment no longer references (a removed entry, or one
      // uploaded and then taken out before saving). Fire-and-forget after the save succeeded; the
      // server keeps anything another assignment still points at.
      if (uploadedSolutionPaths.current.size > 0) {
        requestSolutionCleanup([...uploadedSolutionPaths.current], session.access_token);
      }

      router.push('/dashboard#assignments');
    } catch (err: any) {
      setError(err?.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleResourceFileUpload(resourceId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setResourceUploading(prev => ({ ...prev, [resourceId]: true }));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/assignments/github-upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'File upload failed.');
      updateResource(resourceId, 'url', json.url);
      if (!resources.find(r => r.id === resourceId)?.name) updateResource(resourceId, 'name', file.name);
    } catch (err: any) {
      setError(err?.message || 'File upload failed.');
    } finally {
      setResourceUploading(prev => ({ ...prev, [resourceId]: false }));
      e.target.value = '';
    }
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverUploading(true);
    try {
      const ref = await uploadCoverImage(file, 'covers');
      setCoverImage(ref);
    } catch (err: any) {
      setError(err?.message || 'Image upload failed.');
    } finally {
      setCoverUploading(false);
      e.target.value = '';
    }
  }

  const isLegacyType = !ASSIGNMENT_TYPES.some(t => t.value === assignmentType) && assignmentType !== 'standard';
  const showContentFields = assignmentType !== 'virtual_experience';
  const studioTabs = [
    { id: 'type', label: 'Type', description: 'Choose assignment type', Icon: ClipboardList },
    { id: 'build', label: 'Build', description: 'Build workspace', Icon: Blocks },
    { id: 'content', label: 'Content', description: 'Content workspace', Icon: Video },
    { id: 'resources', label: 'Resources', description: 'Resources workspace', Icon: FolderOpen },
    { id: 'settings', label: 'Settings', description: 'Settings workspace', Icon: Settings },
    { id: 'publish', label: 'Publish', description: 'Publish workspace', Icon: CheckCircle2 },
  ] as const;
  const activeStudioIndex = studioTabs.findIndex(tab => tab.id === activeStudioTab);
  const activeStudioConfig = studioTabs[activeStudioIndex];
  const studioPanelStyle: React.CSSProperties = {
    background: C.card,
    border: `1px solid ${C.cardBorder}`,
    borderRadius: 20,
    boxShadow: isDark ? 'none' : '0 14px 38px rgba(15,23,42,0.05)',
    padding: 24,
  };
  const tabPanelSectionStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    borderRadius: 0,
    boxShadow: 'none',
    padding: 0,
  };
  const fieldGroupStyle: React.CSSProperties = {
    padding: 16,
    borderRadius: 15,
    background: C.page,
  };
  const sectionEyebrowStyle: React.CSSProperties = {
    color: C.cta,
    fontSize: 10,
    fontWeight: 800,
    textTransform: 'uppercase',
    letterSpacing: '.14em',
    margin: '0 0 6px',
  };
  const contentReady = assignmentType === 'virtual_experience'
    ? Boolean(veFormId)
    : assignmentType === 'standard'
      ? scenarios.length > 0
      : Boolean(scenario || brief || tasks || requirements);
  const readinessChecks = [
    { label: 'Assignment title', complete: Boolean(title.trim()) },
    { label: 'Assignment content', complete: contentReady },
    { label: 'Target audience', complete: selectedCohortIds.length > 0 || selectedGroupIds.length > 0 },
    { label: 'Cover image', complete: Boolean(coverImage) },
  ];
  const readinessComplete = readinessChecks.filter(item => item.complete).length;
  const goToStudioTab = (id: typeof studioTabs[number]['id']) => {
    setActiveStudioTab(id);
  };

  const openPreview = async () => {
    if (assignmentType === 'virtual_experience' && veFormId) {
      setLoadingPreviewVe(true);
      const { data: ve } = await supabase
        .from('virtual_experiences')
        .select('id, title, slug, modules, company, role, industry, tagline, description, cover_image, manager_name, manager_title, guide_id, guide_snapshot, dataset, background, difficulty, duration, tools, tool_logos, learn_outcomes, theme, mode, font, custom_accent, is_short_course, badge_image_url')
        .eq('id', veFormId).single();
      if (ve) {
        setPreviewVeConfig({
          isVirtualExperience: true as const,
          title: ve.title,
          company: ve.company,
          role: ve.role,
          industry: ve.industry,
          modules: ve.modules ?? [],
          tagline: ve.tagline,
          coverImage: ve.cover_image,
          description: ve.description,
          toolLogos: ve.tool_logos ?? {},
          theme: ve.theme,
          mode: ve.mode,
          font: ve.font,
          customAccent: ve.custom_accent,
          isShortCourse: !!ve.is_short_course,
          badgeImageUrl: ve.badge_image_url,
          managerName: ve.manager_name,
          managerTitle: ve.manager_title,
          guideId: ve.guide_id,
          guideSnapshot: ve.guide_snapshot,
          dataset: ve.dataset,
          background: ve.background,
          difficulty: ve.difficulty,
          duration: ve.duration,
          tools: ve.tools ?? [],
          learnOutcomes: ve.learn_outcomes ?? [],
        });
      }
      setLoadingPreviewVe(false);
    }
    setShowPreview(true);
  };

  // Assignment reports link here with `preview=1`. Reuse the real editor preview instead of
  // maintaining a second renderer in the reporting page.
  useEffect(() => {
    if (!editorReady || !editId || autoPreviewOpened.current) return;
    if (new URLSearchParams(window.location.search).get('preview') !== '1') return;
    autoPreviewOpened.current = true;
    previewButtonRef.current?.click();
  }, [editorReady, editId]);

  return (
    <div style={{ minHeight: '100vh', background: C.page }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: C.nav, borderBottom: `1px solid ${C.navBorder}`,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      }}>
        <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 24px', height: 56, display: 'flex', alignItems: 'center' }}>
          <Link href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, textDecoration: 'none', fontSize: 14, fontWeight: 500 }}>
            <ArrowLeft style={{ width: 16, height: 16 }}/> Back
          </Link>
        </div>
      </header>

      <main style={{ maxWidth: 1040, margin: '0 auto', padding: '28px 24px 120px' }}>
        <section style={{ ...studioPanelStyle, padding: 0, overflow: 'hidden', marginBottom: 0, borderRadius: '20px 20px 0 0', borderBottom: 'none', boxShadow: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '20px 24px 14px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ position: 'relative', width: 10, height: 10, display: 'grid', placeItems: 'center' }} aria-hidden="true">
                  <span className="animate-ping" style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: C.cta, opacity: .2 }}/>
                  <span style={{ position: 'relative', width: 6, height: 6, borderRadius: '50%', background: C.cta }}/>
                </span>
                <span style={{ color: C.cta, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.16em' }}>Assignment Studio</span>
              </div>
              <h1 style={{ color: C.text, fontSize: 20, lineHeight: 1.2, fontWeight: 750, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || (editId ? 'Edit assignment' : 'Untitled assignment')}</h1>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
              <button ref={previewButtonRef} type="button" onClick={openPreview} disabled={loadingPreviewVe} style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 38, padding: '8px 13px', borderRadius: 12, border: 'none', cursor: 'pointer', background: C.pill, color: C.muted, fontSize: 12, fontWeight: 700 }}>
                {loadingPreviewVe ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin"/> : <Eye style={{ width: 14, height: 14 }}/>} Preview
              </button>
              <span style={{ color: C.faint, fontSize: 11 }}>{editId ? 'Editing assignment' : 'New assignment'}</span>
            </div>
          </div>
          <nav aria-label="Assignment studio sections" style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto', padding: '0 20px 14px', scrollbarWidth: 'none' }}>
            {studioTabs.map(tab => {
              const active = activeStudioTab === tab.id;
              return <button key={tab.id} type="button" aria-current={active ? 'page' : undefined} onClick={() => goToStudioTab(tab.id)} style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 38, padding: '8px 12px', border: 'none', borderRadius: 12, whiteSpace: 'nowrap', cursor: 'pointer', background: active ? `${C.cta}14` : 'transparent', color: active ? C.cta : C.faint, fontSize: 12, fontWeight: 700, transition: 'all .15s ease' }}><tab.Icon style={{ width: 14, height: 14 }}/> {tab.label}</button>;
            })}
          </nav>
        </section>
        <section style={{ padding: '22px 24px', borderLeft: `1px solid ${C.cardBorder}`, borderRight: `1px solid ${C.cardBorder}`, borderTop: `1px solid ${C.divider}`, borderBottom: `1px solid ${C.divider}`, background: C.card }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ color: C.text, fontSize: 20, fontWeight: 750, lineHeight: 1.2, margin: 0 }}>{activeStudioConfig.label}</h2>
              <p style={{ color: C.faint, fontSize: 11, fontWeight: 600, margin: '7px 0 0' }}>{activeStudioConfig.description}</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button type="button" aria-label="Previous" disabled={activeStudioIndex <= 0} onClick={() => goToStudioTab(studioTabs[activeStudioIndex - 1].id)} style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: '50%', border: `1px solid ${C.cardBorder}`, background: 'transparent', color: C.muted, cursor: activeStudioIndex <= 0 ? 'default' : 'pointer', opacity: activeStudioIndex <= 0 ? .3 : 1 }}><ChevronLeft style={{ width: 17, height: 17 }}/></button>
              <button type="button" aria-label="Next" disabled={activeStudioIndex >= studioTabs.length - 1} onClick={() => goToStudioTab(studioTabs[activeStudioIndex + 1].id)} style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', borderRadius: '50%', border: `1px solid ${C.cardBorder}`, background: 'transparent', color: C.muted, cursor: activeStudioIndex >= studioTabs.length - 1 ? 'default' : 'pointer', opacity: activeStudioIndex >= studioTabs.length - 1 ? .3 : 1 }}><ChevronRight style={{ width: 17, height: 17 }}/></button>
            </div>
          </div>
        </section>
        <form id="assignment-form" onSubmit={handleSubmit} noValidate>

          <section aria-live="polite" style={{ ...studioPanelStyle, minHeight: 360, marginTop: 0, borderRadius: '0 0 20px 20px', borderTop: 'none', boxShadow: 'none' }}>

          {error && (
            <div style={{ marginBottom: 20, padding: '12px 16px', borderRadius: 10, background: C.errorBg, color: C.errorText, border: `1px solid ${C.errorBorder}`, fontSize: 14 }}>
              {error}
            </div>
          )}

          {/* -- Assignment Type --- */}
          <section id="assignment-section-type" style={{ ...tabPanelSectionStyle, display: activeStudioTab === 'type' ? 'block' : 'none' }}>
            <div style={{ marginBottom: 20 }}>
              <p style={{ color: C.cta, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.14em', margin: '0 0 6px' }}>Assignment format</p>
              <h3 style={{ fontSize: 17, fontWeight: 750, color: C.text, margin: 0 }}>How should learners complete this assignment?</h3>
              <p style={{ ...hintStyle(C), margin: '7px 0 0', maxWidth: 620 }}>Choose a flexible task-based assignment or connect an immersive virtual experience. This choice determines the tools available in the next tabs.</p>
            </div>
              <div role="radiogroup" aria-label="Assignment type" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: 12 }}>
                {ASSIGNMENT_TYPES.map(t => {
                  const active = assignmentType === t.value;
                  return (
                    <button key={t.value} type="button" role="radio" aria-checked={active} onClick={() => setAssignmentType(t.value)}
                      style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: 13, minWidth: 0, minHeight: 92, padding: 16, borderRadius: 15, border: `1px solid ${active ? C.cta : C.divider}`, background: active ? `${C.cta}0e` : C.page, color: active ? C.cta : C.muted, textAlign: 'left', cursor: 'pointer', transition: 'all .15s ease' }}>
                      <span style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center', background: active ? `${C.cta}18` : C.card, color: active ? C.cta : C.faint }}>{t.icon}</span>
                      <span style={{ minWidth: 0, paddingRight: 22 }}>
                        <strong style={{ display: 'block', color: active ? C.cta : C.text, fontSize: 13.5, lineHeight: 1.3 }}>{t.label}</strong>
                        <span style={{ display: 'block', color: C.faint, fontSize: 11.5, lineHeight: 1.45, marginTop: 5 }}>{t.description}</span>
                      </span>
                      {active && (
                        <CheckCircle2 style={{ position: 'absolute', right: 14, top: 14, width: 16, height: 16, color: C.cta }}/>
                      )}
                    </button>
                  );
                })}
              </div>
            {isLegacyType && (
              <p style={{ ...hintStyle(C), marginTop: 10 }}>
                You are editing a legacy {LEGACY_TYPE_LABELS[assignmentType] ?? assignmentType} assignment. Its settings below still work. New assignments are built as Standard scenarios and tasks.
              </p>
            )}
          </section>

          {/* -- Type-specific Config --- */}
          {assignmentType !== 'standard' && (
            <section style={{ ...tabPanelSectionStyle, display: activeStudioTab === 'content' ? 'block' : 'none', marginBottom: 28, paddingBottom: 28, borderBottom: `1px solid ${C.divider}` }}>
              <p style={sectionEyebrowStyle}>{assignmentType === 'virtual_experience' ? 'Connected experience' : 'AI assessment'}</p>
              <h3 style={{ fontSize: 17, fontWeight: 750, color: C.text, margin: 0 }}>{assignmentType === 'virtual_experience' ? 'Virtual Experience' : 'AI review settings'}</h3>
              <p style={{ ...hintStyle(C), margin: '7px 0 18px' }}>{assignmentType === 'virtual_experience' ? 'Select the immersive experience learners will complete.' : 'Define the rubric, context, and score used for automated review.'}</p>

              {assignmentType === 'virtual_experience' ? (
                <div style={fieldGroupStyle}>
                  <label style={labelStyle(C)}>Select Virtual Experience <span style={{ color: C.errorText }}>*</span></label>
                  {veForms.length === 0 ? (
                    <p style={{ fontSize: 13, color: C.faint }}>No Virtual Experiences found. Create one first from the dashboard.</p>
                  ) : (
                    <select value={veFormId} onChange={e => setVeFormId(e.target.value)}
                      style={{ ...inputStyle(C), appearance: 'auto' }}>
                      <option value="">Select a Virtual Experience</option>
                      {veForms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}
                    </select>
                  )}
                </div>
              ) : (
                <>
                  {/* Rubric */}
                  <div style={{ ...fieldGroupStyle, marginBottom: 12 }}>
                    <label style={labelStyle(C)}>Grading Rubric</label>

                    {/* Extract from reference solution */}
                    <div style={{ marginBottom: 10 }}>
                      <input
                        type="file"
                        accept=".xlsx,.pdf,.csv,.txt,.png,.jpg,.jpeg,.docx"
                        style={{ display: 'none' }}
                        ref={el => { rubricFileRefs.current['reference_solution'] = el; }}
                        onChange={e => handleExtractRubric('reference_solution', e)}
                      />
                      <button
                        type="button"
                        disabled={!!extracting}
                        onClick={() => rubricFileRefs.current['reference_solution']?.click()}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          minHeight: 40, padding: '8px 12px', borderRadius: 10,
                          border: 'none', background: C.card, color: C.muted,
                          fontSize: 11.5, fontWeight: 700, cursor: extracting ? 'not-allowed' : 'pointer',
                          opacity: extracting ? 0.5 : 1, transition: 'opacity 0.15s',
                        }}
                      >
                        {extracting === 'reference_solution'
                          ? <><Loader2 style={{ width: 13, height: 13 }} className="animate-spin"/> Extracting...</>
                          : <><Upload style={{ width: 13, height: 13 }}/> Upload Reference Solution</>
                        }
                      </button>
                    </div>
                    <p style={{ ...hintStyle(C), marginBottom: 8 }}>Upload the completed reference file and AI will extract rubric criteria automatically.</p>

                    <textarea
                      value={rubricText}
                      onChange={e => setRubricText(e.target.value)}
                      placeholder={"Enter one criterion per line:\nCode follows DRY principles\nQueries are optimised\nResults are correct"}
                      style={textareaStyle(C)}
                    />
                    <p style={hintStyle(C)}>Each line becomes a separate rubric criterion the AI will grade against.</p>
                  </div>

                  {/* Context (excel_review / document_review) */}
                  {assignmentType === 'document_review' && (
                    <div style={{ ...fieldGroupStyle, marginBottom: 12 }}>
                      <label style={labelStyle(C)}>Report scope / context <span style={{ fontSize: 12, fontWeight: 400, color: C.faint }}>(optional)</span></label>
                      <textarea
                        value={context}
                        onChange={e => setContext(e.target.value)}
                        placeholder="Describe what the report should cover, the market, industry, or company context the AI should use when reviewing..."
                        style={textareaStyle(C)}
                      />
                    </div>
                  )}

                  {/* Min Score */}
                  {(assignmentType === 'code_review' || assignmentType === 'excel_review' || assignmentType === 'document_review') && (
                    <div style={{ ...fieldGroupStyle, marginBottom: 12 }}>
                      <label style={labelStyle(C)}>Minimum Pass Score <span style={{ fontSize: 12, fontWeight: 400 }}>(out of 100)</span></label>
                      <input
                        type="number" min={1} max={100} value={minScore}
                        onChange={e => setMinScore(Number(e.target.value))}
                        style={{ ...inputStyle(C), width: 100 }}
                      />
                    </div>
                  )}

                  {/* Schema (code_review only) */}
                  {assignmentType === 'code_review' && (
                    <div style={{ ...fieldGroupStyle, marginBottom: 12 }}>
                      <label style={labelStyle(C)}>Database Schema <span style={{ fontSize: 12, fontWeight: 400, color: C.faint }}>(optional, for SQL review)</span></label>
                      <textarea
                        value={schema}
                        onChange={e => setSchema(e.target.value)}
                        placeholder="CREATE TABLE orders (id INT, ...);"
                        style={{ ...textareaStyle(C), fontFamily: 'monospace', fontSize: 12 }}
                      />
                    </div>
                  )}

                  {/* Context (excel_review) */}
                  {assignmentType === 'excel_review' && (
                    <div style={fieldGroupStyle}>
                      <label style={labelStyle(C)}>Business Context <span style={{ fontSize: 12, fontWeight: 400, color: C.faint }}>(optional)</span></label>
                      <textarea
                        value={context}
                        onChange={e => setContext(e.target.value)}
                        placeholder="Describe the business scenario or rules the AI should apply when reviewing the spreadsheet..."
                        style={textareaStyle(C)}
                      />
                    </div>
                  )}

                </>
              )}
            </section>
          )}

          {/* -- Section: Details --- */}
          <section style={{ ...tabPanelSectionStyle, display: activeStudioTab === 'build' ? 'block' : 'none' }}>
            <div style={{ marginBottom: 20 }}>
              <p style={sectionEyebrowStyle}>Assignment identity</p>
              <h3 style={{ fontSize: 17, fontWeight: 750, color: C.text, margin: 0 }}>Set the learner-facing details</h3>
              <p style={{ ...hintStyle(C), marginTop: 6 }}>Use a clear title and a focused cover image learners can recognize at a glance.</p>
            </div>

            <div style={{ ...fieldGroupStyle, marginBottom: 12 }}>
              <label style={labelStyle(C)}>Title <span style={{ color: C.errorText }}>*</span></label>
              <input
                type="text" value={title} onChange={e => setTitle(sanitizePlainText(e.target.value))}
                placeholder="e.g. Week 3 Data Analysis Assignment"
                style={inputStyle(C)} required maxLength={255}
              />
            </div>

            {/* Cover Image */}
            <div style={fieldGroupStyle}>
              <label style={labelStyle(C)}>Cover Image</label>
              <input ref={coverRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverUpload}/>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <input type="text" value={coverImage} onChange={e => setCoverImage(e.target.value)}
                  placeholder="Paste an image URL or upload" style={{ ...inputStyle(C), flex: '1 1 260px' }}/>
                <button type="button" onClick={() => coverRef.current?.click()} disabled={coverUploading}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 46, padding: '10px 14px', borderRadius: 12, border: 'none', background: C.pill, color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  <Upload style={{ width: 14, height: 14 }}/>{coverUploading ? 'Uploading...' : 'Upload'}
                </button>
                <button type="button" onClick={() => setShowCoverLibrary(true)} title="Select from library"
                  style={{ display: 'flex', alignItems: 'center', minHeight: 46, padding: '10px 13px', borderRadius: 12, border: 'none', background: C.pill, color: C.muted, cursor: 'pointer', flexShrink: 0 }}>
                  <Images style={{ width: 14, height: 14 }}/>
                </button>
              </div>
              {coverImage && (
                <div style={{ marginTop: 12, borderRadius: 14, overflow: 'hidden', position: 'relative', background: C.thumbBg }}>
                  <img src={resolveCoverUrl(coverImage)} alt="Cover" style={{ width: '100%', height: 190, objectFit: 'cover', display: 'block' }} onError={e => (e.target as HTMLImageElement).style.display = 'none'}/>
                  <button type="button" onClick={() => setCoverImage('')}
                    style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.55)', border: 'none', borderRadius: '50%', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <X style={{ width: 14, height: 14, color: 'white' }}/>
                  </button>
                </div>
              )}
              {showCoverLibrary && (
                <ImageLibrary
                  uploadFolder="covers"
                  initialFolder="covers"
                  returnPublicId
                  onSelect={ref => setCoverImage(ref)}
                  onClose={() => setShowCoverLibrary(false)}
                />
              )}
            </div>

          </section>

          {/* -- Section: Content (hidden for VE type) --- */}
          {showContentFields && (
            <section style={{ ...tabPanelSectionStyle, display: activeStudioTab === 'content' ? 'block' : 'none', marginBottom: assignmentType === 'standard' ? 28 : 0, paddingBottom: assignmentType === 'standard' ? 28 : 0, borderBottom: assignmentType === 'standard' ? `1px solid ${C.divider}` : 'none' }}>
              <p style={sectionEyebrowStyle}>{assignmentType === 'standard' ? 'Learner briefing' : 'Assignment content'}</p>
              <h3 style={{ fontSize: 17, fontWeight: 750, color: C.text, margin: 0 }}>{assignmentType === 'standard' ? 'Introduce the assignment' : 'Shape the learner brief'}</h3>
              <p style={{ ...hintStyle(C), margin: '7px 0 18px' }}>{assignmentType === 'standard' ? 'Give learners the context they need before starting the scenarios.' : 'Explain the situation, expected work, and completion requirements.'}</p>
              {isLegacyType && (
                <p style={{ ...hintStyle(C), marginBottom: 16 }}>This text is shown to students as a briefing before they interact with the {LEGACY_TYPE_LABELS[assignmentType] ?? assignmentType} tool.</p>
              )}

              {assignmentType === 'standard' ? (
                <div>
                  <label style={labelStyle(C)}>Overview <span style={{ fontSize: 12, fontWeight: 400, color: C.faint }}>(optional intro shown above the scenarios)</span></label>
                  <LessonEditor
                    doc={introDoc}
                    bodyFallback={introBody}
                    onChange={({ doc, body }) => { setIntroDoc(doc); setIntroBody(body); }}
                    placeholder="Set the overall context. Add images, steps, callouts, tables..."
                    isDark={isDark}
                    accentColor={C.cta}
                  />
                </div>
              ) : (
                [
                  { label: 'Scenario', value: scenario, setter: setScenario, placeholder: 'Describe the background context...' },
                  { label: 'Brief', value: brief, setter: setBrief, placeholder: 'Summarise the assignment...' },
                  { label: 'Tasks', value: tasks, setter: setTasks, placeholder: 'List the tasks students must complete...' },
                  { label: 'Requirements', value: requirements, setter: setRequirements, placeholder: 'List any requirements or constraints...' },
                ].map(({ label, value, setter, placeholder }) => (
                  <div key={label} style={{ ...fieldGroupStyle, marginBottom: 12 }}>
                    <label style={labelStyle(C)}>{label}</label>
                    <RichTextEditor value={value} onChange={setter} placeholder={placeholder} enableAiAssist />
                  </div>
                ))
              )}
            </section>
          )}

          {/* -- Section: Scenarios & Tasks (standard only) --- */}
          {assignmentType === 'standard' && (
            <div style={{ display: activeStudioTab === 'content' ? 'block' : 'none' }}>
              <ScenariosEditor scenarios={scenarios} onChange={setScenarios} C={C} embedded />
            </div>
          )}

          {/* -- Section: Resources --- */}
          <section style={{ ...tabPanelSectionStyle, display: activeStudioTab === 'resources' ? 'block' : 'none', marginBottom: 28, paddingBottom: 28, borderBottom: `1px solid ${C.divider}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div>
                <p style={sectionEyebrowStyle}>Learner resources</p>
                <h3 style={{ fontSize: 17, fontWeight: 750, color: C.text, margin: 0 }}>Reference material</h3>
                <p style={{ ...hintStyle(C), marginTop: 6 }}>Attach links or files learners can use while completing the work.</p>
              </div>
              <button type="button" onClick={addResource}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 11, border: 'none', background: C.cta, color: C.ctaText, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                <Plus style={{ width: 14, height: 14 }}/> Add Resource
              </button>
            </div>

            {resources.length === 0 && (
              <div style={{ textAlign: 'center', color: C.faint, fontSize: 12.5, padding: '30px 18px', borderRadius: 15, background: C.page }}>
                <LinkIcon style={{ width: 20, height: 20, margin: '0 auto 8px', color: C.cta }}/>
                No resources yet. Add a link or file when learners need supporting material.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {resources.map(resource => (
                <div key={resource.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, alignItems: 'center', padding: 16, borderRadius: 15, background: C.page }}>
                  <input type="text" placeholder="Resource name" value={resource.name}
                    onChange={e => updateResource(resource.id, 'name', sanitizePlainText(e.target.value))}
                    style={{ ...inputStyle(C), width: '100%' }} maxLength={200}/>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input type="url" placeholder={resource.resource_type === 'file' ? 'Upload a file or paste URL...' : 'https://...'} value={resource.url}
                      onChange={e => updateResource(resource.id, 'url', e.target.value)}
                      style={{ ...inputStyle(C), width: '100%', flex: 1 }}/>
                    {resource.resource_type === 'file' && (
                      <>
                        <input type="file" style={{ display: 'none' }} ref={el => { resourceFileRefs.current[resource.id] = el; }}
                          onChange={e => handleResourceFileUpload(resource.id, e)}/>
                        <button type="button" onClick={() => resourceFileRefs.current[resource.id]?.click()} disabled={resourceUploading[resource.id]}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, minHeight: 44, padding: '9px 12px', borderRadius: 11, border: 'none', background: C.pill, color: C.muted, fontSize: 11.5, fontWeight: 700, cursor: resourceUploading[resource.id] ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          {resourceUploading[resource.id] ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin"/> : <Upload style={{ width: 12, height: 12 }}/>}
                          {resourceUploading[resource.id] ? 'Uploading...' : 'Upload'}
                        </button>
                      </>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['link', 'file'] as const).map(t => (
                      <button key={t} type="button" onClick={() => updateResource(resource.id, 'resource_type', t)}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 11px', borderRadius: 9, border: 'none', background: resource.resource_type === t ? `${C.cta}14` : C.card, color: resource.resource_type === t ? C.cta : C.muted, fontSize: 11.5, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s' }}>
                        <LinkIcon style={{ width: 11, height: 11 }}/> {t}
                      </button>
                    ))}
                  </div>
                  <button type="button" onClick={() => removeResource(resource.id)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 10, border: 'none', background: C.deleteBg, color: C.deleteText, cursor: 'pointer', flexShrink: 0 }}>
                    <Trash2 style={{ width: 14, height: 14 }}/>
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* -- Section: Solution files (released after grading) --- */}
          <section style={{ ...tabPanelSectionStyle, display: activeStudioTab === 'resources' ? 'block' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
              <div>
                <p style={sectionEyebrowStyle}>Post-grade release</p>
                <h3 style={{ fontSize: 17, fontWeight: 750, color: C.text, margin: 0 }}>Solution files</h3>
                <p style={{ ...hintStyle(C), marginTop: 4 }}>
                  The model answer. A student can only see and download these once their own submission has been graded.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <input type="file" multiple style={{ display: 'none' }} ref={solutionFileRef}
                  accept={[...ALLOWED_SOLUTION_EXTENSIONS].join(',')}
                  onChange={handleSolutionFileUpload}/>
                <button type="button" onClick={() => solutionFileRef.current?.click()} disabled={solutionUploading}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 11, border: 'none', background: C.cta, color: C.ctaText, fontSize: 12, fontWeight: 700, cursor: solutionUploading ? 'not-allowed' : 'pointer', opacity: solutionUploading ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                  {solutionUploading ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin"/> : <Upload style={{ width: 14, height: 14 }}/>}
                  {solutionUploading ? 'Uploading...' : 'Upload files'}
                </button>
                <button type="button" onClick={addSolutionLink}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 14px', borderRadius: 11, border: 'none', background: C.pill, color: C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <LinkIcon style={{ width: 14, height: 14 }}/> Add link
                </button>
              </div>
            </div>

            {solutions.length === 0 ? (
              <div style={{ textAlign: 'center', color: C.faint, fontSize: 12.5, padding: '30px 18px', borderRadius: 15, background: C.page }}>
                <FileText style={{ width: 20, height: 20, margin: '0 auto 8px', color: C.cta }}/>
                No solutions yet. Upload a worked answer or link a walkthrough for release after grading.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {solutions.map(s => (
                  <div key={s.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, alignItems: 'center', padding: 16, borderRadius: 15, background: C.page }}>
                    <input type="text" placeholder="Solution name" value={s.name}
                      onChange={e => updateSolution(s.id, 'name', sanitizePlainText(e.target.value))}
                      style={{ ...inputStyle(C), width: '100%' }} maxLength={200}/>
                    {s.kind === 'link' && (
                      <input type="url" placeholder="https://" value={s.url ?? ''}
                        onChange={e => updateSolution(s.id, 'url', e.target.value)}
                        style={{ ...inputStyle(C), width: '100%' }}/>
                    )}
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '8px 10px', borderRadius: 9, background: C.card, color: C.muted, fontSize: 11.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {s.kind === 'file'
                        ? <><FileText style={{ width: 11, height: 11 }}/> Private file</>
                        : <><LinkIcon style={{ width: 11, height: 11 }}/> Link</>}
                    </span>
                    <button type="button" onClick={() => removeSolution(s.id)}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 10, border: 'none', background: C.deleteBg, color: C.deleteText, cursor: 'pointer', flexShrink: 0 }}>
                      <Trash2 style={{ width: 14, height: 14 }}/>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* -- Section: Settings --- */}
          <section style={{ ...tabPanelSectionStyle, display: activeStudioTab === 'settings' ? 'block' : 'none', marginBottom: 28, paddingBottom: 28, borderBottom: `1px solid ${C.divider}` }}>
            <p style={sectionEyebrowStyle}>Rules and timing</p>
            <h3 style={{ fontSize: 17, fontWeight: 750, color: C.text, margin: 0 }}>Assignment settings</h3>
            <p style={{ ...hintStyle(C), margin: '7px 0 18px' }}>Connect the course, set expectations, and define how success is measured.</p>

            <div style={{ ...fieldGroupStyle, marginBottom: 12 }}>
              <label style={labelStyle(C)}>Related Course</label>
              <select value={relatedCourse} onChange={e => setRelatedCourse(e.target.value)}
                style={{ ...inputStyle(C), appearance: 'auto' }}>
                <option value="">None</option>
                {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>

            <div style={{ ...fieldGroupStyle, marginBottom: 12 }}>
              <label style={labelStyle(C)}>Deadline <span style={{ fontSize: 12, fontWeight: 400, color: C.faint }}>(optional)</span></label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="date"
                  value={deadlineDate}
                  onChange={e => setDeadlineDate(e.target.value)}
                  style={{ ...inputStyle(C), width: 'auto' }}
                />
                {deadlineDate && (
                  <button type="button" onClick={() => setDeadlineDate('')}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 10, border: 'none', background: C.card, color: C.faint, cursor: 'pointer', flexShrink: 0 }}>
                    <X style={{ width: 13, height: 13 }}/>
                  </button>
                )}
              </div>
              <p style={hintStyle(C)}>Students will see a countdown on their assignment card until this date.</p>
            </div>

            <div style={{ ...fieldGroupStyle, marginBottom: 12 }}>
              <label style={labelStyle(C)}>Passing score</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number" min={1} max={100}
                  value={passingScore}
                  onChange={e => setPassingScore(Math.min(100, Math.max(1, Math.round(Number(e.target.value) || DEFAULT_PASS_MARK))))}
                  style={{ ...inputStyle(C), width: 'auto' }}
                />
                <span style={{ fontSize: 13, color: C.faint }}>/ 100</span>
              </div>
              <p style={hintStyle(C)}>The grade a submission needs to pass. Below it the student can resubmit; at or above it the work is passed{assignmentType === 'standard' ? ' and the solution files are released' : ''}. Defaults to {DEFAULT_PASS_MARK}.</p>
            </div>

            {/* Submission Instructions is retired from the Standard flow (task instructions +
                Overview cover it). Shown only when a legacy assignment already has content, so
                editing does not silently drop it. */}
            {submissionInstructions.trim() !== '' && (
              <div>
                <label style={labelStyle(C)}>Submission Instructions <span style={{ fontSize: 12, fontWeight: 400, color: C.faint }}>(legacy - not shown to students)</span></label>
                <RichTextEditor value={submissionInstructions} onChange={setSubmissionInstructions} placeholder="How should students submit their work?" enableAiAssist />
              </div>
            )}
          </section>

          {/* -- Target Audience --- */}
          <section style={{ ...tabPanelSectionStyle, display: activeStudioTab === 'settings' ? 'block' : 'none' }}>
            <p style={sectionEyebrowStyle}>Assignment access</p>
            <h3 style={{ fontSize: 17, fontWeight: 750, color: C.text, margin: 0 }}>Target audience</h3>
            <p style={{ ...hintStyle(C), margin: '7px 0 16px' }}>Choose whether this assignment is delivered to complete cohorts or selected groups.</p>
            {/* Mode toggle */}
            <div style={{ display: 'flex', gap: 4, padding: 5, marginBottom: 16, borderRadius: 12, background: C.page, width: 'fit-content' }}>
              {(['cohorts', 'groups'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setAudienceMode(mode)}
                  style={{
                    padding: '8px 18px', borderRadius: 9, fontSize: 12, fontWeight: 700, border: 'none', cursor: 'pointer',
                    background: audienceMode === mode ? C.card : 'transparent',
                    color: audienceMode === mode ? C.cta : C.muted,
                    transition: 'background 0.15s',
                    textTransform: 'capitalize',
                  }}>
                  {mode}
                </button>
              ))}
            </div>

            {audienceMode === 'cohorts' && (
              cohorts.length === 0
                ? <p style={{ fontSize: 13, color: C.faint }}>No cohorts available.</p>
                : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
                    {cohorts.map(c => (
                      <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '11px 13px', borderRadius: 12, background: selectedCohortIds.includes(c.id) ? `${C.cta}0e` : C.page, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selectedCohortIds.includes(c.id)} onChange={() => toggleCohort(c.id)}
                          style={{ width: 16, height: 16, accentColor: C.cta, cursor: 'pointer' }}/>
                        <span style={{ fontSize: 14, color: C.text }}>{c.name}</span>
                      </label>
                    ))}
                  </div>
            )}

            {audienceMode === 'groups' && (
              groups.length === 0
                ? <p style={{ fontSize: 13, color: C.faint }}>No groups yet. Create groups from the <Link href="/admin/groups" style={{ color: C.cta }}>Groups admin page</Link>.</p>
                : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 }}>
                    {groups.map(g => {
                      const cohortName = cohorts.find(c => c.id === g.cohort_id)?.name;
                      return (
                        <label key={g.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, padding: '11px 13px', borderRadius: 12, background: selectedGroupIds.includes(g.id) ? `${C.cta}0e` : C.page, cursor: 'pointer' }}>
                          <input type="checkbox" checked={selectedGroupIds.includes(g.id)} onChange={() => toggleGroup(g.id)}
                            style={{ width: 16, height: 16, accentColor: C.cta, cursor: 'pointer' }}/>
                          <span style={{ fontSize: 14, color: C.text }}>{g.name}</span>
                          {cohortName && <span style={{ fontSize: 12, color: C.faint }}>{cohortName}</span>}
                        </label>
                      );
                    })}
                  </div>
            )}
          </section>

          <section style={{ ...tabPanelSectionStyle, display: activeStudioTab === 'publish' ? 'block' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
              <div>
                <p style={{ color: C.cta, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.14em', margin: 0 }}>Publish readiness</p>
                <h2 style={{ fontSize: 17, fontWeight: 750, color: C.text, margin: '5px 0 0' }}>{readinessComplete === readinessChecks.length ? 'Ready to assign' : `${readinessChecks.length - readinessComplete} items need attention`}</h2>
              </div>
              <span style={{ padding: '7px 11px', borderRadius: 10, background: readinessComplete === readinessChecks.length ? '#22c55e18' : `${C.cta}12`, color: readinessComplete === readinessChecks.length ? '#22c55e' : C.cta, fontSize: 12, fontWeight: 800 }}>{readinessComplete}/{readinessChecks.length}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8, marginBottom: 20 }}>
              {readinessChecks.map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 42, borderRadius: 12, padding: '9px 11px', background: C.page }}>
                  {item.complete
                    ? <CheckCircle2 style={{ width: 15, height: 15, color: '#22c55e', flexShrink: 0 }}/>
                    : <Circle style={{ width: 15, height: 15, color: C.faint, flexShrink: 0 }}/>
                  }
                  <span style={{ color: item.complete ? C.text : C.faint, fontSize: 12, fontWeight: 600 }}>{item.label}</span>
                </div>
              ))}
            </div>
            <label style={labelStyle(C)}>Publishing status</label>
            <div style={{ display: 'flex', gap: 6, padding: 5, borderRadius: 12, background: C.page, width: 'fit-content' }}>
              {(['draft', 'published'] as const).map(s => (
                <button key={s} type="button" onClick={() => setStatus(s)} style={{ minHeight: 38, padding: '8px 16px', borderRadius: 9, border: 'none', background: status === s ? C.cta : 'transparent', color: status === s ? C.ctaText : C.muted, fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize', transition: 'all .15s ease' }}>{s}</button>
              ))}
            </div>
          </section>

          </section>

        </form>
      </main>

      <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 55, display: 'flex', alignItems: 'center', gap: 8, padding: 8, maxWidth: 'calc(100vw - 32px)', borderRadius: 15, background: C.card, border: `1px solid ${C.cardBorder}`, boxShadow: isDark ? '0 16px 42px rgba(0,0,0,.45)' : '0 16px 42px rgba(15,23,42,.16)' }}>
        <motion.button type="submit" form="assignment-form" disabled={loading} whileTap={{ scale: 0.97 }} style={{ display: 'flex', alignItems: 'center', gap: 7, minHeight: 40, padding: '9px 16px', borderRadius: 10, border: 'none', cursor: loading ? 'not-allowed' : 'pointer', background: C.cta, color: C.ctaText, fontSize: 13, fontWeight: 750, opacity: loading ? .65 : 1 }}>
          {loading
            ? <Loader2 style={{ width: 15, height: 15 }} className="animate-spin"/>
            : <Save style={{ width: 15, height: 15 }}/>
          }
          {loading ? 'Saving...' : editId ? 'Update assignment' : status === 'draft' ? 'Save draft' : 'Publish'}
        </motion.button>
      </div>

      {/* Preview Modal */}
      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', background: C.page }}
          >
            {/* Learner preview chrome -- the assignment body below uses the real student renderer. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '12px 20px', background: C.card, borderBottom: `1px solid ${C.cardBorder}`, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ position: 'relative', width: 10, height: 10, display: 'grid', placeItems: 'center' }} aria-hidden="true">
                  <span className="animate-ping" style={{ position: 'absolute', width: 10, height: 10, borderRadius: '50%', background: C.cta, opacity: .2 }}/>
                  <span style={{ position: 'relative', width: 6, height: 6, borderRadius: '50%', background: C.cta }}/>
                </span>
                <div>
                  <p style={{ fontSize: 11.5, fontWeight: 750, color: C.text, margin: 0 }}>Student preview</p>
                  <p style={{ fontSize: 10.5, color: C.faint, margin: '2px 0 0' }}>Rendered with the learner experience. Preview activity is not saved.</p>
                </div>
              </div>
              <button onClick={() => setShowPreview(false)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, border: 'none', background: C.pill, color: C.muted, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                <X style={{ width: 12, height: 12 }}/> Exit Preview
              </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '28px 18px 48px' }}>
              {/* VE-type: show AssignmentExperiencePlayer */}
              {assignmentType === 'virtual_experience' && previewVeConfig && (
                <AssignmentExperiencePlayer
                  formId={veFormId || 'preview'}
                  config={previewVeConfig}
                  userId="preview"
                  studentName="Instructor Preview"
                  studentEmail="preview@instructor"
                  sessionToken=""
                  isDark={C.page === DARK_C.page}
                  onComplete={() => {}}
                  previewMode={true}
                />
              )}

              {assignmentType === 'virtual_experience' && !previewVeConfig && (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: C.faint, fontSize: 14 }}>
                  {veFormId ? 'Could not load Virtual Experience config.' : 'Select a Virtual Experience to preview it.'}
                </div>
              )}

              {/* Standard with scenarios: show the real plain player in preview mode */}
              {assignmentType === 'standard' && scenarios.length > 0 && (
                <div style={{ maxWidth: 1180, margin: '0 auto' }}>
                  <StandardAssignmentPlayer
                    assignmentId={editId || 'preview'}
                    config={{ scenarios, introDoc, introBody }}
                    userId="preview"
                    previewMode
                    title={title || 'Untitled Assignment'}
                    coverImage={coverImage}
                    deadline={deadlineDate}
                    courseTitle={courses.find(c => c.id === relatedCourse)?.title}
                    resources={resources.filter(r => r.url.trim()).map(r => ({ id: r.id, name: r.name, url: r.url, resource_type: r.resource_type }))}
                  />
                </div>
              )}

              {/* Non-VE types (legacy AI + empty standard): show assignment content */}
              {assignmentType !== 'virtual_experience' && !(assignmentType === 'standard' && scenarios.length > 0) && (
                <div style={{ maxWidth: 900, margin: '0 auto' }}>
                  <div style={{ borderRadius: 20, overflow: 'hidden', background: C.card, border: isDark ? 'none' : `1px solid ${C.cardBorder}`, marginBottom: 16 }}>
                    {coverImage && (
                      <div style={{ padding: '16px 16px 0' }}>
                        <img src={resolveCoverUrl(coverImage)} alt={title} style={{ width: '100%', objectFit: 'cover', borderRadius: 12, maxHeight: 220 }} onError={e => (e.target as HTMLImageElement).style.display = 'none'}/>
                      </div>
                    )}
                    <div style={{ padding: '20px 24px' }}>
                      <h2 style={{ fontSize: 17, fontWeight: 700, color: C.text, margin: '0 0 4px' }}>{title || 'Untitled Assignment'}</h2>
                      <span style={{ fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: C.lime, color: C.cta }}>
                        {ASSIGNMENT_TYPES.find(t => t.value === assignmentType)?.label}
                      </span>
                    </div>
                    {scenario && (
                      <>
                        <div style={{ borderTop: `1px solid ${C.divider}` }}/>
                        <div style={{ padding: '16px 24px' }}>
                          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.faint, marginBottom: 8 }}>Scenario</p>
                          <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(scenario) }}/>
                        </div>
                      </>
                    )}
                    {brief && (
                      <>
                        <div style={{ borderTop: `1px solid ${C.divider}` }}/>
                        <div style={{ padding: '16px 24px' }}>
                          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.faint, marginBottom: 8 }}>Brief</p>
                          <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(brief) }}/>
                        </div>
                      </>
                    )}
                    {tasks && (
                      <>
                        <div style={{ borderTop: `1px solid ${C.divider}` }}/>
                        <div style={{ padding: '16px 24px' }}>
                          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.faint, marginBottom: 8 }}>Tasks</p>
                          <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(tasks) }}/>
                        </div>
                      </>
                    )}
                    {requirements && (
                      <>
                        <div style={{ borderTop: `1px solid ${C.divider}` }}/>
                        <div style={{ padding: '16px 24px' }}>
                          <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.faint, marginBottom: 8 }}>Requirements</p>
                          <div className="rich-content" dangerouslySetInnerHTML={{ __html: sanitizeRichText(requirements) }}/>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Submission area placeholder */}
                  <div style={{ borderRadius: 20, background: C.card, border: isDark ? 'none' : `1px solid ${C.cardBorder}`, padding: 24 }}>
                    <p style={{ ...sectionEyebrowStyle, marginBottom: 6 }}>Submission workspace</p>
                    <p style={{ fontSize: 15, fontWeight: 750, color: C.text, marginBottom: 14, marginTop: 0 }}>Your submission</p>
                    {assignmentType === 'standard' && (
                      <>
                        <div style={{ height: 80, borderRadius: 10, border: `1px solid ${C.cardBorder}`, background: C.input, marginBottom: 12 }}/>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <div style={{ height: 36, flex: 1, borderRadius: 10, border: `1px solid ${C.cardBorder}`, background: C.input }}/>
                          <div style={{ height: 36, flex: 1, borderRadius: 10, border: `1px solid ${C.cardBorder}`, background: C.input }}/>
                        </div>
                      </>
                    )}
                    {assignmentType !== 'standard' && (
                      <p style={{ fontSize: 13, color: C.faint, margin: 0 }}>
                        {assignmentType === 'code_review' && 'Students paste their SQL / code here and get AI feedback.'}
                        {assignmentType === 'excel_review' && 'Students upload their spreadsheet and get AI feedback.'}
                        {assignmentType === 'dashboard_critique' && 'Students upload a dashboard screenshot and get AI critique.'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
