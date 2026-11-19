'use client';

// "The tools you will learn": the site's hero image beside two rows of tool tiles, the data tools
// then the AI tools. Logos come from Tool icons, so an uploaded one replaces the default.

import { useToolIcons } from '@/lib/use-tool-icons';

const TOOLS = ['Excel', 'Power BI', 'SQL', 'ChatGPT', 'Claude', 'Perplexity AI'];

export function PricingTools({ imageUrl, hFont }: { imageUrl?: string; hFont?: string }) {
  const toolIcon = useToolIcons();

  return (
    <section className="mt-14 grid gap-4 lg:grid-cols-2" aria-labelledby="pricing-tools-heading">
      {imageUrl && (
        <div className="relative min-h-72 overflow-hidden rounded-[26px]" style={{ background: '#E8ECF1' }}>
          <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
        </div>
      )}
      <div className={`rounded-[26px] bg-white p-6 sm:p-8 ${imageUrl ? '' : 'lg:col-span-2'}`} style={{ boxShadow: '0 14px 45px rgba(16,24,40,0.07)' }}>
        <h2 id="pricing-tools-heading" className="text-[22px] leading-7 font-black tracking-tight" style={{ color: '#101828', fontFamily: hFont }}>
          The tools you will learn
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {TOOLS.map(name => {
            const icon = toolIcon(name);
            return (
              <li key={name} className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-2xl px-3 py-5 text-center" style={{ background: '#F7F9FB' }}>
                {icon ? <img src={icon} alt="" className="h-14 w-14 object-contain" loading="lazy" /> : <span className="h-14 w-14" />}
                <span className="text-base font-black" style={{ color: '#101828', fontFamily: hFont }}>{name}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
