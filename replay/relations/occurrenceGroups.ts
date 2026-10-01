import { establishesAssignment } from './assignmentContinuity.ts';
import type { SyntaxNode } from '../../types.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';

/** Named chains remain separate claims even when one relation lists several. */
export function recoverOccurrenceGroups(evidence: Tier2FacetEvidence) {
  const indices = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('index'));
  const index = indices.length === 1 && indices[0].items.length === 1 && indices[0].items[0].trim() ? indices[0] : undefined;
  const values = index ? { index: [...index.items] } : {};
  const authoredValues = index ? [{ ...index, concepts: ['index'] }] : [];
  const valueOrigins = index ? { [index.key]: [0] } : {};
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
      origins: { anchors: { [entry.key]: entry.items.map((_, index) => index) }, values: valueOrigins },
      evidence: { currentForest: evidence.currentForest, currentAnchors: { occurrences: [...entry.items] },
        authoredCurrentAnchors: [anchor], values, authoredValues } satisfies Tier2FacetEvidence }];
  });
  // Pronunciation and chain-position fields can identify the same occurrence
  // family without restating movement. Root lineage proves identity only.
  const chainDescription = /\b(?:chain|identity|shared (?:thematic )?argument|antecedent government|government of (?:the )?(?:head )?traces?)\b/u.test(normalizeTier2Synonym(evidence.relationName ?? ''));
  const positioned = (evidence.authoredCurrentAnchors ?? []).filter(entry => chainDescription ? entry.items.length > 0 && entry.items.every(id => nodes.get(id)?.length === 1 && nodes.get(id)![0].lineageId?.trim()) :
    /^(?:chain (?:head|foot)|(?:pronounced|unpronounced)(?: occurrences?| copies?)?|(?:thematic|higher|lower|upper|base|raised|intermediate) (?:occurrences?|copies?|traces?|positions?|verbs?)|(?:head|verb|object|subject) (?:antecedent|trace|position)|(?:overt|pronounced) (?:antecedent|argument)|theta position)$/u
      .test(normalizeTier2Synonym(entry.key)));
  const namedList = positioned.length === 1 && establishesAssignment(evidence) && /\bchain\b/u.test(normalizeTier2Synonym(evidence.relationName ?? ''))
    && !/\b(?:no|not|without|possible|potential|hypothetical|pending|unresolved|failed|blocked|unlicensed)\b/u.test(normalizeTier2Synonym(evidence.relationName ?? ''));
  if ((!namedList && positioned.length < 2) || evidence.movement || positioned.some(entry => !entry.items.length
    || entry.items.some(id => nodes.get(id)?.length !== 1 || !nodes.get(id)![0].lineageId?.trim()))) return listed;
  const ids = positioned.flatMap(entry => entry.items);
  if (new Set(ids).size !== ids.length) return listed;
  const lineages = [...new Set(ids.map(id => nodes.get(id)![0].lineageId!))];
  if (namedList && lineages.length !== 1) return listed;
  return [...listed, ...lineages.flatMap(lineage => {
    const anchors = positioned.flatMap(entry => {
      const indices = entry.items.flatMap((id, index) => nodes.get(id)![0].lineageId === lineage ? [index] : []);
      return indices.length ? [{ entry, indices }] : [];
    });
    const members = anchors.flatMap(({ entry, indices }) => indices.map(index => entry.items[index]));
    if (members.length < 2 || anchors.length < 2 && (!namedList
      || listed.some(scope => Object.hasOwn(scope.origins.anchors, anchors[0].entry.key)))) return [];
    return [{ kind: 'identity.occurrences' as const,
      origins: { anchors: Object.fromEntries(anchors.map(({ entry, indices }) => [entry.key, indices])), values: valueOrigins },
      evidence: { currentForest: evidence.currentForest, currentAnchors: { occurrences: members },
        occurrenceGroupAnchorKeys: anchors.map(({ entry }) => entry.key),
        authoredCurrentAnchors: anchors.map(({ entry, indices }) => ({ ...entry,
          items: indices.map(index => entry.items[index]), concepts: ['occurrences'],
          conceptItemIndices: { occurrences: indices.map((_, index) => index) } })),
        values, authoredValues } satisfies Tier2FacetEvidence }];
  })];
}
