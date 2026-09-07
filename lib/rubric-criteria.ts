export type RubricImportKind = 'reference_solution' | 'rubric';

export function mergeRubricCriteria(existing: readonly string[], incoming: unknown): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const value of [...existing, ...(Array.isArray(incoming) ? incoming : [])]) {
    if (typeof value !== 'string') continue;
    const criterion = value.trim();
    if (!criterion) continue;
    const key = criterion.replace(/\s+/g, ' ').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(criterion);
  }

  return merged;
}
