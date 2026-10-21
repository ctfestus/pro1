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

/** True when every required item is done and no track choice is outstanding. */
export function isPathComplete(path: TrackedPath, trackId: string | null | undefined, completedIds: Iterable<string>): boolean {
  if (needsTrack(path, trackId)) return false;
  const required = requiredItemIds(path, trackId);
  const done = new Set(completedIds);
  return required.length > 0 && required.every(id => done.has(id));
}
