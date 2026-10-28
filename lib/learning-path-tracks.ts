// Learning path tracks: one path, personalised by the learner's background.
//
// item_ids stays the single ordered list of everything in the path, so every reader that only
// needs "what content does this path grant" (access, catalogue, tracking) keeps working as is.
// A track names the subset of those items that only its learners take. An item in no track is
// core and is taken by everyone. A learner picks one track (learning_path_progress.track_id) and
// is required to complete core + that track's items, in item_ids order.
//
// A path with tracks cannot be completed before a track is chosen: otherwise finishing the core
// alone would issue the certificate.

export type PathTrack = {
  id: string;
  name: string;
  description?: string;
  item_ids: string[];
};

type TrackedPath = { item_ids?: string[] | null; tracks?: unknown };

/** Tracks as stored, cleaned: unnamed tracks dropped, items limited to ones still in the path. */
export function normalizeTracks(raw: unknown, itemIds: string[] = []): PathTrack[] {
  if (!Array.isArray(raw)) return [];
  const inPath = new Set(itemIds);
  const seen = new Set<string>();
  const tracks: PathTrack[] = [];
  for (const t of raw) {
    if (!t || typeof t !== 'object') continue;
    const id = String((t as any).id ?? '').trim();
    const name = String((t as any).name ?? '').trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const description = String((t as any).description ?? '').trim();
    const items = Array.isArray((t as any).item_ids) ? (t as any).item_ids.map(String) : [];
    tracks.push({
      id,
      name,
      ...(description ? { description } : {}),
      item_ids: [...new Set<string>(items)].filter(i => inPath.has(i)),
    });
  }
  return tracks;
}

/**
 * Why a submitted tracks value cannot be saved, or null when it can. Checked at the API boundary
 * because normalizeTracks would silently drop a bad track, which turns its items into core
 * content required of everyone. Items no longer in the path are not an error: the editor keeps a
 * removed item's tags, and normalizeTracks cleans them on save.
 */
export function tracksError(raw: unknown): string | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return 'Tracks must be a list.';
  const seen = new Set<string>();
  for (const t of raw) {
    if (!t || typeof t !== 'object') return 'Each track must be an object.';
    const id = typeof (t as any).id === 'string' ? (t as any).id.trim() : '';
    if (!id) return 'Each track needs an id.';
    if (seen.has(id)) return 'Two tracks share the same id.';
    seen.add(id);
    if (typeof (t as any).name !== 'string' || !(t as any).name.trim()) return 'Give every track a name.';
    const items = (t as any).item_ids;
    if (items != null && (!Array.isArray(items) || items.some((i: unknown) => typeof i !== 'string'))) {
      return 'A track lists its items as ids.';
    }
  }
  return null;
}

export function pathTracks(path: TrackedPath): PathTrack[] {
  return normalizeTracks(path.tracks, path.item_ids ?? []);
}

/** The chosen track, or null when the path has no tracks or the stored choice no longer exists. */
export function chosenTrack(path: TrackedPath, trackId: string | null | undefined): PathTrack | null {
  if (!trackId) return null;
  return pathTracks(path).find(t => t.id === trackId) ?? null;
}

/** Whether the learner still has to pick a track before the path can be completed. */
export function needsTrack(path: TrackedPath, trackId: string | null | undefined): boolean {
  return pathTracks(path).length > 0 && !chosenTrack(path, trackId);
}

/**
 * The items this learner must complete, in path order: core plus their track's items. Before a
 * track is chosen this is the core only (what they can already start on).
 */
export function requiredItemIds(path: TrackedPath, trackId: string | null | undefined): string[] {
  const itemIds = path.item_ids ?? [];
  const tracks = pathTracks(path);
  if (!tracks.length) return itemIds;
  const inAnyTrack = new Set(tracks.flatMap(t => t.item_ids));
  const mine = new Set(chosenTrack(path, trackId)?.item_ids ?? []);
  return itemIds.filter(id => !inAnyTrack.has(id) || mine.has(id));
}

/**
 * Track items a student is not taking, as `${studentId}|${itemId}` keys.
 *
 * On a path with tracks the other tracks' items are reachable (the path grants access to every
 * item) but not required of a student, so they must not show as Not started or overdue for them.
 * Before a track is chosen only the core is required, matching the student's own path view. An
 * item another path reaching their cohort requires is kept; a direct assignment of the item to the
 * cohort is the caller's to honour. `trackOf` maps `${studentId}|${pathId}` to the chosen track.
 */
export function trackOptOuts(
  paths: (TrackedPath & { id: string; cohort_ids?: string[] | null })[],
  students: { id: string; cohort_id: string | null }[],
  trackOf: Map<string, string | null>,
): Set<string> {
  const out = new Set<string>();
  for (const s of students) {
    if (!s.cohort_id) continue;
    const mine = paths.filter(p => (p.cohort_ids ?? []).includes(s.cohort_id!));
    if (!mine.some(p => pathTracks(p).length > 0)) continue;
    const required = new Set(mine.flatMap(p => requiredItemIds(p, trackOf.get(`${s.id}|${p.id}`) ?? null)));
    for (const p of mine) {
      for (const t of pathTracks(p)) for (const itemId of t.item_ids) if (!required.has(itemId)) out.add(`${s.id}|${itemId}`);
    }
  }
  return out;
}

/**
 * Whose requirements an edit from `prev` to `next` changes: the prev track ids whose required
 * items differ (or that are gone), and `core` for a learner with no track (a path gaining its
 * first tracks, or a plain path's sequence changing). A completer on one of these may not have
 * the edit applied. A stored track id that `prev` no longer has protects nothing: that learner
 * already had no valid track.
 */
export function changedRequirements(prev: TrackedPath, next: TrackedPath): { trackIds: string[]; core: boolean } {
  const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x));
  const changes = (trackId: string | null) => {
    if (needsTrack(prev, trackId)) return false;
    if (needsTrack(next, trackId)) return true;
    return !sameSet(requiredItemIds(prev, trackId), requiredItemIds(next, trackId));
  };
  return {
    trackIds: pathTracks(prev).map(t => t.id).filter(id => changes(id)),
    core: changes(null),
  };
}

/** True when every required item is done and no track choice is outstanding. */
export function isPathComplete(path: TrackedPath, trackId: string | null | undefined, completedIds: Iterable<string>): boolean {
  if (needsTrack(path, trackId)) return false;
  const required = requiredItemIds(path, trackId);
  const done = new Set(completedIds);
  return required.length > 0 && required.every(id => done.has(id));
}
