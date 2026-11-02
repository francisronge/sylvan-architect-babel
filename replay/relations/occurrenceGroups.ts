import type { SyntaxNode } from '../../types.ts';
import { establishesAssignment } from './outcomeResolver.ts';
import type { EvidenceScope } from './evidenceScopes.ts';
import type { Tier2AuthoredEvidenceEntry, Tier2FacetEvidence } from './tier2FacetTypes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';

/** The items of one authored field that an identity family reads. */
const occurrenceEntry = (entry: Tier2AuthoredEvidenceEntry, indices: readonly number[] = entry.items.map((_, index) => index)) => ({
  ...entry, items: indices.map(index => entry.items[index]), concepts: ['occurrences'],
  conceptItemIndices: { occurrences: indices.map((_, index) => index) } });

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
    const anchor = occurrenceEntry(entry);
    return [{ kind: 'identity.occurrences' as const,
      origins: { anchors: { [entry.key]: entry.items.map((_, index) => index) }, values: valueOrigins },
      evidence: { currentForest: evidence.currentForest, currentAnchors: { occurrences: [...entry.items] },
        authoredCurrentAnchors: [anchor], values, authoredValues } satisfies Tier2FacetEvidence }];
  });
  // Pronunciation and chain-position fields can identify the same occurrence
  // family without restating movement. Root lineage proves identity only.
  const chainDescription = /\b(?:chain|identity|shared (?:thematic )?argument|antecedent government|government of (?:the )?(?:head )?traces?)\b/u.test(normalizeTier2Synonym(evidence.relationName ?? ''));
  const positioned = (evidence.authoredCurrentAnchors ?? []).filter(entry => chainDescription ? entry.items.length > 0 && entry.items.every(id => nodes.get(id)?.length === 1 && nodes.get(id)![0].lineageId?.trim()) :
    /^(?:chain (?:head|foot)|(?:pronounced|unpronounced)(?: occurrences?| cop(?:y|ies))?|surface (?:copy|occurrence)|(?:thematic|higher|lower|upper|base|raised|intermediate) (?:occurrences?|cop(?:y|ies)|traces?|positions?|verbs?)|(?:head|verb|object|subject) (?:antecedent|trace|position)|(?:overt|pronounced) (?:antecedent|argument)|theta position)$/u
      .test(normalizeTier2Synonym(entry.key)));
  const namedList = positioned.length === 1 && establishesAssignment(evidence) && /\bchain\b/u.test(normalizeTier2Synonym(evidence.relationName ?? ''))
    && !/\b(?:no|not|without|possible|potential|hypothetical|pending|unresolved|failed|blocked|unlicensed)\b/u.test(normalizeTier2Synonym(evidence.relationName ?? ''));
  // A movement claim's positions are its endpoints, unless structure proved the
  // movement under a coindex of its whole chain, which it keeps.
  if ((!namedList && positioned.length < 2) || evidence.movement && !evidence.keepsChainIdentity || positioned.some(entry => !entry.items.length
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
        authoredCurrentAnchors: anchors.map(({ entry, indices }) => occurrenceEntry(entry, indices)),
        values, authoredValues } satisfies Tier2FacetEvidence }];
  })];
}

/** A recognized identity family covers its whole chain: every other node the
 * same relation anchors with the family's lineage joins it, whatever its field
 * is called, so the coindex and its forest light reach the chain's pronounced
 * member as well as its traces. Completion decides by lineage and structure
 * alone and never creates a family. A node that occurs more than once, already
 * belongs to the family, sits inside a member or contains one stays out, as
 * does every item of a field that repeats an ID. Movement recognition keeps
 * reading the family as recognized (`recognizedOccurrenceGroups`). Families of one
 * relation that complete to the same occurrences are one claim, read from the
 * family that recognized the most of them. */
export function completeOccurrenceGroups(scopes: readonly EvidenceScope[], evidence: Tier2FacetEvidence): EvidenceScope[] {
  const nodes = new Map<string, SyntaxNode[]>();
  const parents = new Map<string, string>();
  const visit = (node: SyntaxNode) => {
    if (node.id) nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]);
    node.children?.forEach(child => { if (node.id && child.id) parents.set(child.id, node.id); visit(child); });
  };
  evidence.currentForest.forEach(visit);
  const within = (id: string, ancestor: string) => {
    for (let parent = parents.get(id); parent; parent = parents.get(parent)) if (parent === ancestor) return true;
    return false;
  };
  const unique = (id: string) => nodes.get(id)?.length === 1 ? nodes.get(id)![0] : undefined;
  const completed = scopes.map(scope => {
    const recognized = scope.evidence.currentAnchors.occurrences ?? [];
    const lineage = unique(recognized[0] ?? '')?.lineageId?.trim();
    if (scope.kind !== 'identity.occurrences' || !lineage
      || recognized.some(id => unique(id)?.lineageId?.trim() !== lineage)) return { scope, recognized: 0 };
    const members = [...recognized];
    const origins = Object.fromEntries(Object.entries(scope.origins.anchors).map(([key, indices]) => [key, [...indices]]));
    const authored = [...scope.evidence.authoredCurrentAnchors ?? []];
    for (const entry of evidence.authoredCurrentAnchors ?? []) {
      if (new Set(entry.items).size !== entry.items.length) continue;
      const indices: number[] = [];
      entry.items.forEach((id, index) => {
        if (unique(id)?.lineageId?.trim() !== lineage || origins[entry.key]?.includes(index)
          || members.some(member => member === id || within(id, member) || within(member, id))) return;
        members.push(id);
        indices.push(index);
      });
      if (!indices.length) continue;
      origins[entry.key] = [...origins[entry.key] ?? [], ...indices];
      authored.push(occurrenceEntry(entry, indices));
    }
    const grown = members.length > recognized.length ? { ...scope, origins: { ...scope.origins, anchors: origins },
      evidence: { ...scope.evidence, currentAnchors: { ...scope.evidence.currentAnchors, occurrences: members },
        recognizedOccurrenceGroups: [recognized], occurrenceGroupAnchorKeys: authored.map(entry => entry.key),
        authoredCurrentAnchors: authored } } : scope;
    return { scope: grown, recognized: recognized.length, key: JSON.stringify([...members].sort()) };
  });
  const kept = completed.filter(({ key, recognized }, index) => !key || !completed.some((other, otherIndex) => other.key === key
    && (other.recognized > recognized || other.recognized === recognized && otherIndex < index)));
  // The claim that remains reads every field the merged families read, so none
  // of their authored evidence is left over for a neutral mark.
  return kept.map(({ scope, key }) => {
    const merged = completed.filter(other => key && other.key === key && other.scope !== scope);
    if (!merged.length) return scope;
    const anchors: Record<string, number[]> = Object.fromEntries(Object.entries(scope.origins.anchors).map(([field, indices]) => [field, [...indices]]));
    for (const { scope: other } of merged) for (const [field, indices] of Object.entries(other.origins.anchors))
      anchors[field] = [...new Set([...anchors[field] ?? [], ...indices])].sort((a, b) => a - b);
    const authored = Object.entries(anchors).flatMap(([field, indices]) => {
      const entry = (evidence.authoredCurrentAnchors ?? []).find(candidate => candidate.key === field);
      return entry ? [occurrenceEntry(entry, indices)] : [];
    });
    // Each merged family stays a recognized group of its own.
    const groups = [scope, ...merged.map(other => other.scope)].flatMap(member =>
      member.evidence.recognizedOccurrenceGroups ?? [member.evidence.currentAnchors.occurrences ?? []]);
    return { ...scope, origins: { ...scope.origins, anchors },
      evidence: { ...scope.evidence, recognizedOccurrenceGroups: groups,
        occurrenceGroupAnchorKeys: authored.map(entry => entry.key), authoredCurrentAnchors: authored } };
  });
}
