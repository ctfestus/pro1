import { CalendarCheck2, ShieldCheck, Ticket } from 'lucide-react';
import { formatApplicationFeeAmount, type ApplicationFee } from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

export function ApplicationFeeTicket({ fee, C }: { fee: ApplicationFee; C: ThemeColors }) {
  return (
    <section className="mt-6" aria-label={`${fee.name} details`}>
      <div className="overflow-hidden rounded-2xl" style={{ background: C.card }}>
        <div className="grid sm:grid-cols-[minmax(0,1fr)_minmax(210px,0.7fr)]">
          <div className="min-w-0 p-5 sm:p-6" style={{ background: `linear-gradient(135deg, color-mix(in srgb, ${C.cta} 7%, ${C.card}), ${C.card} 82%)` }}>
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: `color-mix(in srgb, ${C.cta} 13%, ${C.card})`, color: C.cta }}><Ticket className="h-4 w-4" /></span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: C.muted }}>Programme fee</span>
            </div>
            <h2 className="mt-4 text-xl font-semibold leading-tight tracking-tight" style={{ color: C.text }}>{fee.name}</h2>
            {fee.description && <p className="mt-1.5 max-w-md text-sm leading-5" style={{ color: C.muted }}>{fee.description}</p>}
          </div>
          <div className="min-w-0 border-t border-dashed p-5 sm:border-l sm:border-t-0 sm:p-6" style={{ borderColor: C.inputBorder, background: `radial-gradient(circle at 100% 0%, color-mix(in srgb, ${C.cta} 18%, ${C.card}), color-mix(in srgb, ${C.cta} 7%, ${C.card}) 75%)` }}>
            <p className="text-[11px] font-medium uppercase tracking-[0.12em]" style={{ color: C.muted }}>One-time fee</p>
            <p className="mt-2 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1" style={{ color: C.text }}><span className="text-sm font-semibold" style={{ color: C.cta }}>{fee.currency}</span><span className="min-w-0 break-all text-4xl font-semibold leading-none tracking-tight tabular-nums">{formatApplicationFeeAmount(fee.amount)}</span></p>
            <div className="mt-4 flex items-start gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: C.card, color: C.cta }}><CalendarCheck2 className="h-4 w-4" /></span>
              <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: C.faint }}>Due</p><p className="break-words text-xs font-medium leading-5" style={{ color: C.text }}>{fee.due}</p></div>
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2 px-5 py-3 text-[11px] leading-5 sm:px-6" style={{ background: C.card, color: C.muted }}><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: C.cta }} /> No payment is collected through this application form.</div>
      </div>
    </section>
  );
}
