// Removes the Next build output.
//
// Replaces `next clean`, which is not a command in Next 15 -- it was parsed as a project
// directory, so `npm run clean` failed with "Invalid project directory provided, no such
// directory: <repo>/clean" and never cleaned anything.
//
// Windows is the hard part. Deleting .next fails with EPERM or EBUSY whenever another
// process still holds something inside it -- a dev server, a build that just exited, an
// editor indexing, or a shell sitting in a subdirectory. Two things are worth knowing:
//
//   1. rmSync's own maxRetries/retryDelay does NOT cover this. Measured on Windows against
//      a directory held by another process's cwd, rmSync({maxRetries:10, retryDelay:150})
//      threw EPERM after 642ms without retrying at all, so the loop below is explicit.
//   2. force:true only swallows a missing path. It does not make a locked delete succeed,
//      so the result is checked rather than assumed.
//
// No rimraf dependency: node:fs plus a retry loop is enough and keeps the install lean.

import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(repoRoot, '.next');

// Transient on Windows: the holder usually lets go within a few seconds.
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EMFILE', 'ENFILE']);
const ATTEMPTS = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(target)) {
  console.log('nothing to clean (.next is absent)');
  process.exit(0);
}

let failure = null;
let used = 0;
for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  used = attempt;
  try {
    rmSync(target, { recursive: true, force: true });
    failure = null;
    break;
  } catch (err) {
    failure = err;
    if (!RETRYABLE.has(err.code) || attempt === ATTEMPTS) break;
    // Linear backoff: 150ms, 300ms, ... 1350ms. About 6.7s in total, enough to outlast a
    // finished build releasing its handles without hanging CI.
    await sleep(attempt * 150);
  }
}

// force:true hides a missing path but not a locked one, so treat a surviving directory as
// a failure even when rmSync itself did not throw.
if (!failure && existsSync(target)) {
  console.error('Could not remove ' + target + ' - it is still present after the delete.');
  process.exit(1);
}

if (failure) {
  const code = failure.code || 'unknown';
  console.error('Could not remove ' + target + ' after ' + used + ' attempts');
  console.error('Reason: ' + code + (failure.message ? ' - ' + failure.message : ''));
  if (RETRYABLE.has(code)) {
    console.error('');
    console.error('Something is holding .next open. Usual suspects:');
    console.error('  - a dev server still running (next dev)');
    console.error('  - a build running right now in another terminal or agent');
    console.error('  - an editor or terminal whose working directory is inside .next');
    console.error('  - antivirus or search indexing scanning the folder');
    console.error('Close or stop it, then run npm run clean again.');
  }
  process.exit(1);
}

console.log(used > 1 ? 'removed .next (took ' + used + ' attempts)' : 'removed .next');
