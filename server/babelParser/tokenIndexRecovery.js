import { inspectDerivationWorkspaces } from './derivationCompiler.js';
import { authoredWord, collectPronouncedLeaves } from './nodePronunciation.js';
import { normalizeSurfaceToken } from './surfaceTokens.js';
import { sameTokenSequence } from './syntaxTree.js';

/** A failed optional address can be omitted only when the words independently
 * cover the input. Pronunciation groups and repeated-word addresses keep their
 * stricter ownership semantics. The caller must validate the candidate again. */
export const omitMismatchedOptionalTokenIndices = (analysis, inputTokens, fieldPath = '$') => {
  const stages = analysis?.derivationStages;
  if (!Array.isArray(stages) || !stages.length || stages.some(stage => stage.realizations?.length)) return null;
  const inspected = inspectDerivationWorkspaces(stages, { sentenceTokens: inputTokens });
  if (inspected.some(stage => !stage.workspaceForest || stage.diagnostics.length)) return null;
  const finalWords = inspected.at(-1).workspaceForest.flatMap(collectPronouncedLeaves).map(authoredWord);
  if (!sameTokenSequence(finalWords, inputTokens)) return null;

  const tokens = inputTokens.map(normalizeSurfaceToken), vocabulary = new Set(tokens);
  const candidate = structuredClone(analysis), corrections = [];
  let unsafe = false;
  const visit = (node, path, stageIndex, underSilentAncestor = false) => {
    if (Object.hasOwn(node, 'refId')) return;
    const silent = underSilentAncestor || node.silent === true;
    const children = Array.isArray(node.children) ? node.children : [];
    if (Object.hasOwn(node, 'tokenIndex')) {
      const index = node.tokenIndex, word = authoredWord(node), normalizedWord = normalizeSurfaceToken(word);
      if (!Number.isInteger(index) || index < 0 || index >= tokens.length
        || silent || children.length || !word || !vocabulary.has(normalizedWord)) {
        unsafe = true;
      } else if (normalizedWord !== tokens[index]) {
        corrections.push({ kind: 'omitted_mismatched_optional_token_index', stageIndex,
          fieldPath: `${path}.tokenIndex`, nodeId: node.id, word,
          authoredTokenIndex: index, inputTokenAtAuthoredIndex: inputTokens[index] });
        delete node.tokenIndex;
      }
    }
    children.forEach((child, index) => visit(child, `${path}.children[${index}]`, stageIndex, silent));
  };
  candidate.derivationStages.forEach((stage, stageIndex) => stage.workspaceForest.forEach((node, index) =>
    visit(node, `${fieldPath}.derivationStages[${stageIndex}].workspaceForest[${index}]`, stageIndex)));
  return unsafe || !corrections.length ? null : { candidate, corrections };
};
