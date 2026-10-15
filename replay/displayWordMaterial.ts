import type { SyntaxNode } from '../types.ts';
import { caseSurfaceInitial } from '../server/babelParser/surfaceTokens.js';

/** Generated sentence casing belongs to a display child, not a new authored
 * word. Callers supply its connected owner, or its exact future-layout owner
 * during construction. Provenance establishes identity without revealing it. */
export function authoredDisplayWord(node: SyntaxNode, owner?: SyntaxNode): string | undefined {
  if (!owner?.word || node.replayOrigin?.kind !== 'word'
    || node.replayOrigin.ownerId !== owner.id || node.children?.length
    || node.word !== node.label
    || caseSurfaceInitial(node.word, 'lower') !== caseSurfaceInitial(owner.word, 'lower')) return;
  return owner.word;
}

/** Geometry retention normalizes generated initial casing only. Every authored
 * property remains part of the material identity, including pronunciation and
 * token ownership. This function never rewrites either occurrence. */
export function retainedSubtreeMaterial(node: SyntaxNode): string {
  const material = (current: SyntaxNode, parent?: SyntaxNode): SyntaxNode => {
    const word = authoredDisplayWord(current, parent);
    const next = word === undefined ? current : { ...current, word, label: word };
    return current.children ? { ...next, children: current.children.map(child => material(child, current)) } : next;
  };
  return JSON.stringify(material(node));
}
