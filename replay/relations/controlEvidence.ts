import { establishesAssignment } from './assignmentContinuity.ts';
import { scopeEvidence, uniqueCurrentOwners } from './evidenceScopes.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';

/** An asserted subject chain can name its finite controller independently of
 * its thematic occurrence. No endpoint is chosen from an unordered chain. */
export function recoverSubjectChainControl(evidence: Tier2FacetEvidence) {
  if (normalizeTier2Synonym(evidence.relationName) !== 'subject chain and control' || !establishesAssignment(evidence)) return [];
  const anchors = evidence.authoredCurrentAnchors ?? [];
  const sources = anchors.filter(entry => normalizeTier2Synonym(entry.key) === 'finite subject');
  const targets = anchors.filter(entry => entry.concepts.includes('controllee'));
  const domains = anchors.filter(entry => entry.concepts.includes('domain'));
  const indices = (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('index'));
  if (sources.length !== 1 || targets.length !== 1 || sources[0].items.length !== 1 || targets[0].items.length !== 1
    || !uniqueCurrentOwners(evidence, [...sources[0].items, ...targets[0].items])
    || anchors.some(entry => entry !== sources[0] && entry.concepts.includes('controller'))
    || domains.length > 1 || domains.some(entry => entry.items.length !== 1 || !uniqueCurrentOwners(evidence, entry.items))
    || indices.length > 1 || indices.some(entry => entry.items.length !== 1 || !entry.items[0].trim())) return [];
  return [scopeEvidence(evidence, 'control.dependency', [{ entry: sources[0], concept: 'controller' },
    { entry: targets[0], concept: 'controllee' }, ...domains.map(entry => ({ entry, concept: 'domain' }))],
    indices.map(entry => ({ entry, concept: 'index' })))];
}
