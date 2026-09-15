/**
 * Unusually large authored anchor arrays: the accepted deterministic policy,
 * promoted from the relation lab.
 *
 * Any relation instance with an anchor role whose array reaches
 * `LARGE_ANCHOR_ARRAY_THRESHOLD` compiles to an ordered anchor-set plan
 * instead of being truncated, first-element-sampled, or overwritten. The plan
 * preserves exactly what was authored: relation-instance order within the
 * stage, role order within the relation, and array order within the role.
 * Repeated instances of one relation in one stage each get their own set.
 * Anchors resolve against their own stage's forest; an unresolved anchor is
 * kept in the plan marked unresolved and reported as a diagnostic — its mark
 * fails closed rather than guessing an endpoint. No semantics are inferred
 * from the relation name, and the rendered marks are ordered participation
 * badges and organizational role rails only — never a semantic connector.
 *
 * The badges/rails are additive organization for their parent relation
 * instance and inherit that compiled instance's persistence; they own no
 * independent persistence policy.
 */
import type { DerivationStage, SyntaxNode } from '../../types.ts';

export const LARGE_ANCHOR_ARRAY_THRESHOLD = 5;

/**
 * Full-array ownership predicate. An array role is exempt from the
 * organizational anchor-set marks only when a source-backed exact PRODUCTION
 * registry entry actually renders every element of that role's array itself.
 * Ownership is derived by the caller from the live registry and wired
 * families — never hardcoded here, and never inherited by a merely similar
 * name. With no predicate, nothing is exempt.
 */
export type FullArrayOwnershipPredicate = (relationName: string, role: string) => boolean;

export type LargeAnchorSet = {
  relation: string;
  stageIndex: number;
  /** Exact authored relation-array position; no name matching is needed later. */
  relationIndex: number;
  /** Order of this instance among same-named relations in its stage. */
  instanceIndex: number;
  roles: Array<{
    role: string;
    /** Order of the role within the authored anchors object. */
    roleIndex: number;
    /** Whether this role's array met the threshold. */
    large: boolean;
    anchors: Array<{ nodeId: string; arrayIndex: number; resolved: boolean }>;
  }>;
};

const exactRelationName = (value: string): string => String(value ?? '').trim();

const flattenAnchorIds = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : [value])
    .map((item) => String(item || ''))
    .filter((id) => Boolean(id.trim()));

const collectForestNodeIds = (forest: SyntaxNode[] | undefined): Set<string> => {
  const ids = new Set<string>();
  const walk = (node: SyntaxNode) => {
    const id = String(node.id || '');
    if (id) ids.add(id);
    (Array.isArray(node.children) ? node.children : []).forEach(walk);
  };
  (Array.isArray(forest) ? forest : []).forEach(walk);
  return ids;
};

export const compileLargeAnchorSets = (
  stages: DerivationStage[],
  isFullArrayOwned: FullArrayOwnershipPredicate = () => false
): { sets: LargeAnchorSet[]; diagnostics: string[] } => {
  const sets: LargeAnchorSet[] = [];
  const diagnostics: string[] = [];

  (Array.isArray(stages) ? stages : []).forEach((stage, stageIndex) => {
    const stageNodes = collectForestNodeIds(stage?.workspaceForest);
    const instanceCounts = new Map<string, number>();

    (Array.isArray(stage?.relations) ? stage.relations : []).forEach((relation, relationIndex) => {
      const exactName = exactRelationName(relation.relation);
      const instanceIndex = instanceCounts.get(exactName) ?? 0;
      instanceCounts.set(exactName, instanceIndex + 1);

      const roles = Object.entries(relation.anchors || {}).map(([role, value], roleIndex) => {
        const ids = flattenAnchorIds(value);
        const large = ids.length >= LARGE_ANCHOR_ARRAY_THRESHOLD
          && !isFullArrayOwned(relation.relation, role);
        return {
          role,
          roleIndex,
          large,
          anchors: ids.map((nodeId, arrayIndex) => ({
            nodeId,
            arrayIndex,
            resolved: stageNodes.has(nodeId)
          }))
        };
      });

      if (!roles.some((roleGroup) => roleGroup.large)) return;
      roles.forEach((roleGroup) => {
        if (!roleGroup.large) return;
        roleGroup.anchors.forEach((anchor) => {
          if (anchor.resolved) return;
          diagnostics.push(
            `${relation.relation}: ${roleGroup.role}[${anchor.arrayIndex}] -> ${anchor.nodeId} `
            + `does not resolve in stage ${stageIndex}; its mark fails closed`
          );
        });
      });
      sets.push({ relation: relation.relation, stageIndex, relationIndex, instanceIndex, roles });
    });
  });

  return { sets, diagnostics };
};
