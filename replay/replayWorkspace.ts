import type { SyntaxNode } from '../types.ts';
import { normalizeSurfaceToken } from '../server/babelParser/surfaceTokens.js';
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
  // One walk over the whole canvas decides what is selected, carrying two
  // things down from every ancestor, drawn or not: silence (a silent phrase
  // silences its words) and realization groups (a group naming a node covers
  // every terminal beneath it, as in spell-out). A visible pronounced
  // terminal selects its word by token position (its own, or its category's
  // when Replay draws the word under it); a terminal a group covers selects
  // the group's positions once visible; any other is matched by text to the
  // first unselected sentence word with the same text. Stage trees carry no
  // positions, and a word is visible at its source before it moves, so
  // matching by text counts it from its first appearance. The step's own
  // groups name its drawn nodes: Replay renames continued occurrences.
  const groups = step.replayRealizations ?? [];
  const groupsNaming = new Map<string, number[]>();
  groups.forEach((group, index) => group.nodeIds.forEach(id => {
    groupsNaming.set(String(id), [...(groupsNaming.get(String(id)) ?? []), index]);
  }));
  const selected = new Set<number>();
  const unpositioned: string[] = [];
  const walk = (node: SyntaxNode, parent: SyntaxNode | undefined, inheritedSilence: boolean, inheritedGroups: number[]) => {
    const silent = replayEffectiveSilence(node, inheritedSilence);
    const covering = groupsNaming.has(String(node.id)) ? [...inheritedGroups, ...groupsNaming.get(String(node.id))!] : inheritedGroups;
    const children = node.children ?? [];
    if (!children.length && visible.has(String(node.id)) && !silent) {
      const position = Number.isInteger(node.tokenIndex) ? node.tokenIndex
        : parent?.children?.length === 1 && Number.isInteger(parent.tokenIndex) ? parent.tokenIndex : undefined;
      if (position !== undefined) selected.add(position as number);
      if (covering.length) covering.forEach(index => groups[index].tokenIndices.forEach(token => selected.add(token)));
      else if (position === undefined && node.word) unpositioned.push(String(node.word));
    }
    children.forEach(child => walk(child, node, silent, covering));
  };
  walk(canvas, undefined, false, []);
  // Words compare as the parser compares surface tokens: caseless, without edge punctuation.
  unpositioned.forEach(word => {
    const index = inputTokens.findIndex((token, at) => !selected.has(at) && normalizeSurfaceToken(token) === normalizeSurfaceToken(word));
    if (index !== -1) selected.add(index);
  });
  // Punctuation is never a word to select; symbol words are, as the parser keeps them.
  const lexicalArray = inputTokens.filter((token, index) => normalizeSurfaceToken(token) !== '' && !selected.has(index));
  return { objects, currentIndex, lexicalArray };
};
