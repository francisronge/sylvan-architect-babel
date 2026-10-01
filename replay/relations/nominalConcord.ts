import type { SyntaxNode } from '../../types.ts';
import { categoryLabel } from '../categoryLabel.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';

const nominalRoles = new Map([
  ['noun', ['N', 'NP']], ['nominal', ['N', 'NP']],
  ['nominal head', ['N', 'NP']],
  ['adjective', ['A', 'AP', 'Adj', 'AdjP']],
  ['determiner', ['D', 'DP', 'Det', 'DetP']], ['demonstrative', ['D', 'DP', 'Det', 'DetP', 'Dem', 'DemP']],
  ['definite determiner', ['D', 'DP', 'Det', 'DetP']],
  ['article', ['D', 'DP', 'Det', 'DetP']], ['quantifier', ['Q', 'QP']]
]);
const memberCategory = (node: SyntaxNode) => categoryLabel(node.label).replace(/(?:\^?0|⁰)$/u, '');

/** Undirected, explicitly named nominal members can share an authored feature
 * bundle. A source/controller, a second nominal domain or a missing member
 * prevents this reading; no direction is inferred from tree order. */
type ConcordEvidence = Pick<Tier2FacetEvidence,
  'authoredCurrentAnchors' | 'authoredValues' | 'currentForest' | 'relationName'>;
export function nominalConcordMembers(evidence: ConcordEvidence) {
  return concordMembers(evidence, false);
}

/** A declared controller and target inventory owns directed dependencies,
 * even when all participants also share the same nominal feature bundle. */
export function directedNominalConcordMembers(evidence: ConcordEvidence) {
  return concordMembers(evidence, true);
}

function concordMembers(evidence: ConcordEvidence, directed: boolean) {
  if (relationLabelClauses(evidence.relationName).some(clause => /\bnominal concord\b/u.test(clause)
    && /\b(?:no|not|without|denied|rejected|required|requested|expected|possible|potential|hypothetical|pending|unresolved|if|unless|whether)\b/u.test(clause))) return [];
  let entries = evidence.authoredCurrentAnchors ?? [];
  const named = entries.length >= 2 && entries.some(entry => ['noun', 'nominal', 'nominal head'].includes(normalizeTier2Synonym(entry.key)))
    && entries.every(entry => nominalRoles.has(normalizeTier2Synonym(entry.key)));
  const controller = entries.filter(entry => normalizeTier2Synonym(entry.key) === 'controller');
  const targets = entries.filter(entry => /^targets?$/u.test(normalizeTier2Synonym(entry.key)));
  const directedInventory = /^(?:nominal|adjectival|determiner) concord$/u.test(normalizeTier2Synonym(evidence.relationName))
    && entries.length === 2 && controller.length === 1 && controller[0].items.length === 1 && targets.length === 1 && targets[0].items.length > 0;
  if (!(directed ? directedInventory : named)) return [];
  const features = evidence.authoredValues?.filter(entry => entry.concepts.includes('feature.rows')) ?? [];
  if (!features.length || features.some(entry => !entry.items.length || entry.items.some(value => !value.trim()))) return [];
  const paths = new Map<string, SyntaxNode[][]>();
  const visit = (node: SyntaxNode, ancestors: SyntaxNode[]) => {
    const path = [...ancestors, node];
    if (node.id) paths.set(node.id, [...(paths.get(node.id) ?? []), path]);
    node.children?.forEach(child => visit(child, path));
  };
  evidence.currentForest.forEach(node => visit(node, []));
  const members = entries.flatMap(entry => entry.items);
  if (members.length < 2 || new Set(members).size !== members.length) return [];
  for (const entry of entries) {
    const domainContext = !directed && normalizeTier2Synonym(entry.key) === 'nominal' && entry.items.length === 1
      && entries.some(other => normalizeTier2Synonym(other.key) === 'noun')
      && entries.filter(other => other !== entry).every(other => other.items.every(id => paths.get(id)?.length === 1
        && paths.get(id)![0].some(node => node.id === entry.items[0])));
    const categories = directed ? entry === controller[0] ? ['N', 'NP'] : ['A', 'AP', 'Adj', 'AdjP', 'D', 'DP', 'Det', 'DetP', 'Dem', 'DemP', 'Q', 'QP']
      : domainContext ? ['N', 'NP', 'D', 'DP', 'K', 'KP'] : nominalRoles.get(normalizeTier2Synonym(entry.key))!;
    if (!entry.items.length || entry.items.some(id => paths.get(id)?.length !== 1
      || !categories.includes(memberCategory(paths.get(id)![0].at(-1)!)))) return [];
  }
  // A named nominal enclosing the separately declared noun and modifiers is
  // their domain context, not another feature-sharing member.
  if (!directed && entries.some(entry => normalizeTier2Synonym(entry.key) === 'noun')) {
    entries = entries.filter(entry => normalizeTier2Synonym(entry.key) !== 'nominal' || entry.items.length !== 1
      || !entries.filter(other => other !== entry).every(other => other.items.every(id =>
        paths.get(id)![0].some(node => node.id === entry.items[0]))));
  }
  const memberPaths = entries.flatMap(entry => entry.items).map(id => paths.get(id)![0]);
  const commonNominal = memberPaths[0].filter(node => (['NP', 'DP', 'KP'].includes(categoryLabel(node.label))
    || (node.children?.length ?? 0) > (directed ? 0 : 1) && ['N', 'D', 'K'].includes(categoryLabel(node.label))))
    .reverse().find(node => memberPaths.every(path => path.includes(node)));
  if (!commonNominal || memberPaths.some(path => path.slice(path.indexOf(commonNominal) + 1)
    .some(node => ['CP', 'TP', 'IP', 'S', 'VP', 'vP'].includes(categoryLabel(node.label))))) return [];
  return entries;
}
