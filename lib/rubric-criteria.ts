export type RubricImportKind = 'reference_solution' | 'rubric';

// Code a reference solution can arrive as, matching what the code reviewer accepts from learners.
// Read as plain text by the extraction route; browsers often send these with no text/* MIME type.
export const CODE_FILE_EXTENSIONS = [
  '.sql', '.py', '.js', '.ts', '.jsx', '.tsx', '.r', '.java', '.cs', '.c', '.cpp',
  '.go', '.rs', '.rb', '.php', '.swift', '.kt', '.scala',
];

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
