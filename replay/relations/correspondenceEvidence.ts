import type { SyntaxNode } from '../../types.ts';
import { readCategoryLabel } from '../categoryLabel.ts';
import { establishesAssignment } from './assignmentContinuity.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { isExplicitTier2Role, normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';

const correspondenceClaim = /^(?:(?:vp|np|dp|pp|cp|tp|ip|phrasal|predicate|nominal|right node raising|pf|gapping) )*(?:ellipsis|deletion|correspondence)(?: (?:licensing|antecedence|identity|alignment|structural identity))?$/u;
const antecedentRole = /^(?:antecedent(?: (?:[a-z]+p|domain|phrase|constituent))?|(?:overt )?identity source)$/u;
const indexRows = (evidence: Tier2FacetEvidence) => (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('index'));

/** A named antecedent and elided domain supply one exact correspondence.
 * Silence still belongs to the separate ellipsis recipe; this link does not
 * infer deletion, a licensing arrow, or pair independently ordered lists. */
export function recoverEllipsisCorrespondence(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName)
    .filter(clause => /\b(?:ellipsis|deletion|correspondence)\b/u.test(clause));
  if (!clauses.length || clauses.some(clause => !correspondenceClaim.test(clause))
    || !establishesAssignment(evidence)) return [];
  const fields = evidence.authoredCurrentAnchors ?? [];
  const sources = fields.filter(entry => antecedentRole.test(normalizeTier2Synonym(entry.key))
    || entry.concepts.includes('correspondence.source'));
  const targets = fields.filter(entry => isExplicitTier2Role('ellipsis.site', entry.key) || normalizeTier2Synonym(entry.key) === 'silent domain'
    || entry.concepts.includes('correspondence.target'));
  if (sources.length !== 1 || targets.length !== 1 || sources[0] === targets[0]
    || sources[0].items.length !== 1 || targets[0].items.length !== 1
    || sources[0].items[0] === targets[0].items[0]) return [];
  const indices = indexRows(evidence);
  if (indices.length > 1 || indices.some(entry => entry.items.length !== 1)) return [];
  // Existing exact-role recovery already owns this pair.
  if (sources[0].concepts.includes('correspondence.source')
    && targets[0].concepts.includes('correspondence.target')) return [];
  const ids = [sources[0].items[0], targets[0].items[0]], counts = new Map<string, number>();
  const visit = (node: SyntaxNode) => {
    if (ids.includes(node.id)) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  if (ids.some(id => counts.get(id) !== 1)) return [];
  return [scopeEvidence(evidence, 'correspondence.alignment', [
    { entry: sources[0], concept: 'correspondence.source' },
    { entry: targets[0], concept: 'correspondence.target' }
  ], indices.map(entry => ({ entry, concept: 'index' })))];
}

/** Remnant lists are paired by explicitly supplied role literals, never by
 * the relative ordering of two independently authored anchor arrays. */
export function recoverRemnantCorrespondence(evidence: Tier2FacetEvidence) {
  if (normalizeTier2Synonym(evidence.relationName) !== 'gapping contrast parallelism' || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  const sides = ['antecedent remnants', 'ellipsis remnants'].map(role => anchors.filter(entry => normalizeTier2Synonym(entry.key) === role));
  if (sides.some(side => side.length !== 1)) return [];
  const [source, target] = sides.map(side => side[0]);
  const indices = indexRows(evidence);
  if (indices.length > 1 || indices.some(entry => entry.items.length !== source.items.length)) return [];
  const rows = [source, target].map(side => values.filter(entry => entry.key === side.key));
  if (rows.some((entries, index) => entries.length !== 1 || entries[0].items.length !== [source, target][index].items.length
    || !entries[0].items.length || entries[0].items.some(item => !item.trim()))) return [];
  if (source.items.length !== target.items.length || !uniqueCurrentOwners(evidence, [...source.items, ...target.items])) return [];
  const roles = rows.map(entries => entries[0].items.map(normalizeTier2Synonym));
  if (roles.some(side => new Set(side).size !== side.length)) return [];
  const matches = roles[0].map(role => roles[1].indexOf(role));
  if (matches.some(index => index < 0)) return [];
  return matches.map((targetIndex, sourceIndex) => {
    const scope = scopeEvidence(evidence, 'correspondence.alignment', [
    { entry: source, concept: 'correspondence.source', indices: [sourceIndex] },
    { entry: target, concept: 'correspondence.target', indices: [targetIndex] }
    ], indices.map(entry => ({ entry, concept: 'index', indices: [sourceIndex] })));
    scope.origins.values = { ...scope.origins.values, [rows[0][0].key]: [sourceIndex], [rows[1][0].key]: [targetIndex] };
    scope.evidence.correspondenceRoleWitnesses = [
      { key: rows[0][0].key, items: [rows[0][0].items[sourceIndex]], concepts: [] },
      { key: rows[1][0].key, items: [rows[1][0].items[targetIndex]], concepts: [] }
    ];
    return scope;
  });
}

/** A named silent domain earns the deletion depiction only through the normal
 * recipe's authored-silence check; the ellipsis assertion alone is insufficient. */
export function recoverNamedEllipsisSite(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => /\bellipsis\b/u.test(clause));
  if (clauses.length !== 1 || !correspondenceClaim.test(clauses[0]) || !establishesAssignment(evidence)) return [];
  const sites = (evidence.authoredCurrentAnchors ?? []).filter(entry => normalizeTier2Synonym(entry.key) === 'silent domain');
  if (sites.length !== 1 || sites[0].items.length !== 1 || !uniqueCurrentOwners(evidence, sites[0].items)) return [];
  return [scopeEvidence(evidence, 'ellipsis.site', [{ entry: sites[0], concept: 'ellipsis.site' }])];
}

/** A deleted verbal head is a deletion site only after that exact overt head
 * existed. The surviving remnant phrases are never included in its ghost. */
export function recoverCoordinateGapping(evidence: Tier2FacetEvidence) {
  if (normalizeTier2Synonym(evidence.relationName) !== 'coordinate gapping' || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], prior = evidence.authoredPriorAnchors ?? [];
  const sites = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'deleted verb');
  const sources = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'antecedent verb');
  const previous = prior.filter(entry => normalizeTier2Synonym(entry.key) === 'verb before deletion');
  const operations = (evidence.authoredValues ?? []).filter(entry => normalizeTier2Synonym(entry.key) === 'operation');
  if ([sites, sources, previous, operations].some(entries => entries.length !== 1 || entries[0].items.length !== 1)
    || normalizeTier2Synonym(operations[0].items[0]) !== 'phonological deletion'
    || sites[0].items[0] !== previous[0].items[0]
    || !uniqueCurrentOwners(evidence, [...sites[0].items, ...sources[0].items])
    || anchors.some(entry => ![sites[0], sources[0]].includes(entry)
      && entry.concepts.some(concept => ['ellipsis.site', 'correspondence.source', 'correspondence.target'].includes(concept)))) return [];
  const find = (forest: readonly SyntaxNode[], id: string) => {
    const nodes: Array<{ node: SyntaxNode; silent: boolean }> = []; const visit = (node: SyntaxNode, silent = false) => {
      const hidden = silent || Boolean(node.silent); if (node.id === id) nodes.push({ node, silent: hidden }); node.children?.forEach(child => visit(child, hidden));
    };
    forest.forEach(node => visit(node)); return nodes.length === 1 ? nodes[0] : undefined;
  };
  const current = find(evidence.currentForest, sites[0].items[0]), before = find(evidence.priorForest ?? [], previous[0].items[0]);
  const site = current?.node, previousNode = before?.node, antecedent = find(evidence.currentForest, sources[0].items[0])?.node;
  if (!site || !previousNode || !current?.silent || before?.silent || site.children?.length || previousNode.children?.length
    || !previousNode.word?.trim() || site.word !== previousNode.word || readCategoryLabel(site.label)?.head !== 'V' || readCategoryLabel(site.label)?.kind !== 'head'
    || readCategoryLabel(previousNode.label)?.head !== 'V' || readCategoryLabel(previousNode.label)?.kind !== 'head'
    || !antecedent || antecedent.children?.length || readCategoryLabel(antecedent.label)?.head !== 'V' || readCategoryLabel(antecedent.label)?.kind !== 'head') return [];
  const indices = indexRows(evidence);
  if (indices.length > 1 || indices.some(entry => entry.items.length !== 1)) return [];
  return [scopeEvidence(evidence, 'ellipsis.site', [{ entry: sites[0], concept: 'ellipsis.site' }]),
    scopeEvidence(evidence, 'correspondence.alignment', [{ entry: sources[0], concept: 'correspondence.source' },
      { entry: sites[0], concept: 'correspondence.target' }], indices.map(entry => ({ entry, concept: 'index' })))];
}

/** Individually qualified parallel slots establish correspondence without
 * declaring identity. No coindex or cross-list ordering is inferred. */
export function recoverQualifiedParallelism(evidence: Tier2FacetEvidence) {
  if (normalizeTier2Synonym(evidence.relationName) !== 'contrastive parallelism licensing gapping' || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const indices = indexRows(evidence);
  if (indices.length > 1 || anchors.some(entry => entry.concepts.some(concept => ['correspondence.source', 'correspondence.target'].includes(concept)))) return [];
  const slots = anchors.map(entry => ({ entry, match: /^(first|second) (subject|object)$/u.exec(normalizeTier2Synonym(entry.key)) }));
  if (slots.some(slot => !slot.match || slot.entry.items.length !== 1)
    || !uniqueCurrentOwners(evidence, anchors.flatMap(entry => entry.items))) return [];
  const pairs = ['subject', 'object'].flatMap(role => {
    const sides = ['first', 'second'].map(side => slots.filter(slot => slot.match![1] === side && slot.match![2] === role));
    if (sides.some(side => side.length !== 1)) return [];
    return [[sides[0][0].entry, sides[1][0].entry]];
  });
  if (indices.length && (pairs.length !== 1 || indices[0].items.length !== 1)) return [];
  return pairs.map(([source, target]) => scopeEvidence(evidence, 'correspondence.alignment', [
    { entry: source, concept: 'correspondence.source' }, { entry: target, concept: 'correspondence.target' }
  ], indices.map(entry => ({ entry, concept: 'index' }))));
}
