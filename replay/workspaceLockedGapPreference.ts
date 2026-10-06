import type { Point } from './workspaceLifetimeContours.ts';

type CoordinateSnapshot = readonly (string | number | undefined)[];
export type WorkspacePreferenceInputs = ReadonlyMap<number, {
  selected: CoordinateSnapshot;
  preferred: CoordinateSnapshot;
}>;
export type WorkspaceGapTopology = {
  incarnation: number;
  id: string;
  childIds: readonly string[];
  dependencies: readonly number[];
};
export type WorkspaceLockedGapReference = {
  topology: readonly WorkspaceGapTopology[];
  inputs: WorkspacePreferenceInputs;
  locked: ReadonlySet<number>;
};

/** A complete accepted composition may lock every child of a fork. Its child
 * preferences then do not choose a slot. Only a finite X-only change confined
 * to that fork can reuse this fact; every other consumed input must still match
 * the snapshot, including roots, Y values and earlier incarnations. */
export function preservesLockedWorkspaceGap(
  reference: WorkspaceLockedGapReference | undefined,
  preferences: ReadonlyMap<number, ReadonlyMap<string, Point>>,
  control: { incarnation: number; split: number },
): boolean {
  if (!reference || !reference.locked.has(control.incarnation)
    || !Number.isInteger(control.split) || control.split <= 0) return false;
  const controlled = reference.topology.find(part => part.incarnation === control.incarnation);
  if (!controlled || control.split >= controlled.childIds.length
    || reference.inputs.size !== reference.topology.length
    || reference.topology.some(part => part.dependencies.some(dependency => dependency >= part.incarnation))) return false;
  let changed = false;
  for (const part of reference.topology) {
    const old = reference.inputs.get(part.incarnation), next = preferences.get(part.incarnation);
    const ids = [part.id, ...part.childIds];
    if (!old || old.selected.length || !next || old.preferred.length !== ids.length * 3) return false;
    for (const [index, id] of ids.entries()) {
      const offset = index * 3, point = next.get(id), oldX = old.preferred[offset + 1], oldY = old.preferred[offset + 2];
      if (old.preferred[offset] !== id || !point
        || typeof oldX !== 'number' || typeof oldY !== 'number'
        || ![oldX, oldY, point.x, point.y].every(Number.isFinite)
        || !Object.is(point.y, oldY)) return false;
      if (!Object.is(point.x, oldX)) {
        if (part.incarnation !== control.incarnation || index === 0) return false;
        changed = true;
      }
    }
  }
  return changed;
}
