// A client component must not reach into a module that builds the service-role client.
//
// lib/admin-client constructs its Supabase client the moment the module loads, using a key that
// does not exist in a browser. So a client component importing anything from a module that
// imports it -- even a constant -- throws before the page renders. Type checking does not catch
// this, the production build does not catch it, and the page looks fine until it is opened.
//
// That is exactly how the pricing page shipped broken: a client component imported one array of
// strings from the module that fetches its data.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(entry)) out.push(rel);
  }
  return out;
}

/** Modules that pull in the service-role client, directly or one hop away. */
function serverOnlyModules(): Set<string> {
  const server = new Set<string>(['@/lib/admin-client']);
  const libs = sourceFiles('lib');
  // One extra pass catches a module that wraps admin-client, which is the common shape.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const file of libs) {
      const source = readFileSync(join(root, file), 'utf8');
      const alias = `@/${file.replace(/\.tsx?$/, '')}`;
      if (server.has(alias)) continue;
      const imports = [...source.matchAll(/from '(@\/[^']+)'/g)].map(m => m[1]);
      const importsServer = imports.some(name => server.has(name));
      // A type-only import is erased at build, so it cannot drag anything into the browser.
      const typeOnly = new RegExp(`import type [^;]*from '${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&')}'`);
      if (importsServer && !typeOnly.test(source)) server.add(alias);
    }
  }
  return server;
}

describe('client and server boundary', () => {
  it('no client component imports a module that builds the service-role client', () => {
    const server = serverOnlyModules();
    const offenders: string[] = [];

    for (const file of [...sourceFiles('components'), ...sourceFiles('app')]) {
      const source = readFileSync(join(root, file), 'utf8');
      if (!/^['"]use client['"]/m.test(source)) continue;
      for (const match of source.matchAll(/^import (?!type )[^;]*?from '(@\/[^']+)'/gm)) {
        if (server.has(match[1])) offenders.push(`${relative('.', file)} imports ${match[1]}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('is actually inspecting files, not passing on an empty search', () => {
    // Without this the check above passes just as happily if the walk finds nothing.
    expect(sourceFiles('components').length).toBeGreaterThan(20);
    expect(serverOnlyModules().size).toBeGreaterThan(1);
  });
});
