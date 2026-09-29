/**
 * smoke-anon-content.mjs
 *
 * Read-only check that a tenant database enforces migration 215: content offered to everyone is
 * readable by signed-in accounts only, never by an anonymous caller holding the public anon key.
 * Our Vitest suite never talks to a real database, so this is the proof that the policies are live.
 *
 * For every free course, virtual experience and learning path (as listed by public_free_content):
 *   1. anonymous read of the base table     -> must return no row
 *   2. signed-in read of the base table     -> must return the row  (needs a test account)
 *   3. anonymous /api/catalogue-preview     -> must carry no content (needs --app)
 *
 * It writes nothing. The test account is only signed in to, never modified.
 *
 * Usage:
 *   node scripts/smoke-anon-content.mjs                          # tenant from .env
 *   node scripts/smoke-anon-content.mjs --env=.env.festman       # another tenant's env file
 *   node scripts/smoke-anon-content.mjs --app=https://www.festman.app
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (or MCP_SUPABASE_URL +
 *      MCP_SUPABASE_ANON_KEY). Optional SMOKE_EMAIL + SMOKE_PASSWORD for step 2; without them
 *      step 2 is skipped and reported as skipped, not passed.
 *
 * Exit code 1 if any check fails.
 */
import fs from 'fs';
import path from 'path';

const arg = (name) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const envFile = arg('env') ?? '.env';
const appUrl = arg('app')?.replace(/\/$/, '');

function loadEnv(file) {
  const pairs = fs.readFileSync(path.join(process.cwd(), file), 'utf8').split(/\r?\n/);
  for (const line of pairs) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1].trim()] ??= value;
  }
}

loadEnv(envFile);

const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.MCP_SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.MCP_SUPABASE_ANON_KEY;
if (!url || !anonKey) throw new Error(`No Supabase URL / anon key found in ${envFile}`);

// The catalogue type each table is previewed as.
const TABLES = {
  courses: 'course',
  virtual_experiences: 'virtual_experience',
  learning_paths: 'learning_path',
};

// Anything that is the work itself rather than the sales page. The preview may name lessons and
// modules; it must never carry their bodies, briefs, answers or the dataset.
const FORBIDDEN_IN_PREVIEW = ['"questions"', '"body"', '"doc"', '"background"', '"requirements"',
  '"dataset"', 'csvContent', 'correctAnswer'];

let failures = 0;
const pass = (msg) => console.log(`  PASS  ${msg}`);
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };
const skip = (msg) => console.log(`  SKIP  ${msg}`);

async function rest(pathAndQuery, token) {
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token ?? anonKey}` },
  });
  if (!res.ok) throw new Error(`${pathAndQuery}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function signIn() {
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;
  if (!email || !password) return null;
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Test account sign-in failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

console.log(`Tenant: ${url} (${envFile})`);

const free = await rest('public_free_content?select=content_table,content_id');
const token = await signIn();
if (!token) console.log('No SMOKE_EMAIL / SMOKE_PASSWORD: signed-in checks will be skipped.');
if (!appUrl) console.log('No --app: preview checks will be skipped.');

for (const [table, type] of Object.entries(TABLES)) {
  const ids = free.filter(r => r.content_table === table).map(r => r.content_id);
  console.log(`\n${table}: ${ids.length} free item(s)`);
  if (!ids.length) { skip(`no free ${table} on this tenant, nothing to prove`); continue; }

  for (const id of ids) {
    const anonRows = await rest(`${table}?id=eq.${id}&select=id`);
    anonRows.length === 0
      ? pass(`${id} anonymous table read returns nothing`)
      : fail(`${id} anonymous table read RETURNED THE ROW (migration 215 not applied?)`);

    if (token) {
      const authedRows = await rest(`${table}?id=eq.${id}&select=id`, token);
      authedRows.length === 1
        ? pass(`${id} signed-in table read returns the row`)
        : fail(`${id} signed-in table read returned ${authedRows.length} rows, expected 1`);
    }

    if (appUrl) {
      const res = await fetch(`${appUrl}/api/catalogue-preview?ref=${id}&type=${type}`);
      const text = await res.text();
      const leaked = FORBIDDEN_IN_PREVIEW.filter(key => text.includes(key));
      if (!res.ok) fail(`${id} preview HTTP ${res.status}`);
      else if (leaked.length) fail(`${id} preview carries ${leaked.join(', ')}`);
      else if (JSON.parse(text).item?.locked !== false) fail(`${id} preview is not shown as free`);
      else pass(`${id} preview is free and carries no content`);
    }
  }
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
