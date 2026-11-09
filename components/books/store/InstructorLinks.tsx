import { Github, Globe, Instagram, Linkedin, Twitter, Youtube } from 'lucide-react';
import type { SocialKey } from '@/lib/books/store';

const ICON: Record<SocialKey, { Icon: typeof Globe; label: string }> = {
  linkedin: { Icon: Linkedin, label: 'LinkedIn' },
  twitter: { Icon: Twitter, label: 'X' },
  instagram: { Icon: Instagram, label: 'Instagram' },
  github: { Icon: Github, label: 'GitHub' },
  youtube: { Icon: Youtube, label: 'YouTube' },
  website: { Icon: Globe, label: 'Website' },
};

/** The instructor's social links as round icon buttons, each opening in a new tab. */
export function InstructorLinks({ name, links }: { name: string; links: { key: SocialKey; url: string }[] }) {
  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label={`${name} online`}>
      {links.map(({ key, url }) => {
        const { Icon, label } = ICON[key];
        return (
          <li key={key}>
            <a href={url} target="_blank" rel="noopener noreferrer nofollow" aria-label={`${name} on ${label}`} title={label}
              className="w-10 h-10 rounded-full inline-flex items-center justify-center transition-colors hover:bg-[#E8EBEF]"
              style={{ background: '#F4F5F7', color: '#334155' }}>
              <Icon className="w-[18px] h-[18px]" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}
