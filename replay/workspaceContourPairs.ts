import type { PlaqueRect } from './relations/plaquePlacement.ts';
import { cubicIntersectsRect } from './relations/curveClearance.ts';
import { workspaceObstacleBuffer, WorkspaceObstacleBuffer } from './workspaceObstacleBuffer.ts';

export type WorkspaceContourPair = {
  left: readonly PlaqueRect[];
  rightByY: readonly PlaqueRect[];
  maximumBottomByPrefix?: readonly number[];
  separation: number;
  answers: Map<number, boolean>;
};

// Immutable index buffers can be shared by horizontal trials. Keep them private
// so callers cannot alter another pair's cached vertical contacts.
const contactIndices = new WeakMap<WorkspaceContourPair, Uint32Array>();
const bufferedPairs = new WeakMap<WorkspaceContourPair, {
  left: WorkspaceObstacleBuffer; right: WorkspaceObstacleBuffer; order: readonly number[]; contacts: Uint32Array;
}>();

function maximumBottomByPrefix(rectangles: readonly PlaqueRect[]): number[] | undefined {
  const result: number[] = [];
  let maximum = -Infinity;
  for (const rect of rectangles) {
    const bottom = rect.y + rect.height;
    // Nonfinite values can also make the original sort non-monotone. Retain
    // its exact scan rather than assuming an ordered vertical index.
    if (!Number.isFinite(rect.y) || !Number.isFinite(rect.height) || !Number.isFinite(bottom)) return undefined;
    maximum = Math.max(maximum, bottom);
    result.push(maximum);
  }
  return result;
}

/** Every earlier obstacle ends at or above this top and would be skipped by
 * the original scan. A long earlier rectangle keeps the prefix in range. */
function firstPossibleOverlap(prefix: readonly number[] | undefined, rect: PlaqueRect): number {
  if (!prefix || !Number.isFinite(rect.y) || !Number.isFinite(rect.y + rect.height)) return 0;
  let low = 0, high = prefix.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (prefix[middle] <= rect.y) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Contour obstacles stay immutable for the lifetime of this pair.
 * Separation is used during packing even when no exact contact query follows.
 * Preserve that scan's order and arithmetic without allocating contact tuples. */
export function prepareWorkspaceContourPair(left: readonly PlaqueRect[], right: readonly PlaqueRect[]): WorkspaceContourPair {
  const rightByY = [...right].sort((a, b) => a.y - b.y);
  const prefix = maximumBottomByPrefix(rightByY);
  let separation = 1;
  for (const a of left) {
    for (let index = firstPossibleOverlap(prefix, a); index < rightByY.length; index++) {
      const b = rightByY[index];
      if (b.y >= a.y + a.height) break;
      if (b.y + b.height <= a.y) continue;
      separation = Math.max(separation, a.x + a.width - b.x + 16);
    }
  }
  return { left, rightByY, maximumBottomByPrefix: prefix, separation, answers: new Map() };
}

/** One lifetime preparation owns this bounded index. Horizontal trials can
 * reuse vertical contacts, but separation and precise collisions always read
 * the current obstacles. A hash narrows lookup; exact snapshots certify reuse. */
export function createWorkspaceContourPairPreparer() {
  type Entry = { left: Float64Array; right: Float64Array; order: number[]; prefix: number[];
    contacts: Uint32Array; hash: number };
  const buckets = new Map<number, Entry[]>(), recent = new Map<Entry, true>();
  const bits = new Float64Array(1), words = new Uint32Array(bits.buffer);
  const maxEntries = 64, maxContacts = 65536, maxSnapshotValues = 131072;
  let contactCount = 0, snapshotValues = 0;
  const fingerprint = (left: WorkspaceObstacleBuffer, right: WorkspaceObstacleBuffer) => {
    let hash = 2166136261;
    for (const rectangles of [left, right]) {
      hash = Math.imul(hash ^ rectangles.length, 16777619);
      const bounds = rectangles.bounds;
      for (let offset = 0; offset < bounds.length; offset += 4) {
        const y = bounds[offset + 1], height = bounds[offset + 3];
        if (!Number.isFinite(y) || !Number.isFinite(height) || !Number.isFinite(y + height)) return;
        bits[0] = y;
        hash = Math.imul(Math.imul(hash ^ words[0], 16777619) ^ words[1], 16777619);
        bits[0] = height;
        hash = Math.imul(Math.imul(hash ^ words[0], 16777619) ^ words[1], 16777619);
      }
    }
    return hash;
  };
  const matches = (snapshot: Float64Array, rectangles: WorkspaceObstacleBuffer) => {
    if (snapshot.length !== rectangles.length * 2) return false;
    const bounds = rectangles.bounds;
    for (let index = 0; index < rectangles.length; index++) {
      if (!Object.is(snapshot[index * 2], bounds[index * 4 + 1])
        || !Object.is(snapshot[index * 2 + 1], bounds[index * 4 + 3])) return false;
    }
    return true;
  };
  const snapshot = (rectangles: WorkspaceObstacleBuffer) => {
    const values = new Float64Array(rectangles.length * 2), bounds = rectangles.bounds;
    for (let index = 0; index < rectangles.length; index++) {
      values[index * 2] = bounds[index * 4 + 1]; values[index * 2 + 1] = bounds[index * 4 + 3];
    }
    return values;
  };
  return (leftInput: readonly PlaqueRect[] | WorkspaceObstacleBuffer, rightInput: readonly PlaqueRect[] | WorkspaceObstacleBuffer): WorkspaceContourPair => {
    const left = workspaceObstacleBuffer(leftInput), right = workspaceObstacleBuffer(rightInput);
    const fallback = () => prepareWorkspaceContourPair(left.rectangles(), right.rectangles());
    const size = (left.length + right.length) * 2;
    if (size > maxSnapshotValues) return fallback();
    const hash = fingerprint(left, right);
    if (hash === undefined) return fallback();
    const a = left.bounds, b = right.bounds;
    let entry = buckets.get(hash)?.find(item => matches(item.left, left) && matches(item.right, right));
    if (!entry) {
      const order = Array.from({ length: right.length }, (_, i) => i).sort((i, j) => b[i * 4 + 1] - b[j * 4 + 1]);
      const prefix: number[] = [];
      let maximum = -Infinity;
      for (const index of order) {
        maximum = Math.max(maximum, b[index * 4 + 1] + b[index * 4 + 3]);
        prefix.push(maximum);
      }
      const contacts: number[] = [];
      for (let i = 0; i < left.length; i++) {
        const y = a[i * 4 + 1], bottom = y + a[i * 4 + 3];
        let low = 0, high = prefix.length;
        while (low < high) {
          const middle = low + Math.floor((high - low) / 2);
          if (prefix[middle] <= y) low = middle + 1; else high = middle;
        }
        for (let j = low; j < order.length; j++) {
          const offset = order[j] * 4;
          if (b[offset + 1] >= bottom) break;
          if (b[offset + 1] + b[offset + 3] <= y) continue;
          if (contacts.length === maxContacts * 2) return fallback();
          contacts.push(i, j);
        }
      }
      entry = { left: snapshot(left), right: snapshot(right), order, prefix, contacts: new Uint32Array(contacts), hash };
      while (recent.size >= maxEntries || contactCount + contacts.length / 2 > maxContacts
        || snapshotValues + size > maxSnapshotValues) {
        const oldest = recent.keys().next().value!;
        recent.delete(oldest); contactCount -= oldest.contacts.length / 2;
        snapshotValues -= oldest.left.length + oldest.right.length;
        const bucket = buckets.get(oldest.hash)!;
        bucket.splice(bucket.indexOf(oldest), 1);
        if (!bucket.length) buckets.delete(oldest.hash);
      }
      let bucket = buckets.get(hash);
      if (!bucket) buckets.set(hash, bucket = []);
      bucket.push(entry); contactCount += contacts.length / 2; snapshotValues += size;
    }
    recent.delete(entry); recent.set(entry, true);
    const order = entry.order, contacts = entry.contacts;
    let separation = 1;
    for (let index = 0; index < contacts.length; index += 2) {
      const leftOffset = contacts[index] * 4, rightOffset = order[contacts[index + 1]] * 4;
      separation = Math.max(separation, a[leftOffset] + a[leftOffset + 2] - b[rightOffset] + 16);
    }
    let rightByY: PlaqueRect[] | undefined;
    const pair = { get left() { return left.rectangles(); },
      get rightByY() { return rightByY ??= order.map(index => right.rectangle(index)); },
      maximumBottomByPrefix: [...entry.prefix], separation, answers: new Map<number, boolean>() };
    bufferedPairs.set(pair, { left, right, order, contacts });
    return pair;
  };
}

function bufferedCollision(pair: NonNullable<ReturnType<typeof bufferedPairs.get>>, dx: number): [PlaqueRect, PlaqueRect] | undefined {
  const { left, right, order, contacts } = pair, a = left.bounds, b = right.bounds;
  for (let index = 0; index < contacts.length; index += 2) {
    const ai = contacts[index], bi = order[contacts[index + 1]], ap = ai * 4, bp = bi * 4;
    const shiftedX = b[bp] + dx;
    const width = Math.min(a[ap] + a[ap + 2], shiftedX + b[bp + 2]) - Math.max(a[ap], shiftedX);
    if (!(width > 1e-6 && Math.min(a[ap + 1] + a[ap + 3], b[bp + 1] + b[bp + 3])
      - Math.max(a[ap + 1], b[bp + 1]) > 1e-6)) continue;
    const leftRect = left.rectangle(ai), rightRect = right.rectangle(bi);
    if (exactContact(leftRect, rightRect, shiftedX, dx)) return [leftRect, rightRect];
  }
}

function exactContact(a: PlaqueRect, b: PlaqueRect, shiftedX: number, dx: number): boolean {
  if (!a.curve && !b.curve) return true;
  const shifted = { ...b, x: shiftedX, y: b.y + 0,
    ...(b.curve ? { curve: {
      source: { x: b.curve.source.x + dx, y: b.curve.source.y + 0 },
      control1: { x: b.curve.control1.x + dx, y: b.curve.control1.y + 0 },
      control2: { x: b.curve.control2.x + dx, y: b.curve.control2.y + 0 },
      target: { x: b.curve.target.x + dx, y: b.curve.target.y + 0 }
    } } : {}) };
  return (!a.curve || cubicIntersectsRect(a.curve, shifted, a.curvePadding))
    && (!shifted.curve || cubicIntersectsRect(shifted.curve, a, shifted.curvePadding));
}

export function workspaceContourPairCollision(pair: WorkspaceContourPair, dx: number): [PlaqueRect, PlaqueRect] | undefined {
  const buffered = bufferedPairs.get(pair);
  if (buffered) return bufferedCollision(buffered, dx);
  let indices = contactIndices.get(pair);
  if (!indices) {
    const contacts: number[] = [];
    for (let i = 0; i < pair.left.length; i++) {
      const a = pair.left[i];
      for (let j = firstPossibleOverlap(pair.maximumBottomByPrefix, a); j < pair.rightByY.length; j++) {
        const b = pair.rightByY[j];
        if (b.y >= a.y + a.height) break;
        if (b.y + b.height <= a.y) continue;
        contacts.push(i, j);
      }
    }
    indices = new Uint32Array(contacts);
    contactIndices.set(pair, indices);
  }
  for (let index = 0; index < indices.length; index += 2) {
    const a = pair.left[indices[index]], b = pair.rightByY[indices[index + 1]];
    const shiftedX = b.x + dx;
    const width = Math.min(a.x + a.width, shiftedX + b.width) - Math.max(a.x, shiftedX);
    if (!(width > 1e-6 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1e-6)) continue;
    if (exactContact(a, b, shiftedX, dx)) return [a, b];
  }
}
