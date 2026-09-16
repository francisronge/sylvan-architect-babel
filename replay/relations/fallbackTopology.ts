/**
 * Accepted unregistered-relation fallback: the pure, topology-only dispatcher.
 *
 * Promoted from the accepted relation-lab fallback design. The dispatcher
 * never reads the relation name, the role
 * names, the node IDs, or any authored value. It reads only structural facts
 * of the authored instance — how many scalar roles have a witness, how many
 * array roles there are and how long each is, the authored order inside each
 * array, and whether the instance authors `priorAnchors`.
 *
 * The corrected dispatch table, structural facts only:
 *   row 0 prior-only · row 1 single witness · row 2 two scalars · row 3 one
 *   scalar plus one array · row 4 one array · row 5 two equal arrays ·
 *   row 6 closure.
 * Rows 2 and 3 are the only rows that license a connector, because they are
 * the only shapes in which the authored data says which endpoints belong
 * together. Connectors are undirected and carry zero arrowheads. `values`
 * affect no fallback geometry. The canvas prints authored role names and array
 * positions; relation names, backend node IDs and values remain in the record
 * and Replay panel.
 */

export type FallbackAnchorBlock = Record<string, string | string[]> | undefined;

export type FallbackRelationInstance = {
  relation: string;
  anchors: FallbackAnchorBlock;
  priorAnchors?: FallbackAnchorBlock;
  values?: Record<string, string | string[]>;
};

export type FallbackFrameShape = 'circle' | 'box';

export interface FallbackInstanceMark {
  /** Authoring order of the relation instance in its stage, 1-based. */
  instance: number;
  witness: string;
  role: string;
  /** Authored array position, 1-based, or null for a scalar role. */
  position: number | null;
  /** 0 for the first authored role group, 1 for the second, and so on. */
  group: number;
  /** Only the first two array role groups take a distinguishing frame shape. */
  frame: FallbackFrameShape;
  /** True when the instance also authors previous-stage witnesses. */
  backward: boolean;
}

export interface FallbackFanMark {
  hub: string;
  spokes: string[];
  directed: false;
  arrowheads: 0;
}

export interface FallbackLinkMark {
  endpoints: [string, string];
  directed: false;
  arrowheads: 0;
}

/** Which structural row of the accepted dispatch table an instance took. */
export type FallbackTopologyRow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface FallbackDrawing {
  instance: number;
  row: FallbackTopologyRow;
  marks: FallbackInstanceMark[];
  fan: FallbackFanMark | null;
  link: FallbackLinkMark | null;
  /** Previous-stage witnesses; revealed by interaction, never drawn by default. */
  priorWitnesses: string[];
  backward: boolean;
}

interface RoleGroup {
  role: string;
  witnesses: string[];
  isArray: boolean;
}

/** Authored role order preserved; blank entries dropped. */
const roleGroups = (block: FallbackAnchorBlock): RoleGroup[] =>
  Object.entries(block || {})
    .map(([role, value]) => ({ role,
      isArray: Array.isArray(value),
      witnesses: (Array.isArray(value) ? value : [value])
        .map((entry) => String(entry || ''))
        .filter((id) => Boolean(id.trim()))
    }))
    .filter((group) => group.witnesses.length > 0);

export const fallbackDrawing = (
  relation: FallbackRelationInstance,
  instance = 1
): FallbackDrawing => {
  const current = roleGroups(relation.anchors);
  const prior = roleGroups(relation.priorAnchors);
  const priorWitnesses = prior.flatMap((group) => group.witnesses);
  const backward = priorWitnesses.length > 0;

  const scalars = current.filter((group) => !group.isArray);
  const arrays = current.filter((group) => group.isArray);
  const witnessCount = current.reduce((total, group) => total + group.witnesses.length, 0);

  /*
   * The frame shape distinguishes role groups only where the authored data
   * needs it: with two or more arrays, position numerals repeat across groups,
   * so the second array takes the box frame. Scalars, and a lone array, always
   * take the circle — inventing a shape contrast there would imply a grouping
   * distinction the drawing does not otherwise make.
   */
  const groupFramesNeeded = arrays.length >= 2;
  let arrayOrdinal = -1;
  const marks: FallbackInstanceMark[] = current.flatMap((group, groupIndex) => {
    if (group.isArray) arrayOrdinal += 1;
    const frame: FallbackFrameShape =
      groupFramesNeeded && group.isArray && arrayOrdinal === 1 ? 'box' : 'circle';
    return group.witnesses.map((witness, position) => ({
      instance,
      witness,
      role: group.role,
      position: group.isArray ? position + 1 : null,
      group: groupIndex,
      frame,
      backward
    }));
  });

  const base = { instance, marks, fan: null, link: null, priorWitnesses, backward } as const;

  if (witnessCount === 0) return { ...base, row: 0 };
  if (witnessCount === 1) return { ...base, row: 1 };

  if (scalars.length === 2 && arrays.length === 0) {
    return {
      ...base,
      row: 2,
      link: {
        endpoints: [scalars[0].witnesses[0], scalars[1].witnesses[0]],
        directed: false,
        arrowheads: 0
      }
    };
  }

  if (scalars.length === 1 && arrays.length === 1) {
    return {
      ...base,
      row: 3,
      fan: {
        hub: scalars[0].witnesses[0],
        spokes: [...arrays[0].witnesses],
        directed: false,
        arrowheads: 0
      }
    };
  }

  if (scalars.length === 0 && arrays.length === 1) return { ...base, row: 4 };

  if (
    scalars.length === 0
    && arrays.length === 2
    && arrays[0].witnesses.length === arrays[1].witnesses.length
  ) {
    return { ...base, row: 5 };
  }

  // Closure: nothing in the authored data pairs these endpoints, so the
  // drawing marks participation and stops. No connector is invented.
  return { ...base, row: 6 };
};
