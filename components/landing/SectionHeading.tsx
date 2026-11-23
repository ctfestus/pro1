import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { M3 } from '@/components/landing/type';

/**
 * A home page section's heading: the title, a rounded "See all" button to the section's own page
 * (/courses, /products...) beside it, and one line under it.
 */
export function SectionHeading({ title, sub, color, subColor, hFont, bFont, seeAll }: {
  title: string; sub: string; color: string; subColor: string; hFont?: string; bFont?: string;
  /** The section's own catalogue page (/courses...), as a rounded "See all" button beside the title. */
  seeAll?: string;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-4">
        <h2 style={{ ...M3.headlineSmall, fontWeight: 700, fontFamily: hFont, color }}>{title}</h2>
        {seeAll && (
          <Link href={seeAll} className="group inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-4 py-2 transition-colors"
            style={{ ...M3.labelLarge, fontWeight: 600, fontFamily: bFont ?? hFont, color, boxShadow: `inset 0 0 0 1px ${color === 'white' ? 'rgba(255,255,255,0.45)' : '#D5DAE1'}` }}>
            See all <ArrowRight className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        )}
      </div>
      {sub && <p className="mt-2" style={{ ...M3.bodyLarge, color: subColor, fontFamily: bFont ?? hFont, maxWidth: 640 }}>{sub}</p>}
    </div>
  );
}
