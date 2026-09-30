import { CalendarCheck2, ShieldCheck } from 'lucide-react';
import { formatApplicationFeeAmount, type ApplicationFee } from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

export function ApplicationFeeTicket({ fee, C }: { fee: ApplicationFee; C: ThemeColors }) {
  const amount = formatApplicationFeeAmount(fee.amount);
  const amountSize = amount === 'Set amount' ? 'text-2xl sm:text-3xl' : amount.length > 12 ? 'text-3xl sm:text-4xl' : amount.length > 7 ? 'text-4xl sm:text-5xl' : 'text-5xl sm:text-[4.5rem]';

  return (
    <section className="mt-5" aria-label={`${fee.name} details`}>
      <div className="rounded-xl p-1.5" style={{ background: C.pill }}>
        <div className="relative isolate overflow-hidden rounded-lg px-5 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5" style={{ background: 'linear-gradient(145deg, #151C29 0%, #090D15 75%)', color: '#FFFFFF' }}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at 75% -30%, color-mix(in srgb, ${C.cta} 55%, transparent), transparent 58%)`, opacity: 0.55 }} />
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.45) 1px, transparent 1px)', backgroundSize: '42px 42px' }} />
          <div className="relative grid min-w-0 gap-4 sm:grid-cols-[minmax(0,0.75fr)_minmax(0,1fr)] sm:items-center sm:gap-6">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/65">{fee.currency} / One-time</p>
              <p className={`mt-1 min-w-0 break-all font-black leading-none tracking-[-0.075em] tabular-nums ${amountSize}`}>{amount}</p>
            </div>
            <div className="flex min-w-0 flex-col items-start gap-2 pb-1 pl-1 pr-2 sm:pl-3">
              <div className="max-w-full self-end -rotate-1 bg-white px-2.5 py-1.5 text-[#111827]" style={{ boxShadow: `4px 4px 0 color-mix(in srgb, ${C.cta} 70%, #111827)` }}>
                <p className="flex items-start gap-1.5 text-[10px] font-bold uppercase leading-4 tracking-wide"><CalendarCheck2 className="h-3.5 w-3.5 shrink-0" /> <span className="break-words">Due: {fee.due}</span></p>
              </div>
              <div className="max-w-full -rotate-1 bg-white px-3 py-1.5 text-[#0E1420]" style={{ boxShadow: `-6px 6px 0 ${C.cta}` }}>
                <h2 className="break-words text-lg font-black uppercase leading-tight tracking-tight sm:text-xl">{fee.name}</h2>
              </div>
              {fee.description && <div className="max-w-full rotate-1 bg-white px-3 py-1.5 text-[#17202D]" style={{ boxShadow: `5px 5px 0 color-mix(in srgb, ${C.cta} 65%, #111827)` }}><p className="break-words text-[11px] font-medium leading-4">{fee.description}</p></div>}
            </div>
          </div>
          <p className="relative mt-4 flex items-start gap-2 border-t border-white/15 pt-3 text-[11px] leading-4 text-white/70"><ShieldCheck className="h-4 w-4 shrink-0" /> No payment is collected through this application form.</p>
        </div>
      </div>
    </section>
  );
}
