/** Projection levels read from the tree's shape, whatever the labels spell.
 *
 * A node projects from the daughter with its own head category, is maximal
 * when its parent does not project from it, and is minimal when nothing
 * projects into it. A complex head formed by head movement ([T C] under C) is
 * minimal too, when structure shows the movement (see headShape below). The
 * same structure therefore reads alike in bare labels ([T D [T T V]]) and in
 * Minimalist "XP over XP" labels ([TP DP [TP T VP]]), where the inner TP is a
 * non-maximal segment: "P" names the category, not the level.
 *
 * X-bar notation writes the intermediate level (T′, or prose such as
 * "T-projection"). There a repeated XP marks an adjunct, not a segment with a
 * specifier, which structure alone cannot tell, so consumers keep reading
 * levels from that notation and `readStructuralProjections` answers
 * undefined. */
import type { SyntaxNode } from '../types.ts';
import { readCategoryLabel } from './categoryLabel.ts';

type ProjectionNode = Pick<SyntaxNode, 'label' | 'children' | 'lineageId'>;

export interface StructuralProjections<Node extends ProjectionNode = SyntaxNode> {
  /** The head category the label names, or undefined when it names none. */
  category: (node: Node) => string | undefined;
  parent: (node: Node) => Node | undefined;
  /** Whether `node` projects from its daughter `child`. */
  projects: (child: Node, node: Node) => boolean;
  minimal: (node: Node) => boolean;
  maximal: (node: Node) => boolean;
  /** 'head' for a head or a head inside a complex head, 'phrasal' for a
   * phrase containing a phrase or for a specifier, and undefined otherwise: a
   * one-word item beside a head may be a complement or an adjoined head, and
   * a pair of heads may be a small phrase or a complex head. */
  positionKind: (node: Node) => 'head' | 'phrasal' | undefined;
  /** Whether a one-word daughter beside a head may have adjoined to it: its
   * own occurrence, a head, is the sister of the pair, so the pair may be a complex head
   * over its lower copy as well as a head and its complement. */
  mayHaveAdjoined: (node: Node) => boolean;
}

const childrenOf = <Node extends ProjectionNode>(node: Node): Node[] => (Array.isArray(node.children) ? node.children : []) as Node[];

// Prose such as "T-projection" also states a level, which is read as notation.
const PROSE_LEVEL = /^[A-Za-z\p{Script=Greek}]+[\s-]+(?:projection|phrase|bar)\b/iu;

/** Whether some label writes a projection level (XP, X′ or "X projection"). */
export const writesProjectionLevels = (roots: readonly ProjectionNode[]): boolean => {
  const pending = [...roots];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    const kind = readCategoryLabel(node.label)?.kind;
    if (kind === 'phrase' || kind === 'bar' || PROSE_LEVEL.test(String(node.label ?? '').trim())) return true;
    pending.push(...childrenOf(node));
  }
  return false;
};

/** Whether some label writes an intermediate projection level (X′ or "X
 * projection"), as X-bar notation does. */
export const writesIntermediateLevels = (roots: readonly ProjectionNode[]): boolean => {
  const pending = [...roots];
  while (pending.length) {
    const node = pending.pop();
    if (!node) continue;
    if (readCategoryLabel(node.label)?.kind === 'bar' || PROSE_LEVEL.test(String(node.label ?? '').trim())) return true;
    pending.push(...childrenOf(node));
  }
  return false;
};

// A lower occurrence written as "T trace" or "D-copy" keeps its category.
const LOWER_OCCURRENCE = /^([A-Za-z\p{Script=Greek}]+)[\s-]+(?:trace|copy)$/iu;
const structuralCategory = (label?: string): string | undefined => readCategoryLabel(label)?.head
  ?? readCategoryLabel(LOWER_OCCURRENCE.exec(String(label ?? '').trim())?.[1])?.head;

/** Structural projection levels for a forest that writes no intermediate level. */
export const readStructuralProjections = <Node extends ProjectionNode>(roots: readonly Node[]): StructuralProjections<Node> | undefined => {
  if (!roots.length || writesIntermediateLevels(roots)) return undefined;
  const parents = new Map<Node, Node>();
  const categories = new Map<Node, string | undefined>();
  const all: Node[] = [];
  const visit = (node: Node) => {
    all.push(node);
    categories.set(node, structuralCategory(node.label));
    for (const child of childrenOf(node)) { parents.set(child, node); visit(child); }
  };
  roots.forEach(visit);
  const category = (node: Node) => categories.has(node) ? categories.get(node) : structuralCategory(node.label);
  const sameCategory = (child: Node, node: Node) => Boolean(category(node)) && category(child) === category(node);
  const simpleHead = (node: Node) => !childrenOf(node).some(child => sameCategory(child, node));
  // A head selecting a phrase of its own category (V taking VP) projects
  // itself; with no single such head, every same-category daughter may.
  const projects = (child: Node, node: Node) => {
    if (!sameCategory(child, node)) return false;
    const candidates = childrenOf(node).filter(other => sameCategory(other, node));
    const heads = candidates.filter(simpleHead);
    return candidates.length === 1 || heads.length !== 1 || heads[0] === child;
  };
  const parent = (node: Node) => parents.get(node);
  const maximal = (node: Node) => {
    const above = parents.get(node);
    return !above || !projects(node, above);
  };
  // A head beside a head has adjoined to it, rather than being its
  // complement, when structure shows head movement: its chain heads a
  // projection somewhere (complex heads move too, so chains grow to a
  // fixpoint), or its own lower occurrence lies in the domain the pair
  // c-commands. The pair must itself sit in head position, heading a
  // projection or inside a larger complex head: a moved one-word phrase
  // ([D N] in a specifier) shows the same lineages but is maximal.
  const headLineages = new Set<string>();
  const lineageWithin = (node: Node, lineage: string): boolean => node.lineageId === lineage
    || childrenOf(node).some(child => lineageWithin(child, lineage));
  // The domain a head pair c-commands starts at the sisters of the pair, or of
  // the cluster of one-word heads it sits in ([gli [lo T]]). A sister that is
  // itself the occurrence may instead be a phrase moved out of the pair.
  const occurrenceBeside = (node: Node, child: Node, sisterIsOccurrence?: (sister: Node) => boolean): boolean => {
    const lineage = String(child.lineageId ?? '');
    for (let pair = node, above = parents.get(node); lineage && above; pair = above, above = parents.get(above)) {
      const others = childrenOf(above).filter(sister => sister !== pair);
      if (others.some(sister => sisterIsOccurrence ? sister.lineageId === lineage && sisterIsOccurrence(sister)
        : sister.lineageId !== lineage && lineageWithin(sister, lineage))) return true;
      if (!projects(pair, above) || !others.every(simpleHead) || others.some(sister => childrenOf(sister).length > 1)) return false;
    }
    return false;
  };
  const lowerOccurrenceBelow = (node: Node, child: Node) => occurrenceBeside(node, child);
  const headShape = (node: Node): boolean => {
    const children = childrenOf(node);
    return simpleHead(node) || children.length > 1 && children.every(headShape)
      && children.some(child => !projects(child, node)
        && (headLineages.has(String(child.lineageId ?? '')) || lowerOccurrenceBelow(node, child)));
  };
  const inHeadPosition = (node: Node): boolean => {
    const above = parents.get(node);
    return !maximal(node) || Boolean(above && headShape(above) && inHeadPosition(above));
  };
  // A phrase label (DP over "Mia") settles what structure leaves open: a
  // one-word item may be a head or a phrase, and the label says phrase.
  const phraseLabels = new Set(all.filter(node => readCategoryLabel(node.label)?.kind === 'phrase'));
  const isHead = (node: Node): boolean => !phraseLabels.has(node)
    && (simpleHead(node) || headShape(node) && inHeadPosition(node));
  let minimalCache: Map<Node, boolean> | undefined;
  const minimal = (node: Node): boolean => {
    if (!minimalCache) {
      for (let grew = true; grew;) {
        grew = false;
        for (const candidate of all) {
          const lineage = String(candidate.lineageId ?? '');
          if (lineage && !headLineages.has(lineage) && !maximal(candidate) && isHead(candidate)) {
            headLineages.add(lineage);
            grew = true;
          }
        }
      }
      minimalCache = new Map();
    }
    const cached = minimalCache.get(node);
    if (cached !== undefined) return cached;
    const value = isHead(node);
    minimalCache.set(node, value);
    return value;
  };
  const positionKind = (node: Node): 'head' | 'phrasal' | undefined => {
    const above = parents.get(node);
    if (!minimal(node) && childrenOf(node).some(child => !minimal(child))) return 'phrasal';
    if (minimal(node) && (!maximal(node) || above && minimal(above))) return 'head';
    const siblings = above ? childrenOf(above) : [];
    const sister = siblings.length === 2 ? siblings.find(child => child !== node) : undefined;
    return above && sister && projects(sister, above) && !minimal(sister) ? 'phrasal' : undefined;
  };
  const mayHaveAdjoined = (node: Node): boolean => {
    const above = parents.get(node);
    return Boolean(above) && minimal(node) && childrenOf(above!).every(minimal) && occurrenceBeside(above!, node, minimal);
  };
  return { category, parent, projects, minimal, maximal, positionKind, mayHaveAdjoined };
};
