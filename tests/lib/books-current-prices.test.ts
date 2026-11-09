// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PRICE_CHANGED_EVENT, useCurrentPrices } from '@/lib/books/use-current-prices';
import type { ClientPrice } from '@/lib/books/pricing';
import { endEndedSales, msUntilNextSaleEnd } from '@/lib/books/pricing';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.parse('2026-11-10T12:00:00Z');
let root: Root;
let host: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

// The phone price bar and the buy card both show useCurrentPrices; this probe prints what it holds.
function Probe({ prices }: { prices: ClientPrice[] }) {
  return createElement('span', null, useCurrentPrices(prices).map(p => `${p.currency} ${p.amount}`).join(' / '));
}
const render = (saleEndsAt: string) => act(() => root.render(createElement(Probe, {
  prices: [{ currency: 'GHS', amount: 150, original: 200, saleEndsAt }],
})));

describe('prices shown on the product page (phone bar and buy card)', () => {
  it('drops back to the regular price the moment the sale ends', () => {
    render(new Date(NOW + 60_000).toISOString());
    expect(host.textContent).toContain('150');
    act(() => { vi.advanceTimersByTime(60_001); });
    expect(host.textContent).toContain('200');
    expect(host.textContent).not.toContain('150');
  });

  it('shows the regular price for a sale that had already ended when the page loaded', () => {
    render(new Date(NOW - 1000).toISOString());
    act(() => { vi.advanceTimersByTime(1); });
    expect(host.textContent).not.toContain('150');
  });

  it('follows a price checkout reported as changed', () => {
    render(new Date(NOW + 86_400_000).toISOString());
    act(() => { window.dispatchEvent(new CustomEvent(PRICE_CHANGED_EVENT, { detail: { currency: 'GHS', amount: 180 } })); });
    expect(host.textContent).toContain('180');
  });
});

describe('sale end helpers', () => {
  it('ends only the sales that are over, and times the next end', () => {
    const list = [
      { currency: 'GHS', amount: 150, original: 200, saleEndsAt: new Date(NOW - 1).toISOString() },
      { currency: 'USD', amount: 8, original: 10, saleEndsAt: new Date(NOW + 5000).toISOString() },
      { currency: 'NGN', amount: 900, original: 1000 },
    ];
    expect(endEndedSales(list, NOW)).toEqual([{ currency: 'GHS', amount: 200 }, list[1], list[2]]);
    expect(msUntilNextSaleEnd(list.slice(1), NOW)).toBe(5000);
    expect(msUntilNextSaleEnd([list[2]], NOW)).toBeNull();
  });
});
