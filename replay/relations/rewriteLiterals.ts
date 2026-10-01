import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';
import { normalizeTier2Synonym } from './tier2Synonyms.ts';

const mappingLabel = /^(?:(?:an?|the|authored|explicit|local|morphological|pf) )*(?:realization|realisation|exponence|vocabulary insertion|spell out|pf) (?:mapping|rewrite)(?: rule)?$/u;
const clauses = (name: string) => normalizeTier2Synonym(name).split(/\s*(?:[;,]|\band\b|\bbut\b)\s*/u);
export const hasExplicitPFMappingLabel = (name: string | undefined): boolean =>
  clauses(name ?? '').some(clause => mappingLabel.test(clause));

/** Unqualified status fields belong to this mapping only in an otherwise
 * unambiguous PF context. A separate participant or label clause keeps their
 * ownership open for another claim; sharing an envelope is not enough. */
export function ownedPFRewriteOutcomes(evidence: Tier2FacetEvidence) {
  const labelClauses = clauses(evidence.relationName ?? '');
  const participants = [...(evidence.authoredCurrentAnchors ?? []), ...(evidence.authoredPriorAnchors ?? [])];
  const onlyMappingParticipants = participants.length > 0
    && participants.some(entry => entry.concepts.includes('rewrite.input'))
    && participants.some(entry => entry.concepts.includes('rewrite.output'))
    && participants.every(entry => entry.concepts.some(concept => ['rewrite.input', 'rewrite.output'].includes(concept)));
  if (labelClauses.length !== 1 || !mappingLabel.test(labelClauses[0]) && !onlyMappingParticipants) return [];
  return (evidence.authoredValues ?? []).filter(entry => entry.concepts.includes('outcome')
    || ['outcome', 'status', 'result', 'verdict', 'judgment'].includes(normalizeTier2Synonym(entry.key)));
}

/** A denied or provisional mapping is not a realized input/output pair. Other
 * families in the same label do not determine the status of this claim. */
export function pfRewriteLabelDenial(name: string | undefined): boolean {
  return clauses(name ?? '').some(clause => {
    const withoutPrefix = clause.replace(/^(?:(?:an?|the) )?(?:not (?:yet )?established|not(?: an?| the)?|no|absent|failed|blocked|unsuccessful|rejected|unlicensed|pending|possible|potential|hypothetical|required|unestablished|absence of|failure of) /u, '');
    const withoutSuffix = clause.replace(/ (?:is )?(?:absent|failed|blocked|pending|unestablished|not established)$/u, '');
    return withoutPrefix !== clause && mappingLabel.test(withoutPrefix)
      || withoutSuffix !== clause && mappingLabel.test(withoutSuffix);
  });
}

/** Same-name fields tie the literal columns to their exact declared roles. */
export function authoredRewritePair(evidence: Tier2FacetEvidence) {
  if (!hasExplicitPFMappingLabel(evidence.relationName)) return;
  const inputs = [...(evidence.authoredCurrentAnchors ?? []), ...(evidence.authoredPriorAnchors ?? [])]
    .filter(entry => entry.concepts.includes('rewrite.input'));
  const outputs = (evidence.authoredCurrentAnchors ?? []).filter(entry => entry.concepts.includes('rewrite.output'));
  if (inputs.length !== 1 || outputs.length !== 1 || inputs[0].items.length !== 1 || outputs[0].items.length !== 1) return;
  const input = evidence.authoredValues?.filter(entry => entry.key === inputs[0].key) ?? [];
  const output = evidence.authoredValues?.filter(entry => entry.key === outputs[0].key) ?? [];
  if (input.length !== 1 || output.length !== 1 || input[0] === output[0]
    || [input[0], output[0]].some(entry => entry.items.length !== 1 || !entry.items[0].trim())) return;
  return { input: input[0], output: output[0] };
}

/** Read one supported arrow with nonempty single-line literal columns.
 * Incomplete rows and competing arrows establish no pair. */
export function readRewriteLiteral(value: string): { input: string; output: string } | undefined {
  if (/[\r\n]|-->|->>|<->/u.test(value)) return;
  const sides = value.split(/->|→/u);
  if (sides.length !== 2 || sides.some(side => !side.trim()
    || /[\u2190-\u21ff\u27f0-\u27ff\u2900-\u297f]|=>|<-|-->/u.test(side))) return;
  return { input: sides[0].trim(), output: sides[1].trim() };
}

/** The original input/output fields, or one typed arrow row, supply the native
 * columns. Invalid rows remain literal so recipe completeness can reject them. */
export function prepareRewriteRows(
  evidence: Tier2FacetEvidence,
  rows: Array<{ label: string; value: string }>
) {
  // An owned outcome qualifies the mapping; it is not another rewrite row.
  rows = rows.filter(row => !evidence.authoredValues?.some(entry => entry.key === row.label
    && entry.concepts.includes('outcome') && !entry.concepts.includes('rewrite.rows')));
  const typed = (row: { label: string; value: string }) => evidence.authoredValues === undefined
    ? row.label === 'rewrite.rows' && evidence.values['rewrite.rows']?.includes(row.value)
    : evidence.authoredValues.some(entry => entry.key === row.label
      && entry.concepts.includes('rewrite.rows') && entry.items.includes(row.value));
  const inputs = evidence.authoredValues?.filter(entry => entry.concepts.includes('rewrite.input.literal')) ?? [];
  const outputs = evidence.authoredValues?.filter(entry => entry.concepts.includes('rewrite.output.literal')) ?? [];
  if (inputs.length || outputs.length) {
    const pair = [...inputs, ...outputs];
    const pairedRows = rows.filter(row => pair.some(entry => entry.key === row.label && entry.items[0] === row.value));
    const corroboratingRows = rows.filter(row => !pairedRows.includes(row));
    if (inputs.length === 1 && outputs.length === 1 && inputs[0] !== outputs[0]
      && pair.every(entry => entry.items.length === 1 && entry.items[0].trim())
      && pairedRows.length === 2 && corroboratingRows.length <= 1
      && corroboratingRows.every(row => {
        const columns = typed(row) ? readRewriteLiteral(row.value) : undefined;
        return columns?.input === inputs[0].items[0] && columns.output === outputs[0].items[0];
      })) return { rows: [{ label: inputs[0].items[0], value: outputs[0].items[0] }],
        realizationRowKinds: ['rewrite' as const] };
    return { rows, realizationRowKinds: rows.map(() => 'literal' as const) };
  }
  const realizationRowKinds: Array<'rewrite' | 'literal'> = [];
  const authoredPair = authoredRewritePair(evidence);
  const prepared = rows.map(row => {
    const sides = typed(row) ? readRewriteLiteral(row.value) : undefined;
    if (sides && (!authoredPair || sides.input === authoredPair.input.items[0] && sides.output === authoredPair.output.items[0])) {
      realizationRowKinds.push('rewrite');
      return { label: sides.input, value: sides.output };
    }
    realizationRowKinds.push('literal');
    return row;
  });
  return { rows: prepared, realizationRowKinds };
}
