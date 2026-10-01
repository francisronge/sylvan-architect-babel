import type { SyntaxNode } from '../../types.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';

/** Correspondence between explicitly pronounced and interpreted occurrences is
 * paired by exact root lineage. Independent list order carries no association. */
export function recoverInterpretiveCorrespondence(evidence: Tier2FacetEvidence) {
  const fields = evidence.authoredCurrentAnchors ?? [];
  const sources = fields.filter(entry => /^(?:pronounced|pf) (?:arguments?|occurrences?|constituents?)$/u.test(normalizeTier2Synonym(entry.key)));
  const targets = fields.filter(entry => /^(?:interpreted|interpretive|lf) (?:arguments?|occurrences?|constituents?)$/u.test(normalizeTier2Synonym(entry.key)));
  if (sources.length !== 1 || targets.length !== 1) return [];
  const [source] = sources, [target] = targets;
  const ids = [...source.items, ...target.items];
  if (!source.items.length || source.items.length !== target.items.length || new Set(ids).size !== ids.length) return [];
  const nodes = new Map<string, SyntaxNode[]>();
  const visit = (node: SyntaxNode) => {
    if (node.id) nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  if (ids.some(id => nodes.get(id)?.length !== 1 || !nodes.get(id)![0].lineageId?.trim())) return [];
  const lineage = (id: string) => nodes.get(id)![0].lineageId;
  const matches = source.items.map(id => target.items.flatMap((other, index) => lineage(id) === lineage(other) ? [index] : []));
  if (matches.some(indices => indices.length !== 1) || new Set(matches.flat()).size !== source.items.length) return [];
  return source.items.map((id, sourceIndex) => {
    const targetIndex = matches[sourceIndex][0];
    const anchors = [{ entry: source, id, role: 'correspondence.source' },
      { entry: target, id: target.items[targetIndex], role: 'correspondence.target' }];
    return { kind: 'correspondence.alignment' as const,
      origins: { anchors: { [source.key]: [sourceIndex], [target.key]: [targetIndex] }, values: {} },
      evidence: { currentForest: evidence.currentForest,
        currentAnchors: Object.fromEntries(anchors.map(anchor => [anchor.role, [anchor.id]])),
        authoredCurrentAnchors: anchors.map(({ entry, id, role }) => ({ ...entry,
          items: [id], concepts: [role], conceptItemIndices: { [role]: [0] } })),
        values: {}, authoredValues: [] } satisfies Tier2FacetEvidence };
  });
}
