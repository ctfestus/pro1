/**
 * Check newly added user-visible source text for non-ASCII characters.
 *
 * Scope:
 * - .ts/.tsx files under app/, components/, and lib/
 * - string/template literal content and JSX text
 * - changed lines only by default; --cached checks staged lines; --all checks the backlog
 * - comments, identifiers, regular expressions, and module specifiers are excluded
 *
 * This command never writes files. A finding requires a human decision: use an ASCII
 * equivalent for prose, or replace visual symbols (for example a close glyph) with an icon.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCE_ROOTS = ['app', 'components', 'lib'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isSourcePath(value) {
  const path = normalizePath(value);
  return SOURCE_EXTENSIONS.has(extname(path))
    && SOURCE_ROOTS.some(root => path === root || path.startsWith(`${root}/`));
}

export function parseAddedLines(patch) {
  const changed = new Map();
  let file = null;
  let newLine = 0;

  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) {
      const raw = line.slice(4).trim();
      file = raw === '/dev/null' ? null : normalizePath(raw.replace(/^b\//, ''));
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      continue;
    }
    if (!file || line.startsWith('diff --git ') || line.startsWith('--- ')) continue;
    if (line.startsWith('+')) {
      if (!changed.has(file)) changed.set(file, new Set());
      changed.get(file).add(newLine);
      newLine += 1;
    } else if (!line.startsWith('-') && !line.startsWith('\\ No newline')) {
      newLine += 1;
    }
  }
  return changed;
}

export function enumerateAllSourcePaths(trackedOutput, untrackedOutput = '') {
  const files = new Set();
  for (const output of [trackedOutput, untrackedOutput]) {
    for (const file of output.split(/\r?\n/)) {
      if (isSourcePath(file)) files.add(normalizePath(file));
    }
  }
  return files;
}

function isModuleSpecifier(node) {
  const parent = node.parent;
  return (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node;
}

function isPropertyKey(node) {
  const parent = node.parent;
  return ('name' in parent && parent.name === node)
    || (ts.isElementAccessExpression(parent) && parent.argumentExpression === node);
}

function eligibleRanges(sourceFile) {
  const ranges = [];
  const visit = node => {
    if (ts.isJsxText(node)) {
      ranges.push([node.getStart(sourceFile), node.end]);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      && !isModuleSpecifier(node)
      && !isPropertyKey(node)
    ) {
      ranges.push([node.getStart(sourceFile) + 1, Math.max(node.getStart(sourceFile) + 1, node.end - 1)]);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) {
      ranges.push([node.getStart(sourceFile) + 1, Math.max(node.getStart(sourceFile) + 1, node.end - 2)]);
    } else if (ts.isTemplateTail(node)) {
      ranges.push([node.getStart(sourceFile) + 1, Math.max(node.getStart(sourceFile) + 1, node.end - 1)]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return ranges;
}

/**
 * @param {string} source
 * @param {string} fileName
 * @param {Set<number> | null} changedLines
 */
export function findUserVisibleNonAscii(source, fileName, changedLines = null) {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const ranges = eligibleRanges(sourceFile);
  const violations = [];
  let rangeIndex = 0;

  for (let index = 0; index < source.length; index += 1) {
    const codePoint = source.codePointAt(index);
    if (codePoint <= 0x7f) continue;
    while (rangeIndex < ranges.length && ranges[rangeIndex][1] <= index) rangeIndex += 1;
    const range = ranges[rangeIndex];
    if (!range || index < range[0] || index >= range[1]) continue;
    const position = sourceFile.getLineAndCharacterOfPosition(index);
    const line = position.line + 1;
    if (changedLines && !changedLines.has(line)) continue;
    violations.push({
      file: normalizePath(fileName),
      line,
      column: position.character + 1,
      character: String.fromCodePoint(codePoint),
      codePoint: `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`,
    });
    if (codePoint > 0xffff) index += 1;
  }
  return violations;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function changedFiles({ all, cached }) {
  if (all) {
    // Directory pathspecs include both root-level and nested files. The earlier **/*.ts
    // pathspec required an intermediate directory and silently skipped shared root UI files.
    const tracked = git(['ls-files', '--', 'app', 'components', 'lib']);
    const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'app', 'components', 'lib']);
    return new Map([...enumerateAllSourcePaths(tracked, untracked)].map(file => [file, null]));
  }

  const diffArgs = cached
    ? ['diff', '--cached', '--unified=0', '--no-color', '--diff-filter=ACMR', '--']
    : ['diff', 'HEAD', '--unified=0', '--no-color', '--diff-filter=ACMR', '--'];
  const files = parseAddedLines(git(diffArgs));
  if (!cached) {
    const untracked = git(['ls-files', '--others', '--exclude-standard', '--', 'app', 'components', 'lib']);
    for (const file of untracked.split(/\r?\n/).filter(isSourcePath)) files.set(normalizePath(file), null);
  }
  return files;
}

export function runCheck({ all = false, cached = false } = {}) {
  const violations = [];
  for (const [file, lines] of changedFiles({ all, cached })) {
    if (!isSourcePath(file)) continue;
    const absolute = resolve(ROOT, ...file.split('/'));
    const withinRoot = relative(ROOT, absolute);
    if (withinRoot.startsWith(`..${sep}`) || withinRoot === '..') continue;
    const source = readFileSync(absolute, 'utf8');
    violations.push(...findUserVisibleNonAscii(source, file, lines));
  }
  return violations;
}

function main() {
  const args = new Set(process.argv.slice(2));
  const violations = runCheck({ all: args.has('--all'), cached: args.has('--cached') });
  if (!violations.length) {
    console.log(`User-visible ASCII check passed (${args.has('--all') ? 'whole repository' : args.has('--cached') ? 'staged lines' : 'changed lines'}).`);
    return;
  }
  console.error('Non-ASCII user-visible text found:');
  for (const item of violations) {
    console.error(`  ${item.file}:${item.line}:${item.column}  ${JSON.stringify(item.character)} (${item.codePoint})`);
  }
  console.error('\nUse ASCII prose or an appropriate UI icon. This check never rewrites files.');
  process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) main();
