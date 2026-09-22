import type { SyntaxNode } from '../../types.ts';
import { categoryLabel } from '../categoryLabel.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';

const nominalRoles = new Map([
  ['noun', ['N', 'NP']], ['nominal', ['N', 'NP']],
  ['adjective', ['A', 'AP', 'Adj', 'AdjP']],
  ['determiner', ['D', 'DP', 'Det', 'DetP']], ['demonstrative', ['D', 'DP', 'Dem', 'DemP']],
  ['article', ['D', 'DP', 'Det', 'DetP']], ['quantifier', ['Q', 'QP']]
]);
const memberCategory = (node: SyntaxNode) => categoryLabel(node.label).replace(/(?:\^?0|⁰)$/u, '');

/** Undirected, explicitly named nominal members can share an authored feature
 * bundle. A source/controller, a second nominal domain or a missing member
 * prevents this reading; no direction is inferred from tree order. */
export function nominalConcordMembers(evidence: Pick<Tier2FacetEvidence,
  'authoredCurrentAnchors' | 'authoredValues' | 'currentForest'>) {
  const entries = evidence.authoredCurrentAnchors ?? [];
  if (entries.length < 2 || !entries.some(entry => ['noun', 'nominal'].includes(normalizeTier2Synonym(entry.key)))
    || entries.some(entry => !nominalRoles.has(normalizeTier2Synonym(entry.key)))) return [];
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
    const categories = nominalRoles.get(normalizeTier2Synonym(entry.key))!;
    if (!entry.items.length || entry.items.some(id => paths.get(id)?.length !== 1
      || !categories.includes(memberCategory(paths.get(id)![0].at(-1)!)))) return [];
  }
  const memberPaths = members.map(id => paths.get(id)![0]);
  const commonNominal = memberPaths[0].filter(node => ['NP', 'DP', 'KP'].includes(categoryLabel(node.label)))
    .reverse().find(node => memberPaths.every(path => path.includes(node)));
  if (!commonNominal || memberPaths.some(path => path.slice(path.indexOf(commonNominal) + 1)
    .some(node => ['CP', 'TP', 'IP', 'S', 'VP', 'vP'].includes(categoryLabel(node.label))))) return [];
  return entries;
}
