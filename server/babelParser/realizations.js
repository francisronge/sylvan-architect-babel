import { authoredWord } from './nodePronunciation.js';
import { normalizeSurfaceToken } from './surfaceTokens.js';
import { createFailure } from './validationErrors.js';

const reporter = (diagnostics, { stageIndex = null, fieldPath = '$' }) =>
  (path, value, expectedForm, ruleId = 'DERIVATION_REALIZATION_SHAPE') => diagnostics.push(createFailure({
    failureClass: 'contract_misunderstanding', ruleId, stageIndex,
    fieldPath: `${fieldPath}${path}`, offendingValue: value, expectedForm,
    processingStep: 'realization-alignment',
    message: `${fieldPath}${path}: expected ${expectedForm}.`
  }));

/** Shape checks also run before workspace expansion, so malformed originals remain inspectable. */
export const validateRealizations = (realizations, options = {}) => {
  const diagnostics = [];
  const report = reporter(diagnostics, options);
  if (!Array.isArray(realizations)) {
    report('.realizations', realizations, 'an array of realization groups');
    return diagnostics;
  }
  realizations.forEach((group, index) => {
    const path = `.realizations[${index}]`;
    if (!group || typeof group !== 'object' || Array.isArray(group)
      || Object.keys(group).length !== 2 || !Object.hasOwn(group, 'nodeIds') || !Object.hasOwn(group, 'tokenIndices')) {
      report(path, group, 'an object containing exactly nodeIds and tokenIndices');
      return;
    }
    for (const field of ['nodeIds', 'tokenIndices']) {
      const values = group[field];
      if (!Array.isArray(values) || values.length === 0) {
        report(`${path}.${field}`, values, 'a nonempty array');
        continue;
      }
      const seen = new Set();
      values.forEach((value, itemIndex) => {
        const valid = field === 'nodeIds' ? typeof value === 'string' && Boolean(value.trim())
          : Number.isInteger(value) && value >= 0;
        if (!valid) report(`${path}.${field}[${itemIndex}]`, value,
          field === 'nodeIds' ? 'a nonblank exact node ID' : 'a nonnegative integer input-token index');
        else if (seen.has(value)) report(`${path}.${field}[${itemIndex}]`, value, 'no repeated entry within this group');
        else if (field === 'tokenIndices' && itemIndex > 0 && value < values[itemIndex - 1]) {
          report(`${path}.${field}[${itemIndex}]`, value, 'input-token indices in ascending order');
        }
        seen.add(value);
      });
    }
  });
  return diagnostics;
};

/**
 * Resolve declared input coverage without changing syntax, spelling or pronunciation.
 * Partial stages validate established associations only. A complete stage must cover
 * every input token through groups plus ordinary leaves in their existing tree order.
 * A covered leaf's token set describes collective participation, not sole realization.
 */
export const resolveRealizations = (workspaceForest, realizations, sentenceTokens, options = {}) => {
  const diagnostics = validateRealizations(realizations, options);
  const report = reporter(diagnostics, options);
  const nodes = new Map();
  const leaves = [];
  const coveredLeafIds = new Set();
  const tokenIndicesByNodeId = new Map();
  const tokenAssignments = new Map();
  const claimedTokens = new Set();
  const result = { diagnostics, coveredLeafIds, tokenIndicesByNodeId, tokenAssignments };
  if (diagnostics.length > 0) return result;
  const hasInput = Array.isArray(sentenceTokens);
  const visit = (node, path, inheritedSilence = false) => {
    const silent = inheritedSilence || node.silent === true;
    const record = { node, path, silent, start: leaves.length, end: leaves.length };
    nodes.set(node.id, record);
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) leaves.push(record);
    else children.forEach((child, index) => visit(child, `${path}.children[${index}]`, silent));
    record.end = leaves.length;
  };
  workspaceForest.forEach((root, index) => visit(root, `.workspaceForest[${index}]`));
  const addCoverage = (id, indices) => {
    const coverage = tokenIndicesByNodeId.get(id) || new Set();
    indices.forEach((index) => coverage.add(index));
    tokenIndicesByNodeId.set(id, coverage);
  };
  realizations.forEach((group, groupIndex) => {
    const path = `.realizations[${groupIndex}]`;
    const sources = [];
    group.nodeIds.forEach((id, index) => {
      const source = nodes.get(id);
      if (!source) report(`${path}.nodeIds[${index}]`, id,
        'an exact node ID in this expanded workspace', 'DERIVATION_REALIZATION_SOURCE');
      else sources.push(source);
    });
    group.tokenIndices.forEach((index, itemIndex) => {
      if (hasInput && index >= sentenceTokens.length) report(`${path}.tokenIndices[${itemIndex}]`, index,
        `an input-token index below ${sentenceTokens.length}`, 'DERIVATION_REALIZATION_TOKEN');
      if (claimedTokens.has(index)) report(`${path}.tokenIndices[${itemIndex}]`, index,
        'an input token claimed by only one realization group', 'DERIVATION_REALIZATION_TOKEN');
      claimedTokens.add(index);
    });
    const participatingLeaves = new Map();
    sources.forEach(({ start, end }) => {
      for (let index = start; index < end; index += 1) {
        const leaf = leaves[index];
        if (!leaf.silent) participatingLeaves.set(leaf.node.id, leaf);
      }
    });
    if (sources.length > 0 && participatingLeaves.size === 0) report(`${path}.nodeIds`, group.nodeIds,
      'at least one source outside effective silence', 'DERIVATION_REALIZATION_SILENT');
    participatingLeaves.forEach(({ node }) => {
      coveredLeafIds.add(node.id);
      addCoverage(node.id, group.tokenIndices);
    });
  });

  const directOwners = new Map();
  nodes.forEach(({ node, path, silent }) => {
    if (!Object.hasOwn(node, 'tokenIndex')) return;
    const index = node.tokenIndex;
    const validIndex = Number.isInteger(index) && index >= 0 && (!hasInput || index < sentenceTokens.length);
    const overtLeaf = !silent && !(node.children?.length) && Boolean(authoredWord(node));
    if (!validIndex || !overtLeaf) {
      report(`${path}.tokenIndex`, index, 'a valid input-token index on a pronounced lexical leaf', 'DERIVATION_REALIZATION_DIRECT_INDEX');
      return;
    }
    if (directOwners.has(index)) report(`${path}.tokenIndex`, index,
      'a direct index used by only one pronounced terminal', 'DERIVATION_REALIZATION_DIRECT_INDEX');
    directOwners.set(index, node.id);
    if (hasInput && normalizeSurfaceToken(authoredWord(node)) !== normalizeSurfaceToken(sentenceTokens[index])) {
      report(`${path}.tokenIndex`, index, 'a direct index whose whole input token matches this word', 'DERIVATION_REALIZATION_DIRECT_INDEX');
    }
    if (coveredLeafIds.has(node.id)) {
      if (!tokenIndicesByNodeId.get(node.id)?.has(index)) report(`${path}.tokenIndex`, index,
        'a direct index included in this leaf\'s realization groups', 'DERIVATION_REALIZATION_DIRECT_INDEX');
    } else if (claimedTokens.has(index)) {
      report(`${path}.tokenIndex`, index, 'a token not already claimed by a realization group', 'DERIVATION_REALIZATION_DIRECT_INDEX');
    }
    tokenAssignments.set(node.id, index);
  });

  const ordinaryLeaves = leaves.filter(({ node, silent }) => !silent && authoredWord(node) && !coveredLeafIds.has(node.id));
  if (options.complete && hasInput) {
    const remaining = sentenceTokens.map((token, index) => ({ token, index })).filter(({ index }) => !claimedTokens.has(index));
    const matches = ordinaryLeaves.length === remaining.length && ordinaryLeaves.every(({ node }, index) =>
      normalizeSurfaceToken(authoredWord(node)) === normalizeSurfaceToken(remaining[index].token));
    if (!matches) report('.workspaceForest', {
      expectedRemainingTokens: remaining.map(({ token }) => token),
      observedRemainingWords: ordinaryLeaves.map(({ node }) => authoredWord(node))
    }, 'exact input coverage by realization groups and remaining ordinary leaves in tree order', 'DERIVATION_REALIZATION_COVERAGE');
    else ordinaryLeaves.forEach(({ node, path }, index) => {
      const tokenIndex = remaining[index].index;
      if (Object.hasOwn(node, 'tokenIndex') && node.tokenIndex !== tokenIndex) report(`${path}.tokenIndex`, node.tokenIndex,
        `the input-token index ${tokenIndex}`, 'DERIVATION_REALIZATION_DIRECT_INDEX');
      tokenAssignments.set(node.id, tokenIndex);
    });
  }
  tokenAssignments.forEach((index, id) => addCoverage(id, [index]));
  return result;
};
