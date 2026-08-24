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

// Prebuilt, skill-seeded job search URLs. These always work regardless of
// whether the Claude session has web search enabled. Each link is filtered to
// recent postings and sorted newest-first so expired roles do not dominate
// (f_TPR/fromage/fromAge/days = recency window; unrecognised params are ignored).
function buildJobSearchLinks(query: string, location: string): Record<string, string> {
  const q = encodeURIComponent(query);
  const loc = encodeURIComponent(location);
  const googleQ = encodeURIComponent(`${query} jobs ${location}`.trim());
  return {
    linkedin:     `https://www.linkedin.com/jobs/search/?keywords=${q}${location ? `&location=${loc}` : ''}&f_TPR=r604800&sortBy=DD`,
    indeed:       `https://www.indeed.com/jobs?q=${q}${location ? `&l=${loc}` : ''}&fromage=7&sort=date`,
    googleJobs:   `https://www.google.com/search?q=${googleQ}&ibp=htl;jobs`,
    glassdoor:    `https://www.glassdoor.com/Job/jobs.htm?sc.keyword=${q}&fromAge=7`,
    ziprecruiter: `https://www.ziprecruiter.com/jobs-search?search=${q}${location ? `&location=${loc}` : ''}&days=5`,
    x:            `https://x.com/search?q=${encodeURIComponent(`${query} hiring`)}&f=live`,
  };
}

// GET /api/job-search
// Returns job-search-kit.zip containing:
// job-search-kit/SKILL.md -- the Claude skill
// job-search-kit/job-search-data.json -- the verified record, a skill profile,
// and prebuilt platform search links seeded with the student's skills and location.
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
      .select('full_name, email, skills, bio, country, city, username, social_links')
      .eq('id', user.id)
      .single();

    const location = [student?.city, student?.country].filter(Boolean).join(', ');

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
      .select('learning_path_id, completed_item_ids, completed_at')
      .eq('student_id', user.id);

    const pathIds = [...new Set((pathProgress ?? []).map((p: any) => p.learning_path_id).filter(Boolean))];
    const { data: pathRows } = pathIds.length
      ? await supabase.from('learning_paths').select('id, title, description, item_ids').in('id', pathIds)
      : { data: [] };
    const pathMap = Object.fromEntries((pathRows ?? []).map((r: any) => [r.id, r]));

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
      return {
        name:                cert.courseName,
        type:                cert.certType,
        issuingOrganization: cert.settings?.institutionName || platformName,
        issueDate:           cert.issueDate,
        credentialUrl:       `${baseUrl}/certificate/${c.id}`,
      };
    }));
    const certificates = resolvedCerts.filter(Boolean);

    // --- Shape the record ---
    const courses = (courseAttempts ?? []).map((a: any) => {
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
    }).filter((c: any) => c.title);

    const virtualExperiences = (veAttempts ?? []).map((a: any) => {
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
    }).filter((v: any) => v.title);

    const assignments = (submissions ?? []).map((s: any) => {
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
    }).filter((a: any) => a.title);

    const learningPaths = (pathProgress ?? []).map((p: any) => {
      const path = pathMap[p.learning_path_id];
      if (!path?.title) return null;
      return {
        title:       path.title,
        description: path.description ?? '',
        completed:   !!p.completed_at,
        completedAt: p.completed_at ?? null,
      };
    }).filter(Boolean);

    // --- Skill profile + job search seeds ---
    const courseSkills = [...new Set(courses.flatMap((c: any) => c.skills))];
    const veTools = [...new Set(virtualExperiences.flatMap((v: any) => v.tools))];
    const assessedCompetencies = [...new Set(assignments.flatMap((a: any) => a.skillsDemonstrated))];
    const studentSkills = Array.isArray(student?.skills) ? student!.skills.filter(Boolean) : [];
    const allSkills = [...new Set([...courseSkills, ...veTools, ...studentSkills])];

    const veRoles = [...new Set(virtualExperiences.map((v: any) => v.role).filter(Boolean))];
    const roleQueries = veRoles.length
      ? veRoles
      : (allSkills.length ? [allSkills.slice(0, 3).join(' ')] : []);
    const byRole = roleQueries.map((role: string) => ({ role, links: buildJobSearchLinks(role, location) }));
    const topSkillsQuery = allSkills.length
      ? { query: allSkills.slice(0, 4).join(' '), links: buildJobSearchLinks(allSkills.slice(0, 4).join(' '), location) }
      : null;

    const data = {
      student: {
        name:        student?.full_name ?? '',
        email:       student?.email ?? '',
        location,
        bio:         student?.bio ?? '',
        username:    student?.username ?? null,
        profileUrl:  student?.username ? `${baseUrl}/s/${student.username}` : null,
        socialLinks: student?.social_links ?? null,
      },
      skills: {
        all:                  allSkills,
        tools:                veTools,
        topics:               courseSkills,
        assessedCompetencies,
      },
      jobSearch: {
        location,
        roles:         roleQueries,
        byRole,
        topSkillsQuery,
      },
      courses,
      virtualExperiences,
      assignments,
      learningPaths,
      certificates,
    };

    const skillContent = readFileSync(join(process.cwd(), 'lib', 'job-search-skill.md'), 'utf8')
      .replaceAll('{{PLATFORM_NAME}}', platformName || 'the platform');
    const dataContent = JSON.stringify(data, null, 2);

    const zip = new JSZip();
    const folder = zip.folder('job-search-kit')!;
    folder.file('SKILL.md', skillContent);
    folder.file('job-search-data.json', dataContent);

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type':        'application/zip',
        'Content-Disposition': 'attachment; filename="job-search-kit.zip"',
      },
    });
  } catch (err) {
    console.error('[/api/job-search]', err);
    return NextResponse.json({ error: 'Failed to generate job search package' }, { status: 500 });
  }
}
