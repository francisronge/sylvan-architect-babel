const CURRENT_PROVENANCE_FIELDS = [
  'modelRoute',
  'framework',
  'language',
  'timestamp',
  'treeSource',
  'promptVersion',
  'parserVersion',
  'uiVersion',
  'payloadIntegrityFlags',
  'payloadRepairDiagnostics',
  'hasDerivationStages',
  'parsePromptTokenCount',
  'parseOutputTokenCount',
  'parseTotalTokenCount',
  'primaryPromptTokenCount',
  'primaryOutputTokenCount',
  'primaryTotalTokenCount'
];

const CURRENT_ANALYSIS_FIELDS = [
  'tree',
  'derivationStages',
  'provenance'
];

const CURRENT_BUNDLE_FIELDS = [
  'analyses',
  'ambiguityDetected',
  'ambiguityNote',
  'sentence',
  'requestedModelRoute',
  'requestedModelId',
  'requestedReasoningEffort',
  'modelUsed',
  'generationRecord',
  'rawModelOutput'
];

export const loadTreeBankBundleSnapshot = (bundle) => JSON.parse(JSON.stringify(bundle));

const projectFields = (source, fields) => {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  return fields.reduce((projected, field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) projected[field] = source[field];
    return projected;
  }, {});
};

const snapshotCurrentAnalysis = (analysis) => {
  const current = projectFields(analysis, CURRENT_ANALYSIS_FIELDS);
  if (current.provenance) {
    current.provenance = projectFields(current.provenance, CURRENT_PROVENANCE_FIELDS);
  }
  return current;
};

export const createTreeBankBundleSnapshot = (bundle) => {
  const snapshot = loadTreeBankBundleSnapshot(bundle);
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return snapshot;
  const current = projectFields(snapshot, CURRENT_BUNDLE_FIELDS);
  return {
    ...current,
    analyses: (Array.isArray(current.analyses) ? current.analyses : [])
      .map(snapshotCurrentAnalysis)
  };
};
