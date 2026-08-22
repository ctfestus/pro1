// Removes the Next build output.
//
// Replaces `next clean`, which is not a command in Next 15 -- it was parsed as a project
// directory, so `npm run clean` failed with "Invalid project directory provided, no such
// directory: <repo>/clean" and never cleaned anything.
//
// fs.rmSync with recursive+force is cross-platform and does not need rimraf, so this adds
// no dependency. force:true makes an already-clean tree a no-op rather than an error.

import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(repoRoot, '.next');

if (!existsSync(target)) {
  console.log('nothing to clean (.next is absent)');
} else {
  rmSync(target, { recursive: true, force: true });
  console.log('removed .next');
}
