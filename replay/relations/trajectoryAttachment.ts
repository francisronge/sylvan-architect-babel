import type { SyntaxNode } from '../../types.ts';
import { readCategoryLabel } from '../categoryLabel.ts';
import { isDisplayTerminalNode, shouldExpandPreterminalLeaf } from '../replaySurfaceNotation.ts';

const countDisplayTerminals = (node: SyntaxNode): number => node.children?.length
  ? node.children.reduce((count, child) => Math.min(2, count + countDisplayTerminals(child)), 0)
  : Number(isDisplayTerminalNode(node));

/** An exact wordless occurrence attaches at its shell; multiple terminals remain ambiguous. */
export const terminalTrajectoryAttachment = (node: SyntaxNode): 'terminal' | 'shell-bottom' =>
  countDisplayTerminals(node) === 0 ? 'shell-bottom' : 'terminal';

/** A compound head is the authored endpoint, not one arbitrarily chosen morpheme.
 * Simple heads keep their terminal; wordless heads use their exact shell. The
 * label must read as a head unless recovered movement evidence has already
 * proved this landing a head (`provedHead`), as it can for prose labels. */
export const headTrajectoryAttachment = (node: SyntaxNode, provedHead = false): 'terminal' | 'shell-bottom' => {
  const count = countDisplayTerminals(node);
  const compoundHead = (provedHead || readCategoryLabel(node.label)?.kind === 'head') && count > 1;
  return count === 0 || compoundHead ? 'shell-bottom' : 'terminal';
};

/** An endpoint ends just below its node's visible text. A shell endpoint has
 * no category label to stand under when the node is painted only as a word
 * (a trace t, a silent copy, a bare word), and its node point lies above that
 * word; it attaches below the word instead. */
export const visibleTextTrajectoryAttachment = <A extends string>(node: SyntaxNode, attachment: A): A | 'terminal' =>
  attachment === 'shell-bottom' && isDisplayTerminalNode(node) && !shouldExpandPreterminalLeaf(node) ? 'terminal' : attachment;

/**
 * The one terminal-attachment law, pure and shared by every provider: a
 * terminal endpoint is NEVER inferred. If the anchored node is itself the
 * display terminal, it is the endpoint; otherwise exactly one display
 * terminal may exist inside the exact anchored subtree. Zero fails closed
 * as always; MORE than one fails closed as an ambiguity — never resolved
 * by traversal order or current visibility — so full-frame allocation and
 * step-visible drawing can never disagree about an endpoint.
 */
export type TerminalResolution<T> =
  | { terminal: T; reason: 'anchor-terminal' | 'unique' }
  | { terminal: null; reason: 'none' | 'ambiguous'; count: number };

export const resolveUniqueDisplayTerminal = <T>(
  anchor: T,
  childrenOf: (node: T) => readonly T[],
  isDisplayTerminal: (node: T) => boolean
): TerminalResolution<T> => {
  if (isDisplayTerminal(anchor)) return { terminal: anchor, reason: 'anchor-terminal' };
  const terminals: T[] = [];
  const walk = (node: T) => {
    if (isDisplayTerminal(node)) terminals.push(node);
    childrenOf(node).forEach(walk);
  };
  childrenOf(anchor).forEach(walk);
  if (terminals.length === 1) return { terminal: terminals[0], reason: 'unique' };
  if (terminals.length === 0) return { terminal: null, reason: 'none', count: 0 };
  return { terminal: null, reason: 'ambiguous', count: terminals.length };
};
