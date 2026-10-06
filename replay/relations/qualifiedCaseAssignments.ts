import { establishesAssignment, type AssignmentScope } from './assignmentContinuity.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { isExplicitTier2Role, normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';
import { buildTier2FacetEvidence } from './relationEvidence.ts';
import type { DerivationStageRelation } from '../../types.ts';
import { scopeEvidence, uniqueCurrentOwners, type EvidenceScope } from './evidenceScopes.ts';
import { relationAssertionFailure, relationLabelOutcome } from './outcomeResolver.ts';
import { readCategoryLabel } from '../categoryLabel.ts';
import { hasIndependentCaseEndpoints } from './featureEvidence.ts';

const conventionalCases = new Set(['nominative', 'accusative', 'genitive', 'dative', 'ergative',
  'absolutive', 'instrumental', 'locative', 'oblique', 'vocative']);

const caseAbbreviations: Readonly<Record<string, string>> = {
  nom: 'nominative', acc: 'accusative', gen: 'genitive', dat: 'dative', erg: 'ergative',
  abs: 'absolutive', ins: 'instrumental', inst: 'instrumental', loc: 'locative', obl: 'oblique', voc: 'vocative'
};

/** Argument licensing can state an object's Case independently of its theta
 * predicate. Only an explicitly typed licensing source owns that assignment;
 * agreement inference and a nearby lexical predicate supply no Case source. */
export function recoverLicensedArgumentCase(evidence: Tier2FacetEvidence): EvidenceScope[] {
  const clauses = relationLabelClauses(evidence.relationName);
  if (!clauses.some(clause => /^(?:matrix |embedded )?argument licensing$/u.test(clause))
    || clauses.some(clause => /\bcase\b|\bargument licensing\b/u.test(clause)
      && /\b(?:no|not|never|without|denied|rejected|failed|blocked|unlicensed|pending|unresolved|unestablished|required|requested|expected|possible|potential|hypothetical|whether|if|unless)\b/u.test(clause))
    || !establishesAssignment(evidence) || !hasIndependentCaseEndpoints(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  const sources = anchors.filter(entry => entry.concepts.includes('feature.source'));
  const targets = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'internal argument');
  const cases = values.filter(entry => normalizeTier2Synonym(entry.key) === 'object case');
  const roles = values.filter(entry => normalizeTier2Synonym(entry.key) === 'internal role');
  if ([sources, targets, cases, roles].some(entries => entries.length !== 1 || entries[0].items.length !== 1)
    || !isExplicitTier2Role('feature.source', sources[0].key)
    || !cases[0].items[0].trim() || !roles[0].items[0].trim()
    || anchors.some(entry => entry !== targets[0] && entry.concepts.includes('feature.target'))
    || values.some(entry => entry !== cases[0] && entry.concepts.includes('case.literal'))
    || !uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items])) return [];
  const paths = new Map<string, typeof evidence.currentForest>();
  const visit = (node: typeof evidence.currentForest[number], path: typeof evidence.currentForest) => {
    paths.set(node.id, [...path, node]); node.children?.forEach(child => visit(child, [...path, node]));
  };
  evidence.currentForest.forEach(node => visit(node, []));
  const source = paths.get(sources[0].items[0])!, target = paths.get(targets[0].items[0])!;
  const nominal = readCategoryLabel(target.at(-1)!.label);
  if (!nominal || nominal.compound || !['N', 'D', 'K'].includes(nominal.head) || nominal.kind === 'bar'
    || source[0] !== target[0] || target.includes(source.at(-1)!) || source.includes(target.at(-1)!)) return [];
  return [scopeEvidence(evidence, 'feature.dependency', [
    { entry: sources[0], concept: 'feature.source' }, { entry: targets[0], concept: 'feature.target' }
  ], [{ entry: cases[0], concept: 'case.literal' }])];
}

/** A governor and phrase qualified by the same authored Case name form an
 * explicit pair. The matching literal preserves an open Case vocabulary and
 * never lets another subject or inflection inherit that assignment. */
export function recoverCaseQualifiedPair(evidence: Tier2FacetEvidence): EvidenceScope[] {
  if (normalizeTier2Synonym(evidence.relationName) !== 'case licensing' || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  return anchors.flatMap(source => {
    const qualifier = /^(.+) governor$/u.exec(normalizeTier2Synonym(source.key))?.[1];
    if (!qualifier || source.items.length !== 1) return [];
    const targets = anchors.filter(entry => normalizeTier2Synonym(entry.key) === `${qualifier} phrase`);
    const rows = values.filter(entry => (entry.concepts.includes('case.literal') || / case$/u.test(normalizeTier2Synonym(entry.key))) && entry.items.length === 1
      && (normalizeTier2Synonym(entry.items[0]) === qualifier || normalizeTier2Synonym(entry.items[0]).startsWith(`${qualifier},`)));
    if (targets.length !== 1 || rows.length !== 1 || targets[0].items.length !== 1
      || anchors.some(entry => entry !== source && normalizeTier2Synonym(entry.key) === `${qualifier} governor`)
      || !uniqueCurrentOwners(evidence, [...source.items, ...targets[0].items])) return [];
    const paths = new Map<string, typeof evidence.currentForest>();
    const visit = (node: typeof evidence.currentForest[number], path: typeof evidence.currentForest) => {
      paths.set(node.id, [...path, node]); node.children?.forEach(child => visit(child, [...path, node]));
    };
    evidence.currentForest.forEach(node => visit(node, []));
    const s = paths.get(source.items[0])!, t = paths.get(targets[0].items[0])!;
    const sourceShape = readCategoryLabel(s.at(-1)!.label), targetShape = readCategoryLabel(t.at(-1)!.label);
    if (sourceShape?.kind !== 'head' || sourceShape.compound || s.at(-1)!.children?.length || !targetShape
      || !['N', 'D', 'K'].includes(targetShape.head) || s[0] !== t[0] || t.includes(s.at(-1)!) || s.includes(t.at(-1)!)) return [];
    return [scopeEvidence(evidence, 'feature.dependency', [{ entry: source, concept: 'feature.source' }, { entry: targets[0], concept: 'feature.target' }],
      [{ entry: rows[0], concept: 'case.literal' }])];
  });
}

/** An abbreviated Case head corroborates an elliptical assignment label only
 * inside its explicitly named recipient. Qualifiers need their own anchored
 * annotation; neither a head's spelling nor stage prose supplies a Case claim. */
function corroboratedCaseLiteral(relation: DerivationStageRelation, evidence: Tier2FacetEvidence): string | undefined {
  const match = /^(?:([\p{L}]+) )?([\p{L}]+)(?: case)? (?:assignment|licensing|valuation|marking)$/u
    .exec(normalizeTier2Synonym(relation.relation));
  if (!match || !conventionalCases.has(match[2])) return;
  const qualifier = match[1];
  if (qualifier && (relationAssertionFailure(`${qualifier} case licensing`, 'case')
    || /^(?:not|non|if|unless|whether|required|expected|alternative|previous|prior|former|denied)$/u.test(qualifier))) return;
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const heads = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'case head');
  const recipients = anchors.filter(entry => entry.concepts.includes('feature.target')
    || /^(?:subject|object|argument|nominal|recipient|case bearer)$/u.test(normalizeTier2Synonym(entry.key)));
  const sources = anchors.filter(entry => entry.concepts.includes('feature.source'));
  if ([heads, recipients, sources].some(group => group.length !== 1 || group[0].items.length !== 1)) return;
  const occurrences = new Map<string, typeof evidence.currentForest>();
  const visit = (node: typeof evidence.currentForest[number]) => {
    occurrences.set(node.id, [...(occurrences.get(node.id) ?? []), node]);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  const exact = (id: string) => occurrences.get(id)?.length === 1 ? occurrences.get(id)![0] : undefined;
  const head = exact(heads[0].items[0]), recipient = exact(recipients[0].items[0]);
  const source = exact(sources[0].items[0]);
  if (!head || !recipient || !source || new Set([head.id, recipient.id, source.id]).size !== 3) return;
  const category = readCategoryLabel(head.label);
  const annotation = /^K(?:\^?0|⁰)?\s*\[\s*(?:case\s*:\s*)?([\p{L}]+)\s*\]$/iu.exec(head.label);
  if (category?.head !== 'K' || category.kind !== 'head' || head.children?.length || !annotation) return;
  const headCase = normalizeTier2Synonym(annotation[1]);
  if ((caseAbbreviations[headCase] ?? headCase) !== match[2]) return;
  const contains = (node: typeof recipient): boolean => node.id === head.id || Boolean(node.children?.some(contains));
  if (!contains(recipient)) return;
  if (qualifier) {
    const witnesses = anchors.filter(entry => new RegExp(`^${qualifier} (?:verb|head|predicate|aspect)$`, 'u')
      .test(normalizeTier2Synonym(entry.key)));
    if (witnesses.length !== 1 || witnesses[0].items.length !== 1) return;
    const witness = exact(witnesses[0].items[0]);
    const shape = readCategoryLabel(witness?.label);
    if (!witness || shape?.kind !== 'head' || shape.compound || witness.children?.length) return;
    const annotations = [...witness.label.matchAll(/\[([^\[\]]*)\]/gu)]
      .flatMap(entry => entry[1].split(/[,;]/u)).map(normalizeTier2Synonym);
    if (!annotations.includes(qualifier)) return;
  }
  return match[2];
}

/** A literal Case in an assignment label is evidence too. This accepts a
 * complete label grammar, not a Case word mentioned inside arbitrary prose. */
export function recoverLabelledCaseAssignment(relation: DerivationStageRelation, evidence: Tier2FacetEvidence, thematic?: EvidenceScope): EvidenceScope[] {
  if (!establishesAssignment(evidence) || evidence.authoredValues?.some(entry => entry.concepts.includes('case.literal'))) return [];
  const match = /^(?:(?:structural|abstract|inherent) )?([\p{L}]+) case (?:assignment|licensing|valuation|marking)$/u
    .exec(normalizeTier2Synonym(relation.relation));
  const literal = match && conventionalCases.has(match[1]) ? match[1] : corroboratedCaseLiteral(relation, evidence);
  if (!literal) return [];
  // Build the same typed evidence as a separately authored Case field, then
  // remove the temporary field. No value is added to the authored relation.
  const derived = buildTier2FacetEvidence({ relation: { ...relation, values: { ...relation.values, case: literal } },
    currentForest: evidence.currentForest, priorForest: evidence.priorForest });
  derived.authoredValues = derived.authoredValues?.filter(entry => entry.key !== 'case');
  if (relation.values && Object.keys(relation.values).some(key => normalizeTier2Synonym(key) === 'case')) return [];
  const contextual = recoverContextualCaseAssignment(derived, thematic);
  if (contextual.length) return contextual;
  const anchors = derived.authoredCurrentAnchors ?? [];
  if (!derived.currentAnchors['feature.source']?.length) {
    const recipients = anchors.filter(entry => entry.concepts.includes('feature.target')
      || /^(?:subject|object|argument|nominal|recipient|case bearer)$/u.test(normalizeTier2Synonym(entry.key)));
    if (recipients.length === 1 && recipients[0].items.length === 1)
      return [scopeEvidence(evidence, 'plaque.structured', [{ entry: recipients[0], concept: 'plaque.anchor' }],
        [], { 'plaque.rows': [literal] })];
  }
  return [{ kind: 'feature.dependency', evidence: derived, origins: {
    anchors: Object.fromEntries(anchors.map(entry => [entry.key, entry.items.map((_, index) => index)])),
    values: Object.fromEntries((evidence.authoredValues ?? []).map(entry => [entry.key, entry.items.map((_, index) => index)]))
  } }];
}

/** A complete Case claim can give a contextual head its assignment role.
 * Category evidence corroborates the named head; it never supplies the claim.
 * A governing position owns its exact occurrence, not another chain member. */
export function recoverContextualCaseAssignment(evidence: Tier2FacetEvidence, thematic?: EvidenceScope): EvidenceScope[] {
  if (!establishesAssignment(evidence)) return [];
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => /\bcase\b/u.test(clause));
  if (clauses.length !== 1) return [];
  const clause = clauses[0].replace(/ through (?:the )?(?:(?:verbal|nominal|movement) )?chain$/u, '');
  const selected = clause === 'lexically selected case';
  const caseValues = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('case.literal'));
  const namedCase = caseValues.length === 1 && caseValues[0].items.length === 1
    && clause === `${normalizeTier2Synonym(caseValues[0].items[0])} case`
    && !/\b(?:no|not|without|denied|rejected|required|requested|expected|pending|possible|potential|hypothetical|if|unless|whether|failed|blocked|unlicensed)\b/u.test(clause);
  const assignment = /^(?:(?:matrix|embedded|local|structural|abstract|inherent|dependent|nominal|subject|object|internal argument|external argument|nominative|accusative|genitive|dative|ergative|absolutive|instrumental|locative|oblique|vocative) )*case (?:assignment|licensing|valuation)$/u.test(clause);
  const government = namedCase && relationLabelClauses(evidence.relationName).includes('government');
  if (!selected && !assignment && !namedCase) return [];
  if (namedCase && !hasIndependentCaseEndpoints(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  // An explicitly typed source remains the source. Contextual aliases cannot
  // replace it while the separately named nominal target is being recovered.
  const explicitSources = anchors.filter(entry => entry.concepts.includes('feature.source'));
  const values = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('case.literal'));
  const literals = values.length ? values.flatMap(entry => entry.items) : evidence.values['case.literal'] ?? [];
  if (values.length > 1 || literals.length !== 1 || !literals[0].trim()) return [];
  const occurrences = new Map<string, Array<{ node: typeof evidence.currentForest[number]; root: number; ancestors: string[] }>>();
  const visit = (node: typeof evidence.currentForest[number], root: number, ancestors: string[]) => {
    occurrences.set(node.id, [...(occurrences.get(node.id) ?? []), { node, root, ancestors }]);
    node.children?.forEach(child => visit(child, root, [...ancestors, node.id]));
  };
  evidence.currentForest.forEach((node, root) => visit(node, root, []));
  const exact = (id: string) => occurrences.get(id)?.length === 1 ? occurrences.get(id)![0] : undefined;
  const nodeFor = (entry: typeof anchors[number]) => entry.items.length === 1 ? exact(entry.items[0]) : undefined;
  const nominal = (entry: typeof anchors[number]) => {
    const category = readCategoryLabel(nodeFor(entry)?.node.label);
    return category && !category.compound && ['N', 'D', 'K'].includes(category.head) && category.kind !== 'bar';
  };
  const explicitTargets = anchors.filter(entry => entry.concepts.includes('feature.target'));
  const roleValues = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('role.label'));
  const namedRole = roleValues.length === 1 && roleValues[0].items.length === 1
    ? normalizeTier2Synonym(roleValues[0].items[0]) : undefined;
  const targets = explicitTargets.length ? explicitTargets : anchors.filter(entry =>
    /^(?:(?:licensed|internal|external) )?(?:subject|object|argument|nominal|recipient|dependent|case bearer)$/u.test(normalizeTier2Synonym(entry.key))
    || namedCase && normalizeTier2Synonym(entry.key) === 'nominal projection'
    || namedRole && normalizeTier2Synonym(entry.key) === namedRole
    || thematic?.origins.anchors[entry.key] && thematic.evidence.currentAnchors['theta.arguments']?.includes(entry.items[0]));
  if (targets.length !== 1 || !nominal(targets[0])) return [];
  const target = targets[0], targetNode = nodeFor(target)!;
  const sources = anchors.filter(entry => {
    const role = normalizeTier2Synonym(entry.key), occurrence = nodeFor(entry);
    if (!occurrence) return false;
    if (explicitSources.length) return explicitSources.includes(entry);
    const category = readCategoryLabel(occurrence.node.label);
    if (role === 'governing position') return assignment;
    if (!category || category.compound || category.kind !== 'head') return false;
    if (namedCase && role === `${normalizeTier2Synonym(literals[0])} head`) return ['P', 'K'].includes(category.head);
    if (/^(?:finite head|inflection|inflectional head)$/u.test(role))
      return assignment && ['I', 'T', 'Infl'].includes(category.head);
    if (role === 'case head') return assignment && category.head === 'K';
    if (role === 'localizer') return assignment && category.head === 'L';
    if (/^(?:governor|governing head)$/u.test(role)) return assignment || government;
    if (role === 'selector') return selected;
    return assignment && Boolean(thematic?.origins.anchors[entry.key]
      && thematic.evidence.currentAnchors.predicate?.includes(occurrence.node.id));
  });
  if (sources.length !== 1) return [];
  const source = sources[0], sourceNode = nodeFor(source)!;
  if (sourceNode.node.id === targetNode.node.id || sourceNode.root !== targetNode.root
    || sourceNode.ancestors.includes(targetNode.node.id) || targetNode.ancestors.includes(sourceNode.node.id)) return [];
  // Another contextual head could own the Case claim. A named chain head is
  // only context when its exact occurrence shares the governing slot's lineage.
  const competing = anchors.some(entry => {
    if (entry === source || entry === target) return false;
    const role = normalizeTier2Synonym(entry.key), occurrence = nodeFor(entry);
    if (role === 'chain head' && normalizeTier2Synonym(source.key) === 'governing position'
      && occurrence && sourceNode.node.lineageId && occurrence.node.lineageId === sourceNode.node.lineageId) return false;
    return /(?:^| )(?:head|inflection|selector|governing position|verb|predicate|localizer)$/u.test(role);
  });
  if (competing) return [];
  return [scopeEvidence(evidence, 'feature.dependency', [
    { entry: source, concept: 'feature.source' }, { entry: target, concept: 'feature.target' }
  ], values.map(entry => ({ entry, concept: 'case.literal' })), values.length ? {} : { 'case.literal': literals })];
}

/** Matching qualifiers pair each Case literal with its own endpoints. An
 * explicit Case field qualifier or complete assignment clause supplies the
 * domain for an unfamiliar literal; it never translates that literal. */
export function recoverQualifiedCaseAssignments(evidence: Tier2FacetEvidence): AssignmentScope[] {
  if (!establishesAssignment(evidence)) return [];
  // A separately supplied Case value must pass the existing literal-pair rules.
  if (evidence.authoredValues?.some(entry => entry.concepts.includes('case.literal'))) return [];
  const explicitCaseAssignment = relationLabelClauses(evidence.relationName).some(clause =>
    /^(?:(?:matrix|embedded|local|structural|abstract|inherent|dependent|nominal|internal argument|external argument) )*case (?:assignment|licensing|valuation|marking)$/u.test(clause));
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const values = evidence.authoredValues ?? [];
  const literalFor = (entry: typeof anchors[number]) => values.filter(value => value.key === entry.key
    && value.items.length === entry.items.length && value.items.every(item => item.trim()));
  const sharedSources = anchors.filter(entry => /^(?:(?:lexical|finite) )?(?:governor|licensor|licenser|assigner)$/u.test(normalizeTier2Synonym(entry.key))); 
  const occurrenceCounts = new Map<string, number>();
  const count = (node: typeof evidence.currentForest[number]) => {
    occurrenceCounts.set(node.id, (occurrenceCounts.get(node.id) ?? 0) + 1);
    node.children?.forEach(count);
  };
  evidence.currentForest.forEach(count);
  const groups = new Map<string, Array<{ entry: NonNullable<Tier2FacetEvidence['authoredCurrentAnchors']>[number]; source: boolean }>>();
  for (const entry of anchors) {
    const match = /^(.+?) (assigner|licensor|licenser|bearer|recipient|argument|position|dp|np|nominal)$/u.exec(normalizeTier2Synonym(entry.key));
    if (!match) continue;
    const literal = match[1].replace(/ case$/u, '');
    if (/\b(?:not|non|no|previous|prior|former|alternative|possible|potential|hypothetical|pending|failed|blocked|denied|unlicensed|rejected|unresolved|unestablished)\b/u.test(literal)) continue;
    if (!conventionalCases.has(literal) && literal === match[1] && !explicitCaseAssignment) continue;
    groups.set(literal, [...(groups.get(literal) ?? []), { entry, source: ['assigner', 'licensor', 'licenser'].includes(match[2]) }]);
  }
  return [...groups].flatMap(([literal, fields]): AssignmentScope[] => {
    // Keep an unfamiliar Case name opaque while applying the same bounded
    // denial grammar to that Case. A named sibling's denial stays with it.
    const clauses = relationLabelClauses(evidence.relationName).filter(clause => {
      const padded = ` ${clause}`;
      const namedCase = [...groups.keys(), ...conventionalCases].find(name => padded.includes(` ${name} case`));
      return !namedCase || namedCase === literal;
    }).map(clause => ` ${clause}`.replace(` ${literal} case`, ' case').trim())
      .map(clause => clause.replace(/\b(?:(?:matrix|embedded|local|structural|abstract|inherent|dependent|nominal|internal argument|external argument) )+(?=case\b)/u, ''));
    if (clauses.some(clause => relationAssertionFailure(clause, 'case') && !relationLabelOutcome(clause, 'case'))) return [];
    const sources = fields.filter(field => field.source), targets = fields.filter(field => !field.source);
    if (targets.length !== 1) return [];
    const target = targets[0].entry, authored = literalFor(target);
    const shared = !sources.length && explicitCaseAssignment && authored.length === 1 ? sharedSources : [];
    if (sources.length + shared.length !== 1 || authored.length > 1) return [];
    const source = sources[0]?.entry ?? shared[0];
    if (source.items.length !== 1 || target.items.length !== 1 || source.items[0] === target.items[0]) return [];
    if (occurrenceCounts.get(source.items[0]) !== 1 || occurrenceCounts.get(target.items[0]) !== 1) return [];
    const scope = scopeEvidence(evidence, 'feature.dependency', [
      { entry: source, concept: 'feature.source' }, { entry: target, concept: 'feature.target' }
    ], authored.map(entry => ({ entry, concept: 'case.literal' })), authored.length ? {} : { 'case.literal': [literal] });
    scope.evidence.relationName = clauses.join('; ');
    return [scope];
  });
}
