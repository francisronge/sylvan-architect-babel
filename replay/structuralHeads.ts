/** Heads read from the shape of a tree, never from what a label is called.
 *
 * A daughter projects its parent when it carries the parent's head category
 * (T′ under TP, T under T′, a lower TP segment under TP, bare T under T); when
 * several do (V selecting a VP), the minimal one projects. A node is minimal
 * (a head) when it is a leaf, or a complex head: a node whose label writes no
 * level and whose daughters are all minimal. In a tree written in bare labels a
 * head and a small phrase look alike ([T D T]), so there the Bare Phrase
 * Structure reader decides. Category names never matter: Voice, Appl, Foc, Fin
 * and K are read exactly like T. */
import type { SyntaxNode } from '../types.ts';
import { categoryLabel, readCategoryLabel } from './categoryLabel.ts';
import { readBareProjections } from './projectionStructure.ts';

type ShapeNode = Pick<SyntaxNode, 'label' | 'children' | 'lineageId'>;

const childrenOf = (node: ShapeNode): ShapeNode[] => Array.isArray(node.children) ? node.children : [];
// A label the category reader cannot parse (&′) still names its category by
// its spelling, and a prime still marks it as an intermediate projection.
const PRIME = /[′’']\s*$/u;
const headCategory = (node: ShapeNode): string | undefined => readCategoryLabel(node.label)?.head
  ?? (categoryLabel(node.label) || undefined);
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
  minimal: (node: ShapeNode) => boolean;
  /** Whether `node` is a head: a leaf, or a complex head, whose label writes
   * no phrase or bar level (a "DP" trace leaf is a phrase). */
  isHead: (node: ShapeNode) => boolean;
  /** The Bare Phrase Structure reader's answer where it gives one, else isHead. */
  isHeadPosition: (node: ShapeNode) => boolean;
  /** The daughter that projects `parent`, or undefined when no single one does. */
  projectingDaughter: (parent: ShapeNode) => ShapeNode | undefined;
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
  const projectingDaughter = (parent: ShapeNode): ShapeNode | undefined => {
    const category = headCategory(parent);
    if (!category) return undefined;
    const candidates = childrenOf(parent).filter(child => headCategory(child) === category);
    if (candidates.length === 1) return candidates[0];
    const heads = candidates.filter(minimal);
    return heads.length === 1 ? heads[0] : undefined;
  };
  const isHead = (node: ShapeNode): boolean => {
    const kind = writtenLevel(node);
    return kind !== 'phrase' && kind !== 'bar' && minimal(node);
  };
  const isHeadPosition = (node: ShapeNode): boolean => {
    const structural = bare?.positionKind(node);
    return structural ? structural === 'head' : isHead(node);
  };
  return { minimal, isHead, isHeadPosition, projectingDaughter };
};
