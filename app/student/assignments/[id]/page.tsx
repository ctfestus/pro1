'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardText } from '@phosphor-icons/react';
import { supabase } from '@/lib/supabase';
import { useC } from '@/lib/theme';
import { AssignmentDetail } from '@/components/student/assignments';
import { Sk } from '@/components/student/shared';
import { getStudentMode, installStudentModeFetchBridge } from '@/lib/student-mode-client';
import { DISPLAY_FONT } from '@/components/dashboard/subscriptions/ui';

type LearnerContext = {
  id: string;
  name: string;
  email: string;
  cohortId: string | null;
  groupIds: string[];
};

export default function StudentAssignmentPage() {
  const C = useC();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const assignmentId = Array.isArray(params.id) ? params.id[0] : params.id;
  const [assignment, setAssignment] = useState<any>(null);
  const [learner, setLearner] = useState<LearnerContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => installStudentModeFetchBridge(), []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          router.replace('/auth');
          return;
        }

        const studentMode = getStudentMode();
        let effectiveId = studentMode?.studentId ?? session.user.id;
        let modeName = studentMode?.name ?? '';
        let modeEmail = studentMode?.email ?? '';

        if (studentMode) {
          const response = await fetch('/api/student-mode', {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            router.replace('/student#assignments');
            return;
          }
          effectiveId = studentMode.studentId;
          modeName = result.name || studentMode.name;
          modeEmail = result.email || studentMode.email;
        }

        const [{ data: student, error: studentError }, { data: memberships }, { data: row, error: assignmentError }] = await Promise.all([
          supabase.from('students').select('full_name, email, cohort_id').eq('id', effectiveId).maybeSingle(),
          supabase.from('group_members').select('group_id').eq('student_id', effectiveId),
          supabase.from('assignments').select('*').eq('id', assignmentId).eq('status', 'published').maybeSingle(),
        ]);

        if (studentError) throw studentError;
        if (assignmentError) throw assignmentError;
        if (!student || !row) throw new Error('This assignment is unavailable or has not been published.');

        const groupIds = (memberships ?? []).map((membership: any) => membership.group_id).filter(Boolean);
        const cohortIds = Array.isArray(row.cohort_ids) ? row.cohort_ids : [];
        const assignedGroupIds = Array.isArray(row.group_ids) ? row.group_ids : [];
        const isAssigned = (student.cohort_id && cohortIds.includes(student.cohort_id))
          || assignedGroupIds.some((groupId: string) => groupIds.includes(groupId));

        if (!isAssigned) throw new Error('This assignment is not assigned to your cohort or group.');

        let course: { title?: string; slug?: string; cover_image?: string } | null = null;
        if (row.related_course) {
          const { data } = await supabase.from('courses').select('title, slug, cover_image').eq('id', row.related_course).maybeSingle();
          course = data;
        }

        if (cancelled) return;
        setLearner({
          id: effectiveId,
          name: modeName || student.full_name || session.user.email?.split('@')[0] || 'Student',
          email: modeEmail || student.email || session.user.email || '',
          cohortId: student.cohort_id ?? null,
          groupIds,
        });
        setAssignment({
          ...row,
          _course_title: course?.title ?? null,
          _course_slug: course?.slug ?? null,
          _course_cover: course?.cover_image ?? null,
        });
        document.title = `${row.title} - Assignment`;
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load this assignment.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (assignmentId) void load();
    return () => { cancelled = true; };
  }, [assignmentId, router]);

  if (loading) {
    // The page's own shape while it loads: back button, details panel, then the brief and
    // submission cards (the panel folds into one line on a phone).
    return (
      <main aria-busy="true" style={{ minHeight: '100vh', background: C.page, padding: '24px clamp(16px,3vw,40px) 56px' }}>
        <span className="sr-only">Loading assignment</span>
        <div style={{ width: 'min(100%, 1280px)', margin: '0 auto' }}>
          <div className="mb-4"><Sk w={120} h={32} r={10}/></div>
          <div className="grid gap-[18px] min-[900px]:grid-cols-[260px_minmax(0,1fr)]">
            <div className="max-[899px]:hidden rounded-xl p-4 self-start grid gap-3.5" style={{ background: C.card }}>
              <Sk w={104} h={24} r={999}/>
              {[0, 1, 2].map(i => <div key={i} className="grid gap-1.5"><Sk w="40%" h={11}/><Sk w="70%" h={15}/></div>)}
            </div>
            <div className="min-w-0 grid gap-4 content-start">
              <div className="min-[900px]:hidden flex gap-3"><Sk w={104} h={24} r={999}/><Sk w={110} h={18}/><Sk w={70} h={18}/></div>
              <div className="rounded-xl px-6 py-5 grid gap-4" style={{ background: C.card }}>
                <Sk w="55%" h={26}/>
                {[0, 1, 2].map(i => (
                  <div key={i} className="flex gap-3"><Sk w={36} h={36} r={8}/><div className="flex-1 grid gap-2"><Sk w="25%" h={14}/><Sk h={13}/><Sk w="80%" h={13}/></div></div>
                ))}
              </div>
              <div className="rounded-xl px-6 py-5 grid gap-3" style={{ background: C.card }}>
                <Sk w="30%" h={18}/>
                <Sk h={110} r={10}/>
                <div className="flex justify-end gap-2.5"><Sk w={100} h={40} r={10}/><Sk w={90} h={40} r={10}/></div>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (error || !assignment || !learner) {
    return (
      <main style={{ minHeight: '100vh', background: C.page, display: 'grid', placeItems: 'center', padding: 24 }}>
        <section style={{ width: 'min(100%, 480px)', padding: 28, borderRadius: 20, textAlign: 'center', background: C.card, border: `1px solid ${C.divider}` }}>
          <span style={{ width: 46, height: 46, margin: '0 auto 14px', display: 'grid', placeItems: 'center', borderRadius: 14, background: C.pill }}>
            <ClipboardText weight="duotone" className="w-5 h-5" style={{ color: C.text }}/>
          </span>
          <h1 style={{ color: C.text, fontSize: 20, fontWeight: 700, margin: 0, fontFamily: DISPLAY_FONT }}>Assignment unavailable</h1>
          <p style={{ color: C.faint, fontSize: 13, lineHeight: 1.6, margin: '8px 0 18px' }}>{error || 'This assignment could not be loaded.'}</p>
          <button type="button" onClick={() => router.push('/student#assignments')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 11, border: 'none', background: C.cta, color: C.ctaText, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <ArrowLeft weight="bold" className="w-3.5 h-3.5"/> Back to assignments
          </button>
        </section>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', background: C.page, padding: '24px clamp(16px,3vw,40px) 56px' }}>
      <div style={{ width: 'min(100%, 1280px)', margin: '0 auto' }}>
        <AssignmentDetail
          assignment={assignment}
          userId={learner.id}
          studentName={learner.name}
          studentEmail={learner.email}
          C={C}
          onBack={() => router.push('/student#assignments')}
        />
      </div>
    </main>
  );
}
