// Paged fetch for Supabase list queries whose result size grows with tenant size.
//
// PostgREST caps how many rows a single response may carry -- Supabase exposes it as the
// project's "Max rows" setting and ships it at 1000. Exceeding the cap is not an error: the
// response comes back silently truncated, so downstream code sees missing rows rather than a
// failure. In a report that reads "no attempt found means not started", a truncated attempts
// query reports active students as inactive. Page such queries through this helper rather than
// selecting them in one shot.

const REQUEST_SIZE = 1000;

type PageResult<T> = PromiseLike<{
  data: T[] | null;
  count?: number | null;
  error: { message: string } | null;
}>;

/**
 * Fetch every row a query matches, one capped page at a time.
 *
 * `page` receives the range bounds and must apply them with `.range(from, to)`. Request an exact
 * count (`.select(cols, { count: 'exact' })`) so the loop knows the real total: without one it
 * can only stop at the first short page, which is premature if the project's row cap is lower
 * than the page size asked for. Order the query by a unique column -- page boundaries are only
 * stable under a total order.
 */
// PostgREST takes filters in the query string, so `.in('id', ids)` with a few hundred uuids builds
// a URL long enough for a proxy to reject. Split the id list and merge the pages back.
const ID_CHUNK = 100;

export function chunkIds<T>(ids: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

// Chunking narrows each request but multiplies how many there are: a large tenant filtered on two
// id lists can produce hundreds of chunks, and firing them all at once trades a long URL for a
// connection stampede. Run them a few at a time instead.
const MAX_CONCURRENT_REQUESTS = 8;

async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// When a query filters on two id lists at once, both travel in the same URL, so chunking one of
// them bounds nothing. Budget the ids across both: a short second list lets the first take the
// remainder, and two long lists split it evenly, so a request carries about PAIR_BUDGET uuids
// however lopsided the pair is.
const PAIR_BUDGET = 140;

/**
 * Fetch every row matching any of `ids`, chunking the id list so no single request carries them
 * all, and paging each chunk through fetchAllRows. `page` receives one chunk plus range bounds.
 * For a query that filters on two id lists, use fetchAllRowsByIdPairs -- passing a smaller chunk
 * size here would shrink one list while the other still went out in full.
 */
export async function fetchAllRowsByIds<T>(
  ids: string[],
  page: (idChunk: string[], from: number, to: number) => PageResult<T>,
): Promise<T[]> {
  if (!ids.length) return [];
  const chunks = await mapWithLimit(chunkIds(ids), MAX_CONCURRENT_REQUESTS,
    idChunk => fetchAllRows<T>((from, to) => page(idChunk, from, to)));
  return chunks.flat();
}

/**
 * Fetch every row matching any `primary` id together with any `secondary` id -- a query with two
 * `.in(...)` filters. Both lists are chunked, so neither can push the request line over a proxy
 * limit no matter how long it grows. One request covers the common case where both lists are small.
 */
export async function fetchAllRowsByIdPairs<T>(
  primary: string[],
  secondary: string[],
  page: (primaryChunk: string[], secondaryChunk: string[], from: number, to: number) => PageResult<T>,
): Promise<T[]> {
  if (!primary.length || !secondary.length) return [];
  const secondarySize = Math.min(secondary.length, Math.floor(PAIR_BUDGET / 2));
  const primarySize   = Math.max(10, PAIR_BUDGET - secondarySize);
  const pairs: Array<[string[], string[]]> = [];
  for (const a of chunkIds(primary, primarySize)) {
    for (const b of chunkIds(secondary, secondarySize)) pairs.push([a, b]);
  }
  const results = await mapWithLimit(pairs, MAX_CONCURRENT_REQUESTS,
    ([a, b]) => fetchAllRows<T>((from, to) => page(a, b, from, to)));
  return results.flat();
}

export async function fetchAllRows<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const all: T[] = [];
  let total: number | null = null;

  for (;;) {
    const { data, count, error } = await page(all.length, all.length + REQUEST_SIZE - 1);
    if (error) throw new Error(error.message);
    if (total === null && typeof count === 'number') total = count;

    const batch = data ?? [];
    all.push(...batch);

    // An empty page always terminates, and guarantees the loop ends even if a caller forgets
    // to apply the range bounds.
    if (!batch.length) return all;
    if (total !== null) {
      if (all.length >= total) return all;
    } else if (batch.length < REQUEST_SIZE) {
      return all;
    }
  }
}
