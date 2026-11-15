'use client';

// A lesson's attached media, in the order the course player shows it: video or embedded tool,
// image, PDF, audio. The player shows lessons in three places (the lesson card, above an AI
// review question, and the lesson sheet opened from a question); each passes its own spacing and
// corner classes so they keep their look while sharing one copy of the logic.

import dynamic from 'next/dynamic';
import { safeEmbedUrl, isHtmlEmbedUrl } from '@/lib/safe-embed-url';
import { HtmlEmbedFrame } from '@/components/HtmlEmbedFrame';
import { LessonAudioPlayer } from '@/components/lesson/LessonAudioPlayer';

const PdfCarousel = dynamic(() => import('@/components/PdfCarousel'), { ssr: false });

export interface LessonMediaFields {
  videoUrl?: string;
  imageUrl?: string;
  pdfUrl?: string;
  pdfName?: string;
  pdfPages?: number;
  audioUrl?: string;
}

export function LessonMedia({
  lesson, accent, isDark,
  itemClassName, videoItemClassName, videoFrameClassName = '', imageFrameClassName = '',
}: {
  lesson: LessonMediaFields;
  accent: string;
  isDark: boolean;
  /** Wrapper around each item (spacing). Omitted: no wrapper, for a parent that spaces its children. */
  itemClassName?: string;
  /** Wrapper around the video only, when it is spaced differently from the rest. */
  videoItemClassName?: string;
  /** Corners and shadow of the video or embedded tool. */
  videoFrameClassName?: string;
  /** Corners and shadow of the image. */
  imageFrameClassName?: string;
}) {
  const embedUrl = lesson.videoUrl ? safeEmbedUrl(lesson.videoUrl) : null;
  const item = (key: string, node: React.ReactNode, className = itemClassName) =>
    className == null ? <div key={key}>{node}</div> : <div key={key} className={className}>{node}</div>;

  return (
    <>
      {embedUrl && item('video', isHtmlEmbedUrl(embedUrl) ? (
        <div className={`${videoFrameClassName} overflow-hidden`}>
          <HtmlEmbedFrame src={embedUrl} />
        </div>
      ) : (
        // Canva designs are tall pages, not 16:9 videos.
        <div className={`${videoFrameClassName} overflow-hidden`} style={embedUrl.includes('canva.com') ? { height: '80vh' } : { aspectRatio: '16/9' }}>
          <iframe
            src={embedUrl}
            className="w-full h-full border-0"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        </div>
      ), videoItemClassName ?? itemClassName)}

      {lesson.imageUrl && item('image', (
        <div className={`${imageFrameClassName} overflow-hidden`}>
          <img src={lesson.imageUrl} alt="Lesson illustration" className="w-full object-cover" />
        </div>
      ))}

      {lesson.pdfUrl && item('pdf', (
        <PdfCarousel url={lesson.pdfUrl} pages={lesson.pdfPages || 1} fileName={lesson.pdfName} accent={accent} isDark={isDark} />
      ))}

      {lesson.audioUrl && item('audio', <LessonAudioPlayer src={lesson.audioUrl} isDark={isDark} />)}
    </>
  );
}
