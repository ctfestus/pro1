export function reversibleDeliverableRequirementIds(modules: any[]): Set<string> {
  const ids = new Set<string>();
  for (const veModule of modules ?? []) {
    for (const lesson of veModule?.lessons ?? []) {
      for (const requirement of lesson?.requirements ?? []) {
        if (
          requirement?.id &&
          (requirement.type === 'task' || requirement.type === 'deliverable')
        ) {
          ids.add(String(requirement.id));
        }
      }
    }
  }
  return ids;
}

/**
 * Keep completed progress monotonic for validated and submission-based requirement types.
 * Checkbox deliverables may move in either direction until the VE attempt is submitted.
 */
export function mergeVeProgress(
  existing: any,
  incoming: any,
  reversibleRequirementIds: Set<string>,
  attemptCompleted: boolean,
) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const next = incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : {};
  const merged: Record<string, any> = { ...base };

  for (const [requirementId, incomingEntry] of Object.entries(next)) {
    const existingEntry = merged[requirementId];
    const reversible = !attemptCompleted && reversibleRequirementIds.has(requirementId);
    if (!reversible && existingEntry?.completed && !(incomingEntry as any)?.completed) continue;
    merged[requirementId] = {
      ...(existingEntry && typeof existingEntry === 'object' ? existingEntry : {}),
      ...(incomingEntry && typeof incomingEntry === 'object' ? incomingEntry : {}),
      completed: reversible
        ? Boolean((incomingEntry as any)?.completed)
        : Boolean(existingEntry?.completed || (incomingEntry as any)?.completed),
    };
  }

  return merged;
}
