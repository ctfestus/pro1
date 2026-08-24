import { NextRequest, NextResponse } from 'next/server';
import { requireUser, isAuthError } from '@/lib/api-auth';
import { parseReviewNotes } from '@/lib/reviewRecord';
import { loadCertificate } from '@/lib/certificate';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { readFileSync } from 'fs';
import { join } from 'path';
import JSZip from 'jszip';

export const dynamic = 'force-dynamic';

function inferTopics(questions: any[]): string[] {
  const topicMap: Record<string, string> = {
    sql_exercise:       'SQL',
    sql_review:         'SQL',
    sql_playground:     'SQL',
    python_exercise:    'Python',
    python_review:      'Python',
    excel_review:       'Excel',
    dashboard_critique: 'Data Visualization',
    code_review:        'Programming',
    document_review:    'Business Analysis',
  };
  const found = new Set<string>();
  for (const q of questions ?? []) {
    const topic = topicMap[q.type as string];
    if (topic) found.add(topic);
  }
  return [...found];
}

function extractModuleTitles(modules: any[]): string[] {
  return (modules ?? []).map((m: any) => m.title ?? m.name).filter(Boolean);
}

// Build the LinkedIn "Add to profile" deep link that prefills the
// Licenses and Certifications form. Mirrors the buttons on the certificate
// and badge pages.
function buildLinkedInAddUrl(opts: {
  name: string;
  organizationName?: string;
  issuedAt: string;
  credentialId: string;
  credentialUrl: string;
}): string {
  const d = new Date(opts.issuedAt);
  const params = new URLSearchParams({
    startTask:  'CERTIFICATION_NAME',
    name:       opts.name,
    issueYear:  String(d.getFullYear()),
    issueMonth: String(d.getMonth() + 1),
    certId:     opts.credentialId,
    certUrl:    opts.credentialUrl,
  });
  if (opts.organizationName) params.set('organizationName', opts.organizationName);
  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

// GET /api/linkedin
// Returns linkedin-builder.zip containing:
// linkedin-builder/SKILL.md -- the Claude skill
// linkedin-builder/linkedin-data.json -- the student's complete record with
// ready-to-paste LinkedIn field values and one-click add links.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthError(auth)) return auth.error;
  const { user, serviceDb: supabase } = auth;

  try {
    const tenant = await getTenantSettings();
    const baseUrl = (tenant.appUrl || req.nextUrl.origin).replace(/\/$/, '');
    // App / Platform Name is the primary display name; Organisation Name is the backup.
    const platformName = tenant.appName || tenant.orgName || '';

    const { data: student } = await supabase
      .from('students')
      .select('full_name, email, skills, bio')
      .eq('id', user.id)
      .single();

    const { data: courseAttempts } = await supabase
      .from('course_attempts')
      .select('score, passed, completed_at, course_id')
      .eq('student_id', user.id)
      .not('completed_at', 'is', null)
      .eq('passed', true);

    const courseIds = [...new Set((courseAttempts ?? []).map((a: any) => a.course_id).filter(Boolean))];
    const { data: courseRows } = courseIds.length
      ? await supabase.from('courses').select('id, title, description, learn_outcomes, category, questions').in('id', courseIds)
      : { data: [] };
    const courseMap = Object.fromEntries((courseRows ?? []).map((r: any) => [r.id, r]));

    const { data: veAttempts } = await supabase
      .from('guided_project_attempts')
      .select('completed_at, ve_id')
      .eq('student_id', user.id)
      .not('completed_at', 'is', null);

    const veIds = [...new Set((veAttempts ?? []).map((a: any) => a.ve_id).filter(Boolean))];
    const { data: veRows } = veIds.length
      ? await supabase
          .from('virtual_experiences')
          .select('id, title, description, tagline, industry, role, company, tools, learn_outcomes, background, difficulty, duration, modules')
          .in('id', veIds)
      : { data: [] };
    const veMap = Object.fromEntries((veRows ?? []).map((r: any) => [r.id, r]));

    const { data: submissions } = await supabase
      .from('assignment_submissions')
      .select('score, submitted_at, status, feedback, assignment_id')
      .eq('student_id', user.id)
      .in('status', ['submitted', 'graded'])
      .not('feedback', 'is', null);

    const assignmentIds = [...new Set((submissions ?? []).map((s: any) => s.assignment_id).filter(Boolean))];
    const { data: assignmentRows } = assignmentIds.length
      ? await supabase.from('assignments').select('id, title, type, scenario, brief, tasks').in('id', assignmentIds)
      : { data: [] };
    const assignmentMap = Object.fromEntries((assignmentRows ?? []).map((r: any) => [r.id, r]));

    const { data: pathProgress } = await supabase
      .from('learning_path_progress')
      .select('learning_path_id, completed_item_ids, completed_at, cert_id')
      .eq('student_id', user.id);

    const pathIds = [...new Set((pathProgress ?? []).map((p: any) => p.learning_path_id).filter(Boolean))];
    const { data: pathRows } = pathIds.length
      ? await supabase.from('learning_paths').select('id, title, description, item_ids').in('id', pathIds)
      : { data: [] };
    const pathMap = Object.fromEntries((pathRows ?? []).map((r: any) => [r.id, r]));

    // Resolve learning-path item titles, reusing the course/VE maps and
    // fetching any path items the student did not complete individually.
    const itemTitleMap: Record<string, string> = {};
    const allItemIds = [...new Set((pathRows ?? []).flatMap((r: any) => (r.item_ids ?? []) as string[]))];
    for (const id of allItemIds) {
      if (courseMap[id]?.title) itemTitleMap[id] = courseMap[id].title;
      else if (veMap[id]?.title) itemTitleMap[id] = veMap[id].title;
    }
    const missingItemIds = allItemIds.filter((id) => !itemTitleMap[id]);
    if (missingItemIds.length) {
      const [{ data: mc }, { data: mv }] = await Promise.all([
        supabase.from('courses').select('id, title').in('id', missingItemIds),
        supabase.from('virtual_experiences').select('id, title').in('id', missingItemIds),
      ]);
      for (const r of (mc ?? [])) itemTitleMap[r.id] = r.title;
      for (const r of (mv ?? [])) itemTitleMap[r.id] = r.title;
    }

    const { data: certRows } = await supabase
      .from('certificates')
      .select('id, issued_at, course_id, ve_id, learning_path_id')
      .eq('student_id', user.id)
      .eq('revoked', false)
      .order('issued_at', { ascending: false });

    const resolvedCerts = await Promise.all((certRows ?? []).map(async (c: any) => {
      const result = await loadCertificate(c.id);
      if (result.status !== 'ready') return null;
      const cert = result.data;
      const org = cert.settings?.institutionName || platformName;
      const credentialUrl = `${baseUrl}/certificate/${c.id}`;
      let skills: string[] = [];
      if (c.course_id && courseMap[c.course_id]) skills = inferTopics(courseMap[c.course_id].questions ?? []);
      else if (c.ve_id && veMap[c.ve_id]) skills = (veMap[c.ve_id].tools ?? []).filter(Boolean);
      return {
        name:                cert.courseName,
        type:                cert.certType,
        issuingOrganization: org,
        issueDate:           cert.issueDate,
        issueYear:           new Date(cert.issuedAt).getFullYear(),
        issueMonth:          new Date(cert.issuedAt).getMonth() + 1,
        credentialId:        c.id,
        credentialUrl,
        skills,
        linkedInAddUrl: buildLinkedInAddUrl({
          name: cert.courseName, organizationName: org, issuedAt: cert.issuedAt, credentialId: c.id, credentialUrl,
        }),
      };
    }));
    const certificates = resolvedCerts.filter(Boolean);

    const { data: earnedBadges } = await supabase
      .from('student_badges')
      .select('id, awarded_at, badge_id')
      .eq('student_id', user.id);

    const badgeIds = [...new Set((earnedBadges ?? []).map((b: any) => b.badge_id).filter(Boolean))];
    const { data: badgeRows } = badgeIds.length
      ? await supabase.from('badges').select('id, name, description').in('id', badgeIds)
      : { data: [] };
    const badgeMap = Object.fromEntries((badgeRows ?? []).map((r: any) => [r.id, r]));

    const badges = (earnedBadges ?? []).map((b: any) => {
      const meta = badgeMap[b.badge_id];
      if (!meta?.name) return null;
      const credentialUrl = `${baseUrl}/b/${b.id}`;
      return {
        name:                meta.name,
        description:         meta.description ?? '',
        issuingOrganization: platformName,
        awardedAt:           b.awarded_at,
        awardedYear:         new Date(b.awarded_at).getFullYear(),
        awardedMonth:        new Date(b.awarded_at).getMonth() + 1,
        credentialId:        b.id,
        credentialUrl,
        linkedInAddUrl: buildLinkedInAddUrl({
          name: meta.name, organizationName: platformName, issuedAt: b.awarded_at, credentialId: b.id, credentialUrl,
        }),
      };
    }).filter(Boolean);

    const learningPaths = (pathProgress ?? []).map((p: any) => {
      const path = pathMap[p.learning_path_id];
      if (!path?.title) return null;
      return {
        title:          path.title,
        description:    path.description ?? '',
        items:          (path.item_ids ?? []).map((id: string) => itemTitleMap[id]).filter(Boolean),
        totalItems:     (path.item_ids ?? []).length,
        completedItems: (p.completed_item_ids ?? []).length,
        completed:      !!p.completed_at,
        completedAt:    p.completed_at ?? null,
        certificateId:  p.cert_id ?? null,
      };
    }).filter(Boolean);

    const data = {
      student: {
        name:   student?.full_name ?? '',
        email:  student?.email ?? '',
        skills: student?.skills ?? [],
        bio:    student?.bio ?? '',
      },
      courses: (courseAttempts ?? []).map((a: any) => {
        const c = courseMap[a.course_id] ?? {};
        return {
          title:         c.title ?? '',
          description:   c.description ?? '',
          category:      c.category ?? '',
          learnOutcomes: (c.learn_outcomes ?? []).filter(Boolean),
          skills:        inferTopics(c.questions ?? []),
          score:         a.score,
          completedAt:   a.completed_at,
        };
      }).filter((c: any) => c.title),
      virtualExperiences: (veAttempts ?? []).map((a: any) => {
        const v = veMap[a.ve_id] ?? {};
        return {
          title:         v.title ?? '',
          tagline:       v.tagline ?? '',
          description:   v.description ?? '',
          background:    v.background ?? '',
          industry:      v.industry ?? '',
          role:          v.role ?? '',
          company:       v.company ?? '',
          tools:         (v.tools ?? []).filter(Boolean),
          learnOutcomes: (v.learn_outcomes ?? []).filter(Boolean),
          modules:       extractModuleTitles(v.modules ?? []),
          difficulty:    v.difficulty ?? '',
          duration:      v.duration ?? '',
          completedAt:   a.completed_at,
        };
      }).filter((v: any) => v.title),
      assignments: (submissions ?? []).map((s: any) => {
        const asgn = assignmentMap[s.assignment_id] ?? {};
        const record = s.feedback ? parseReviewNotes(s.feedback) : null;
        const report = record?.report;
        return {
          title:              asgn.title ?? '',
          type:               asgn.type ?? '',
          scenario:           asgn.scenario ?? '',
          brief:              asgn.brief ?? '',
          submittedAt:        s.submitted_at,
          score:              s.score,
          executiveSummary:   report?.executiveSummary ?? '',
          topRecommendations: report?.topRecommendations ?? [],
          skillsDemonstrated: (report?.rubricGrades ?? []).filter((g: any) => g.passed).map((g: any) => g.criterion),
        };
      }).filter((a: any) => a.title),
      learningPaths,
      certificates,
      badges,
    };

    const skillContent = readFileSync(join(process.cwd(), 'lib', 'linkedin-skill.md'), 'utf8')
      .replaceAll('{{PLATFORM_NAME}}', platformName || 'the platform');
    const dataContent  = JSON.stringify(data, null, 2);

    const zip = new JSZip();
    const folder = zip.folder('linkedin-builder')!;
    folder.file('SKILL.md', skillContent);
    folder.file('linkedin-data.json', dataContent);

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':        'application/zip',
        'Content-Disposition': 'attachment; filename="linkedin-builder.zip"',
      },
    });
  } catch (err) {
    console.error('[/api/linkedin]', err);
    return NextResponse.json({ error: 'Failed to generate LinkedIn package' }, { status: 500 });
  }
}
