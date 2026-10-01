import type { DerivationStageRelation, SurfaceRealization, SyntaxNode } from '../../types.ts';
import { exactRealizationGroup, sameRealizationMembers } from '../realizationGroups.ts';
import { recoverMovementEvidence } from './movementEvidence.ts';
import { nominalConcordMembers, directedNominalConcordMembers } from './nominalConcord.ts';
import { resolveOutcomeLiteral, isUnestablishedOutcomeLiteral, relationAssertionFailure, relationLabelOutcome, negativeClaimFailure } from './outcomeResolver.ts';
import { INDEPENDENT_TIER2_ANCHOR_ROLES, INDEPENDENT_TIER2_VALUE_ROLES, independentFeatureDimensions, independentThetaArgumentFields, independentIdiomMemberFields, sameNameValueEntries,
  type Tier2AuthoredEvidenceEntry, type Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { buildTier2SynonymIndex, lookupTier2SynonymCandidates, normalizeTier2Synonym, relationRoleConcepts, relationValueConcepts,
  hasAuthoredJudgment, isCovertMovementDescription, type Tier2SynonymIndex, type Tier2SynonymScope } from './tier2Synonyms.ts';
const DEFAULT_SYNONYM_INDEX = buildTier2SynonymIndex();

const authoredItems = (value: string | string[]): string[] => (
  (Array.isArray(value) ? value : [value])
    .map((item) => String(item ?? ''))
);

const appendItems = (
  target: Record<string, string[]>,
  concept: string,
  items: readonly string[]
) => {
  target[concept] = [...(target[concept] ?? []), ...items];
};

const normalizeBlock = (
  block: Record<string, string | string[]> | undefined,
  scope: Tier2SynonymScope,
  synonymIndex: Tier2SynonymIndex,
  context?: Parameters<typeof relationRoleConcepts>[2]
): {
  concepts: Record<string, string[]>;
  authored: Tier2AuthoredEvidenceEntry[];
} => {
  const normalized: Record<string, string[]> = {};
  const authored: Tier2AuthoredEvidenceEntry[] = [];
  const conceptBlocks = new Map<string, string[]>();
  Object.entries(block ?? {}).forEach(([authoredKey, value]) => {
    const items = authoredItems(value);
    const concepts = scope === 'role' ? relationRoleConcepts(synonymIndex, authoredKey, context)
      : relationValueConcepts(synonymIndex, authoredKey, context);
    const activeConcepts: string[] = [];
    const conceptItemIndices: Record<string, number[]> = {};
    concepts.forEach((concept) => {
      const conceptItems = scope === 'value' && concept === 'outcome'
        ? items.filter((item) => resolveOutcomeLiteral(item)?.concept || isUnestablishedOutcomeLiteral(item))
        : scope === 'value' && concept === 'verdict'
          ? items.filter((item) => hasAuthoredJudgment(context) || !resolveOutcomeLiteral(item)?.concept)
          : items;
      if (conceptItems.length === 0) {
        if (items.length === 0) activeConcepts.push(concept);
        return;
      }
      activeConcepts.push(concept);
      conceptItemIndices[concept] = items.flatMap((item, index) => conceptItems.includes(item) ? [index] : []);
      const blockIdentity = JSON.stringify(conceptItems);
      const previousBlocks = conceptBlocks.get(concept) ?? [];
      if (!previousBlocks.includes(blockIdentity)) {
        const dimensions = scope === 'value' && concept === 'feature.rows' && independentFeatureDimensions([
          ...authored.filter(entry => entry.concepts.includes(concept)), { key: authoredKey, items }
        ]);
        if (previousBlocks.length === 0 || dimensions || (scope === 'role' ? INDEPENDENT_TIER2_ANCHOR_ROLES : INDEPENDENT_TIER2_VALUE_ROLES).has(concept)) {
          appendItems(normalized, concept, conceptItems);
        } else {
          normalized[concept] = [];
        }
      }
      conceptBlocks.set(concept, [...previousBlocks, blockIdentity]);
    });
    authored.push({
      key: authoredKey,
      concepts: activeConcepts,
      conceptItemIndices,
      items: [...items]
    });
  });
  return { concepts: normalized, authored };
};

export const buildTier2FacetEvidence = ({
  relation,
  currentForest,
  currentRealizations,
  priorRealizations,
  priorForest,
  activeLens,
  synonymIndex = DEFAULT_SYNONYM_INDEX
}: { relation: DerivationStageRelation; currentForest: readonly SyntaxNode[]; currentRealizations?: readonly SurfaceRealization[];
  priorRealizations?: readonly SurfaceRealization[];
  priorForest?: readonly SyntaxNode[]; activeLens?: boolean; synonymIndex?: Tier2SynonymIndex }): Tier2FacetEvidence => {
  const currentAnchors = normalizeBlock(relation.anchors, 'role', synonymIndex, { ...relation, forest: currentForest });
  const priorAnchors = normalizeBlock(relation.priorAnchors, 'role', synonymIndex, { ...relation, anchors: relation.priorAnchors ?? {}, forest: priorForest });
  const values = normalizeBlock(relation.values, 'value', synonymIndex, { ...relation, forest: currentForest });
  // A verdict explicitly attached to the analysis is not the outcome of every
  // independent dependency in the same authored envelope. Local verdicts retain
  // their outcome meaning when no whole-analysis target has been established.
  if (currentAnchors.concepts['analysis.anchor']?.length) {
    values.authored.filter(entry => ['judgment', 'verdict'].includes(normalizeTier2Synonym(entry.key))
      && entry.concepts.includes('verdict')).forEach(entry => {
      entry.concepts = entry.concepts.filter(concept => concept !== 'outcome');
      if (entry.conceptItemIndices) entry.conceptItemIndices = Object.fromEntries(
        Object.entries(entry.conceptItemIndices).filter(([key]) => key !== 'outcome'));
    });
    const localOutcomes = values.authored.filter(entry => entry.concepts.includes('outcome'))
      .flatMap(entry => (entry.conceptItemIndices?.outcome ?? entry.items.map((_, i) => i)).map(i => entry.items[i]));
    if (localOutcomes.length) values.concepts.outcome = localOutcomes;
    else delete values.concepts.outcome;
  }
  // A qualification belongs next to the verdict, not in the large glyph.
  // Both pieces are verbatim spans of the one authored value and stay together.
  if (hasAuthoredJudgment(relation) && values.concepts.verdict?.length === 1
    && !values.concepts.label?.length) {
    const literal = values.concepts.verdict[0];
    const parts = /^((?:[Ss]tructurally |[Ss]yntactically )?(?:[Gg]rammatical|[Uu]ngrammatical|[Ii]llicit|[Ll]icensed|[Ww]ell-formed|[Nn]ot grammatical))((?:\s+(?:in|under|with|on|but)\s+|,\s*).+)$/u.exec(literal);
    if (parts && Array.from(parts[1]).length <= 32) {
      values.concepts.verdict = [parts[1]];
      values.concepts.label = [parts[2].trim()];
      values.authored.filter(entry => entry.concepts.includes('verdict')).forEach(entry => {
        entry.concepts = [...entry.concepts, 'label'];
        entry.conceptItemIndices = { ...entry.conceptItemIndices, label: [...(entry.conceptItemIndices?.verdict ?? [0])] };
      });
    }
  }
  // A Case value qualified by the exact recipient role belongs to that one
  // participant. This cannot pair a subjectCase literal with a generic goal.
  const recipients = currentAnchors.authored.filter(entry => entry.concepts.includes('feature.target'));
  if (recipients.length === 1 && recipients[0].items.length === 1) {
    const role = normalizeTier2Synonym(recipients[0].key);
    const namedCases = values.authored.filter(entry => normalizeTier2Synonym(entry.key) === `${role} case` && entry.items.length === 1 && entry.items[0].trim());
    namedCases.forEach(entry => {
      entry.concepts = [...entry.concepts, 'case.literal'];
      entry.conceptItemIndices = { ...entry.conceptItemIndices, 'case.literal': [0] };
      appendItems(values.concepts, 'case.literal', entry.items);
    });
  }
  // Case and feature collection can share endpoints while making independent
  // assertions. A denied collection cannot borrow the Case claim's connector;
  // its literal properties remain available to annotation and neutral evidence.
  const negativeOutcome = Boolean(values.concepts.outcome?.length)
    && !negativeClaimFailure(values.concepts.outcome, []);
  if (!negativeOutcome && values.concepts['case.literal']?.length && values.concepts['feature.rows']?.length) {
    for (const [family, concept] of [['agreement', 'feature.rows'], ['case', 'case.literal']] as const) {
      if (!relationAssertionFailure(relation.relation, family) || relationLabelOutcome(relation.relation, family)) continue;
      delete values.concepts[concept];
      values.authored.forEach(entry => {
        entry.concepts = entry.concepts.filter(item => item !== concept);
        if (entry.conceptItemIndices) entry.conceptItemIndices = Object.fromEntries(
          Object.entries(entry.conceptItemIndices).filter(([key]) => key !== concept));
      });
    }
  }
  if (independentIdiomMemberFields({ authoredCurrentAnchors: currentAnchors.authored })) {
    currentAnchors.concepts.chunks = currentAnchors.authored.filter(entry => entry.concepts.includes('chunks')).flatMap(entry => entry.items);
  }
  const concord = nominalConcordMembers({ relationName: relation.relation, currentForest, authoredCurrentAnchors: currentAnchors.authored, authoredValues: values.authored });
  if (concord.length) {
    currentAnchors.concepts['feature.bearers'] = concord.flatMap(entry => entry.items);
    concord.forEach(entry => {
      entry.concepts = [...entry.concepts, 'feature.bearers'];
      entry.conceptItemIndices = { ...entry.conceptItemIndices, 'feature.bearers': entry.items.map((_, index) => index) };
    });
  }
  const directedConcord = directedNominalConcordMembers({ relationName: relation.relation, currentForest,
    authoredCurrentAnchors: currentAnchors.authored, authoredValues: values.authored });
  for (const entry of directedConcord) {
    const concept = normalizeTier2Synonym(entry.key) === 'controller' ? 'feature.source' : 'feature.target';
    currentAnchors.concepts[concept] = [...entry.items];
    entry.concepts = [...new Set([...entry.concepts, concept])];
    entry.conceptItemIndices = { ...entry.conceptItemIndices, [concept]: entry.items.map((_, index) => index) };
  }
  const declaredContributors = currentAnchors.authored.filter(entry => entry.concepts.includes('pf.contributors'));
  const contributors = declaredContributors.length ? declaredContributors : currentAnchors.authored;
  const surfaces = values.authored.filter(entry => entry.concepts.includes('pf.surface'));
  const surfaceSequence = surfaces.length === 1 && ['surface sequence', 'surface pieces', 'input pieces in order']
    .includes(normalizeTier2Synonym(surfaces[0].key));
  let realizationGroupAnchorKeys: string[] | undefined;
  let priorRealizationGroupAnchorKeys: string[] | undefined;
  // The entire authored realization group owns the plate. No member is chosen
  // as a lexical source, output head or morphological controller.
  if ((!declaredContributors.length || declaredContributors.length === 1) && surfaces.length === 1
    && surfaces[0].items.length > 0 && (surfaces[0].items.length === 1 || surfaceSequence)
    && surfaces[0].items.every(item => item.trim())) {
    const ids = contributors.flatMap(entry => entry.items);
    const groups = currentRealizations ?? [];
    const nodes = new Map<string, SyntaxNode[]>();
    const visit = (node: SyntaxNode) => {
      nodes.set(node.id, [...(nodes.get(node.id) ?? []), node]);
      node.children?.forEach(visit);
    };
    currentForest.forEach(visit);
    const contains = (node: SyntaxNode, id: string): boolean => node.id === id || Boolean(node.children?.some(child => contains(child, id)));
    const matches = groups.flatMap(group => {
      if (group.nodeIds.length === ids.length && new Set(group.nodeIds).size === ids.length
        && ids.every(id => group.nodeIds.includes(id))) return [{ group, carriers: [] as Tier2AuthoredEvidenceEntry[] }];
      // A realization may name the whole constituent while its relation names
      // the contained contributors. The carrier must also be explicitly anchored.
      if (!declaredContributors.length || group.nodeIds.length !== 1) return [];
      const carriers = currentAnchors.authored.filter(entry => !contributors.includes(entry)
        && entry.items.length === 1 && entry.items[0] === group.nodeIds[0]);
      const carrier = nodes.get(group.nodeIds[0]);
      return carriers.length === 1 && carrier?.length === 1 && ids.every(id => contains(carrier[0], id))
        ? [{ group, carriers }] : [];
    });
    const match = matches.length === 1 ? matches[0] : undefined;
    const group = match?.group;
    const exactGroup = ids.length > 0 && new Set(ids).size === ids.length && group
      && ids.every(id => nodes.get(id)?.length === 1)
      && exactRealizationGroup(group.nodeIds, groups, currentForest)
      && (!surfaceSequence || surfaces[0].items.length === group.tokenIndices.length)
      && (currentAnchors.concepts['rewrite.output'] ?? []).every(id =>
        [...ids, ...match!.carriers.flatMap(entry => entry.items)].includes(id));
    if (exactGroup) {
      const owners = [...match!.carriers, ...contributors];
      realizationGroupAnchorKeys = owners.map(entry => entry.key);
      currentAnchors.concepts['rewrite.output'] = [...new Set(owners.flatMap(entry => entry.items))];
      owners.forEach(entry => {
        entry.concepts = [...entry.concepts, 'rewrite.output'];
        entry.conceptItemIndices = { ...entry.conceptItemIndices,
          'rewrite.output': entry.items.map((_, index) => index) };
      });
      if (!surfaces[0].concepts.includes('pf.rows')) appendItems(values.concepts, 'pf.rows', surfaces[0].items);
      surfaces[0].concepts = [...new Set([...surfaces[0].concepts, 'pf.rows'])];
      surfaces[0].conceptItemIndices = { ...surfaces[0].conceptItemIndices,
        'pf.rows': surfaces[0].items.map((_, index) => index) };
      const priorIds = priorAnchors.authored.flatMap(entry => entry.items);
      const priorGroup = exactRealizationGroup(priorIds, priorRealizations, priorForest);
      if (priorGroup && sameRealizationMembers(priorGroup.tokenIndices, group.tokenIndices)) {
        priorRealizationGroupAnchorKeys = priorAnchors.authored.map(entry => entry.key);
        priorAnchors.concepts['rewrite.output'] = [...priorIds];
        priorAnchors.authored.forEach(entry => {
          entry.concepts = [...new Set([...entry.concepts, 'rewrite.output'])];
          entry.conceptItemIndices = { ...entry.conceptItemIndices,
            'rewrite.output': entry.items.map((_, index) => index) };
        });
      }
    }
  }
  if (independentThetaArgumentFields({ authoredCurrentAnchors: currentAnchors.authored, authoredValues: values.authored })) {
    const arguments_ = currentAnchors.authored.filter(entry => entry.concepts.includes('theta.arguments'));
    currentAnchors.concepts['theta.arguments'] = arguments_.flatMap(entry => [...entry.items]);
    const paired = arguments_.map(entry => sameNameValueEntries({ authoredValues: values.authored }, entry, 'theta.arguments')[0]);
    if (!values.concepts['role.label']?.length && paired.every(entry => entry?.concepts.includes('role.label'))) {
      values.concepts['role.label'] = paired.flatMap(entry => entry.items);
    }
  }
  // One current participant makes explicit record rows attachable without
  // interpreting its role or the relation title. Multiple participants still
  // need an authored recipient; this rule never earns a dependency.
  const participant = currentAnchors.authored.length === 1 ? currentAnchors.authored[0] : undefined;
  if (participant?.items.length === 1 && (values.concepts['plaque.rows']?.length || values.concepts['feature.rows']?.length)) {
    currentAnchors.concepts['plaque.anchor'] = [...participant.items];
    participant.concepts = [...new Set([...participant.concepts, 'plaque.anchor'])];
    participant.conceptItemIndices = { ...participant.conceptItemIndices, 'plaque.anchor': [0] };
    const preceding = priorAnchors.authored.filter(entry => entry.key === participant.key);
    if (preceding.length === 1 && preceding[0].items.length === 1) {
      priorAnchors.concepts['plaque.anchor'] = [...preceding[0].items];
      preceding[0].concepts = [...new Set([...preceding[0].concepts, 'plaque.anchor'])];
      preceding[0].conceptItemIndices = { ...preceding[0].conceptItemIndices, 'plaque.anchor': [0] };
    }
    if (values.concepts['feature.rows']?.length) {
      appendItems(values.concepts, 'plaque.rows', values.concepts['feature.rows']);
      values.authored.filter(entry => entry.concepts.includes('feature.rows')).forEach(entry => {
        entry.concepts = [...entry.concepts, 'plaque.rows'];
        entry.conceptItemIndices = { ...entry.conceptItemIndices, 'plaque.rows': entry.items.map((_, index) => index) };
      });
    }
  }
  const realizationHost = (currentAnchors.concepts['pf.host']?.length ?? 0) > 0;
  if (realizationHost) {
    values.authored.filter(entry => normalizeTier2Synonym(entry.key) === 'notation').forEach(entry => {
      entry.concepts = [...entry.concepts, 'pf.rows'];
      entry.conceptItemIndices = { ...entry.conceptItemIndices, 'pf.rows': entry.items.map((_, index) => index) };
      appendItems(values.concepts, 'pf.rows', entry.items);
    });
  }
  const { movement, failure: movementFailure, diagnostics: movementDiagnostics } = recoverMovementEvidence(relation, currentForest, priorForest);
  if (movement) {
    currentAnchors.concepts['movement.source'] = [movement.sourceNodeId];
    currentAnchors.concepts['movement.witness'] = [movement.witnessNodeId];
    currentAnchors.concepts['movement.landing'] = [movement.targetNodeId];
    currentAnchors.authored.forEach(entry => {
      entry.concepts = entry.concepts.filter(c => !['movement.source', 'movement.witness', 'movement.landing'].includes(c));
      entry.concepts = [...entry.concepts, ...(movement.roles[normalizeTier2Synonym(entry.key)] || [])];
    });
    if (isCovertMovementDescription(relation.relation) && movement.trajectoryKind === 'phrasal') {
      for (const [role, id, movementRole] of [
        ['scope.source', movement.witnessNodeId, 'movement.source'],
        ['scope.landing', movement.targetNodeId, 'movement.landing']
      ] as const) {
        const entries = currentAnchors.authored.filter(entry => entry.items.length === 1 && entry.items[0] === id
          && entry.concepts.includes(movementRole));
        if (!entries.length) continue;
        currentAnchors.concepts[role] = [id];
        entries.forEach(entry => {
          entry.concepts = [...new Set([...entry.concepts, role])];
          entry.conceptItemIndices = { ...entry.conceptItemIndices, [role]: [0] };
        });
      }
    }
    // Proven source context must not re-enter the recipe as a competing endpoint.
    if ('movement.source' in priorAnchors.concepts) {
      priorAnchors.authored.forEach(entry => {
        if (entry.items.length !== 1 || entry.items[0] !== movement.priorSourceNodeId) {
          entry.concepts = entry.concepts.filter(concept => concept !== 'movement.source');
        }
      });
      priorAnchors.concepts['movement.source'] = [...new Set(priorAnchors.authored
        .filter(entry => entry.concepts.includes('movement.source')).flatMap(entry => entry.items))];
    }
  }
  return {
    ...(currentRealizations ? { currentRealizations } : {}),
    relationName: relation.relation,
    ...(realizationGroupAnchorKeys ? { realizationGroupAnchorKeys } : {}),
    ...(priorRealizationGroupAnchorKeys ? { priorRealizationGroupAnchorKeys } : {}),
    movementDiagnostics,
    ...(movementFailure ? { movementFailure } : {}),
    ...(movement ? { movement } : {}),
    currentAnchors: currentAnchors.concepts,
    authoredCurrentAnchors: currentAnchors.authored,
    ...(relation.priorAnchors
      ? {
          priorAnchors: priorAnchors.concepts,
          authoredPriorAnchors: priorAnchors.authored
        }
      : {}),
    values: values.concepts,
    authoredValues: values.authored,
    currentForest,
    ...(priorForest ? { priorForest } : {}),
    ...(activeLens === undefined ? {} : { activeLens })
  };
};
