import { normalizeSurfaceToken } from './surfaceTokens.js';
import {
  normalizeSurfaceSpan,
  normalizeTokenIndex,
  getLabelProfile
} from './treeBasics.js';
import { ParseApiError } from './error.js';
import { resolveOvertLeafSurface, isTraceLikeNode, isNullLikeNode } from './derivationHelpers.js';

// Empty heads such as Voice/T/v are structural placeholders until an overt
// word lands in them. Do not count them as sentence material.
const isBareEmptyStructuralHeadLeaf = (node) => {
  if (!node || typeof node !== 'object') return false;
  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length > 0) return false;
  if (String(node.word || '').trim()) return false;
  if (normalizeTokenIndex(node.tokenIndex, Number.POSITIVE_INFINITY) !== undefined) return false;
  if (normalizeSurfaceSpan(node.surfaceSpan)) return false;
  if (isTraceLikeNode(node) || isNullLikeNode(node)) return false;
  const rawLabel = String(node.label || '').trim();
  const profile = getLabelProfile(rawLabel);
  if (!profile.isHeadLikeStructural) return false;
  return rawLabel === rawLabel.toUpperCase() || /^[A-Z]/.test(rawLabel) || /^[cvtdnpaqi]$/i.test(rawLabel);
};

export const sameTokenSequence = (leftTokens, rightTokens) => {
  if (leftTokens.length !== rightTokens.length) return false;
  for (let index = 0; index < leftTokens.length; index += 1) {
    if (normalizeSurfaceToken(leftTokens[index]) !== normalizeSurfaceToken(rightTokens[index])) {
      return false;
    }
  }
  return true;
};

export const collectOvertTerminalNodes = (tree) => {
  const terminals = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
      if (surface && !isTraceLikeNode(node) && !isNullLikeNode(node) && !isBareEmptyStructuralHeadLeaf(node)) terminals.push(node);
      return;
    }
    children.forEach(visit);
  };
  visit(tree);
  return terminals;
};

export const deriveCanonicalSurfaceSpans = (tree) => {
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      throw new ParseApiError('BAD_MODEL_RESPONSE', 'Malformed tree node during surface-span normalization.', 502);
    }

    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const surface = normalizeSurfaceToken(resolveOvertLeafSurface(node));
      const overt = Boolean(surface) && !isTraceLikeNode(node) && !isNullLikeNode(node) && !isBareEmptyStructuralHeadLeaf(node);
      if (!overt) {
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
    children.forEach((child) => {
      const childSpan = visit(child);
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
