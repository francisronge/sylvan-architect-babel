import type { SyntaxNode } from '../../types.ts';
import { readCategoryLabel } from '../categoryLabel.ts';
import { scopeEvidence } from './evidenceScopes.ts';
import { resolveOutcomeLiteral } from './outcomeResolver.ts';
import { POSITIVE_OUTCOMES, type Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';

/** An edge reached by a phrasal movement may be named in its landing-site
 * description. The exact phase head and its projection spine corroborate that
 * position; neither a category alone nor a future Transfer licenses the mark. */
export function recoverPhaseEdge(evidence: Tier2FacetEvidence) {
  if (evidence.currentAnchors['phase.edge']?.length || evidence.movement?.trajectoryKind !== 'phrasal') return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const heads = anchors.filter(entry => entry.concepts.includes('phase.head'));
  const edges = anchors.filter(entry => entry.concepts.includes('movement.landing')
    && entry.items.includes(evidence.movement!.targetNodeId));
  if (heads.length !== 1 || edges.length !== 1 || heads[0].items.length !== 1 || edges[0].items.length !== 1) return [];
  const head = heads[0], edge = edges[0];
  const nodes = new Map<string, SyntaxNode[]>(), parents = new Map<string, SyntaxNode[]>();
  const visit = (node: SyntaxNode, parent?: SyntaxNode) => {
    nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]);
    if (parent) parents.set(node.id, [...(parents.get(node.id) ?? []), parent]);
    node.children?.forEach(child => visit(child, node));
  };
  evidence.currentForest.forEach(node => visit(node));
  const uniqueNode = (id: string) => nodes.get(id)?.length === 1 ? nodes.get(id)![0] : undefined;
  const headNode = uniqueNode(head.items[0]), edgeNode = uniqueNode(edge.items[0]);
  const headShape = readCategoryLabel(headNode?.label);
  const headComplex = Boolean(headNode?.children?.length && headNode.children.every(child => {
    const shape = readCategoryLabel(child.label);
    return uniqueNode(child.id) === child && shape?.kind === 'head' && !shape.compound && !child.children?.length;
  }) && headNode.children.some(child => readCategoryLabel(child.label)?.head === headShape?.head));
  if (!headNode || !edgeNode || headNode === edgeNode || headNode.children?.length && !headComplex
    || headShape?.kind !== 'head' || headShape.compound) return [];
  // The edge is a sister of the head's projection, never material inside its
  // complement or an unrelated node elsewhere in the workspace forest.
  let projection = headNode, attached = false;
  while (parents.get(projection.id)?.length === 1) {
    const parent = parents.get(projection.id)![0], shape = readCategoryLabel(parent.label);
    if (uniqueNode(parent.id) !== parent || shape?.head !== headShape.head || shape.compound) break;
    const sisters = parent.children?.filter(child => child !== projection) ?? [];
    if (sisters.includes(edgeNode)) { attached = true; break; }
    if (sisters.some(child => readCategoryLabel(child.label)?.head === headShape.head)) break;
    projection = parent;
  }
  if (!attached) return [];

  const clauses = relationLabelClauses(evidence.relationName);
  const denied = /\b(?:no|not|without|failed|blocked|rejected|unlicensed|unsuccessful|absent|possible|potential|hypothetical|pending|unresolved|unestablished|whether|if|unless)\b/u;
  if (clauses.some(clause => /\b(?:phase edge|internal merge|movement)\b/u.test(clause) && denied.test(clause))) return [];
  const values = evidence.authoredValues ?? [];
  const statuses = values.filter(entry => /^(?:(?:phase )?edge )?(?:status|outcome)$/u.test(normalizeTier2Synonym(entry.key)));
  if (statuses.some(entry => entry.items.length !== 1
    || !POSITIVE_OUTCOMES.includes(resolveOutcomeLiteral(entry.items[0])?.concept as typeof POSITIVE_OUTCOMES[number]))) return [];
  const phaseEdgeMovement = clauses.some(clause => /^(?:phase edge (?:movement|internal merge)|(?:internal merge|(?:(?:phrasal|wh) )?movement) (?:to|through) (?:the )?phase edge)$/u.test(clause));
  const ordinaryMovement = clauses.some(clause => /^(?:successive cyclic )?(?:(?:object|subject|relative|wh) )?(?:internal merge|phrasal movement|movement)$/u.test(clause));
  const category = normalizeTier2Synonym(headShape.head);
  const chainEdgeMovement = clauses.some(clause => new RegExp(`^wh chain extension through the (?:embedded|matrix) ${category} edge$`, 'u').test(clause));
  if (!phaseEdgeMovement && !ordinaryMovement && !chainEdgeMovement) return [];
  const modifiers = '(?:(?:the|outer|inner|embedded|matrix|transitive|intransitive|declarative|interrogative|little) )*';
  const location = new RegExp(`^(?:${modifiers}(?:phase edge|${category} (?:phase )?edge)|${modifiers}edge of ${modifiers}${category})$`, 'u');
  const sites = values.filter(entry => /^(?:landing site|landing position|destination)$/u.test(normalizeTier2Synonym(entry.key)));
  if (sites.some(entry => entry.items.length !== 1 || !location.test(normalizeTier2Synonym(entry.items[0])))) return [];
  const triggers = values.filter(entry => normalizeTier2Synonym(entry.key) === 'trigger' && entry.items.length === 1
    && new RegExp(`^(?:${category}|phase) edge feature$`, 'u').test(normalizeTier2Synonym(entry.items[0])));
  if (!phaseEdgeMovement && !sites.length && !((ordinaryMovement || chainEdgeMovement) && triggers.length === 1)) return [];
  // The head and assertion corroborate the edge position but are not themselves
  // painted. Leave that supporting context available as authored neutral text.
  return [scopeEvidence(evidence, 'phase.edge', [{ entry: edge, concept: 'phase.edge' }])];
}
