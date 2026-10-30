/** Rewrite X-bar labels into Bare Phrase Structure labels (TP, T′ and T⁰ all
 * become T) while keeping every node, ID, word and relation. Minimalism
 * analyses author such labels; the rewrite lets a test compare the same
 * structure under both notations. */
import { readCategoryLabel } from '../../replay/categoryLabel.ts';
import { readStructuralProjections } from '../../replay/projectionStructure.ts';

const LEADING_CATEGORY = /^([A-Za-z]+)(⁰|°|\^?0|[′’']+)?/u;

export const toBareLabel = label => {
  const shape = readCategoryLabel(label);
  return !shape || shape.compound ? label : String(label).replace(LEADING_CATEGORY, () => shape.head);
};

// A word leaf's label is its word, not category notation.
const isWordLeaf = node => !node.children?.length && typeof node.word === 'string' && node.word.trim() === String(node.label || '').trim();

const bareNode = node => !node || node.refId ? node : {
  ...node,
  ...(isWordLeaf(node) ? {} : { label: toBareLabel(node.label) }),
  ...(Array.isArray(node.children) ? { children: node.children.map(bareNode) } : {})
};

/** Whether some label writes a level (XP or X′), as the rewrite expects. */
export const writesLevelNotation = forest => forest.some(function writes(node) {
  return ['phrase', 'bar'].includes(readCategoryLabel(node.label)?.kind) || (node.children ?? []).some(writes);
});

export const toBareForest = forest => forest.map(bareNode);
export const toBareStages = stages => stages.map(stage => ({ ...stage, workspaceForest: toBareForest(stage.workspaceForest) }));

/** Whether every X-bar label of the forest states a level its bare structure
 * also shows: XP maximal, X′ neither maximal nor minimal, X⁰ minimal and the
 * head of its parent's projection or inside a complex head. Labels that carry
 * more than structure (an X′ root, XP adjoined to XP or to a head, a VP
 * without V′) make no claim the bare rewrite could keep. */
export const isStructureFaithfulXbar = forest => {
  const rewritten = toBareForest(forest);
  const bare = readStructuralProjections(rewritten);
  const faithful = (authored, node) => {
    if (isWordLeaf(authored)) return true;
    const shape = readCategoryLabel(authored.label);
    if (!shape || shape.compound) return false;
    const minimal = bare.minimal(node), maximal = bare.maximal(node);
    const parent = bare.parent(node);
    const insideHead = Boolean(parent && bare.minimal(parent));
    const level = shape.kind === 'phrase' ? maximal && !insideHead : shape.kind === 'bar' ? !maximal && !minimal
      : minimal && (!maximal || insideHead);
    return level && (authored.children ?? []).every((child, index) => faithful(child, node.children[index]));
  };
  return Boolean(bare) && forest.every((root, index) => faithful(root, rewritten[index]));
};

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
// Only X′ tells a specifier from an adjunct, so bare labels describe X-bar's
// Spec,TP neutrally, as the phrase in T.
const NEUTRAL_SPECIFIER = parent => `(?:.+ in )?${escape(toBareLabel(parent))}`;

/** Rewrite the labels a position description names: `T⁰ in T′` → `T in T`.
 * The result is a pattern: X-bar's `Spec,TP` becomes "<phrase> in T". */
export const toBarePosition = text => {
  const spec = /^Spec,(.+)$/u.exec(text);
  if (spec) return NEUTRAL_SPECIFIER(spec[1]);
  const within = /^(.+) in (.+)$/u.exec(text);
  if (within) return escape(`${toBareLabel(within[1])} in ${toBareLabel(within[2])}`);
  return escape(/^complement of /u.test(text) ? text : toBareLabel(text));
};

/** Rewrite a Source or Landing panel value: `did (I in I′)`, `did (I) in C`,
 * `Spec,TP`, and several of them joined by ` + `, into a pattern the bare
 * value must match whole. */
export const toBarePanelPattern = value => new RegExp(`^${value.split(' + ').map(part => {
  const named = /^(.*) \(([^()]*)\)$/u.exec(part);
  if (named) return `${escape(toBareLabel(named[1]))} \\(${toBarePosition(named[2])}\\)`;
  const head = /^(.*) \(([^()]*)\) in (.+)$/u.exec(part);
  if (head) return escape(`${head[1]} (${toBareLabel(head[2])}) in ${toBareLabel(head[3])}`);
  return toBarePosition(part);
}).join(' \\+ ')}$`, 'u');

/** The exact bare position for a whole X-bar description. */
export const toBarePositionPattern = text => new RegExp(`^${toBarePosition(text)}$`, 'u');
