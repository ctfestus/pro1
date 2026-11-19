'use client';

// The person who teaches a course or path, in the side column: drawn like the experience page's
// guide card, from the same instructor profile events show under "Hosted by".

import type { StoreInstructor } from '@/lib/books/store';
import { InstructorLinks } from '@/components/books/store/InstructorLinks';
import { resolveCoverUrl } from '@/lib/cloudinary-url';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('');

export function InstructorCard({ instructor, palette }: {
  instructor: StoreInstructor;
  palette: { card: string; text: string; muted: string; accent: string; shadow: string };
}) {
  return (
    <div style={{ background: palette.card, borderRadius: 14, padding: 24, boxShadow: palette.shadow }}>
      <p style={{ margin: '0 0 12px', fontSize: 11, fontWeight: 700, color: palette.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Your instructor
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 44, height: 44, borderRadius: 999, overflow: 'hidden', flexShrink: 0, display: 'grid', placeItems: 'center', background: `color-mix(in srgb, ${palette.accent} 14%, transparent)`, color: palette.accent, fontWeight: 800, fontSize: 14 }}>
          {instructor.avatar
            ? <img src={resolveCoverUrl(instructor.avatar)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : initials(instructor.name)}
        </span>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: palette.text, lineHeight: 1.3, minWidth: 0 }}>{instructor.name}</p>
      </div>
      {instructor.bio && (
        <p className="line-clamp-5" style={{ margin: '12px 0 0', fontSize: 12, lineHeight: 1.55, color: palette.muted }}>{instructor.bio}</p>
      )}
      {instructor.links.length > 0 && <InstructorLinks name={instructor.name} links={instructor.links} />}
    </div>
  );
}
