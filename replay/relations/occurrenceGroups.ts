import type { SyntaxNode } from '../../types.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';

/** Named chains remain separate claims even when one relation lists several. */
export function recoverOccurrenceGroups(evidence: Tier2FacetEvidence) {
  const nodes = new Map<string, SyntaxNode[]>();
  const visit = (node: SyntaxNode) => {
    if (node.id) nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  const listed = (evidence.authoredCurrentAnchors ?? []).flatMap(entry => {
    const role = normalizeTier2Synonym(entry.key);
    if (!/^(?:[\p{L}\p{N}]+ )*(?:chain|occurrences)$/u.test(role)
      || entry.items.length < 2 || new Set(entry.items).size !== entry.items.length) return [];
    const occurrences = entry.items.map(id => nodes.get(id));
    if (occurrences.some(matches => matches?.length !== 1)) return [];
    const lineages = occurrences.map(matches => matches![0].lineageId?.trim());
    if (!lineages[0] || !lineages.every(lineage => lineage === lineages[0])) return [];
    const anchor = { ...entry, concepts: ['occurrences'],
      conceptItemIndices: { occurrences: entry.items.map((_, index) => index) } };
    return [{ kind: 'identity.occurrences' as const,
      origins: { anchors: { [entry.key]: entry.items.map((_, index) => index) }, values: {} },
      evidence: { currentForest: evidence.currentForest, currentAnchors: { occurrences: [...entry.items] },
        authoredCurrentAnchors: [anchor], values: {}, authoredValues: [] } satisfies Tier2FacetEvidence }];
  });
  // Pronunciation and chain-position fields can identify the same occurrence
  // family without restating movement. Root lineage proves identity only.
  const positioned = (evidence.authoredCurrentAnchors ?? []).filter(entry =>
    /^(?:chain (?:head|foot)|(?:pronounced|unpronounced)(?: occurrences?| copies?)?|(?:thematic|higher|lower|upper|base|raised|intermediate) (?:occurrences?|copies?))$/u
      .test(normalizeTier2Synonym(entry.key)));
  if (positioned.length < 2 || evidence.movement || positioned.some(entry => !entry.items.length
    || entry.items.some(id => nodes.get(id)?.length !== 1 || !nodes.get(id)![0].lineageId?.trim()))) return listed;
  const ids = positioned.flatMap(entry => entry.items);
  if (new Set(ids).size !== ids.length) return listed;
  const lineages = [...new Set(ids.map(id => nodes.get(id)![0].lineageId!))];
  return [...listed, ...lineages.flatMap(lineage => {
    const anchors = positioned.flatMap(entry => {
      const indices = entry.items.flatMap((id, index) => nodes.get(id)![0].lineageId === lineage ? [index] : []);
      return indices.length ? [{ entry, indices }] : [];
    });
    const members = anchors.flatMap(({ entry, indices }) => indices.map(index => entry.items[index]));
    if (members.length < 2 || anchors.length < 2) return [];
    return [{ kind: 'identity.occurrences' as const,
      origins: { anchors: Object.fromEntries(anchors.map(({ entry, indices }) => [entry.key, indices])), values: {} },
      evidence: { currentForest: evidence.currentForest, currentAnchors: { occurrences: members },
        occurrenceGroupAnchorKeys: anchors.map(({ entry }) => entry.key),
        authoredCurrentAnchors: anchors.map(({ entry, indices }) => ({ ...entry,
          items: indices.map(index => entry.items[index]), concepts: ['occurrences'],
          conceptItemIndices: { occurrences: indices.map((_, index) => index) } })),
        values: {}, authoredValues: [] } satisfies Tier2FacetEvidence }];
  })];
}
