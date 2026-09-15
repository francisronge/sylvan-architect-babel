import { normalizeSurfaceToken } from './surfaceTokens.js';
import { normalizeTokenIndex } from './treeBasics.js';
import { ParseApiError } from './error.js';
import { collectPronouncedLeaves, isPronouncedLeafWithin } from './nodePronunciation.js';

export const sameTokenSequence = (leftTokens, rightTokens) => {
  if (leftTokens.length !== rightTokens.length) return false;
  for (let index = 0; index < leftTokens.length; index += 1) {
    if (normalizeSurfaceToken(leftTokens[index]) !== normalizeSurfaceToken(rightTokens[index])) {
      return false;
    }
  }
  return true;
};

// Pronunciation is an authored-field decision, inherited from silent
// ancestors; see nodePronunciation.js.
export const collectOvertTerminalNodes = (tree) => collectPronouncedLeaves(tree);

export const deriveCanonicalSurfaceSpans = (tree, realizedTokenIndices) => {
  if (realizedTokenIndices) {
    const visit = (node) => {
      const indices = new Set(realizedTokenIndices.get(node.id) || []);
      (node.children || []).forEach((child) => visit(child).forEach((index) => indices.add(index)));
      const ordered = [...indices].sort((a, b) => a - b);
      // A range cannot faithfully describe a discontinuous association.
      if (ordered.length && ordered.at(-1) - ordered[0] + 1 === ordered.length) {
        node.surfaceSpan = [ordered[0], ordered.at(-1)];
      } else delete node.surfaceSpan;
      return indices;
    };
    visit(tree);
    return tree;
  }
  const visit = (node, underSilentAncestor = false) => {
    if (!node || typeof node !== 'object') {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed tree node during surface-span normalization.', 502);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      if (!isPronouncedLeafWithin(node, underSilentAncestor)) {
        delete node.surfaceSpan;
        return null;
      }

      const tokenIndex = normalizeTokenIndex(node.tokenIndex, Number.POSITIVE_INFINITY);
      if (tokenIndex === undefined) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Overt leaves must carry tokenIndex after sentence anchoring.', 502);
      }
      node.surfaceSpan = [tokenIndex, tokenIndex];
      return node.surfaceSpan;
    }

    const childSpans = [];
    const silentHere = underSilentAncestor || node.silent === true;
    children.forEach((child) => {
      const childSpan = visit(child, silentHere);
      if (childSpan) childSpans.push(childSpan);
    });

    if (childSpans.length === 0) {
      delete node.surfaceSpan;
      return null;
    }

    for (let index = 1; index < childSpans.length; index += 1) {
      if (childSpans[index - 1][0] > childSpans[index][0]) {
        throw new ParseApiError('BAD_MODEL_RESPONSE', 'Children arrays do not follow ascending surface-span order.', 502);
      }
    }

    node.surfaceSpan = [childSpans[0][0], childSpans[childSpans.length - 1][1]];
    return node.surfaceSpan;
  };

  visit(tree);
  return tree;
};
