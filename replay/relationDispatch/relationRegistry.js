const IDENTITY_NORMALIZATIONS = new Set([
  'exact',
  'case',
  'whitespace',
  'case-whitespace'
]);

const SIGNATURE_FIELDS = Object.freeze([
  'anchors',
  'priorAnchors',
  'values'
]);

const ENTRY_FIELDS = Object.freeze([
  'id',
  'version',
  'identities',
  'signature',
  'marks'
]);

const isRecord = (value) => (
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
);

const requireNonemptyText = (value, path) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const normalizeIdentity = (value, normalization) => {
  let normalized = value;
  if (normalization.includes('whitespace')) {
    normalized = normalized.trim().replace(/\s+/gu, ' ');
  }
  if (normalization.includes('case')) {
    normalized = normalized.toLowerCase();
  }
  return normalized;
};

const normalizeRoleRules = (value, path) => {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new TypeError(`${path} must be an object.`);

  return Object.fromEntries(Object.entries(value).map(([role, rule]) => {
    requireNonemptyText(role, `${path} role`);
    if (!isRecord(rule)) throw new TypeError(`${path}.${role} must be an object.`);
    const minItems = rule.minItems ?? 1;
    const maxItems = rule.maxItems ?? null;
    if (!Number.isInteger(minItems) || minItems < 0) {
      throw new TypeError(`${path}.${role}.minItems must be a non-negative integer.`);
    }
    if (
      maxItems !== null
      && (!Number.isInteger(maxItems) || maxItems < minItems)
    ) {
      throw new TypeError(
        `${path}.${role}.maxItems must be null or an integer not below minItems.`
      );
    }
    if (rule.aliases !== undefined && (!Array.isArray(rule.aliases)
      || !rule.aliases.every(alias => typeof alias === 'string' && alias.trim()))) {
      throw new TypeError(`${path}.${role}.aliases must be an array of non-empty strings.`);
    }
    if (rule.concept !== undefined) requireNonemptyText(rule.concept, `${path}.${role}.concept`);
    return [role, { minItems, maxItems,
      ...(rule.aliases ? { aliases: [...new Set(rule.aliases)] } : {}),
      ...(rule.concept ? { concept: rule.concept } : {})
    }];
  }));
};

const normalizeRequiredAny = (value, path, declaredRoles, allowAdditional) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);

  return value.map((group, groupIndex) => {
    const groupPath = `${path}[${groupIndex}]`;
    if (!Array.isArray(group) || group.length === 0) {
      throw new TypeError(`${groupPath} must be a non-empty array.`);
    }
    const normalized = group.map((role, roleIndex) => (
      requireNonemptyText(role, `${groupPath}[${roleIndex}]`)
    ));
    if (new Set(normalized).size !== normalized.length) {
      throw new TypeError(`${groupPath} cannot repeat a role.`);
    }
    if (!allowAdditional) {
      const undeclared = normalized.find((role) => !declaredRoles.has(role));
      if (undeclared) {
        throw new TypeError(`${groupPath} names undeclared role ${undeclared}.`);
      }
    }
    return normalized;
  });
};

const normalizeRoleGroups = (
  value,
  path,
  declaredRoles,
  allowAdditional,
  { minGroups = 1, minRoles = 1 } = {}
) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  if (value.length < minGroups) {
    throw new TypeError(`${path} must contain at least ${minGroups} group(s).`);
  }

  return value.map((group, groupIndex) => {
    const groupPath = `${path}[${groupIndex}]`;
    if (!Array.isArray(group) || group.length < minRoles) {
      throw new TypeError(`${groupPath} must contain at least ${minRoles} role(s).`);
    }
    const normalized = group.map((role, roleIndex) => (
      requireNonemptyText(role, `${groupPath}[${roleIndex}]`)
    ));
    if (new Set(normalized).size !== normalized.length) {
      throw new TypeError(`${groupPath} cannot repeat a role.`);
    }
    if (!allowAdditional) {
      const undeclared = normalized.find((role) => !declaredRoles.has(role));
      if (undeclared) {
        throw new TypeError(`${groupPath} names undeclared role ${undeclared}.`);
      }
    }
    return normalized;
  });
};

const normalizeRequiredAlternatives = (
  value,
  path,
  declaredRoles,
  allowAdditional
) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty array.`);
  }
  return value.map((alternative, alternativeIndex) => normalizeRoleGroups(
    alternative,
    `${path}[${alternativeIndex}]`,
    declaredRoles,
    allowAdditional
  ));
};

const normalizeSignatureBlock = (value, path) => {
  const block = value ?? {};
  if (!isRecord(block)) throw new TypeError(`${path} must be an object.`);
  const unexpected = Object.keys(block).filter(
    (key) => ![
      'required',
      'optional',
      'requiredAny',
      'requiredAlternatives',
      'allOrNone',
      'sameLength',
      'minPresentItems',
      'allowAdditional',
      'allowContext'
    ].includes(key)
  );
  if (unexpected.length > 0) {
    throw new TypeError(`${path} has unsupported fields: ${unexpected.join(', ')}.`);
  }
  const required = normalizeRoleRules(block.required, `${path}.required`);
  const optional = normalizeRoleRules(block.optional, `${path}.optional`);
  const duplicate = Object.keys(required).find((role) => Object.hasOwn(optional, role));
  if (duplicate) throw new TypeError(`${path}.${duplicate} cannot be required and optional.`);
  if (
    block.allowAdditional !== undefined
    && typeof block.allowAdditional !== 'boolean'
  ) {
    throw new TypeError(`${path}.allowAdditional must be boolean.`);
  }
  const allowAdditional = block.allowAdditional === true;
  if (block.allowContext !== undefined && typeof block.allowContext !== 'boolean') {
    throw new TypeError(`${path}.allowContext must be boolean.`);
  }
  const declaredRoles = new Set([...Object.keys(required), ...Object.keys(optional)]);
  const requiredAny = normalizeRequiredAny(
    block.requiredAny,
    `${path}.requiredAny`,
    declaredRoles,
    allowAdditional
  );
  const requiredAlternatives = normalizeRequiredAlternatives(
    block.requiredAlternatives,
    `${path}.requiredAlternatives`,
    declaredRoles,
    allowAdditional
  );
  const allOrNone = normalizeRoleGroups(
    block.allOrNone,
    `${path}.allOrNone`,
    declaredRoles,
    allowAdditional,
    { minRoles: 2 }
  );
  const sameLength = normalizeRoleGroups(
    block.sameLength,
    `${path}.sameLength`,
    declaredRoles,
    allowAdditional,
    { minRoles: 2 }
  );
  const minPresentItems = block.minPresentItems ?? 0;
  if (!Number.isInteger(minPresentItems) || minPresentItems < 0) {
    throw new TypeError(`${path}.minPresentItems must be a non-negative integer.`);
  }
  return {
    required,
    optional,
    requiredAny,
    requiredAlternatives,
    allOrNone,
    sameLength,
    minPresentItems,
    allowAdditional,
    allowContext: block.allowContext === true
  };
};

const normalizeLicense = (value, path) => {
  if (!isRecord(value)) throw new TypeError(`${path} must be an object.`);
  const field = requireNonemptyText(value.field, `${path}.field`);
  if (field === 'relation') {
    if (Object.keys(value).length !== 1) {
      throw new TypeError(`${path} relation licenses cannot have a key.`);
    }
    return { field };
  }
  if (!SIGNATURE_FIELDS.includes(field)) {
    throw new TypeError(`${path}.field must name relation or a structured relation field.`);
  }
  const key = requireNonemptyText(value.key, `${path}.key`);
  if (Object.keys(value).some((item) => !['field', 'key'].includes(item))) {
    throw new TypeError(`${path} has unsupported fields.`);
  }
  return { field, key };
};

const normalizeEntry = (entry, entryIndex) => {
  const path = `entries[${entryIndex}]`;
  if (!isRecord(entry)) throw new TypeError(`${path} must be an object.`);
  const unexpectedEntryFields = Object.keys(entry).filter(
    (key) => !ENTRY_FIELDS.includes(key)
  );
  if (unexpectedEntryFields.length > 0) {
    throw new TypeError(
      `${path} has unsupported fields: ${unexpectedEntryFields.join(', ')}.`
    );
  }
  const id = requireNonemptyText(entry.id, `${path}.id`);
  const version = requireNonemptyText(entry.version, `${path}.version`);
  if (!Array.isArray(entry.identities) || entry.identities.length === 0) {
    throw new TypeError(`${path}.identities must be a non-empty array.`);
  }
  const identities = entry.identities.map((identity, identityIndex) => {
    const identityPath = `${path}.identities[${identityIndex}]`;
    if (!isRecord(identity)) throw new TypeError(`${identityPath} must be an object.`);
    const unexpectedIdentityFields = Object.keys(identity).filter(
      (key) => !['name', 'normalization'].includes(key)
    );
    if (unexpectedIdentityFields.length > 0) {
      throw new TypeError(`${identityPath} has unsupported fields.`);
    }
    const name = requireNonemptyText(identity.name, `${identityPath}.name`);
    const normalization = identity.normalization ?? 'exact';
    if (!IDENTITY_NORMALIZATIONS.has(normalization)) {
      throw new TypeError(`${identityPath}.normalization is not supported.`);
    }
    return { name, normalization };
  });

  const signatureInput = entry.signature ?? {};
  if (!isRecord(signatureInput)) throw new TypeError(`${path}.signature must be an object.`);
  const unexpectedSignatureFields = Object.keys(signatureInput).filter(
    (key) => !SIGNATURE_FIELDS.includes(key)
  );
  if (unexpectedSignatureFields.length > 0) {
    throw new TypeError(
      `${path}.signature has unsupported fields: ${unexpectedSignatureFields.join(', ')}.`
    );
  }
  const signature = Object.fromEntries(
    SIGNATURE_FIELDS.map((field) => [
      field,
      normalizeSignatureBlock(signatureInput[field], `${path}.signature.${field}`)
    ])
  );

  if (entry.marks !== undefined && !Array.isArray(entry.marks)) {
    throw new TypeError(`${path}.marks must be an array.`);
  }
  const marks = (entry.marks ?? []).map((mark, markIndex) => {
    const markPath = `${path}.marks[${markIndex}]`;
    if (!isRecord(mark)) throw new TypeError(`${markPath} must be an object.`);
    if (Object.keys(mark).some((key) => !['id', 'licenses'].includes(key))) {
      throw new TypeError(`${markPath} has unsupported fields.`);
    }
    const markId = requireNonemptyText(mark.id, `${markPath}.id`);
    if (!Array.isArray(mark.licenses) || mark.licenses.length === 0) {
      throw new TypeError(`${markPath}.licenses must be a non-empty array.`);
    }
    return {
      id: markId,
      licenses: mark.licenses.map((license, licenseIndex) => (
        normalizeLicense(license, `${markPath}.licenses[${licenseIndex}]`)
      ))
    };
  });

  const duplicateMark = marks.find(
    (mark, index) => marks.findIndex((candidate) => candidate.id === mark.id) !== index
  );
  if (duplicateMark) throw new TypeError(`${path} repeats mark id ${duplicateMark.id}.`);
  marks.forEach((mark) => {
    mark.licenses.forEach((license) => {
      if (license.field === 'relation') return;
      const block = signature[license.field];
      const declared = Object.hasOwn(block.required, license.key)
        || Object.hasOwn(block.optional, license.key);
      if (!declared && !block.allowAdditional) {
        throw new TypeError(
          `${path} mark ${mark.id} licenses undeclared ${license.field} role ${license.key}.`
        );
      }
    });
  });

  return { id, version, identities, signature, marks };
};

export const createRelationRegistry = ({
  registryId,
  version,
  entries = []
}) => {
  requireNonemptyText(registryId, 'registryId');
  requireNonemptyText(version, 'version');
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array.');

  const normalizedEntries = entries.map(normalizeEntry);
  const entryIds = new Set();
  const identityKeys = new Set();
  const matchers = [];

  normalizedEntries.forEach((entry) => {
    if (entryIds.has(entry.id)) throw new TypeError(`Duplicate registry entry id: ${entry.id}.`);
    entryIds.add(entry.id);
    entry.identities.forEach((identity) => {
      const normalizedName = normalizeIdentity(identity.name, identity.normalization);
      const identityKey = `${identity.normalization}\u0000${normalizedName}`;
      if (identityKeys.has(identityKey)) {
        throw new TypeError(
          `Duplicate registry identity under ${identity.normalization}: ${identity.name}.`
        );
      }
      identityKeys.add(identityKey);
      matchers.push({
        entryId: entry.id,
        normalization: identity.normalization,
        normalizedName
      });
    });
  });

  return deepFreeze({
    registryId,
    version,
    entries: normalizedEntries,
    matchers
  });
};

export const findRelationRegistryEntry = (registry, authoredName) => {
  if (!registry || !Array.isArray(registry.entries) || !Array.isArray(registry.matchers)) {
    throw new TypeError('registry must be created by createRelationRegistry.');
  }
  if (typeof authoredName !== 'string') return null;
  const matchingEntryIds = new Set(
    registry.matchers
      .filter((candidate) => (
        normalizeIdentity(authoredName, candidate.normalization) === candidate.normalizedName
      ))
      .map(({ entryId }) => entryId)
  );
  if (matchingEntryIds.size > 1) {
    throw new TypeError(`Ambiguous registry identity for authored relation: ${authoredName}.`);
  }
  const [entryId] = matchingEntryIds;
  return entryId
    ? registry.entries.find((entry) => entry.id === entryId) ?? null
    : null;
};
