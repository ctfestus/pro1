// Course-end rank for the result screen. Pure: the route supplies the cohort roster and the
// course's completed attempts; this decides who counts, which attempt is each student's best,
// and how ties rank. Only names and ranks of neighbours leave here -- never emails or ids.

export type RankAttempt = {
  student_id: string;
  score: number | null;
  points: number | null;
  completed_at: string | null;
};

export type RankRosterEntry = { id: string; full_name: string | null };

export type CourseRankNeighbour = { name: string; rank: number };

export type CourseRankResult =
  | { eligible: false }
  | {
      eligible: true;
      rank: number;
      total: number;
      above: CourseRankNeighbour | null;
      me: { name: string; rank: number; score: number; points: number };
      below: CourseRankNeighbour | null;
    };

type Entry = { studentId: string; score: number; points: number; completedAt: string };

// Higher score wins, then higher points, then the earlier completion.
function isBetterAttempt(a: Entry, b: Entry): boolean {
  if (a.score !== b.score) return a.score > b.score;
  if (a.points !== b.points) return a.points > b.points;
  return a.completedAt < b.completedAt;
}

export function rankCourseAttempts(
  attempts: RankAttempt[],
  roster: RankRosterEntry[],
  callerId: string,
): CourseRankResult {
  const names = new Map<string, string>();
  for (const s of roster) names.set(s.id, s.full_name?.trim() || 'Anonymous');

  // The roster filter is enforced here as well as in the query, so a student outside the
  // cohort can never be counted or named even if the query is widened by mistake.
  const best = new Map<string, Entry>();
  for (const a of attempts) {
    if (!a.completed_at || !names.has(a.student_id)) continue;
    const entry: Entry = {
      studentId: a.student_id,
      score: a.score ?? 0,
      points: a.points ?? 0,
      completedAt: a.completed_at,
    };
    const existing = best.get(a.student_id);
    if (!existing || isBetterAttempt(entry, existing)) best.set(a.student_id, entry);
  }

  if (!best.has(callerId)) return { eligible: false };

  // Ties keep a stable display order by id; the id never decides rank.
  const sorted = Array.from(best.values()).sort((a, b) =>
    b.score - a.score
    || b.points - a.points
    || (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0));

  // Competition ranking: equal score and points share a rank (1, 1, 3).
  const ranks: number[] = [];
  sorted.forEach((e, i) => {
    const prev = sorted[i - 1];
    ranks.push(prev && prev.score === e.score && prev.points === e.points ? ranks[i - 1] : i + 1);
  });

  const idx = sorted.findIndex(e => e.studentId === callerId);
  const myRank = ranks[idx];
  const firstOfTie = ranks.indexOf(myRank);
  const lastOfTie = ranks.lastIndexOf(myRank);

  // Neighbours are strictly better / strictly worse, never a tied peer.
  const neighbour = (i: number): CourseRankNeighbour | null =>
    i >= 0 && i < sorted.length ? { name: names.get(sorted[i].studentId)!, rank: ranks[i] } : null;

  const me = sorted[idx];
  return {
    eligible: true,
    rank: myRank,
    total: sorted.length,
    above: neighbour(firstOfTie - 1),
    me: { name: names.get(callerId)!, rank: myRank, score: me.score, points: me.points },
    below: neighbour(lastOfTie + 1),
  };
}
