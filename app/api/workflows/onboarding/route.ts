/**
 * Onboarding email sequence -- powered by Upstash Workflow.
 * Durable multi-step flow that survives server restarts and Vercel cold starts.
 *
 * Steps:
 *   Immediately   Welcome email
 *   Day 3         Check-in: did they start a course?
 *   Day 7         Encouragement: celebrate progress or nudge if stalled
 */
import { serve } from '@upstash/workflow/nextjs';
import { Resend } from 'resend';
import { adminClient } from '@/lib/admin-client';
import { addToResendAudience } from '@/lib/resend-audience';
import {
  welcomeEmail,
  day3CheckInEmail,
  day7EncouragementEmail,
} from '@/lib/email-templates';
import { getTenantSettings } from '@/lib/get-tenant-settings';
import { applyEmailTemplate } from '@/lib/email-template-service';

const resend = new Resend(process.env.RESEND_API_KEY);

const DAY = 24 * 60 * 60 * 1000; // ms

export const { POST } = serve<{ email: string; name: string; userId: string }>(
  async (context) => {
    const { email, name, userId } = context.requestPayload;
    const supabase = adminClient();

    // -- Step 1: Welcome email (immediate) ---
    await context.run('send-welcome', async () => {
      const t        = await getTenantSettings();
      const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
      const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

      // Add to the Resend audience (backstop -- students are normally added at
      // admission time; this covers self-serve signups that skip provisioning).
      await addToResendAudience({ email, name });

      const studentUrl = `${t.appUrl}/student`;
      const fallbackSubject = `Welcome to ${t.appName}, ${name}!`;
      const fallbackHtml = welcomeEmail({ name, studentUrl, branding });
      const rendered = await applyEmailTemplate({ key: 'onboarding_welcome', fallbackSubject, fallbackHtml, variables: { student_name: name, app_name: t.appName }, branding, actionUrl: studentUrl });
      await resend.emails.send({ from: FROM, to: email, subject: rendered.subject, html: rendered.html });
    });

    // -- Wait 3 days ---
    await context.sleep('wait-3-days', 3 * DAY / 1000); // Upstash sleep takes seconds

    // -- Step 2: Day-3 check-in ---
    await context.run('day3-checkin', async () => {
      const t        = await getTenantSettings();
      const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
      const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

      const { data: student } = await supabase
        .from('students')
        .select('cohort_id')
        .eq('id', userId)
        .single();

      let courseTitle: string | undefined;
      let courseUrl:   string | undefined;

      if (student?.cohort_id) {
        const { data: course } = await supabase
          .from('courses')
          .select('title, slug, id')
          .contains('cohort_ids', [student.cohort_id])
          .eq('status', 'published')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (course) {
          courseTitle = course.title;
          courseUrl   = `${t.appUrl}/${course.slug || course.id}?go=1`;
        }
      }

      const studentUrl = `${t.appUrl}/student`;
      const fallbackSubject = `${name}, your courses are waiting for you`;
      const fallbackHtml = day3CheckInEmail({ name, studentUrl, courseTitle, courseUrl, branding });
      const rendered = await applyEmailTemplate({ key: 'onboarding_day3', fallbackSubject, fallbackHtml, variables: { student_name: name, content_title: courseTitle || 'your courses', app_name: t.appName }, branding, actionUrl: courseUrl || studentUrl });
      await resend.emails.send({ from: FROM, to: email, subject: rendered.subject, html: rendered.html });
    });

    // -- Wait 4 more days (7 days total) ---
    await context.sleep('wait-4-more-days', 4 * DAY / 1000);

    // -- Step 3: Day-7 encouragement ---
    await context.run('day7-encouragement', async () => {
      const t        = await getTenantSettings();
      const FROM     = process.env.RESEND_FROM_EMAIL || `${t.senderName} <${t.supportEmail}>`;
      const branding = { logoUrl: t.logoUrl, emailBannerUrl: t.emailBannerUrl, teamName: t.teamName, appName: t.appName, appUrl: t.appUrl };

      const { data: attempts } = await supabase
        .from('course_attempts')
        .select('course_id')
        .eq('student_id', userId)
        .eq('passed', true)
        .not('completed_at', 'is', null);

      const completedCourseIds = [...new Set((attempts ?? []).map((a: any) => a.course_id))];
      const coursesCompleted = completedCourseIds.length;
      const hasStarted       = (attempts ?? []).length > 0 || coursesCompleted > 0;

      const fallbackSubject = coursesCompleted > 0
          ? `${name}, look how far you have come! 🏆`
          : hasStarted
            ? `Keep going, ${name} -- you are almost there! 💪`
            : `${name}, your learning journey is still waiting for you`;
      const studentUrl = `${t.appUrl}/student`;
      const fallbackHtml = day7EncouragementEmail({ name, studentUrl, hasStarted, coursesCompleted, branding });
      const rendered = await applyEmailTemplate({ key: 'onboarding_day7', fallbackSubject, fallbackHtml, variables: { student_name: name, completed_count: coursesCompleted, app_name: t.appName }, branding, actionUrl: studentUrl });
      await resend.emails.send({ from: FROM, to: email, subject: rendered.subject, html: rendered.html });
    });
  },
);
