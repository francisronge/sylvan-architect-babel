/**
 * The saved Jev record's shape (`types.ts` JevRecord, docs/design/jev.md), without
 * Replay's recognition, so the Tree Bank and the contract check can refuse a malformed
 * record cheaply. Whether a mapping applies to a claim is decided when Replay reads it
 * (`relations/jev.ts`, `jevAnswerFor`).
 */
export const JEV_RECORD_VERSION = 2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isIndex = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const isStringList = (value: unknown) => Array.isArray(value) && value.every(item => typeof item === 'string');
const isStringRecord = (value: unknown, item: (entry: unknown) => boolean) =>
  isRecord(value) && Object.values(value).every(item);
const exactFields = (value: Record<string, unknown>, fields: string[], optional: string[] = []) =>
  fields.every(field => Object.hasOwn(value, field))
  && Object.keys(value).every(field => fields.includes(field) || optional.includes(field));

/** Why a value is not a saved Jev record, or nothing when it is. */
export const jevRecordIssues = (value: unknown): string[] => {
  if (!isRecord(value)) return ['the Jev record is not an object'];
  const issues: string[] = [];
  if (!exactFields(value, ['version', 'mappings'], ['provenance'])) issues.push('the Jev record has missing or unknown fields');
  if (value.version !== JEV_RECORD_VERSION) issues.push(`the Jev record version is not ${JEV_RECORD_VERSION}`);
  if (value.provenance !== undefined && !isRecord(value.provenance)) issues.push('the Jev provenance is not an object');
  if (!Array.isArray(value.mappings)) return [...issues, 'the Jev mappings are not a list'];
  value.mappings.forEach((mapping: unknown, index) => {
    const at = `Jev mapping ${index}`;
    if (!isRecord(mapping) || !exactFields(mapping, ['stageIndex', 'relationIndex', 'terms', 'answer', 'confidence'])) {
      issues.push(`${at} has missing or unknown fields`);
      return;
    }
    if (!isIndex(mapping.stageIndex) || !isIndex(mapping.relationIndex)) issues.push(`${at} has no claim position`);
    const { terms, answer, confidence } = mapping;
    if (!isRecord(terms) || !exactFields(terms, ['relation', 'roles', 'values']) || typeof terms.relation !== 'string'
      || !isStringList(terms.roles) || !isStringRecord(terms.values, isStringList)) issues.push(`${at} has malformed terms`);
    if (!isRecord(answer) || !exactFields(answer, ['family', 'roles', 'values']) || typeof answer.family !== 'string'
      || !isStringRecord(answer.roles, item => typeof item === 'string')
      || !isStringRecord(answer.values, item => typeof item === 'string')) issues.push(`${at} has a malformed answer`);
    if (!(typeof confidence === 'number' && confidence >= 0 && confidence <= 1)) issues.push(`${at} has no confidence from 0 to 1`);
  });
  return issues;
};
