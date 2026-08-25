import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The rest of the fresh-schema coverage is string matching, which cannot tell a valid
// CREATE TABLE from one that names a column the table never declares. Postgres only
// reports that when the file is actually executed against a database, and by then a
// tenant provision has already aborted partway through. This walks the DDL structurally
// instead: every column named in a table-level PRIMARY KEY / UNIQUE / FOREIGN KEY must
// be declared in the same block, every referenced column must exist on the target, and
// every composite FK must have a UNIQUE or PRIMARY KEY to point at.

type Table = {
  columns: Set<string>;
  uniques: string[][];
  constraints: string[];
  line: number;
};

const CONSTRAINT_STARTERS = /^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT|EXCLUDE|LIKE)\b/i;

function stripSqlComments(sql: string): string {
  let result = '';
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarTag = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        result += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = '';
      } else result += ch;
      continue;
    }
    if (singleQuoted) {
      result += ch;
      if (ch === "'" && next === "'") { result += next; i++; }
      else if (ch === "'") singleQuoted = false;
      continue;
    }
    if (doubleQuoted) {
      result += ch;
      if (ch === '"' && next === '"') { result += next; i++; }
      else if (ch === '"') doubleQuoted = false;
      continue;
    }
    const dollar = sql.slice(i).match(/^\$[a-z_0-9]*\$/i)?.[0];
    if (dollar) { dollarTag = dollar; result += dollar; i += dollar.length - 1; continue; }
    if (ch === "'") { singleQuoted = true; result += ch; continue; }
    if (ch === '"') { doubleQuoted = true; result += ch; continue; }
    if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      result += '\n';
      continue;
    }
    result += ch;
  }
  return result;
}

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (const ch of body) {
    if (inStr) {
      cur += ch;
      if (ch === "'") inStr = false;
      continue;
    }
    if (ch === "'") { inStr = true; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function parseTables(sql: string): Map<string, Table> {
  const stripped = stripSqlComments(sql);
  const tables = new Map<string, Table>();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_0-9]+)\s*\(/gi;
  let m: RegExpExecArray | null;

  while ((m = re.exec(stripped))) {
    let i = m.index + m[0].length;
    let depth = 1;
    let inStr = false;
    let body = '';
    while (i < stripped.length && depth > 0) {
      const ch = stripped[i];
      if (inStr) { if (ch === "'") inStr = false; }
      else if (ch === "'") inStr = true;
      else if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) break; }
      body += ch;
      i++;
    }

    const columns = new Set<string>();
    const uniques: string[][] = [];
    const constraints: string[] = [];
    for (const part of splitTopLevel(body)) {
      if (CONSTRAINT_STARTERS.test(part)) { constraints.push(part); continue; }
      const col = part.match(/^"?([a-z_0-9]+)"?\s+/i);
      if (!col) continue;
      const name = col[1].toLowerCase();
      columns.add(name);
      if (/\b(PRIMARY\s+KEY|UNIQUE)\b/i.test(part)) uniques.push([name]);
    }

    tables.set(m[1], {
      columns,
      uniques,
      constraints,
      line: stripped.slice(0, m.index).split('\n').length,
    });
  }

  const alterConstraint = /ALTER\s+TABLE\s+(?:public\.)?([a-z_0-9]+)\s+ADD\s+(CONSTRAINT\s+"?[a-z_0-9]+"?\s+[\s\S]*?);/gi;
  while ((m = alterConstraint.exec(stripped))) {
    tables.get(m[1])?.constraints.push(m[2].trim());
  }

  const uniqueIndex = /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?[a-z_0-9]+"?\s+ON\s+(?:public\.)?([a-z_0-9]+)\s*\(([^;]*)\)\s*([^;]*);/gi;
  while ((m = uniqueIndex.exec(stripped))) {
    // PostgreSQL cannot use a partial unique index as a foreign-key target.
    if (/\bWHERE\b/i.test(m[3])) continue;
    const columns = splitTopLevel(m[2]).map(part => part.trim().replace(/"/g, '').toLowerCase());
    if (columns.length > 0 && columns.every(column => /^[a-z_0-9]+$/.test(column))) {
      tables.get(m[1])?.uniques.push(columns);
    }
  }
  return tables;
}

function findUnresolvedReferences(sql: string): string[] {
  const tables = parseTables(sql);
  const errors: string[] = [];

  for (const [name, table] of tables) {
    for (const raw of table.constraints) {
      const norm = raw.replace(/^CONSTRAINT\s+"?[a-z_0-9]+"?\s+/i, '');
      const kind = /^PRIMARY\s+KEY/i.test(norm) ? 'PRIMARY KEY'
        : /^UNIQUE/i.test(norm) ? 'UNIQUE'
        : /^FOREIGN\s+KEY/i.test(norm) ? 'FOREIGN KEY'
        : null;
      if (!kind) continue;

      const first = norm.match(/\(([^)]*)\)/);
      if (!first) continue;
      const cols = first[1].split(',').map(s => s.trim().replace(/"/g, '').toLowerCase()).filter(Boolean);

      for (const col of cols) {
        if (!table.columns.has(col)) {
          errors.push(`${name} (line ~${table.line}): ${kind} names column "${col}" which the table does not declare`);
        }
      }
      if (kind !== 'FOREIGN KEY') { table.uniques.push(cols); continue; }

      const ref = norm.match(/REFERENCES\s+(?:public\.)?([a-z_0-9]+)\s*\(([^)]*)\)/i);
      if (!ref) continue;
      const target = tables.get(ref[1]);
      if (!target) continue; // auth.* and anything defined outside this file
      const refCols = ref[2].split(',').map(s => s.trim().replace(/"/g, '').toLowerCase());
      for (const rc of refCols) {
        if (!target.columns.has(rc)) {
          errors.push(`${name} (line ~${table.line}): FOREIGN KEY references ${ref[1]}("${rc}") which that table does not declare`);
        }
      }
      if (refCols.length > 1) {
        const matched = target.uniques.some(u => u.length === refCols.length && u.every(c => refCols.includes(c)));
        if (!matched) {
          errors.push(`${name} (line ~${table.line}): composite FOREIGN KEY to ${ref[1]}(${refCols.join(', ')}) has no matching UNIQUE or PRIMARY KEY on the target`);
        }
      }
    }
  }
  return errors;
}

describe('fresh schema structure', () => {
  const schema = readFileSync(join(process.cwd(), 'festman-fresh-schema.sql'), 'utf8');

  it('parses every CREATE TABLE block', () => {
    expect(parseTables(schema).size).toBe(71);
  });

  it('has no key or foreign key naming a column its table does not declare', () => {
    expect(findUnresolvedReferences(schema)).toEqual([]);
  });

  it('flags a key that names an undeclared column', () => {
    const broken = `CREATE TABLE public.student_xp (
      student_id uuid PRIMARY KEY,
      total_xp integer NOT NULL DEFAULT 0,
      UNIQUE (id, cohort_id)
    );`;
    expect(findUnresolvedReferences(broken)).toEqual([
      'student_xp (line ~1): UNIQUE names column "id" which the table does not declare',
      'student_xp (line ~1): UNIQUE names column "cohort_id" which the table does not declare',
    ]);
  });

  it('flags a composite foreign key with no unique constraint to point at', () => {
    const broken = `CREATE TABLE public.subscription_plans (
      id uuid PRIMARY KEY,
      cohort_id uuid NOT NULL
    );
    CREATE TABLE public.individual_subscriptions (
      id uuid PRIMARY KEY,
      plan_id uuid NOT NULL,
      cohort_id uuid NOT NULL,
      FOREIGN KEY (plan_id, cohort_id) REFERENCES public.subscription_plans(id, cohort_id)
    );`;
    expect(findUnresolvedReferences(broken)).toContain(
      'individual_subscriptions (line ~5): composite FOREIGN KEY to subscription_plans(id, cohort_id) has no matching UNIQUE or PRIMARY KEY on the target',
    );
  });

  it('recognizes standalone unique indexes and ALTER TABLE constraints', () => {
    const valid = `CREATE TABLE public.parents (id uuid, cohort_id uuid);
      CREATE UNIQUE INDEX parents_identity ON public.parents(id, cohort_id);
      CREATE TABLE public.children (id uuid, parent_id uuid, cohort_id uuid);
      ALTER TABLE public.children ADD CONSTRAINT child_parent_fk
        FOREIGN KEY (parent_id, cohort_id) REFERENCES public.parents(id, cohort_id);`;
    expect(findUnresolvedReferences(valid)).toEqual([]);

    const brokenAlter = `CREATE TABLE public.parents (id uuid PRIMARY KEY);
      CREATE TABLE public.children (id uuid PRIMARY KEY);
      ALTER TABLE public.children ADD CONSTRAINT child_parent_fk
        FOREIGN KEY (missing_parent_id) REFERENCES public.parents(id);`;
    expect(findUnresolvedReferences(brokenAlter)).toContain(
      'children (line ~2): FOREIGN KEY names column "missing_parent_id" which the table does not declare',
    );
  });

  it('does not treat comment markers inside SQL strings as comments', () => {
    const broken = `CREATE TABLE public.notes (
      id uuid PRIMARY KEY,
      body text DEFAULT 'keep -- this text', UNIQUE (missing_column)
    );`;
    expect(findUnresolvedReferences(broken)).toContain(
      'notes (line ~1): UNIQUE names column "missing_column" which the table does not declare',
    );
  });

  it('does not accept a partial unique index as a foreign-key target', () => {
    const broken = `CREATE TABLE public.parents (id uuid, cohort_id uuid);
      CREATE UNIQUE INDEX parents_partial_identity
        ON public.parents(id, cohort_id) WHERE cohort_id IS NOT NULL;
      CREATE TABLE public.children (
        id uuid PRIMARY KEY,
        parent_id uuid,
        cohort_id uuid,
        FOREIGN KEY (parent_id, cohort_id) REFERENCES public.parents(id, cohort_id)
      );`;
    expect(findUnresolvedReferences(broken)).toContain(
      'children (line ~4): composite FOREIGN KEY to parents(id, cohort_id) has no matching UNIQUE or PRIMARY KEY on the target',
    );
  });
});
