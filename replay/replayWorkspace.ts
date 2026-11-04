import type { SyntaxNode } from '../types.ts';
import { replayEffectiveSilence } from './syntaxForest.ts';
import type { PlaybackStep } from './types.ts';

/**
 * A construction step's derivational state, as the Replay panel writes it:
 * the workspace (every visible syntax object) and the lexical array (the
 * sentence's words no visible pronounced terminal accounts for yet).
 */
export interface ReplayWorkspace {
  /** Visible syntax objects, each pruned to its visible nodes. */
  objects: SyntaxNode[];
  /** The object holding the step's target, the one this step built or selected. */
  currentIndex: number;
  /** Words still to be selected, in sentence order. */
  lexicalArray: string[];
}

const WORDLIKE = /[\p{L}\p{N}]/u;

/**
 * A visible node keeps its visible descendants; a hidden one passes them up.
 * Silence is inherited, as in pronunciation (a silent phrase silences
 * everything beneath it, drawn or not), so each kept node records its
 * effective silence.
 */
const pruneToVisible = (node: SyntaxNode, visible: ReadonlySet<string>, inheritedSilence = false): SyntaxNode[] => {
  const silent = replayEffectiveSilence(node, inheritedSilence);
  const children = (node.children ?? []).flatMap(child => pruneToVisible(child, visible, silent));
  if (!visible.has(String(node.id))) return children;
  const { children: _children, ...rest } = node;
  const kept: SyntaxNode = silent ? { ...rest, silent: true } : rest;
  return [children.length ? { ...kept, children } : kept];
};

const someNode = (node: SyntaxNode, test: (node: SyntaxNode) => boolean): boolean =>
  test(node) || (node.children ?? []).some(child => someNode(child, test));

const eachNode = (node: SyntaxNode, visit: (node: SyntaxNode, parent?: SyntaxNode) => void, parent?: SyntaxNode) => {
  visit(node, parent);
  (node.children ?? []).forEach(child => eachNode(child, visit, node));
};

export const buildReplayWorkspace = (
  step: PlaybackStep | null | undefined,
  inputTokens: readonly string[]
): ReplayWorkspace | null => {
  const canvas = step?.replayCanvasData;
  if (!step || step.replayKind !== 'micro' || !canvas) return null;
  const visible = new Set(step.replayVisibleNodeIds ?? []);
  const objects = pruneToVisible(canvas, visible);
  if (!objects.length) return null;
  const target = step.targetNodeId === undefined ? undefined : String(step.targetNodeId);
  const found = target === undefined ? -1 : objects.findIndex(object => someNode(object, node => String(node.id) === target));
  const currentIndex = found === -1 ? objects.length - 1 : found;

  // A visible pronounced terminal selects its word: by its token position
  // when it has one (the final tree's terminals do), otherwise by matching
  // its word to the first unselected sentence word with the same text. Stage
  // trees carry no positions, and a word is visible at its source before it
  // moves, so matching by text counts it from its first appearance.
  const selected = new Set<number>();
  // A word realized by several terminals counts once any of them is visible,
  // and its terminals are then accounted for: none is matched by text again.
  // The step's own groups name its drawn nodes; Replay renames continued
  // occurrences, so the authored stage's groups may not.
  const realized = new Set<string>();
  (step.replayRealizations ?? []).forEach(group => {
    if (!group.nodeIds.some(id => visible.has(String(id)))) return;
    group.tokenIndices.forEach(index => selected.add(index));
    group.nodeIds.forEach(id => realized.add(String(id)));
  });
  const unpositioned: string[] = [];
  objects.forEach(object => eachNode(object, (node, parent) => {
    if (node.silent || node.children?.length) return;
    // Replay draws a lexical head as its category over the word; the category keeps the position.
    const position = Number.isInteger(node.tokenIndex) ? node.tokenIndex
      : parent?.children?.length === 1 && Number.isInteger(parent.tokenIndex) ? parent.tokenIndex : undefined;
    if (position !== undefined) selected.add(position as number);
    // A drawn word sits under its category node, which is the one a group names.
    else if (node.word && !realized.has(String(node.id)) && !(parent && realized.has(String(parent.id)))) unpositioned.push(String(node.word));
  }));
  const fold = (text: string) => text.normalize('NFC').toLocaleLowerCase();
  unpositioned.forEach(word => {
    const index = inputTokens.findIndex((token, at) => !selected.has(at) && fold(token) === fold(word));
    if (index !== -1) selected.add(index);
  });
  const lexicalArray = inputTokens.filter((token, index) => WORDLIKE.test(token) && !selected.has(index));
  return { objects, currentIndex, lexicalArray };
};
