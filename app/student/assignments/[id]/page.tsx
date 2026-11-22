'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardList, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useC } from '@/lib/theme';
import { AssignmentDetail } from '@/components/student/assignments';
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
    return (
      <main style={{ minHeight: '100vh', background: C.page, display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: C.faint, fontSize: 13, fontWeight: 600 }}>
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: C.green }}/> Loading assignment…
        </div>
      </main>
    );
  }

  if (error || !assignment || !learner) {
    return (
      <main style={{ minHeight: '100vh', background: C.page, display: 'grid', placeItems: 'center', padding: 24 }}>
        <section style={{ width: 'min(100%, 480px)', padding: 28, borderRadius: 20, textAlign: 'center', background: C.card, border: `1px solid ${C.divider}` }}>
          <span style={{ width: 46, height: 46, margin: '0 auto 14px', display: 'grid', placeItems: 'center', borderRadius: 14, background: C.pill }}>
            <ClipboardList className="w-5 h-5" style={{ color: C.green }}/>
          </span>
          <h1 style={{ color: C.text, fontSize: 20, fontWeight: 700, margin: 0, fontFamily: DISPLAY_FONT }}>Assignment unavailable</h1>
          <p style={{ color: C.faint, fontSize: 13, lineHeight: 1.6, margin: '8px 0 18px' }}>{error || 'This assignment could not be loaded.'}</p>
          <button type="button" onClick={() => router.push('/student#assignments')} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '9px 14px', borderRadius: 11, border: 'none', background: C.cta, color: C.ctaText, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <ArrowLeft className="w-3.5 h-3.5"/> Back to assignments
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
