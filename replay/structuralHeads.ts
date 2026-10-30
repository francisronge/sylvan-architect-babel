/** Heads read from the shape of a tree, never from what a label is called.
 *
 * A node is minimal when it is a leaf, or a complex head: a node whose label
 * writes no level and whose daughters are all minimal. A head is a minimal node
 * whose label writes no phrase or bar level (a "DP" trace leaf stays a phrase)
 * standing in head position: it carries its parent's category, sits inside a
 * complex head, or is the one minimal daughter of an X′ that no daughter
 * projects (a head trace "t" under V′). A one-word specifier or argument
 * ("Mia" in Spec,CP) is a phrase. In a tree written in bare labels a head and a small phrase look alike
 * ([T D T]), so there the Bare Phrase Structure reader decides. Category names
 * never matter: Voice, Appl, Foc, Fin and K are read exactly like T. */
import type { SyntaxNode } from '../types.ts';
import { readCategoryLabel } from './categoryLabel.ts';
import { readStructuralProjections, writesProjectionLevels } from './projectionStructure.ts';

type ShapeNode = Pick<SyntaxNode, 'label' | 'children' | 'lineageId'>;

const childrenOf = (node: ShapeNode): ShapeNode[] => Array.isArray(node.children) ? node.children : [];
// A prime marks an intermediate projection even where the category reader
// cannot parse the label (&′).
const PRIME = /[′’']\s*$/u;
// Notation the category reader leaves alone still writes a level: a lower
// occurrence ("DP trace", "T-copy"), a full-width gloss ("DP（代词）") and a
// prose level ("N-bar", "T projection").
const LOWER_OCCURRENCE = /^(\S+)[\s-]+(?:trace|copy)$/iu;
const GLOSSED = /^(\S+?)\s*[（(][^（）()]*[）)]$/u;
const PROSE_LEVEL = /^[A-Za-z\p{Script=Greek}]+[\s-]+(projection|phrase|bar)\b/iu;
const readShape = (node: ShapeNode) => {
  const label = String(node.label ?? '').trim();
  return readCategoryLabel(label) ?? readCategoryLabel(LOWER_OCCURRENCE.exec(label)?.[1])
    ?? readCategoryLabel(GLOSSED.exec(label)?.[1]);
};
const writtenLevel = (node: ShapeNode): 'head' | 'bar' | 'phrase' | undefined => {
  const label = String(node.label ?? '').trim();
  const prose = PROSE_LEVEL.exec(label)?.[1]?.toLowerCase();
  if (prose) return prose === 'phrase' ? 'phrase' : 'bar';
  return readShape(node)?.kind ?? (PRIME.test(label) ? 'bar' : undefined);
};
const projects = (child: ShapeNode, parent: ShapeNode): boolean => {
  const category = readShape(parent)?.head;
  return Boolean(category) && readShape(child)?.head === category;
};
const writesHeadLevel = (node: ShapeNode): boolean => {
  const kind = writtenLevel(node);
  return kind !== 'phrase' && kind !== 'bar';
};

export interface StructuralHeads {
  /** Whether `node` is a head: a leaf, or a complex head, whose label writes
   * no phrase or bar level (a "DP" trace leaf is a phrase). */
  isHead: (node: ShapeNode) => boolean;
  /** The Bare Phrase Structure reader's answer where it gives one, else isHead. */
  isHeadPosition: (node: ShapeNode) => boolean;
}

/** Read heads for one forest. Every node passed in later must belong to it. */
export const readStructuralHeads = (roots: readonly ShapeNode[]): StructuralHeads => {
  // Only a forest that writes no level at all is left to structure here: once
  // labels write XP, a label without P is the author's head level.
  const bare = writesProjectionLevels(roots) ? undefined : readStructuralProjections(roots);
  const parents = new Map<ShapeNode, ShapeNode>();
  const index = (node: ShapeNode): void => childrenOf(node).forEach(child => { parents.set(child, node); index(child); });
  roots.forEach(index);
  const cache = new Map<ShapeNode, boolean>();
  const minimal = (node: ShapeNode): boolean => {
    const children = childrenOf(node);
    if (!children.length) return true;
    const cached = cache.get(node);
    if (cached !== undefined) return cached;
    const value = bare ? bare.minimal(node) : writesHeadLevel(node) && children.every(minimal);
    cache.set(node, value);
    return value;
  };
  const inHeadPosition = (node: ShapeNode): boolean => {
    const parent = parents.get(node);
    if (!parent || projects(node, parent) || isHead(parent)) return true;
    const daughters = childrenOf(parent);
    if (writtenLevel(parent) !== 'bar' || daughters.some(daughter => projects(daughter, parent))) return false;
    const heads = daughters.filter(daughter => writesHeadLevel(daughter) && minimal(daughter));
    return heads.length === 1 && heads[0] === node;
  };
  const isHead = (node: ShapeNode): boolean => writesHeadLevel(node) && minimal(node) && inHeadPosition(node);
  const isHeadPosition = (node: ShapeNode): boolean => {
    const structural = bare?.positionKind(node);
    return structural ? structural === 'head' : isHead(node);
  };
  return { isHead, isHeadPosition };
};
