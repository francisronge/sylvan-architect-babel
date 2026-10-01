import { establishesAssignment } from './assignmentContinuity.ts';
import { participantName, scopeEvidence, uniqueCurrentOwners, type EvidenceScope } from './evidenceScopes.ts';
import { readCategoryLabel } from '../categoryLabel.ts';
import { namedThematicRole, normalizeTier2Synonym, relationLabelClauses, thematicIntroducer, thematicSlotQualifier, qualifiedAssignmentConcepts } from './tier2Synonyms.ts';
import { independentThetaArgumentFields, type Tier2FacetEvidence } from './tier2FacetRecipes.ts';

/** A typed role assignment owns its literal and exact endpoints independently
 * of a sibling Case property. Unresolved typed claims must not fall back to a
 * weaker interpretation that chooses a convenient predicate or argument. */
export function typedThematicAssignment(evidence: Tier2FacetEvidence): {
  applies: boolean; scope?: EvidenceScope;
} {
  const values = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('role.label'));
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => /\brole\b/u.test(clause));
  const licensingClauses = relationLabelClauses(evidence.relationName).filter(clause => /\b(?:argument|clitic) licensing\b/u.test(clause));
  const typedLicensing = licensingClauses.length === 1
    && /^(?:(?:subject|object|internal|external) )?(?:argument|clitic) licensing$/u.test(licensingClauses[0]);
  const qualifiedTarget = (evidence.authoredCurrentAnchors ?? []).some(entry => qualifiedAssignmentConcepts(entry.key).includes('theta.arguments') && / (?:position|occurrence)$/u.test(normalizeTier2Synonym(entry.key)));
  if (!values.length || (!clauses.length && !qualifiedTarget && !typedLicensing)) return { applies: false };
  // A conditional role assertion remains a typed but unresolved claim. It
  // cannot fall through to a generic grid that ignores the condition.
  if (clauses.some(clause => /\b(?:if|unless|whether|conditional)\b/u.test(clause))) return { applies: true };
  const typedClause = /^(?:(?:matrix|embedded|local) )?(?:(?:subject|object|internal|external) )?(?:[\p{L}\p{N}]+ )?(?:(?:theta|thematic|θ) )?role(?: (?:assignment|introduction|licensing))?$/u;
  if (!qualifiedTarget && !typedLicensing && !clauses.some(clause => typedClause.test(clause.replace(/^(?:no|not|without|possible|potential|hypothetical|pending|unresolved|unestablished|failed|blocked|unlicensed) /u, '')))) return { applies: false };
  const unresolved = { applies: true };
  const assertionClauses = clauses.length ? clauses : typedLicensing ? licensingClauses : relationLabelClauses(evidence.relationName).filter(clause => /\b(?:argument|theta|thematic|θ)\b/u.test(clause));
  const qualifiedClause = /^(?:(?:matrix|embedded|local|internal|external) )*argument(?: chain)? (?:dependency|licensing|assignment|introduction)$/u;
  if ((!qualifiedTarget && !typedLicensing && clauses.length !== 1)
    || !establishesAssignment(evidence)
    || assertionClauses.some(clause => /\b(?:no|not|without|possible|potential|hypothetical|pending|unresolved|unestablished|failed|blocked|unlicensed)\b/u.test(clause))
    || qualifiedTarget && (!assertionClauses.length || assertionClauses.some(clause => !typedClause.test(clause) && !qualifiedClause.test(clause)))
    || !qualifiedTarget && !typedLicensing && !typedClause.test(clauses[0])) return unresolved;
  // Complete per-participant fields already bind their own role inventory.
  // This scalar fallback must not replace that stronger association.
  if (independentThetaArgumentFields(evidence)) return { applies: false };
  if (values.length !== 1 || values[0].items.length !== 1 || !values[0].items[0].trim()) return unresolved;
  const literal = normalizeTier2Synonym(values[0].items[0]);
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const introduced = anchors.some(entry => thematicIntroducer(normalizeTier2Synonym(entry.key)));
  const sources = anchors.filter(entry => !(introduced && entry.concepts.includes('predicate.context')) && (entry.concepts.includes('predicate')
    || qualifiedTarget && qualifiedAssignmentConcepts(`theta ${normalizeTier2Synonym(entry.key).replace(/^(?:lexical|finite|matrix|embedded|local) /u, '')}`).includes('predicate')
    || typedLicensing && participantName(entry.key) === 'verb'
    || participantName(entry.key) === 'predicate'
    || /^assigning (?:verb|head)$/u.test(normalizeTier2Synonym(entry.key))
    || /^(?:predicate|lexical predicate|assigner|source|introducer|verb|(?:active|passive|causative|applicative|verbal|nominal|adjectival) head)$/u.test(normalizeTier2Synonym(entry.key))));
  const targets = anchors.filter(entry => !sources.includes(entry) && (entry.concepts.includes('theta.arguments')
    || typedLicensing && /^(?:pronominal|nominal|clitic) argument$/u.test(normalizeTier2Synonym(entry.key))
    || /^(?:recipient|goal|argument)$/u.test(normalizeTier2Synonym(entry.key))
    || Boolean(namedThematicRole(entry.key)) || normalizeTier2Synonym(entry.key) === literal));
  if (sources.length !== 1 || targets.length !== 1 || sources[0].items.length !== 1 || targets[0].items.length !== 1
    || sources[0].items[0] === targets[0].items[0]) return unresolved;
  const roots = new Map<string, number[]>();
  const visit = (node: typeof evidence.currentForest[number], root: number) => {
    roots.set(node.id, [...(roots.get(node.id) ?? []), root]);
    node.children?.forEach(child => visit(child, root));
  };
  evidence.currentForest.forEach(visit);
  const sourceRoots = roots.get(sources[0].items[0]), targetRoots = roots.get(targets[0].items[0]);
  if (sourceRoots?.length !== 1 || targetRoots?.length !== 1 || sourceRoots[0] !== targetRoots[0]) return unresolved;
  return { applies: true, scope: scopeEvidence(evidence, 'theta-grid', [
    { entry: sources[0], concept: 'predicate' }, { entry: targets[0], concept: 'theta.arguments' }
  ], [{ entry: values[0], concept: 'role.label' }]) };
}

/** Qualified role fields in an asserted interpretation retain their own
 * argument associations. A complement role additionally requires the actual
 * clausal sister of the predicate, rather than a nearby nominal. */
export function typedInterpretiveRoles(evidence: Tier2FacetEvidence): boolean {
  return normalizeTier2Synonym(evidence.relationName) === 'thematic interpretation'
    && (evidence.authoredValues ?? []).some(entry => {
      const qualifier = thematicSlotQualifier(entry.key, 'value');
      return qualifier && evidence.authoredCurrentAnchors?.some(anchor => thematicSlotQualifier(anchor.key, 'anchor') === qualifier
        || qualifier === 'complement' && normalizeTier2Synonym(anchor.key) === 'propositional argument');
    });
}
export function recoverClauseComplementTheta(evidence: Tier2FacetEvidence) {
  if (!typedInterpretiveRoles(evidence) || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  const sources = anchors.filter(entry => entry.concepts.includes('predicate') || participantName(entry.key) === 'predicate'
    || /^(?:assigner|introducer|assigning (?:head|verb))$/u.test(normalizeTier2Synonym(entry.key)));
  if (sources.length !== 1 || sources[0].items.length !== 1 || !uniqueCurrentOwners(evidence, sources[0].items)) return [];
  return values.flatMap(row => {
    const qualifier = thematicSlotQualifier(row.key, 'value');
    if (!qualifier || row.items.length !== 1 || !row.items[0].trim()) return [];
    const competingRows = values.filter(other => thematicSlotQualifier(other.key, 'value') === qualifier);
    if (competingRows.length !== 1) return [];
    const targets = anchors.filter(entry => thematicSlotQualifier(entry.key, 'anchor') === qualifier
      || qualifier === 'complement' && normalizeTier2Synonym(entry.key) === 'propositional argument');
    if (targets.length !== 1 || targets[0].items.length !== 1
      || !uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items])) return [];
    let sharedRoot = false, clausalSisters = false;
    const has = (node: typeof evidence.currentForest[number], id: string): boolean => node.id === id || Boolean(node.children?.some(child => has(child, id)));
    const visit = (node: typeof evidence.currentForest[number]) => {
      const source = node.children?.find(child => child.id === sources[0].items[0]);
      const target = node.children?.find(child => child.id === targets[0].items[0]);
      if (source && target && readCategoryLabel(target.label)?.head === 'C') clausalSisters = true;
      node.children?.forEach(visit);
    };
    evidence.currentForest.forEach(root => {
      if (has(root, sources[0].items[0]) && has(root, targets[0].items[0])) sharedRoot = true;
      visit(root);
    });
    if (!sharedRoot || qualifier === 'complement' && !clausalSisters) return [];
    return [scopeEvidence(evidence, 'theta-grid', [{ entry: sources[0], concept: 'predicate' },
      { entry: targets[0], concept: 'theta.arguments' }], [{ entry: row, concept: 'role.label' }])];
  });
}

/** Qualified external/internal roles name their argument slots in a thematic
 * licensing claim. Finite inflection is Case context, not a theta predicate. */
export function recoverQualifiedThetaLicensing(evidence: Tier2FacetEvidence) {
  if (normalizeTier2Synonym(evidence.relationName) !== 'thematic and case licensing' || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  const sources = anchors.filter(entry => entry.concepts.includes('predicate') || /^(?:verb|predicate)$/u.test(normalizeTier2Synonym(entry.key)));
  if (sources.length !== 1 || sources[0].items.length !== 1) return [];
  return ['external', 'internal'].flatMap(slot => {
    const rows = values.filter(entry => thematicSlotQualifier(entry.key, 'value') === slot);
    const targets = anchors.filter(entry => normalizeTier2Synonym(entry.key) === (slot === 'external' ? 'subject' : 'object')
      || thematicSlotQualifier(entry.key, 'anchor') === slot);
    if (rows.length !== 1 || targets.length !== 1 || rows[0].items.length !== 1 || !rows[0].items[0].trim()
      || /\b(?:denied|rejected|required|requested|expected|possible|potential|hypothetical|pending|unresolved|if|unless|whether)\b/u.test(normalizeTier2Synonym(rows[0].items[0]))
      || targets[0].items.length !== 1 || !uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items])) return [];
    return [scopeEvidence(evidence, 'theta-grid', [{ entry: sources[0], concept: 'predicate' }, { entry: targets[0], concept: 'theta.arguments' }],
      [{ entry: rows[0], concept: 'role.label' }])];
  });
}

/** An interpretation can explicitly qualify an argument rather than name a
 * generic argument field. Its named predicate owns the role; a containing PP
 * is introduction context. No role is extracted from explanatory prose. */
export function recoverQualifiedRoleInterpretation(evidence: Tier2FacetEvidence) {
  const name = normalizeTier2Synonym(evidence.relationName);
  const experiential = name === 'experiencer interpretation';
  const passive = /^(?:passive agent (?:interpretation|identification))$/u.test(name);
  const recipient = name === 'recipient interpretation and dative licensing';
  const proposition = /^(?:(?:matrix|embedded) )?thematic interpretation$/u.test(name);
  if (!(experiential || passive || recipient || proposition) || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  const targetName = experiential ? 'experiencer' : passive ? 'agent nominal' : recipient ? 'recipient' : 'propositional content';
  const targets = anchors.filter(entry => normalizeTier2Synonym(entry.key) === targetName);
  if (targets.length !== 1 || targets[0].items.length !== 1) return [];
  const sourceName = experiential ? 'adjective' : recipient ? 'licenser' : 'predicate';
  const sources = anchors.filter(entry => normalizeTier2Synonym(entry.key) === sourceName);
  const competitors = anchors.filter(entry => entry !== sources[0] && entry.concepts.includes('predicate')
    && !(recipient && normalizeTier2Synonym(entry.key) === 'predicate'));
  if (sources.length !== 1 || sources[0].items.length !== 1 || competitors.length
    || !uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items])) return [];
  const paths = new Map<string, typeof evidence.currentForest>();
  const visit = (node: typeof evidence.currentForest[number], path: typeof evidence.currentForest) => {
    paths.set(node.id, [...path, node]); node.children?.forEach(child => visit(child, [...path, node]));
  };
  evidence.currentForest.forEach(node => visit(node, []));
  const sourcePath = paths.get(sources[0].items[0])!, targetPath = paths.get(targets[0].items[0])!;
  const sourceNode = sourcePath.at(-1)!, targetNode = targetPath.at(-1)!;
  const shape = readCategoryLabel(sourceNode.label);
  if (sourcePath[0] !== targetPath[0] || shape?.kind !== 'head' || shape.compound || sourceNode.children?.length
    || !(experiential ? ['A', 'Adj'].includes(shape.head) : recipient ? shape.head === 'Appl' : shape.head === 'V')) return [];
  if (proposition && (readCategoryLabel(targetNode.label)?.head !== 'C' || sourcePath.at(-2) !== targetPath.at(-2))) return [];
  const rows = values.filter(entry => entry.concepts.includes('role.label'));
  if (rows.length > 1 || rows.some(entry => entry.items.length !== 1 || !entry.items[0].trim()
    || /\b(?:denied|rejected|required|requested|expected|possible|potential|hypothetical|pending|unresolved|if|unless|whether)\b/u.test(normalizeTier2Synonym(entry.items[0])))) return [];
  const expected = experiential ? 'experiencer' : passive ? 'agent' : recipient ? 'recipient' : 'propositional content';
  if (rows.length && !normalizeTier2Synonym(rows[0].items[0]).startsWith(expected)) return [];
  if (experiential && !rows.length || recipient && !rows.length) return [];
  return [scopeEvidence(evidence, 'theta-grid', [{ entry: sources[0], concept: 'predicate' }, { entry: targets[0], concept: 'theta.arguments' }],
    rows.map(entry => ({ entry, concept: 'role.label' })), rows.length ? {} : { 'role.label': [expected] })];
}
