import { establishesAssignment } from './assignmentContinuity.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import { exactRealizationGroup } from '../realizationGroups.ts';
import { readRewriteLiteral, authoredRewritePair, pfRewriteLabelDenial, ownedPFRewriteOutcomes } from './rewriteLiterals.ts';
import type { Tier2AuthoredEvidenceEntry, Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';

type RewriteInput = { entry: Tier2AuthoredEvidenceEntry; prior: boolean };
const rewriteScope = (evidence: Tier2FacetEvidence, input: RewriteInput,
  output: Tier2AuthoredEvidenceEntry, bindings: NonNullable<Parameters<typeof scopeEvidence>[3]>) => {
  const scope = scopeEvidence(evidence, 'pf.rewrite', [
    ...(!input.prior ? [{ entry: input.entry, concept: 'rewrite.input' }] : []),
    { entry: output, concept: 'rewrite.output' }
  ], bindings);
  return { ...scope, origins: { ...scope.origins,
    ...(input.prior ? { priorAnchors: { [input.entry.key]: [0] } } : {}) },
    evidence: { ...scope.evidence, ...(input.prior ? {
      priorForest: evidence.priorForest,
      priorAnchors: { 'rewrite.input': input.entry.items },
      authoredPriorAnchors: [{ ...input.entry, concepts: ['rewrite.input'], conceptItemIndices: { 'rewrite.input': [0] } }]
    } : {}) }
  };
};
const bindLiteralColumns = (scope: ReturnType<typeof rewriteScope>, inputKey: string, outputKey: string) => {
  for (const [key, concept] of [[inputKey, 'rewrite.input.literal'], [outputKey, 'rewrite.output.literal']]) {
    const entry = scope.evidence.authoredValues!.find(entry => entry.key === key)!;
    entry.concepts = [...entry.concepts, concept];
    entry.conceptItemIndices = { ...entry.conceptItemIndices, [concept]: [0] };
  }
  return scope;
};

export function recoverPFRewrite(evidence: Tier2FacetEvidence) {
  return [...recoverExplicitPFRewrite(evidence), ...recoverAllomorphRewrite(evidence), ...recoverQualifiedRealizationGroups(evidence), ...recoverSurfaceCombination(evidence)];
}

/** A literal surface combination belongs to the complete exact realization
 * group. Linking material remains a PF row, never a new syntax occurrence. */
function recoverSurfaceCombination(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName);
  const realization = clauses.filter(clause => /\b(?:realization|realisation)\b/u.test(clause));
  const denied = /\b(?:no|not|never|without|denied|rejected|failed|blocked|unlicensed|pending|unresolved|unestablished|required|requested|expected|possible|potential|hypothetical|whether|if|unless)\b/u;
  if (realization.length !== 1 || denied.test(realization[0])) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  const surfaces = values.filter(entry => normalizeTier2Synonym(entry.key) === 'surface combination' || entry.concepts.includes('pf.surface'));
  const links = values.filter(entry => normalizeTier2Synonym(entry.key) === 'linking segment');
  const outcomes = values.filter(entry => /^(?:realization|realisation) (?:outcome|status|result)$/u.test(normalizeTier2Synonym(entry.key))
    || clauses.length === 1 && (entry.concepts.includes('outcome')
      || /^(?:status|result|verdict|judgment)$/u.test(normalizeTier2Synonym(entry.key))));
  if (surfaces.length !== 1 || links.length > 1 || [...surfaces, ...links].some(entry => entry.items.length !== 1 || !entry.items[0].trim())
    || outcomes.some(entry => entry.items.some(item => denied.test(normalizeTier2Synonym(item))))
    || anchors.some(entry => entry.concepts.includes('rewrite.input') || entry.concepts.includes('pf.contributors'))) return [];
  const nodes = new Map<string, typeof evidence.currentForest[number]>();
  const visit = (node: typeof evidence.currentForest[number]) => { nodes.set(node.id, node); node.children?.forEach(visit); };
  evidence.currentForest.forEach(visit);
  if (!uniqueCurrentOwners(evidence, anchors.flatMap(entry => entry.items))) return [];
  const contains = (node: typeof evidence.currentForest[number], id: string): boolean => node.id === id || Boolean(node.children?.some(child => contains(child, id)));
  const groups = (evidence.currentRealizations ?? []).flatMap(group => {
    if (!exactRealizationGroup(group.nodeIds, evidence.currentRealizations, evidence.currentForest)) return [];
    const owners = anchors.filter(entry => entry.items.length && entry.items.every(id => group.nodeIds.includes(id)));
    if (owners.flatMap(entry => entry.items).length !== group.nodeIds.length
      || !group.nodeIds.every(id => owners.some(entry => entry.items.includes(id)))) return [];
    // An explicitly anchored enclosing constituent is context, never another
    // output. Unrelated or competing participants cannot disappear from proof.
    const context = anchors.filter(entry => !owners.includes(entry));
    if (context.some(entry => entry.concepts.includes('rewrite.output') || entry.items.length !== 1
      || !group.nodeIds.some(id => contains(nodes.get(entry.items[0])!, id)))) return [];
    return [{ group, owners }];
  });
  if (groups.length !== 1) return [];
  const scope = scopeEvidence(evidence, 'pf.structured', groups[0].owners.map(entry => ({ entry, concept: 'rewrite.output' })),
    [...surfaces, ...links].map(entry => ({ entry, concept: 'pf.rows' })));
  scope.evidence.realizationGroupAnchorKeys = groups[0].owners.map(entry => entry.key);
  return [scope];
}

/** Qualified contributor/output fields attach literal PF rows to their exact
 * authored realization group. They supply no invented whole-word syntax node
 * or input/output rewrite columns. */
function recoverQualifiedRealizationGroups(evidence: Tier2FacetEvidence) {
  if (normalizeTier2Synonym(evidence.relationName) !== 'inflectional realization' || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  return anchors.flatMap(anchor => {
    const qualifier = /^(.+) contributors$/u.exec(normalizeTier2Synonym(anchor.key))?.[1];
    if (!qualifier || !exactRealizationGroup(anchor.items, evidence.currentRealizations, evidence.currentForest)
      || !uniqueCurrentOwners(evidence, anchor.items)) return [];
    const outputs = values.filter(entry => normalizeTier2Synonym(entry.key) === `${qualifier} output`);
    const rows = values.filter(entry => [`${qualifier} output`, `${qualifier} allomorphy`].includes(normalizeTier2Synonym(entry.key)));
    if (outputs.length !== 1 || rows.some(entry => entry.items.length !== 1 || !entry.items[0].trim())
      || rows.some(entry => /\b(?:denied|rejected|required|requested|expected|possible|potential|hypothetical|pending|unresolved|if|unless|whether)\b/u.test(normalizeTier2Synonym(entry.items[0])))
      || anchors.some(entry => entry !== anchor && entry.concepts.includes('rewrite.output') && entry.items.some(id => anchor.items.includes(id)))) return [];
    const scope = scopeEvidence(evidence, 'pf.structured', [{ entry: anchor, concept: 'rewrite.output' }], rows.map(entry => ({ entry, concept: 'pf.rows' })));
    scope.evidence.realizationGroupAnchorKeys = [anchor.key];
    return [scope];
  });
}

/** Input/output roles alone are context. A complete PF mapping assertion plus
 * same-name scalar literals establishes the two original columns of a rewrite. */
function recoverExplicitPFRewrite(evidence: Tier2FacetEvidence) {
  const outcomes = ownedPFRewriteOutcomes(evidence);
  if (pfRewriteLabelDenial(evidence.relationName)
    || !establishesAssignment({ ...evidence, authoredValues: outcomes })) return [];
  const current = evidence.authoredCurrentAnchors ?? [];
  const prior = evidence.authoredPriorAnchors ?? [];
  const inputs = [
    ...current.filter(entry => entry.concepts.includes('rewrite.input')).map(entry => ({ entry, prior: false })),
    ...prior.filter(entry => entry.concepts.includes('rewrite.input')).map(entry => ({ entry, prior: true }))
  ];
  const outputs = current.filter(entry => entry.concepts.includes('rewrite.output'));
  if (inputs.length !== 1 || outputs.length !== 1 || inputs[0].entry.items.length !== 1 || outputs[0].items.length !== 1) return [];
  const input = inputs[0], output = outputs[0];
  const values = evidence.authoredValues ?? [];
  const mappings = values.filter(entry => entry.concepts.includes('rewrite.rows'));
  const pair = authoredRewritePair(evidence);
  const scopeRows = (bindings: NonNullable<Parameters<typeof scopeEvidence>[3]>) =>
    rewriteScope(evidence, input, output, [...bindings, ...outcomes.map(entry => ({ entry, concept: 'outcome' }))]);
  // Valid items can be drawn without consuming an invalid sibling in the same
  // authored array. Repeated items retain their original positions.
  const typedScopes = () => mappings.flatMap(entry => {
    const indices = entry.items.flatMap((item, index) => {
      const columns = readRewriteLiteral(item);
      return columns && (!pair || columns.input === pair.input.items[0] && columns.output === pair.output.items[0]) ? [index] : [];
    });
    return indices.length ? [scopeRows([{ entry, indices, concept: 'rewrite.rows' }])] : [];
  });
  if (!pair) return typedScopes();
  // One repeated statement of the same pair is corroboration. Lists, competing
  // rows and unrelated properties remain independently owned evidence.
  if (mappings.length) {
    if (mappings.length !== 1 || mappings[0].items.length !== 1) return typedScopes();
    const columns = readRewriteLiteral(mappings[0].items[0]);
    if (!columns || columns.input !== pair.input.items[0] || columns.output !== pair.output.items[0]) return typedScopes();
  }
  const scope = scopeRows([pair.input, pair.output, ...mappings].map(entry => ({ entry, concept: 'rewrite.rows' })));
  return [bindLiteralColumns(scope, pair.input.key, pair.output.key)];
}

/** A stem allomorph maps two authored literals only when the exact lexical
 * occurrence changes from that prior word to that current word. Token grouping
 * and a whole complex's joint realization supply no such one-carrier rewrite. */
function recoverAllomorphRewrite(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName)
    .filter(clause => /\b(?:allomorphy|realization|realisation)\b/u.test(clause));
  const assertion = /^(?:(?:past|present|future|finite|tense|aspect|contextual|conditioned|stem|lexical|inflectional|morphological|root|verbal) )*(?:allomorphy|realization|realisation)$/u;
  if (!evidence.priorForest || !clauses.length || clauses.some(clause => !assertion.test(clause))
    || !establishesAssignment(evidence)) return [];
  const sourceRole = /^(?:lexical (?:form|verb|stem|root)|citation form|underlying (?:form|stem|root)|uninflected (?:verb|stem|root))$/u;
  const targetRole = /^(?:stem|lexical stem|lexical verb|verb|root|surface stem|inflected stem)$/u;
  const inputs = (evidence.authoredPriorAnchors ?? []).filter(entry => sourceRole.test(normalizeTier2Synonym(entry.key)));
  const outputs = (evidence.authoredCurrentAnchors ?? []).filter(entry => targetRole.test(normalizeTier2Synonym(entry.key)));
  const values = evidence.authoredValues ?? [];
  const inputValues = values.filter(entry => /^(?:lexical (?:citation )?form|citation form|underlying form|lexical verb|uninflected (?:form|stem|verb))$/u.test(normalizeTier2Synonym(entry.key)));
  const outputValues = values.filter(entry => /^(?:surface stem|stem allomorph|inflected stem|realized stem)$/u.test(normalizeTier2Synonym(entry.key)));
  if ([inputs, outputs, inputValues, outputValues].some(entries => entries.length !== 1 || entries[0].items.length !== 1)
    || values.some(entry => entry.concepts.includes('rewrite.rows'))) return [];
  const [input] = inputs, [output] = outputs, [inputValue] = inputValues, [outputValue] = outputValues;
  const find = (forest: Tier2FacetEvidence['currentForest'], id: string): Tier2FacetEvidence['currentForest'] =>
    forest.flatMap(node => [...(node.id === id ? [node] : []), ...find(node.children ?? [], id)]);
  const prior = find(evidence.priorForest, input.items[0]), current = find(evidence.currentForest, output.items[0]);
  if (prior.length !== 1 || current.length !== 1 || prior[0].children?.length || current[0].children?.length
    || !inputValue.items[0].trim() || !outputValue.items[0].trim() || inputValue.items[0] === outputValue.items[0]
    || prior[0].word !== inputValue.items[0] || current[0].word !== outputValue.items[0]) return [];
  const sameId = prior[0].id === current[0].id;
  if (!sameId && (!prior[0].lineageId || prior[0].lineageId !== current[0].lineageId)
    || sameId && prior[0].lineageId && current[0].lineageId && prior[0].lineageId !== current[0].lineageId) return [];
  return [bindLiteralColumns(rewriteScope(evidence, { entry: input, prior: true }, output,
    [inputValue, outputValue].map(entry => ({ entry, concept: 'rewrite.rows' }))), inputValue.key, outputValue.key)];
}
