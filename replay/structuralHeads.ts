/** Heads read from the shape of a tree, never from what a label is called.
 *
 * A node is minimal when it is a leaf, or a complex head: a node whose label
 * writes no level and whose daughters are all minimal. A head is a minimal node
 * whose label writes no phrase or bar level, so a "DP" trace leaf stays a
 * phrase. In a tree written in bare labels a head and a small phrase look alike
 * ([T D T]), so there the Bare Phrase Structure reader decides. Category names
 * never matter: Voice, Appl, Foc, Fin and K are read exactly like T. */
import type { SyntaxNode } from '../types.ts';
import { readCategoryLabel } from './categoryLabel.ts';
import { readBareProjections } from './projectionStructure.ts';

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
const writtenLevel = (node: ShapeNode): 'head' | 'bar' | 'phrase' | undefined => {
  const label = String(node.label ?? '').trim();
  const prose = PROSE_LEVEL.exec(label)?.[1]?.toLowerCase();
  if (prose) return prose === 'phrase' ? 'phrase' : 'bar';
  return (readCategoryLabel(label) ?? readCategoryLabel(LOWER_OCCURRENCE.exec(label)?.[1])
    ?? readCategoryLabel(GLOSSED.exec(label)?.[1]))?.kind ?? (PRIME.test(label) ? 'bar' : undefined);
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
  const bare = readBareProjections(roots);
  const cache = new Map<ShapeNode, boolean>();
  const minimal = (node: ShapeNode): boolean => {
    const children = childrenOf(node);
    if (!children.length) return true;
    const cached = cache.get(node);
    if (cached !== undefined) return cached;
    const kind = writtenLevel(node);
    const value = bare ? bare.minimal(node) : kind !== 'phrase' && kind !== 'bar' && children.every(minimal);
    cache.set(node, value);
    return value;
  };
  const isHead = (node: ShapeNode): boolean => {
    const kind = writtenLevel(node);
    return kind !== 'phrase' && kind !== 'bar' && minimal(node);
  };
  const isHeadPosition = (node: ShapeNode): boolean => {
    const structural = bare?.positionKind(node);
    return structural ? structural === 'head' : isHead(node);
  };
  return { isHead, isHeadPosition };
};
