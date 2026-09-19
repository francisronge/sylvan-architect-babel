import { findRelationRegistryEntry } from './relationRegistry.js';
import { bindRelationRoles } from './roleBinding.js';

const STRUCTURED_FIELDS = Object.freeze([
  'anchors',
  'priorAnchors',
  'values'
]);

const isRecord = (value) => (
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
);

const cloneAuthored = (value) => {
  if (Array.isArray(value)) return value.map(cloneAuthored);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneAuthored(item)])
  );
};

const authoredItems = (value, field) => {
  const permitsEmptyString = field === 'values';
  const validString = (item) => (
    typeof item === 'string'
    && (permitsEmptyString || item.trim().length > 0)
  );
  if (validString(value)) return { items: [value], valid: true };
  if (
    Array.isArray(value)
    && value.length > 0
    && value.every(validString)
  ) {
    return { items: [...value], valid: true };
  }
  return { items: [], valid: false };
};

const validateRoleValue = ({ field, role, rule, value }) => {
  const result = authoredItems(value, field);
  if (!result.valid) {
    return [{
      kind: 'invalid-role-value',
      field,
      role,
      offendingValue: cloneAuthored(value)
    }];
  }
  // A declared occurrence slot may count repeated exact IDs once. The authored
  // array, literal values and distinct positions sharing lineage stay intact.
  const count = field !== 'values' && rule.countDistinct
    ? new Set(result.items).size : result.items.length;
  if (
    count < rule.minItems
    || (rule.maxItems !== null && count > rule.maxItems)
  ) {
    return [{
      kind: 'invalid-arity',
      field,
      role,
      observedItems: count,
      minItems: rule.minItems,
      maxItems: rule.maxItems
    }];
  }
  return [];
};

const validateStructuredBlock = (relation, field, signature) => {
  const actual = relation[field];
  const issues = [];
  if (actual !== undefined && !isRecord(actual)) {
    return [{
      kind: 'invalid-block',
      field,
      offendingValue: cloneAuthored(actual)
    }];
  }
  const record = isRecord(actual) ? actual : {};

  Object.keys(signature.required).forEach((role) => {
    if (!Object.hasOwn(record, role)) {
      issues.push({ kind: 'missing-role', field, role });
    }
  });
  signature.requiredAny.forEach((roles) => {
    if (!roles.some((role) => Object.hasOwn(record, role))) {
      issues.push({ kind: 'missing-role-group', field, roles: [...roles] });
    }
  });
  if (
    signature.requiredAlternatives.length > 0
    && !signature.requiredAlternatives.some((alternative) => (
      alternative.every((roles) => roles.some((role) => Object.hasOwn(record, role)))
    ))
  ) {
    issues.push({
      kind: 'missing-role-alternative',
      field,
      alternatives: signature.requiredAlternatives.map((alternative) => (
        alternative.map((roles) => [...roles])
      ))
    });
  }
  signature.allOrNone.forEach((roles) => {
    const presentRoles = roles.filter((role) => Object.hasOwn(record, role));
    if (presentRoles.length > 0 && presentRoles.length < roles.length) {
      issues.push({
        kind: 'incomplete-role-group',
        field,
        roles: [...roles],
        presentRoles
      });
    }
  });
  signature.sameLength.forEach((roles) => {
    const present = roles
      .filter((role) => Object.hasOwn(record, role))
      .map((role) => ({ role, result: authoredItems(record[role], field) }));
    if (
      present.length === roles.length
      && present.every(({ result }) => result.valid)
      && new Set(present.map(({ result }) => result.items.length)).size > 1
    ) {
      issues.push({
        kind: 'unequal-role-lengths',
        field,
        roles: [...roles],
        observedItems: Object.fromEntries(
          present.map(({ role, result }) => [role, result.items.length])
        )
      });
    }
  });
  const presentItems = Object.values(record).reduce((count, value) => (
    count + (Array.isArray(value) ? value.length : value === undefined ? 0 : 1)
  ), 0);
  if (presentItems < signature.minPresentItems) {
    issues.push({
      kind: 'insufficient-items',
      field,
      observedItems: presentItems,
      minPresentItems: signature.minPresentItems
    });
  }

  Object.entries(record).forEach(([role, value]) => {
    const rule = signature.required[role] ?? signature.optional[role];
    if (!rule) {
      if (!signature.allowAdditional && !signature.allowContext) {
        issues.push({ kind: 'unexpected-role', field, role });
      }
      return;
    }
    issues.push(...validateRoleValue({ field, role, rule, value }));
  });

  return issues;
};

const authoredRows = (relation, field) => {
  const record = relation[field];
  if (!isRecord(record)) return [];
  return Object.entries(record).flatMap(([role, value]) => {
    const result = authoredItems(value, field);
    if (!result.valid) return [];
    return [{
      kind: field === 'values' ? 'value-row' : 'witness-row',
      field,
      role,
      values: result.items,
      provenance: {
        classification: 'authored',
        field,
        role
      }
    }];
  });
};

export const buildLiteralRelationDisplays = ({
  relation,
  stageIndex,
  relationIndex
}) => {
  if (!isRecord(relation)) throw new TypeError('relation must be an object.');
  if (typeof relation.relation !== 'string' || !relation.relation.trim()) {
    throw new TypeError('relation.relation must be a non-empty string.');
  }
  const displays = [];
  displays.push({
    kind: 'relation-name',
    text: relation.relation,
    provenance: {
      classification: 'authored',
      field: 'relation'
    }
  });
  STRUCTURED_FIELDS.forEach((field) => {
    displays.push(...authoredRows(relation, field));
  });
  if (Number.isInteger(relationIndex) && relationIndex >= 0) {
    displays.push({
      kind: 'ordinal-badge',
      ordinal: relationIndex + 1,
      provenance: {
        classification: 'derived-presentation',
        inputs: ['relationIndex']
      }
    });
  }
  if (Number.isInteger(stageIndex) && stageIndex >= 0) {
    displays.push({
      kind: 'stage-timing-badge',
      stageNumber: stageIndex + 1,
      provenance: {
        classification: 'derived-presentation',
        inputs: ['stageIndex']
      }
    });
  }
  return displays;
};

const readLicensedField = (relation, license) => {
  if (license.field === 'relation') {
    return typeof relation.relation === 'string'
      ? { present: true, value: relation.relation }
      : { present: false };
  }
  const block = relation[license.field];
  if (!isRecord(block) || !Object.hasOwn(block, license.key)) {
    return { present: false };
  }
  return {
    present: true,
    value: cloneAuthored(block[license.key])
  };
};

const licenseMarks = ({
  entry,
  relation,
  registry,
  stageIndex,
  relationIndex
}) => {
  const licensedMarks = [];
  const omittedMarks = [];
  entry.marks.forEach((mark) => {
    const licensingFields = mark.licenses.map((license) => ({
      ...license,
      ...readLicensedField(relation, license)
    }));
    const missingLicenses = licensingFields
      .filter((field) => !field.present)
      .map(({ field, key }) => ({ field, ...(key ? { key } : {}) }));
    if (missingLicenses.length > 0) {
      omittedMarks.push({
        markId: mark.id,
        missingLicenses
      });
      return;
    }
    licensedMarks.push({
      markId: mark.id,
      provenance: {
        registryId: registry.registryId,
        registryVersion: registry.version,
        registryEntryId: entry.id,
        registryEntryVersion: entry.version,
        relationInstance: {
          stageIndex,
          relationIndex
        },
        licensingFields: licensingFields.map(({ present, ...field }) => field)
      }
    });
  });
  return { licensedMarks, omittedMarks };
};

export const dispatchRelation = ({
  registry,
  relation,
  stageIndex,
  relationIndex,
  currentForest = undefined,
  priorForest = undefined
}) => {
  if (!Number.isInteger(stageIndex) || stageIndex < 0) {
    throw new TypeError('stageIndex must be a non-negative integer.');
  }
  if (!Number.isInteger(relationIndex) || relationIndex < 0) {
    throw new TypeError('relationIndex must be a non-negative integer.');
  }
  const literalDisplays = buildLiteralRelationDisplays({
    relation,
    stageIndex,
    relationIndex
  });
  const authoredName = relation.relation;
  const entry = findRelationRegistryEntry(registry, authoredName);
  const base = {
    registryId: registry.registryId,
    registryVersion: registry.version,
    authoredRelationName: authoredName,
    relationInstance: { stageIndex, relationIndex },
    literalDisplays,
    boundRelation: relation,
    roleBindings: []
  };
  if (!entry) {
    return {
      ...base,
      outcome: 'unregistered',
      signatureIssues: [],
      licensedMarks: [],
      omittedMarks: []
    };
  }

  const binding = bindRelationRoles(relation, entry, currentForest, priorForest);
  const bindingBase = { ...base, boundRelation: binding.relation, roleBindings: binding.bindings };
  const signatureIssues = [...binding.issues, ...STRUCTURED_FIELDS.flatMap((field) => (
    validateStructuredBlock(binding.relation, field, entry.signature[field])
  ))];
  if (signatureIssues.length > 0) {
    return {
      ...bindingBase,
      outcome: 'signature-incomplete',
      registryEntryId: entry.id,
      registryEntryVersion: entry.version,
      signatureIssues,
      licensedMarks: [],
      omittedMarks: entry.marks.map((mark) => ({
        markId: mark.id,
        reason: 'signature-incomplete'
      }))
    };
  }

  const { licensedMarks, omittedMarks } = licenseMarks({
    entry,
    relation: binding.relation,
    registry,
    stageIndex,
    relationIndex
  });
  return {
    ...bindingBase,
    outcome: 'resolved',
    registryEntryId: entry.id,
    registryEntryVersion: entry.version,
    signatureIssues: [],
    licensedMarks,
    omittedMarks
  };
};

export const summarizeUnregisteredRelations = (dispatchResults) => {
  if (!Array.isArray(dispatchResults)) {
    throw new TypeError('dispatchResults must be an array.');
  }
  const counts = new Map();
  dispatchResults.forEach((result) => {
    if (result?.outcome !== 'unregistered') return;
    const name = result.authoredRelationName;
    if (typeof name !== 'string') return;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
  return Array.from(counts, ([relation, count]) => ({ relation, count }));
};
