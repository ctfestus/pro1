// The route tests run on a simulated database, so a query naming a column that does not exist
// passes them and fails only in production. This reads every Supabase query in the books server
// code and checks each selected, filtered or ordered column against festman-fresh-schema.sql.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const schema = readFileSync(join(ROOT, 'festman-fresh-schema.sql'), 'utf8').replace(/--[^\n]*/g, '');

/** Columns per table: CREATE TABLE bodies plus ALTER TABLE ... ADD COLUMN. */
function tableColumns(): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const create = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_0-9]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = create.exec(schema))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let body = '';
    while (i < schema.length && depth > 0) {
      const ch = schema[i];
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (depth > 0) body += ch;
      i++;
    }
    const cols = tables.get(m[1]) ?? new Set<string>();
    let d = 0;
    let cur = '';
    const parts: string[] = [];
    for (const ch of body) {
      if (ch === '(') d++;
      if (ch === ')') d--;
      if (ch === ',' && d === 0) { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    parts.push(cur);
    for (const part of parts) {
      const col = part.trim().match(/^"?([a-z_0-9]+)"?\s+/i);
      if (col && !/^(CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK|EXCLUDE)$/i.test(col[1])) cols.add(col[1].toLowerCase());
    }
    tables.set(m[1], cols);
  }
  const alter = /ALTER\s+TABLE\s+(?:public\.)?([a-z_0-9]+)([\s\S]*?);/gi;
  while ((m = alter.exec(schema))) {
    const add = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_0-9]+)"?/gi;
    let a: RegExpExecArray | null;
    while ((a = add.exec(m[2]))) tables.get(m[1])?.add(a[1].toLowerCase());
  }
  return tables;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Top-level comma split that keeps "rel ( a, b )" embeds whole. */
function splitSelect(list: string): string[] {
  const out: string[] = [];
  let d = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(') d++;
    if (ch === ')') d--;
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const SOURCES = [...files(join(ROOT, 'lib/books')), ...files(join(ROOT, 'app/api/books'))];
const tables = tableColumns();

describe('books queries name only columns the schema has', () => {
  it('finds the tables it checks', () => {
    for (const t of ['book_purchases', 'book_entitlements', 'book_download_events', 'books', 'students']) expect(tables.has(t)).toBe(true);
    expect(tables.get('book_purchases')!.has('guest_downloads_used')).toBe(true);
  });

  it('every selected, filtered and ordered column exists', () => {
    const problems: string[] = [];
    for (const file of SOURCES) {
      const src = readFileSync(file, 'utf8');
      const chain = /\.from\('([a-z_0-9]+)'\)([\s\S]*?)(?=\.from\(|;\s*\n|\n\s*\n)/g;
      let m: RegExpExecArray | null;
      while ((m = chain.exec(src))) {
        const table = m[1];
        const cols = tables.get(table);
        if (!cols) continue; // storage buckets and views are out of scope
        const rest = m[2];
        const where = `${file.replace(ROOT + '/', '')}: ${table}`;
        const sel = /\.select\(\s*(['`])([^'`]*)\1/g;
        let s: RegExpExecArray | null;
        while ((s = sel.exec(rest))) {
          if (s[2].includes('${')) continue; // built from a shared constant; checked where it is defined
          for (const part of splitSelect(s[2])) {
            const embed = part.match(/^([a-z_0-9]+)(?:!inner)?\s*\(([\s\S]*)\)$/);
            if (embed) {
              const other = tables.get(embed[1]);
              for (const c of splitSelect(embed[2])) if (other && c !== '*' && !other.has(c)) problems.push(`${where} -> ${embed[1]}.${c}`);
              continue;
            }
            if (part !== '*' && !cols.has(part)) problems.push(`${where}.${part}`);
          }
        }
        const filter = /\.(?:eq|neq|gt|gte|lt|lte|is|in|not|order|like|ilike)\(\s*'([a-z_0-9.]+)'/g;
        let f: RegExpExecArray | null;
        while ((f = filter.exec(rest))) {
          const name = f[1];
          if (name.includes('.')) continue; // a filter on an embedded table
          if (!cols.has(name)) problems.push(`${where} filter ${name}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
