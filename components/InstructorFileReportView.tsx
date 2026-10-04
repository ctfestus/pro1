'use client';

// Renders an instructor's report on an uploaded VE file in the same layout the AI reviewers use.
// Shared by the instructor's preview (dashboard Review panel) and the student's VE details.

import AiStructuredReviewReport from '@/components/AiStructuredReviewReport';
import { INSTRUCTOR_SEVERITY_LABELS, type InstructorFileReport } from '@/lib/ve-instructor-report';

const filled = (list: string[]) => list.map(s => s.trim()).filter(Boolean);

export default function InstructorFileReportView({ report, title, accentColor, isDark }: {
  report: InstructorFileReport;
  title: string;
  accentColor: string;
  isDark: boolean;
}) {
  return (
    <AiStructuredReviewReport
      reportLabel="Instructor review"
      title={title}
      metadata="Reviewed by your instructor"
      score={report.score}
      summary={report.summary}
      // The editor keeps blank rows while typing; never show them.
      findings={report.findings.filter(f => f.title.trim())}
      findingsTitle="Findings in your file"
      severityLabels={INSTRUCTOR_SEVERITY_LABELS}
      metricLabels={{ risks: 'Needs attention' }}
      showCategoryDetails
      categories={report.categories.filter(c => c.name.trim()).map(c => ({ ...c, strengths: filled(c.strengths), gaps: filled(c.gaps) }))}
      recommendations={filled(report.recommendations)}
      accentColor={accentColor}
      isDark={isDark}
    />
  );
}
