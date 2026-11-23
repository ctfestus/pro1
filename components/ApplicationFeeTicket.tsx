import { CalendarCheck, Receipt, ShieldCheck } from '@phosphor-icons/react';
import { formatApplicationFeeAmount, type ApplicationFee } from '@/lib/application-forms';
import type { ThemeColors } from '@/lib/theme';

/**
 * The application's fee, drawn as a ticket with a stub: the fee's name, what it is for and when it
 * is due on the left; a dashed tear line; the amount large on the stub. On phones the stub sits
 * below the name, and when it is due comes after the amount. Under it,
 * the note that no payment is taken here. Colours come from the form's theme (light and dark).
 */
export function ApplicationFeeTicket({ fee, C }: { fee: ApplicationFee; C: ThemeColors }) {
  const amount = formatApplicationFeeAmount(fee.amount);
  const set = amount !== 'Set amount';
  const chip = { background: C.pill, color: C.text };
  const dash = `color-mix(in srgb, ${C.faint} 60%, transparent)`;
  const terms = (
    <div className="flex flex-wrap gap-2">
      <span className="inline-flex h-7 items-center rounded-full px-3 text-xs font-semibold" style={chip}>One-time</span>
      {fee.due && (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-semibold" style={chip}>
          <CalendarCheck className="h-3.5 w-3.5" weight="bold" /> Due: {fee.due}
        </span>
      )}
    </div>
  );

  return (
    <section className="mt-6" aria-label={`${fee.name} details`}>
      <div className="flex flex-col overflow-hidden rounded-xl sm:flex-row" style={{ border: `1px solid ${C.divider}` }}>
        <div className="flex min-w-0 flex-1 items-start gap-3.5 p-5 sm:p-6">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={chip}>
            <Receipt className="h-6 w-6" weight="duotone" />
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-base font-bold leading-6" style={{ color: C.text }}>{fee.name}</h2>
            {fee.description && <p className="mt-0.5 break-words text-sm leading-5" style={{ color: C.muted }}>{fee.description}</p>}
            <div className="mt-3 hidden sm:block">{terms}</div>
          </div>
        </div>
        {/* The stub, behind a dashed tear line (left of it on wide screens, above it on phones). */}
        <div className="relative flex shrink-0 flex-col justify-center px-5 py-4 sm:min-w-[11rem] sm:px-6 sm:text-center" style={{ background: C.pill }}>
          <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[1.5px] sm:hidden" style={{ background: `repeating-linear-gradient(to right, ${dash} 0 6px, transparent 6px 11px)` }} />
          <span aria-hidden="true" className="absolute inset-y-0 left-0 hidden w-[1.5px] sm:block" style={{ background: `repeating-linear-gradient(to bottom, ${dash} 0 6px, transparent 6px 11px)` }} />
          {set && <p className="text-xs font-semibold" style={{ color: C.faint }}>{fee.currency}</p>}
          <p className={`font-extrabold leading-none tabular-nums tracking-tight ${set ? 'mt-1 text-4xl sm:text-5xl' : 'text-2xl'}`} style={{ color: C.text }}>{amount}</p>
        </div>
        {/* Phones: when and how often, below the price. */}
        <div className="px-5 py-3.5 sm:hidden">{terms}</div>
      </div>
      <p className="mt-2.5 flex items-center gap-1.5 text-xs" style={{ color: C.faint }}>
        <ShieldCheck className="h-4 w-4 shrink-0" weight="duotone" style={{ color: C.successText }} /> No payment is collected through this application form.
      </p>
    </section>
  );
}
