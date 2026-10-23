/** Rewrite X-bar labels into Bare Phrase Structure labels (TP, T′ and T⁰ all
 * become T) while keeping every node, ID, word and relation. Minimalism
 * analyses author such labels; the rewrite lets a test compare the same
 * structure under both notations. */
import { readCategoryLabel } from '../../replay/categoryLabel.ts';
import { readBareProjections } from '../../replay/projectionStructure.ts';

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

export const toBareForest = forest => forest.map(bareNode);
export const toBareStages = stages => stages.map(stage => ({ ...stage, workspaceForest: toBareForest(stage.workspaceForest) }));

/** Whether every X-bar label of the forest states a level its bare structure
 * also shows: XP maximal, X′ neither maximal nor minimal, X⁰ minimal and the
 * head of its parent's projection or inside a complex head. Labels that carry
 * more than structure (an X′ root, XP adjoined to XP or to a head, a VP
 * without V′) make no claim the bare rewrite could keep. */
export const isStructureFaithfulXbar = forest => {
  const rewritten = toBareForest(forest);
  const bare = readBareProjections(rewritten);
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

/** Rewrite the labels a position description names: `Spec,TP` → `Spec,T`. */
export const toBarePosition = text => {
  const spec = /^Spec,(.+)$/u.exec(text);
  if (spec) return `Spec,${toBareLabel(spec[1])}`;
  const within = /^(.+) in (.+)$/u.exec(text);
  if (within) return `${toBareLabel(within[1])} in ${toBareLabel(within[2])}`;
  return /^complement of /u.test(text) ? text : toBareLabel(text);
};

/** Rewrite a Source or Landing panel value: `did (I in I′)`, `did (I) in C`,
 * `Spec,TP`, and several of them joined by ` + `. */
export const toBarePanelValue = value => value.split(' + ').map(part => {
  const named = /^(.*) \(([^()]*)\)$/u.exec(part);
  if (named) return `${toBareLabel(named[1])} (${toBarePosition(named[2])})`;
  const head = /^(.*) \(([^()]*)\) in (.+)$/u.exec(part);
  if (head) return `${head[1]} (${toBareLabel(head[2])}) in ${toBareLabel(head[3])}`;
  return toBarePosition(part);
}).join(' + ');
