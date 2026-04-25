import { NOTES_RAW_JSON_ONLY_INSTRUCTION } from './systemInstruction.js';

const normalizeOptionalText = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed || '';
};

const pruneEmptyPromptContext = (value) => {
  if (Array.isArray(value)) {
    const next = value
      .map((item) => pruneEmptyPromptContext(item))
      .filter((item) => typeof item !== 'undefined');
    return next.length > 0 ? next : undefined;
  }

  if (value && typeof value === 'object') {
    const next = Object.entries(value).reduce((acc, [key, entry]) => {
      const pruned = pruneEmptyPromptContext(entry);
      if (typeof pruned !== 'undefined') {
        acc[key] = pruned;
      }
      return acc;
    }, {});
    return Object.keys(next).length > 0 ? next : undefined;
  }

  if (typeof value === 'string') {
    return value.trim() ? value : undefined;
  }

  if (value === null || typeof value === 'undefined') return undefined;
  return value;
};

export const buildNotesSecondPassFrozenAnalysis = (analysis = {}) => (
  pruneEmptyPromptContext({
    derivationStages: analysis.derivationStages || [],
    growthFrames: analysis.growthFrames || [],
    derivationSteps: analysis.derivationSteps || [],
    movementEvents: analysis.movementEvents || [],
    chains: analysis.chains || [],
    commitmentFacts: analysis.commitmentFacts || analysis.commitmentGraph || [],
    surfaceOrder: analysis.surfaceOrder || [],
    framework: analysis.provenance?.framework,
    treeSource: analysis.provenance?.treeSource,
    completenessStatus: analysis.completenessStatus
  }) || {}
);

export const buildNotesSecondPassSupportInventory = (
  analysis = {},
  { normalizeChainType }
) => {
  const normalizedCommitmentFacts = (Array.isArray(analysis.commitmentFacts || analysis.commitmentGraph) ? (analysis.commitmentFacts || analysis.commitmentGraph) : [])
    .map((entry) => {
      const factId = normalizeOptionalText(entry?.factId || entry?.id);
      const family = normalizeOptionalText(entry?.family || entry?.kind);
      const subtype = normalizeOptionalText(entry?.subtype);
      const frameworkLabel = normalizeOptionalText(entry?.frameworkLabel);
      return factId && family ? { factId, family, subtype, frameworkLabel } : null;
    })
    .filter(Boolean);

  const commitmentFactIds = normalizedCommitmentFacts.map((entry) => entry.factId);

  const chains = (Array.isArray(analysis.chains) ? analysis.chains : [])
    .map((chain) => ({
      chainId: normalizeOptionalText(chain?.chainId || chain?.id),
      type: normalizeOptionalText(chain?.type),
      family: normalizeChainType(chain?.family || chain?.type) || undefined
    }))
    .filter((entry) => entry.chainId);

  return pruneEmptyPromptContext({
    chains,
    commitmentFacts: normalizedCommitmentFacts,
    commitmentFactIds
  }) || {};
};

export const buildNotesSecondPassPrompt = (
  sentence,
  framework = 'xbar',
  analysis = {},
  { normalizeChainType }
) => {
  const frozenAnalysis = buildNotesSecondPassFrozenAnalysis(analysis);
  const supportInventory = buildNotesSecondPassSupportInventory(analysis, { normalizeChainType });
  return (
    `${NOTES_RAW_JSON_ONLY_INSTRUCTION} ` +
    `commitmentFacts are the primary fact layer in the frozen analysis. ` +
    `Support is note-local, not global. If a note makes a public claim, that same note must carry the matching commitmentFactIds. ` +
    `Movement language belongs in chain notes and those notes must carry chainId plus stepIds and/or nodeIds. ` +
    `If a note names a specific subtype or structural generalization, use that label only when the frozen analysis exposes matching support. If that support is absent, rewrite the note structurally and avoid the unsupported label. ` +
    `If a note claims a stable linearization pattern, cite matching commitmentFactIds whose family is "linearization" when the frozen analysis exposes them; otherwise anchor that claim directly to the relevant stepIds, nodeIds, and/or chainId and keep the claim narrow. ` +
    `If a note cannot satisfy those support obligations, rewrite it more simply instead of returning an unsupported claim. ` +
    `The first returned noteBinding must have kind "architecture" and must summarize only the final committed clause architecture and supported structural commitments from the frozen derivation. Do not use the architecture note as a spellout summary or a generic wrap-up sentence. ` +
    `Architecture notes should stay structural. If an architecture note mentions selection, embedding, dependency, or other public facts, attach the matching commitmentFactIds on that same architecture note and do not mention unsupported claims. ` +
    `After the architecture note, include one note per major encoded movement dependency when present, optional additional structural notes for supported non-movement facts, and optional closure only if it adds no new technical claim. Prefer 3-6 noteBindings total. ` +
    `Frozen support inventory JSON:\n${JSON.stringify({ framework, sentence, supportInventory })}\n` +
    `Frozen committed analysis JSON:\n${JSON.stringify({ framework, sentence, analysis: frozenAnalysis })}`
  );
};
