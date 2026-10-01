import type { SyntaxNode } from '../../types.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import { POSITIVE_OUTCOMES, type Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';
import { relationAssertionFailure, resolveOutcomeLiteral } from './outcomeResolver.ts';
import { establishesAssignment } from './assignmentContinuity.ts';
import { readCategoryLabel } from '../categoryLabel.ts';
import { relationLabelClauses } from './tier2Synonyms.ts';

/** Silence is authored on the exact target or throughout its entire yield.
 * A wordless terminal alone does not establish silence. */
function whollySilent(node: SyntaxNode): boolean {
  return node.silent === true || Boolean(node.children?.length && node.children.every(whollySilent));
}

/** An explicit licensor/licensed-head tuple supplies its form association.
 * An elliptical label instead requires an independently matching category
 * annotation; a requested or conjectured form supplies neither proof. */
export function recoverNamedFormLicensing(evidence: Tier2FacetEvidence) {
  if (!establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const label = normalizeTier2Synonym(evidence.relationName);
  // A named current participle and its auxiliary can explicitly establish the
  // selected form. The exact same literal must name the asserted selection;
  // an unfulfilled required form or a lexical spelling is insufficient.
  const selectedForm = /^(.*?) selection$/u.exec(label)?.[1];
  if (selectedForm && !/\b(?:no|not|without|denied|rejected|required|requested|expected|possible|potential|hypothetical|pending|conditional|failed|blocked|unlicensed|if|unless|whether)\b/u.test(label)) {
    const sources = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'auxiliary');
    const targets = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'participle');
    const rows = (evidence.authoredValues ?? []).filter(entry => normalizeTier2Synonym(entry.key) === 'form');
    if (sources.length === 1 && targets.length === 1 && rows.length === 1
      && [...sources, ...targets, ...rows].every(entry => entry.items.length === 1)
      && normalizeTier2Synonym(rows[0].items[0]) === selectedForm
      && !anchors.some(entry => entry !== sources[0] && entry.concepts.includes('feature.source')
        || entry !== targets[0] && entry.concepts.includes('feature.target'))
      && uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items])) {
      const nodes: SyntaxNode[] = [];
      const visit = (node: SyntaxNode) => { if ([...sources[0].items, ...targets[0].items].includes(node.id)) nodes.push(node); node.children?.forEach(visit); };
      evidence.currentForest.forEach(visit);
      const source = nodes.find(node => node.id === sources[0].items[0]), target = nodes.find(node => node.id === targets[0].items[0]);
      const sourceShape = readCategoryLabel(source?.label), targetShape = readCategoryLabel(target?.label);
      if (sourceShape?.kind === 'head' && !sourceShape.compound && !source?.children?.length
        && targetShape?.kind === 'head' && targetShape.head === 'V' && !targetShape.compound && !target?.children?.length)
        return [scopeEvidence(evidence, 'feature.dependency', [{ entry: sources[0], concept: 'feature.source' },
          { entry: targets[0], concept: 'feature.target' }], [{ entry: rows[0], concept: 'feature.rows' }])];
    }
    return [];
  }
  const explicitFormClaim = /^(?:[\p{L}\p{N}]+ )*(?:form|verb) licensing$/u.test(normalizeTier2Synonym(evidence.relationName ?? ''))
    && !/\b(?:no|not|without|denied|rejected|required|requested|expected|possible|potential|hypothetical|pending|conditional|failed|blocked|unlicensed|if|unless|whether)\b/u.test(normalizeTier2Synonym(evidence.relationName ?? ''));
  if (explicitFormClaim) {
    const sources = anchors.filter(entry => /^(?:licen[cs](?:or|er)|tense)$/u.test(normalizeTier2Synonym(entry.key)));
    const targets = anchors.filter(entry => /^(?:licensed head|verb)$/u.test(normalizeTier2Synonym(entry.key)));
    const rows = (evidence.authoredValues ?? []).filter(entry => /^(?:form|licensed form|inflection)$/u.test(normalizeTier2Synonym(entry.key)));
    if (sources.length === 1 && targets.length === 1 && sources[0].items.length === 1 && targets[0].items.length === 1
      && rows.length === 1 && rows[0].items.length === 1 && rows[0].items[0].trim()
      && !anchors.some(entry => entry !== sources[0] && entry.concepts.includes('feature.source')
        || entry !== targets[0] && entry.concepts.includes('feature.target'))
      && uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items]))
      return [scopeEvidence(evidence, 'feature.dependency', [
        { entry: sources[0], concept: 'feature.source' }, { entry: targets[0], concept: 'feature.target' }
      ], [{ entry: rows[0], concept: 'feature.rows' }])];
    return [];
  }
  const values = (evidence.authoredValues ?? []).filter(entry => normalizeTier2Synonym(entry.key) === 'licensed form');
  const targets = anchors.filter(entry => /^licensed [\p{L}]+$/u.test(normalizeTier2Synonym(entry.key)));
  if (values.length !== 1 || values[0].items.length !== 1 || targets.length !== 1 || targets[0].items.length !== 1) return [];
  const literal = normalizeTier2Synonym(values[0].items[0]);
  if (!literal) return [];
  const sources = anchors.filter(entry => entry !== targets[0] && entry.items.length === 1
    && / head$/u.test(normalizeTier2Synonym(entry.key))
    && normalizeTier2Synonym(evidence.relationName ?? '') === `${normalizeTier2Synonym(entry.key).replace(/ head$/u, '')} ${literal} licensing`);
  if (sources.length !== 1) return [];
  const nodes: SyntaxNode[] = [];
  const visit = (node: SyntaxNode) => { if (node.id === targets[0].items[0]) nodes.push(node); node.children?.forEach(visit); };
  evidence.currentForest.forEach(visit);
  if (nodes.length !== 1 || ![...nodes[0].label.matchAll(/\[([^\[\]]*)\]/gu)].flatMap(match => match[1].split(/[,;]/u))
    .map(normalizeTier2Synonym).includes(literal)) return [];
  return [scopeEvidence(evidence, 'feature.dependency', [
    { entry: sources[0], concept: 'feature.source' }, { entry: targets[0], concept: 'feature.target' }
  ], [{ entry: values[0], concept: 'feature.rows' }])];
}

/** A selected functional property becomes current licensing evidence only
 * when the named functional recipient itself records that exact value. A
 * verbal exponent is realization context, not a second licensed recipient. */
export function recoverSpecifiedMoodLicensing(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName).filter(clause => /\bmood\b/u.test(clause));
  if (clauses.length !== 1 || !/^(?:negative temporal and )?mood licensing$/u.test(clauses[0]) || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  const rows = values.filter(entry => /^(?:selected )?mood$/u.test(normalizeTier2Synonym(entry.key)));
  const sources = anchors.filter(entry => /^(?:selector|licen[cs](?:or|er))$/u.test(normalizeTier2Synonym(entry.key)));
  const targets = anchors.filter(entry => /^(?:finite head|mood head)$/u.test(normalizeTier2Synonym(entry.key)));
  if ([sources, targets, rows].some(entries => entries.length !== 1 || entries[0].items.length !== 1)
    || !rows[0].items[0].trim() || !uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items])
    || anchors.some(entry => entry !== sources[0] && entry !== targets[0]
      && entry.concepts.some(concept => ['feature.source', 'feature.target'].includes(concept)))) return [];
  let target: SyntaxNode | undefined;
  const visit = (node: SyntaxNode) => { if (node.id === targets[0].items[0]) target = node; node.children?.forEach(visit); };
  evidence.currentForest.forEach(visit);
  const shape = readCategoryLabel(target?.label);
  if (!target || shape?.kind !== 'head' || shape.compound || target.children?.length
    || !['T', 'I', 'Infl', 'Mood'].includes(shape.head)) return [];
  const annotations = [...target.label.matchAll(/\[([^\[\]]*)\]|\(([^()]*)\)/gu)]
    .flatMap(match => (match[1] ?? match[2]).split(/[,;]/u)).map(normalizeTier2Synonym);
  if (!annotations.includes(normalizeTier2Synonym(rows[0].items[0]))) return [];
  return [scopeEvidence(evidence, 'feature.dependency', [{ entry: sources[0], concept: 'feature.source' },
    { entry: targets[0], concept: 'feature.target' }], [{ entry: rows[0], concept: 'feature.rows' }])];
}

/** A single additive property clause can share the licensing subject without
 * restating the dependency. Contrast, retraction, conditions and unresolved
 * references do not establish that independence. The property stays literal. */
function independentPropertyClause(clause: string, subject: string): boolean {
  const predicate = '(has|bears|receives|does not have|does not bear|does not receive)';
  const inherited = new RegExp(`^${predicate} ([\\p{L}\\p{N} ]+)$`, 'u').exec(clause);
  const explicit = inherited ? undefined
    : new RegExp(`^(?:the )?([\\p{L}\\p{N} ]+) ${predicate} ([\\p{L}\\p{N} ]+)$`, 'u').exec(clause);
  if (!inherited && (!explicit || explicit[1] !== subject)) return false;
  const property = inherited?.[2] ?? explicit![3];
  return !/\b(?:if|unless|whether|but|however|actually|instead|although|yet|or|and|because|despite|except|notwithstanding|license|licenses|licensed|licensing|licence|unlicensed|block|blocks|blocked|blocking|fail|fails|failed|failure|retract|retracts|retracted|cannot|it|its|he|him|his|she|her|they|them|their|this|that|these|those)\b/u.test(property);
}

/** A declarative licensing clause can identify an exact source and recipient
 * without prescribing their role names. Only a complete positive clause and an
 * independently typed value earn the existing dependency. One independent
 * property clause may follow; the complete status remains neutral text. */
export function recoverDeclarativeLicensing(evidence: Tier2FacetEvidence) {
  const name = normalizeTier2Synonym(evidence.relationName ?? '');
  if (/\b(?:no|not|non|without|failed|blocked|unlicensed|impossible|possible|potential|hypothetical|conditional|pending|if|unless|whether)\b/u.test(name)
    || relationAssertionFailure(evidence.relationName, 'agreement')) return [];
  const values = evidence.authoredValues ?? [];
  const statuses = values.filter(entry => normalizeTier2Synonym(entry.key) === 'status');
  if (statuses.length !== 1 || statuses[0].items.length !== 1) return [];
  const status = statuses[0];
  const clauses = normalizeTier2Synonym(status.items[0]).replace(/\.$/u, '').split(' and ');
  if (clauses.length > 2) return [];
  const match = /^(?:the )?([\p{L}\p{N} ]+) licenses (?:the )?([\p{L}\p{N} ]+?)$/u.exec(clauses[0]);
  if (!match) return [];
  if (clauses.length === 2 && !independentPropertyClause(clauses[1], match[1])) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const sources = anchors.filter(entry => normalizeTier2Synonym(entry.key) === match[1]);
  if (sources.length !== 1 || sources[0].items.length !== 1) return [];
  const source = sources[0];
  const nodes = new Map<string, SyntaxNode[]>();
  const visit = (node: SyntaxNode) => {
    nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]);
    node.children?.forEach(visit);
  };
  evidence.currentForest.forEach(visit);
  if (nodes.get(source.items[0])?.length !== 1) return [];
  const targets = anchors.filter(entry => {
    if (entry === source || entry.items.length !== 1) return false;
    const node = nodes.get(entry.items[0]);
    if (node?.length !== 1) return false;
    const role = normalizeTier2Synonym(entry.key);
    if (role === match[2]) return true;
    return whollySilent(node[0]) && [
      `silent ${role}`, `${role} argument`, `silent ${role} argument`
    ].includes(match[2]);
  });
  if (targets.length !== 1 || targets[0].items[0] === source.items[0]) return [];
  const target = targets[0];
  if (anchors.some(entry => entry !== source && entry.concepts.some(concept => ['probe', 'feature.source'].includes(concept))
    || entry !== target && entry.concepts.some(concept => ['goal', 'feature.target'].includes(concept)))) return [];
  const typed = values.filter(entry => entry.concepts.some(concept => ['feature.rows', 'case.literal'].includes(concept)));
  if (!typed.length || typed.some(entry => !entry.items.length || entry.items.some(item => !item.trim()))) return [];
  if (values.some(entry => entry !== status && !typed.includes(entry)
    && (!['outcome', 'judgment', 'verdict'].includes(normalizeTier2Synonym(entry.key))
      || entry.items.some(item => !POSITIVE_OUTCOMES.some(outcome => resolveOutcomeLiteral(item)?.concept === outcome))))) return [];
  return [scopeEvidence(evidence, 'feature.dependency', [
    { entry: source, concept: 'feature.source' }, { entry: target, concept: 'feature.target' }
  ], typed.map(entry => ({ entry, concept: entry.concepts.includes('case.literal') ? 'case.literal' : 'feature.rows' })))];
}
