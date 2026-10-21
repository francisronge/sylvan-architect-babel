/** Provenance fields that vary between otherwise identical normalizations. */
export const volatileProvenanceFields = Object.freeze([
  'timestamp',
  'promptVersion',
  'parserVersion',
  'uiVersion'
]);

/** Deletes the volatile provenance fields from each analysis in place and returns the bundle. */
export const stripVolatileProvenance = (bundle) => {
  for (const analysis of bundle.analyses || []) {
    if (!analysis.provenance || typeof analysis.provenance !== 'object') continue;
    for (const field of volatileProvenanceFields) {
      delete analysis.provenance[field];
    }
  }
  return bundle;
};
