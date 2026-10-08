import { assignmentOutcomes, establishesAssignment } from './assignmentContinuity.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym, relationLabelClauses } from './tier2Synonyms.ts';

/** A feature-licensing assertion can name its recipient by role. Direction
 * still comes from an explicit licenser, and the displayed feature comes only
 * from its authored literal. Particle/exponent context is not another target. */
export function recoverNamedFeatureLicensing(evidence: Tier2FacetEvidence) {
  const clauses = relationLabelClauses(evidence.relationName);
  if (clauses.length !== 1 || !establishesAssignment(evidence)) return [];
  const claim = /^(?:(.+?) )?feature licensing$/u.exec(clauses[0]);
  if (!claim || /\b(?:no|not|without|denied|rejected|required|requested|expected|possible|potential|hypothetical|pending|conditional|failed|blocked|unlicensed|unresolved|unestablished|if|unless|whether)\b/u.test(clauses[0])) return [];

  const anchors = evidence.authoredCurrentAnchors ?? [], values = evidence.authoredValues ?? [];
  const sources = anchors.filter(entry => /^(?:(?:finite|lexical|matrix|embedded|local) )?(?:licen[cs](?:or|er)|licensing head|license source)$/u.test(normalizeTier2Synonym(entry.key)));
  const targets = anchors.filter(entry => claim[1]
    ? normalizeTier2Synonym(entry.key) === claim[1]
    : entry.concepts.includes('feature.target'));
  const features = values.filter(entry => entry.concepts.includes('feature.label'));
  if ([sources, targets, features].some(entries => entries.length !== 1 || entries[0].items.length !== 1)
    || !features[0].items[0].trim()
    || /^(?:(?:abstract|structural|inherent|dependent|nominal) )?case$/u.test(normalizeTier2Synonym(features[0].items[0]))
    || !uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items])) return [];
  // Other feature/value fields can describe a different assignment or paired
  // notation. They cannot be folded into this independently complete claim.
  if (values.some(entry => entry !== features[0] && (entry.concepts.some(concept => ['feature.rows', 'case.literal'].includes(concept))
    || /^(?:value|feature value|feature valuation)$/u.test(normalizeTier2Synonym(entry.key))))
    || anchors.some(entry => entry !== sources[0] && entry.concepts.some(concept => ['feature.source', 'probe'].includes(concept))
      || entry !== targets[0] && entry.concepts.some(concept => ['feature.target', 'goal'].includes(concept)))) return [];
  return [scopeEvidence(evidence, 'feature.dependency', [
    { entry: sources[0], concept: 'feature.source' }, { entry: targets[0], concept: 'feature.target' }
  ], [{ entry: features[0], concept: 'feature.rows' },
    ...assignmentOutcomes(evidence).map(entry => ({ entry, concept: 'outcome' }))])];
}
