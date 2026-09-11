/**
 * Authored pronunciation status of a syntax node.
 *
 * The contract expresses pronunciation through fields only: `word` holds a
 * terminal's lexical content, `silent: true` marks a terminal unpronounced in
 * its stage, and a wordless item is abstract. The spelling or casing of
 * `word`, `label` or `id` never decides whether a leaf is pronounced, so a
 * pronounced input token spelled `copy`, `pro` or `t` stays pronounced and a
 * wordless head labelled `appl` or `Neg` is abstract on every layer.
 *
 * The parser and Replay both classify through these predicates so the two
 * layers cannot disagree. Notation styling for unpronounced leaves (`t`, `∅`)
 * belongs to the display layer and applies only to leaves that are already
 * unpronounced here.
 */

export const isLeafNode = (node) => (
  Boolean(node)
  && typeof node === 'object'
  && !(Array.isArray(node.children) && node.children.length > 0)
);

export const authoredWord = (node) => (
  typeof node?.word === 'string' ? node.word.trim() : ''
);

/** A leaf with lexical content that the analysis pronounces in this stage. */
export const isPronouncedLeaf = (node) => (
  isLeafNode(node) && Boolean(authoredWord(node)) && node.silent !== true
);

/** A leaf that retains lexical content but is authored unpronounced. */
export const isSilentWordLeaf = (node) => (
  isLeafNode(node) && Boolean(authoredWord(node)) && node.silent === true
);

/** A leaf without lexical content: an abstract item, whatever its label says. */
export const isWordlessLeaf = (node) => isLeafNode(node) && !authoredWord(node);

/**
 * Silence covers a whole occurrence: `silent: true` on a phrase leaves every
 * terminal beneath it unpronounced. Walks each leaf with that inherited flag.
 */
export const forEachLeaf = (root, visit, underSilentAncestor = false) => {
  if (!root || typeof root !== 'object') return;
  const silentHere = underSilentAncestor || root.silent === true;
  const children = Array.isArray(root.children) ? root.children : [];
  if (children.length === 0) {
    visit(root, underSilentAncestor);
    return;
  }
  children.forEach((child) => forEachLeaf(child, visit, silentHere));
};

export const isPronouncedLeafWithin = (node, underSilentAncestor) => (
  !underSilentAncestor && isPronouncedLeaf(node)
);

export const collectPronouncedLeaves = (root) => {
  const leaves = [];
  forEachLeaf(root, (leaf, underSilentAncestor) => {
    if (isPronouncedLeafWithin(leaf, underSilentAncestor)) leaves.push(leaf);
  });
  return leaves;
};
