const EPSILON = 1e-6;

/** A reserved descendant depth is not evidence for a current one-edge row.
 * Keep a uniform preferred row only if it occurred as a native current row in
 * this material lifetime, or was proved on the same retained parent at another
 * current boundary. Otherwise use its explicit latest current stage row.
 * Callers without stage metadata may retain a uniform reference, but may not
 * turn an inconsistent sibling row into an arbitrary first/minimum/default row. */
export function workspaceReferenceRank(
  preferredRanks: readonly number[], currentRanks: ReadonlySet<number>, latestCurrentRank: number | undefined,
  fallback: number, complete: boolean, inheritedRows: ReadonlySet<number> = new Set(),
): number {
  const current = latestCurrentRank !== undefined && Number.isFinite(latestCurrentRank) && latestCurrentRank > 0
    ? latestCurrentRank : undefined;
  const first = preferredRanks[0];
  const uniform = complete && Number.isFinite(first) && first > 0
    && preferredRanks.every(rank => Number.isFinite(rank) && Math.abs(rank - first) <= EPSILON);
  if (uniform && (current === undefined || [...currentRanks, ...inheritedRows].some(rank => Math.abs(rank - first) <= EPSILON))) return first;
  if (current !== undefined) return current;
  if (complete) throw Error('Inconsistent current reference ranks without stage row evidence.');
  return fallback;
}
