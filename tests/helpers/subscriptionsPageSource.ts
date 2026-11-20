// The Subscriptions page is SubscriptionsSection.tsx plus the tabs, pop-ups and helpers in
// components/dashboard/subscriptions/. Source checks read all of it, so they hold wherever a piece
// of the page happens to live.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function subscriptionsPageSource() {
  const dir = join(process.cwd(), 'components/dashboard/subscriptions');
  return [
    join(process.cwd(), 'components/dashboard/SubscriptionsSection.tsx'),
    ...readdirSync(dir).sort().map((file) => join(dir, file)),
  ].map((path) => readFileSync(path, 'utf8')).join('\n');
}
