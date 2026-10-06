import { establishesAssignment } from './assignmentContinuity.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { isExplicitTier2Role, normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';
import type { SyntaxNode } from '../../types.ts';
import type { RecoveredMovement } from './movementEvidence.ts';

/** An asserted subject chain can name its finite controller independently of
 * its thematic occurrence. No endpoint is chosen from an unordered chain. */
export function recoverSubjectChainControl(evidence: Tier2FacetEvidence) {
  if (normalizeTier2Synonym(evidence.relationName) !== 'subject chain and control' || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const sources = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'finite subject');
  const targets = anchors.filter(entry => entry.concepts.includes('controllee'));
  const domains = anchors.filter(entry => entry.concepts.includes('domain'));
  const indices = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('index'));
  if (sources.length !== 1 || targets.length !== 1 || sources[0].items.length !== 1 || targets[0].items.length !== 1
    || !uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items])
    || anchors.some(entry => entry !== sources[0] && entry.concepts.includes('controller'))
    || domains.length > 1 || domains.some(entry => entry.items.length !== 1 || !uniqueCurrentOwners(evidence, entry.items))
    || indices.length > 1 || indices.some(entry => entry.items.length !== 1 || !entry.items[0].trim())) return [];
  return [scopeEvidence(evidence, 'control.dependency', [{ entry: sources[0], concept: 'controller' },
    { entry: targets[0], concept: 'controllee' }, ...domains.map(entry => ({ entry, concept: 'domain' }))],
    indices.map(entry => ({ entry, concept: 'index' })))];
}

type ControlOccurrence = { node: SyntaxNode; parent: string | null; childIndex: number | null };
type ControlMoment = { stageIndex: number; relationIndex: number };
type ControlClaim = ControlMoment & { source: string; target: string };
export type ControlContext = {
  stages: Array<readonly SyntaxNode[]>;
  indexes: Map<number, Map<string, ControlOccurrence | null>>;
  movements: Map<number, RecoveredMovement[]>;
  claims: ControlClaim[];
};

export const createControlContext = (): ControlContext => ({ stages: [], indexes: new Map(), movements: new Map(), claims: [] });

/** Keep exact occurrence history so a chain never chooses a new controller by position. */
export function beginControlStage(context: ControlContext, forest: readonly SyntaxNode[]) {
  context.stages.push(forest);
}

// Analyses without control claims need no additional tree indexing.
function controlStageNodes(context: ControlContext, stageIndex: number) {
  const cached = context.indexes.get(stageIndex);
  if (cached) return cached;
  const nodes = new Map<string, ControlOccurrence | null>();
  const visit = (node: SyntaxNode, parent: string | null, childIndex: number | null) => {
    nodes.set(node.id, nodes.has(node.id) ? null : { node, parent, childIndex });
    node.children?.forEach((child, index) => visit(child, node.id, index));
  };
  context.stages[stageIndex]?.forEach(node => visit(node, null, null));
  context.indexes.set(stageIndex, nodes);
  return nodes;
}

export function rememberControlMovement(context: ControlContext, stageIndex: number, movement: RecoveredMovement) {
  if (context.claims.length && movement.transition)
    context.movements.set(stageIndex, [...(context.movements.get(stageIndex) ?? []), movement]);
}

const assertedControl = (evidence: Tier2FacetEvidence): boolean => {
  if (!establishesAssignment(evidence)) return false;
  const clauses = relationLabelClauses(evidence.relationName);
  const denied = /^(?:no|not|absence of|lack of|without|pending|possible|potential|hypothetical|ambiguous|unestablished|unresolved|failed|blocked|denied|rejected|unlicensed) .*\bcontrol\b|\bcontrol(?: dependency| relation)?(?: is)? (?:absent|pending|ambiguous|unresolved|unestablished|not established|not yet established|failed|blocked|denied|rejected|unlicensed)$/u;
  if (clauses.some(clause => denied.test(clause))) return false;
  return !(evidence.authoredValues ?? []).some(entry => normalizeTier2Synonym(entry.key) === 'dependency type'
    && entry.items.some(literal => /^(?:not|no) control$|\brather than control$/u.test(normalizeTier2Synonym(literal))));
};

/** Only a complete earlier control claim can establish the connector's owner. */
export function rememberControlClaim(context: ControlContext, evidence: Tier2FacetEvidence, moment: ControlMoment) {
  const sources = evidence.currentAnchors.controller ?? [], targets = evidence.currentAnchors.controllee ?? [];
  if (sources.length !== 1 || targets.length !== 1 || sources[0] === targets[0] || !assertedControl(evidence)) return;
  const nodes = controlStageNodes(context, moment.stageIndex);
  if (!nodes?.get(sources[0]) || !nodes.get(targets[0])) return;
  context.claims.push({ ...moment, source: sources[0], target: targets[0] });
}

function continuedControlOccurrence(context: ControlContext, id: string, since: number): string | undefined {
  let currentId = id;
  for (let stage = since + 1; stage < context.stages.length; stage += 1) {
    const before = controlStageNodes(context, stage - 1).get(currentId);
    if (!before) return;
    const current = controlStageNodes(context, stage).get(currentId);
    if (current && current.parent === before.parent && current.childIndex === before.childIndex
      && current.node.lineageId === before.node.lineageId) continue;
    const replacements = new Set((context.movements.get(stage) ?? []).flatMap(movement => {
      if (movement.priorSourceNodeId !== currentId) return [];
      const witness = controlStageNodes(context, stage).get(movement.witnessNodeId);
      return witness && before.node.lineageId && witness.node.lineageId === before.node.lineageId
        && witness.parent === before.parent && witness.childIndex === before.childIndex ? [movement.witnessNodeId] : [];
    }));
    if (replacements.size !== 1) return;
    currentId = [...replacements][0];
  }
  return currentId;
}

/** A chain restatement retains one previously proved controller position.
 * The complete list proves identity; it cannot select an endpoint by list order,
 * height, pronunciation, or a shared word. Its identity facet remains separate. */
export function recoverControllerChainControl(evidence: Tier2FacetEvidence, context: ControlContext) {
  if (!assertedControl(evidence) || evidence.authoredPriorAnchors?.length) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const chains = anchors.filter(entry => /^controller (?:occurrences|copies|chain)$/u.test(normalizeTier2Synonym(entry.key)));
  const targets = anchors.filter(entry => entry.concepts.includes('controllee') && isExplicitTier2Role('controllee', entry.key));
  const domains = anchors.filter(entry => entry.concepts.includes('domain'));
  const indices = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('index'));
  if (chains.length !== 1 || chains[0].items.length < 2 || targets.length !== 1 || targets[0].items.length !== 1
    || anchors.some(entry => entry.concepts.includes('controller'))
    || domains.length > 1 || domains.some(entry => entry.items.length !== 1 || !uniqueCurrentOwners(evidence, entry.items))
    || indices.length > 1 || indices.some(entry => entry.items.length !== 1 || !entry.items[0].trim())
    || !uniqueCurrentOwners(evidence, [...chains[0].items, ...targets[0].items])) return [];
  const nodes = controlStageNodes(context, context.stages.length - 1);
  const members = chains[0].items.map(id => nodes?.get(id));
  const lineage = members[0]?.node.lineageId;
  if (!lineage?.trim() || members.some(member => member?.node.lineageId !== lineage)) return [];
  const containsMember = (node: SyntaxNode): boolean => Boolean(node.children?.some(child =>
    chains[0].items.includes(child.id) || containsMember(child)));
  if (members.some(member => containsMember(member!.node))) return [];
  const pairs = new Map<string, { source: string; prior: ControlClaim }>();
  for (const claim of context.claims) {
    const source = continuedControlOccurrence(context, claim.source, claim.stageIndex);
    const target = continuedControlOccurrence(context, claim.target, claim.stageIndex);
    if (source && chains[0].items.includes(source) && target === targets[0].items[0])
      pairs.set(JSON.stringify([source, target]), { source, prior: claim });
  }
  if (pairs.size !== 1) return [];
  const { source, prior } = [...pairs.values()][0];
  const scope = scopeEvidence(evidence, 'control.dependency', [
    { entry: chains[0], concept: 'controller', indices: [chains[0].items.indexOf(source)] },
    { entry: targets[0], concept: 'controllee' }, ...domains.map(entry => ({ entry, concept: 'domain' }))
  ], indices.map(entry => ({ entry, concept: 'index' })));
  return [{ ...scope, restates: { stageIndex: prior.stageIndex, relationIndex: prior.relationIndex } }];
}
