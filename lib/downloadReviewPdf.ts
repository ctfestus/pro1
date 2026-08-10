export async function downloadReviewPdf(el: HTMLElement, filename: string): Promise<void> {
  try {
    const html2canvas = (await import('html2canvas')).default;
    const { jsPDF }   = await import('jspdf');

    const canvas  = await html2canvas(el, { scale: 2, useCORS: true, allowTaint: true, logging: false });
    let imgData: string;
    try {
      imgData = canvas.toDataURL('image/png');
    } catch {
      throw new Error('PDF export failed: the review contains cross-origin images that cannot be captured. Try downloading from a different browser.');
    }

    // A4 dimensions in px at 96 dpi
    const pageW    = 794;
    const pageH    = 1123;
    const margin   = 36;
    const contentW = pageW - margin * 2;
    const ratio    = contentW / (canvas.width / 2);
    const scaledH  = (canvas.height / 2) * ratio;
    const contentH = pageH - margin * 2;

    const pdf = new jsPDF({ unit: 'px', format: [pageW, pageH] });

    let yOffset = 0;
    let page    = 0;

    while (yOffset < scaledH) {
      if (page > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', margin, margin - yOffset, contentW, scaledH);
      yOffset += contentH;
      page++;
    }

    pdf.save(filename);
  } catch (err: any) {
    throw new Error(err?.message ?? 'PDF export failed. Please try again.');
  }
}

export interface StructuredReviewPdfData {
  overallScore: number;
  executiveSummary: string;
  reportLabel?: string;
  reportTitle?: string;
  reportKicker?: string;
  sourceLabel?: string;
  findingsTitle?: string;
  locationLabel?: string;
  footerLabel?: string;
  severityLabels?: Partial<Record<'error' | 'warning' | 'suggestion', string>>;
  metricLabels?: Partial<Record<'errors' | 'warnings' | 'opportunities' | 'rubric', string>>;
  language?: string;
  dialect?: string;
  issues: Array<{
    lines?: string;
    severity: 'error' | 'warning' | 'suggestion';
    title: string;
    detail: string;
    fix?: string;
  }>;
  categories: Array<{
    name: string;
    score: number;
    summary: string;
    strengths: string[];
    gaps: string[];
  }>;
  topRecommendations: string[];
  rubricGrades?: Array<{
    criterion: string;
    passed: boolean;
    comment: string;
  }>;
}

type Rgb = [number, number, number];

function hexToRgb(value: string, fallback: Rgb): Rgb {
  const normalized = value.trim().replace('#', '');
  const expanded = normalized.length === 3
    ? normalized.split('').map(character => character + character).join('')
    : normalized;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return fallback;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

export async function downloadStructuredReviewPdf(data: StructuredReviewPdfData, filename: string, accentColor: string): Promise<void> {
  try {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 44;
    const contentWidth = pageWidth - margin * 2;
    const footerSpace = 42;
    const accent = hexToRgb(accentColor, [240, 68, 92]);
    const ink: Rgb = [20, 24, 31];
    const muted: Rgb = [99, 108, 121];
    const line: Rgb = [229, 233, 239];
    const soft: Rgb = [247, 249, 251];
    const white: Rgb = [255, 255, 255];
    const severityColors: Record<StructuredReviewPdfData['issues'][number]['severity'], Rgb> = {
      error: [220, 53, 69],
      warning: [222, 145, 20],
      suggestion: [49, 112, 220],
    };
    let y = margin;

    const setText = (size: number, color: Rgb = ink, weight: 'normal' | 'bold' = 'normal') => {
      pdf.setFont('helvetica', weight);
      pdf.setFontSize(size);
      pdf.setTextColor(...color);
    };
    const wrap = (value: string, width: number, size: number) => {
      pdf.setFontSize(size);
      return pdf.splitTextToSize(value || '', width) as string[];
    };
    const lineHeight = (size: number) => size * 1.42;
    const nextPage = () => {
      pdf.addPage();
      y = margin;
      setText(8, muted, 'bold');
      pdf.text(`${data.reportLabel ?? 'AI CODE INTELLIGENCE'}  /  ${data.reportKicker ?? 'CODE REVIEW'}`, margin, y);
      pdf.setDrawColor(...line);
      pdf.line(margin, y + 10, pageWidth - margin, y + 10);
      y += 30;
    };
    const ensureSpace = (height: number) => {
      if (y + height > pageHeight - footerSpace) nextPage();
    };
    const sectionTitle = (eyebrow: string, title: string) => {
      ensureSpace(42);
      setText(8, accent, 'bold');
      pdf.text(eyebrow.toUpperCase(), margin, y);
      y += 17;
      setText(15, ink, 'bold');
      pdf.text(title, margin, y);
      y += 18;
    };

    // Report identity
    pdf.setFillColor(...accent);
    pdf.roundedRect(margin, y, 8, 8, 4, 4, 'F');
    setText(8, accent, 'bold');
    pdf.text(data.reportLabel ?? 'AI CODE INTELLIGENCE', margin + 16, y + 7);
    const generated = new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date());
    setText(8, muted);
    pdf.text(generated, pageWidth - margin, y + 7, { align: 'right' });
    y += 30;

    // Score and executive summary hero
    const summaryLines = wrap(data.executiveSummary, contentWidth - 148, 10);
    const heroHeight = Math.max(122, 68 + summaryLines.length * lineHeight(10));
    pdf.setFillColor(...soft);
    pdf.roundedRect(margin, y, contentWidth, heroHeight, 14, 14, 'F');
    setText(8, accent, 'bold');
    pdf.text(`${data.reportKicker ?? 'CODE REVIEW'} REPORT`, margin + 20, y + 23);
    setText(21, ink, 'bold');
    pdf.text(data.reportTitle ?? 'Your code review', margin + 20, y + 50);
    setText(8, muted);
    const meta = data.sourceLabel ?? [data.language, data.language === 'SQL' ? data.dialect : undefined].filter(Boolean).join('  /  ');
    if (meta) pdf.text(meta, margin + 20, y + 66);
    setText(10, muted);
    pdf.text(summaryLines, margin + 20, y + 86, { lineHeightFactor: 1.42 });

    const scoreX = pageWidth - margin - 108;
    pdf.setFillColor(...white);
    pdf.roundedRect(scoreX, y + 18, 88, 86, 11, 11, 'F');
    setText(27, ink, 'bold');
    pdf.text(data.overallScore.toFixed(1), scoreX + 44, y + 55, { align: 'center' });
    setText(7, muted, 'bold');
    pdf.text('OUT OF 100', scoreX + 44, y + 70, { align: 'center' });
    pdf.setFillColor(...line);
    pdf.roundedRect(scoreX + 12, y + 83, 64, 6, 3, 3, 'F');
    const scoreProgress = Math.min(100, Math.max(0, data.overallScore));
    if (scoreProgress > 0) {
      pdf.setFillColor(...accent);
      pdf.roundedRect(scoreX + 12, y + 83, Math.max(6, 64 * scoreProgress / 100), 6, 3, 3, 'F');
    }
    y += heroHeight + 14;

    // Snapshot metrics
    const errors = data.issues.filter(issue => issue.severity === 'error').length;
    const warnings = data.issues.filter(issue => issue.severity === 'warning').length;
    const opportunities = data.categories.reduce((count, category) => count + category.gaps.length, 0);
    const rubricPassed = data.rubricGrades?.filter(grade => grade.passed).length ?? 0;
    const rubricTotal = data.rubricGrades?.length ?? 0;
    const metrics = [
      [data.metricLabels?.errors ?? 'ERRORS', String(errors), severityColors.error],
      [data.metricLabels?.warnings ?? 'WARNINGS', String(warnings), severityColors.warning],
      [data.metricLabels?.opportunities ?? 'OPPORTUNITIES', String(opportunities), severityColors.suggestion],
      [data.metricLabels?.rubric ?? 'RUBRIC PASSED', rubricTotal ? `${rubricPassed}/${rubricTotal}` : 'N/A', accent],
    ] as const;
    const metricGap = 8;
    const metricWidth = (contentWidth - metricGap * 3) / 4;
    metrics.forEach(([label, value, color], index) => {
      const x = margin + index * (metricWidth + metricGap);
      pdf.setDrawColor(...line);
      pdf.setFillColor(...white);
      pdf.roundedRect(x, y, metricWidth, 54, 9, 9, 'FD');
      setText(16, color, 'bold');
      pdf.text(value, x + 12, y + 23);
      setText(6.5, muted, 'bold');
      pdf.text(label, x + 12, y + 41);
    });
    y += 72;

    if (data.issues.length > 0) {
      sectionTitle('Diagnostic feed', data.findingsTitle ?? 'Findings in your code');
      data.issues.forEach(issue => {
        const color = severityColors[issue.severity];
        setText(10, ink, 'bold');
        const titleLines = wrap(issue.title, contentWidth - 116, 10);
        setText(9.5, muted);
        const detailLines = wrap(issue.detail, contentWidth - 40, 9.5);
        const fixLines = issue.fix ? wrap(issue.fix, contentWidth - 64, 9.5) : [];
        const titleHeight = titleLines.length * lineHeight(10);
        const detailLineHeight = lineHeight(9.5);
        const baseHeight = 48 + titleHeight;
        let detailIndex = 0;
        let fixIndex = 0;
        let firstFragment = true;

        // A single finding can be taller than a page. Split its detail and fix text into
        // continued cards instead of drawing one oversized card that gets clipped.
        while (firstFragment || detailIndex < detailLines.length || fixIndex < fixLines.length) {
          firstFragment = false;
          const minimumContentHeight = detailIndex < detailLines.length
            ? detailLineHeight
            : fixIndex < fixLines.length ? 28 + detailLineHeight : 0;
          if (pageHeight - footerSpace - y < baseHeight + minimumContentHeight + 9) nextPage();
          const availableHeight = pageHeight - footerSpace - y - 9;
          let remainingHeight = availableHeight - baseHeight;
          const detailStart = detailIndex;
          const fixStart = fixIndex;

          if (detailIndex < detailLines.length) {
            const detailCount = Math.max(1, Math.floor(remainingHeight / detailLineHeight));
            detailIndex = Math.min(detailLines.length, detailIndex + detailCount);
            remainingHeight -= (detailIndex - detailStart) * detailLineHeight;
          }
          if (detailIndex === detailLines.length && fixIndex < fixLines.length && remainingHeight >= 28 + detailLineHeight) {
            const fixCount = Math.max(1, Math.floor((remainingHeight - 28) / detailLineHeight));
            fixIndex = Math.min(fixLines.length, fixIndex + fixCount);
          }

          const detailChunk = detailLines.slice(detailStart, detailIndex);
          const fixChunk = fixLines.slice(fixStart, fixIndex);
          const cardHeight = baseHeight
            + detailChunk.length * detailLineHeight
            + (fixChunk.length ? 28 + fixChunk.length * detailLineHeight : 0);
          const cardTop = y;
          pdf.setFillColor(...soft);
          pdf.roundedRect(margin, cardTop, contentWidth, cardHeight, 11, 11, 'F');
          pdf.setFillColor(...color);
          pdf.roundedRect(margin + 14, cardTop + 17, 7, 7, 3.5, 3.5, 'F');
          setText(7, color, 'bold');
          pdf.text((data.severityLabels?.[issue.severity] ?? issue.severity).toUpperCase(), margin + 30, cardTop + 23);
          if (issue.lines) {
            setText(7, muted, 'bold');
            const location = `${data.locationLabel ?? 'LINE'} ${issue.lines}`;
            pdf.text(location.length > 48 ? `${location.slice(0, 45)}...` : location, pageWidth - margin - 16, cardTop + 23, { align: 'right' });
          }
          setText(10, ink, 'bold');
          pdf.text(titleLines, margin + 30, cardTop + 42, { lineHeightFactor: 1.42 });
          let detailY = cardTop + 45 + titleHeight;
          if (detailChunk.length) {
            setText(9.5, muted);
            pdf.text(detailChunk, margin + 20, detailY, { lineHeightFactor: 1.42 });
            detailY += detailChunk.length * detailLineHeight + 8;
          }
          if (fixChunk.length) {
            const fixHeight = 15 + fixChunk.length * detailLineHeight;
            pdf.setFillColor(...white);
            pdf.roundedRect(margin + 20, detailY, contentWidth - 40, fixHeight, 8, 8, 'F');
            setText(6.5, accent, 'bold');
            pdf.text('RECOMMENDED FIX', margin + 32, detailY + 13);
            setText(9.5, ink);
            pdf.text(fixChunk, margin + 32, detailY + 29, { lineHeightFactor: 1.42 });
          }
          y += cardHeight + 9;
          if (detailIndex < detailLines.length || fixIndex < fixLines.length) nextPage();
        }
      });
      y += 8;
    }

    if (data.categories.length > 0) {
      sectionTitle('Performance matrix', 'Quality by dimension');
      data.categories.forEach(category => {
        const summary = wrap(category.summary, contentWidth - 28, 9);
        const rowHeight = 38 + summary.length * lineHeight(9);
        ensureSpace(rowHeight + 7);
        setText(9.5, ink, 'bold');
        pdf.text(category.name, margin, y + 12);
        const categoryColor: Rgb = category.score >= 80 ? [34, 160, 91] : category.score >= 60 ? [222, 145, 20] : [220, 53, 69];
        setText(10, categoryColor, 'bold');
        pdf.text(String(category.score), pageWidth - margin, y + 12, { align: 'right' });
        pdf.setFillColor(...line);
        pdf.roundedRect(margin, y + 21, contentWidth, 5, 2.5, 2.5, 'F');
        pdf.setFillColor(...categoryColor);
        pdf.roundedRect(margin, y + 21, Math.max(5, contentWidth * Math.min(100, Math.max(0, category.score)) / 100), 5, 2.5, 2.5, 'F');
        setText(9, muted);
        pdf.text(summary, margin, y + 42, { lineHeightFactor: 1.42 });
        y += rowHeight + 7;
      });
      y += 8;
    }

    if (data.rubricGrades?.length) {
      sectionTitle('Rubric signal', 'Requirements check');
      data.rubricGrades.forEach(grade => {
        const comment = wrap(grade.comment, contentWidth - 52, 9);
        const rowHeight = Math.max(40, 27 + comment.length * lineHeight(9));
        ensureSpace(rowHeight + 6);
        pdf.setFillColor(...soft);
        pdf.roundedRect(margin, y, contentWidth, rowHeight, 9, 9, 'F');
        const status: Rgb = grade.passed ? [34, 160, 91] : [139, 146, 158];
        pdf.setFillColor(...status);
        pdf.roundedRect(margin + 14, y + 15, 12, 12, 6, 6, 'F');
        pdf.setDrawColor(...white);
        pdf.setLineWidth(1.2);
        if (grade.passed) {
          pdf.line(margin + 16.5, y + 21, margin + 19, y + 23.5);
          pdf.line(margin + 19, y + 23.5, margin + 24, y + 18.5);
        } else {
          pdf.line(margin + 17, y + 21, margin + 23, y + 21);
        }
        setText(9.5, ink, 'bold');
        pdf.text(grade.criterion, margin + 36, y + 20);
        setText(9, muted);
        pdf.text(comment, margin + 36, y + 36, { lineHeightFactor: 1.42 });
        y += rowHeight + 6;
      });
      y += 8;
    }

    if (data.topRecommendations.length > 0) {
      sectionTitle('Next best actions', 'Your improvement path');
      data.topRecommendations.forEach((recommendation, index) => {
        const lines = wrap(recommendation, contentWidth - 58, 9.5);
        const rowHeight = Math.max(44, 25 + lines.length * lineHeight(9.5));
        ensureSpace(rowHeight + 7);
        pdf.setFillColor(...soft);
        pdf.roundedRect(margin, y, contentWidth, rowHeight, 10, 10, 'F');
        pdf.setFillColor(...accent);
        pdf.roundedRect(margin + 14, y + 12, 22, 22, 7, 7, 'F');
        setText(9, white, 'bold');
        pdf.text(String(index + 1), margin + 25, y + 27, { align: 'center' });
        setText(9.5, ink);
        pdf.text(lines, margin + 48, y + 20, { lineHeightFactor: 1.42 });
        y += rowHeight + 7;
      });
    }

    const pageCount = pdf.getNumberOfPages();
    for (let page = 1; page <= pageCount; page++) {
      pdf.setPage(page);
      pdf.setDrawColor(...line);
      pdf.line(margin, pageHeight - 28, pageWidth - margin, pageHeight - 28);
      setText(7, muted);
      pdf.text(data.footerLabel ?? 'AI-generated feedback | Review recommendations before applying changes.', margin, pageHeight - 15);
      pdf.text(`${page} / ${pageCount}`, pageWidth - margin, pageHeight - 15, { align: 'right' });
    }

    pdf.save(filename);
  } catch (err: any) {
    throw new Error(err?.message ?? 'PDF export failed. Please try again.');
  }
}

export async function downloadCodeReviewPdf(data: StructuredReviewPdfData, filename: string, accentColor: string): Promise<void> {
  return downloadStructuredReviewPdf(data, filename, accentColor);
}
