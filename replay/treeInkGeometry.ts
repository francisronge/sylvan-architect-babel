import type { TreeLabelRuns, TreeLabelMeasure, TreeLabelBounds } from './treeLabelRuns.ts';
import type { HierarchyPointNode } from 'd3';
import type { SyntaxNode } from '../types.ts';
import { caseSurfaceInitial } from '../server/babelParser/surfaceTokens.js';
import { categoryTextLayout, type CategoryTextMeasure } from './categoryTextLayout.ts';
import { getNodeId } from './displayIdentity.ts';
import { REPLAY_GENERATED_TERMINAL_GLYPHS } from './replayCompiler.ts';
import { plaqueTreeObstacles, plaqueBranchObstacles, type PlaqueRect } from './relations/plaquePlacement.ts';

export type TreeInkTextStyle = 'category' | 'terminal' | 'category-index' | 'terminal-index';
/** Glyph x bounds use a left-aligned origin; ascent/descent are baseline distances. */
export type TreeInkTextMetrics = {
  width: number; left: number; right: number; ascent: number; descent: number;
  fontAscent: number; fontDescent: number;
};
export type TreeInkTextMeasure = (text: string, style: TreeInkTextStyle) => TreeInkTextMetrics | undefined;
type Node = HierarchyPointNode<SyntaxNode>;

const valid = (metrics: TreeInkTextMetrics | undefined): metrics is TreeInkTextMetrics => Boolean(metrics
  && [metrics.width, metrics.left, metrics.right, metrics.ascent, metrics.descent, metrics.fontAscent, metrics.fontDescent].every(Number.isFinite)
  && metrics.width >= 0 && metrics.right >= metrics.left
  && metrics.fontAscent >= 0 && metrics.fontDescent >= 0);

/** These are the exact requests consumed by validation, also collected before a
 * worker/cache lookup. Missing browser metrics retain the existing envelope. */
export function collectTreeInkMeasurements(
  label: string, word: string | undefined, measureCategoryText: CategoryTextMeasure | undefined,
  measureTreeInk: TreeInkTextMeasure | undefined
) {
  if (!measureTreeInk) return {};
  const category = categoryTextLayout(label, measureCategoryText).lines.map(line => ({
    line, metrics: measureTreeInk(line, 'category')
  }));
  const categoryIndex = measureTreeInk(REPLAY_GENERATED_TERMINAL_GLYPHS, 'category-index');
  const result: {
    category?: Array<{ line: string; metrics: TreeInkTextMetrics }>;
    categoryIndex?: TreeInkTextMetrics;
    terminal?: { ascent: number; descent: number; left: number; right: number };
  } = {};
  if (category.every(run => valid(run.metrics)) && valid(categoryIndex)) {
    result.category = category as Array<{ line: string; metrics: TreeInkTextMetrics }>;
    result.categoryIndex = categoryIndex;
  }
  if (!word) return result;
  const variants = new Set([word, caseSurfaceInitial(word, 'upper'), caseSurfaceInitial(word, 'lower')]);
  const actualWords = [...variants].map(text => measureTreeInk(text, 'terminal'));
  const terminal = [...actualWords, measureTreeInk(REPLAY_GENERATED_TERMINAL_GLYPHS, 'terminal')];
  const index = measureTreeInk(REPLAY_GENERATED_TERMINAL_GLYPHS, 'terminal-index');
  if (actualWords.every(valid) && terminal.every(valid) && valid(index)) {
    result.terminal = {
      ascent: Math.max(index.ascent, ...terminal.flatMap(metric => [metric.ascent, metric.fontAscent])),
      descent: Math.max(index.descent, ...terminal.flatMap(metric => [metric.descent, metric.fontDescent])),
      left: Math.min(...actualWords.map(metric => -metric.width / 2 + metric.left - 4)),
      right: Math.max(...actualWords.map(metric => -metric.width / 2 + metric.right + 4))
    };
  }
  return result;
}

/** Syntax validation measures painted text and stems. Plaque allocation keeps
 * its deliberately larger placement padding through plaqueTreeObstacles. */
export function treeInkObstacles(
  nodes: Node[], measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure,
  preciseBranches = false, labelRuns?: ReadonlyMap<string, readonly TreeLabelRuns[]>, measureTreeLabel?: TreeLabelMeasure
): PlaqueRect[] {
  const existing = plaqueTreeObstacles(nodes, measureCategoryText, preciseBranches);
  if (measureTreeLabel) return styledLabelObstacles(existing, nodes, labelRuns, measureTreeLabel);
  if (!measureTreeInk) return existing;
  const replacements = new Map<string, PlaqueRect[]>();
  const terminalStems = new Map<string, PlaqueRect>();
  const byAttachment = new Map<string, PlaqueRect[]>();
  for (const rect of existing) if (rect.connectorAttachment) {
    const group = byAttachment.get(rect.connectorAttachment) ?? [];
    group.push(rect);
    byAttachment.set(rect.connectorAttachment, group);
  }
  for (const node of nodes) {
    const id = getNodeId(node), categoryKey = `${id}:category`, terminalKey = `${id}:terminal`;
    const measured = collectTreeInkMeasurements(node.data.label || '', node.data.word, measureCategoryText, measureTreeInk);
    const category = byAttachment.get(categoryKey) ?? [];
    if (category.length && measured.category && measured.categoryIndex) {
      const left = Math.min(...category.map(rect => rect.x)), right = Math.max(...category.map(rect => rect.x + rect.width));
      replacements.set(categoryKey, measured.category.map(({ metrics }, index, runs) => {
        const baseline = node.y - 10 - (runs.length - 1 - index) * 48;
        const ascent = Math.max(metrics.ascent, measured.categoryIndex!.ascent);
        const descent = Math.max(metrics.descent, measured.categoryIndex!.descent);
        const x = Math.min(left, node.x - metrics.width / 2 + metrics.left - 5);
        return { x, y: baseline - ascent - 5,
          width: Math.max(right, node.x - metrics.width / 2 + metrics.right + 5) - x,
          height: ascent + descent + 10, connectorAttachment: categoryKey };
      }));
    }
    const terminal = byAttachment.get(terminalKey)?.[0];
    if (terminal && measured.terminal
      && node.x + measured.terminal.left >= terminal.x
      && node.x + measured.terminal.right <= terminal.x + terminal.width) {
      replacements.set(terminalKey, [{ ...terminal, y: node.y + 115 - measured.terminal.ascent - 4,
        height: measured.terminal.ascent + measured.terminal.descent + 8 }]);
      terminalStems.set(id, { x: node.x - 1.5, y: node.y + 18.5, width: 3, height: 48, terminalStemNodeId: id });
    }
  }
  const used = new Set<string>();
  return existing.flatMap(rect => {
    if (rect.connectorAttachment && replacements.has(rect.connectorAttachment)) {
      if (used.has(rect.connectorAttachment)) return [];
      used.add(rect.connectorAttachment);
      return replacements.get(rect.connectorAttachment)!;
    }
    return [rect.terminalStemNodeId ? terminalStems.get(rect.terminalStemNodeId) ?? rect : rect];
  });
}

/** Validation visits overlapping subtrees of one immutable rendered scene.
 * Measure each node and visible edge once, retaining the ordinary DFS order. */
export function prepareTreeInkSubtrees(
  visible: ReadonlyMap<string, Node>, measureCategoryText?: CategoryTextMeasure, measureTreeInk?: TreeInkTextMeasure,
  preciseBranches = false, labelRuns?: ReadonlyMap<string, readonly TreeLabelRuns[]>, measureTreeLabel?: TreeLabelMeasure
) {
  const local = new Map<Node, PlaqueRect[]>(), branches = new Map<Node, PlaqueRect[]>();
  const contents = new Map<Node, PlaqueRect[]>(), withIncoming = new Map<Node, PlaqueRect[]>();
  const own = (node: Node) => {
    let result = local.get(node);
    if (!result) {
      result = treeInkObstacles([node], measureCategoryText, measureTreeInk, preciseBranches, labelRuns, measureTreeLabel);
      local.set(node, result);
    }
    return result;
  };
  const incoming = (node: Node) => {
    let result = branches.get(node);
    if (!result) {
      const parent = node.parent;
      result = parent && visible.has(getNodeId(parent))
        && parent.data.replayOrigin?.kind !== 'workspace' && node.data.replayOrigin?.kind !== 'workspace'
        ? plaqueBranchObstacles(parent, node, preciseBranches) : [];
      branches.set(node, result);
    }
    return result;
  };
  const descendants = (node: Node): PlaqueRect[] => {
    let result = contents.get(node);
    if (!result) {
      result = (node.children ?? []).flatMap(child => {
        if (!visible.has(getNodeId(child))) return [];
        let value = withIncoming.get(child);
        if (!value) {
          value = [...own(child), ...incoming(child), ...descendants(child)];
          withIncoming.set(child, value);
        }
        return value;
      });
      contents.set(node, result);
    }
    return result;
  };
  const roots = new Map<Node, PlaqueRect[]>();
  return (node: Node): PlaqueRect[] => {
    if (!visible.has(getNodeId(node))) return [];
    let result = roots.get(node);
    if (!result) { result = [...own(node), ...descendants(node)]; roots.set(node, result); }
    return result;
  };
}


function styledLabelObstacles(
  existing: PlaqueRect[], nodes: Node[], labels: ReadonlyMap<string, readonly TreeLabelRuns[]> | undefined,
  measure: TreeLabelMeasure
): PlaqueRect[] {
  if (!labels) return existing;
  const replacement = new Map<string, PlaqueRect[]>(), stems = new Map<string, PlaqueRect>();
  const byAttachment = new Map<string, PlaqueRect[]>();
  for (const rect of existing) if (rect.connectorAttachment) {
    const group = byAttachment.get(rect.connectorAttachment) ?? [];
    group.push(rect);
    byAttachment.set(rect.connectorAttachment, group);
  }
  const validBounds = (bounds: TreeLabelBounds | undefined): bounds is TreeLabelBounds => Boolean(bounds
    && Number.isFinite(bounds.x) && Number.isFinite(bounds.y) && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height) && bounds.width > 0 && bounds.height > 0);
  for (const node of nodes) {
    const id = getNodeId(node), runs = labels.get(id);
    if (!runs?.length) continue;
    const boxesByKind: Record<'category' | 'terminal', TreeLabelBounds[]> = { category: [], terminal: [] };
    let complete = true;
    for (const run of runs) {
      const bounds = measure(run);
      if (validBounds(bounds)) boxesByKind[run.kind].push(bounds);
      else complete = false;
    }
    // Missing one variant means its complete previous footprint remains.
    if (!complete) continue;
    for (const kind of ['category','terminal'] as const) {
      const key = `${id}:${kind}`, old = byAttachment.get(key) ?? [];
      const boxes = boxesByKind[kind];
      if (!old.length || !boxes.length) continue;
      let left = Infinity, right = -Infinity;
      for (const rect of old) { left = Math.min(left, rect.x); right = Math.max(right, rect.x + rect.width); }
      for (const box of boxes) { left = Math.min(left, node.x + box.x); right = Math.max(right, node.x + box.x + box.width); }
      replacement.set(key, boxes.map(box => ({x:left,y:node.y+box.y,width:right-left,height:box.height,connectorAttachment:key})));
      if (kind === 'terminal') stems.set(id, {x:node.x-1.5,y:node.y+18.5,width:3,height:48,terminalStemNodeId:id});
    }
  }
  const used = new Set<string>();
  const result: PlaqueRect[] = [];
  for (const rect of existing) {
    if (rect.connectorAttachment && replacement.has(rect.connectorAttachment)) {
      if (used.has(rect.connectorAttachment)) continue;
      used.add(rect.connectorAttachment);
      result.push(...replacement.get(rect.connectorAttachment)!);
    } else {
      result.push(rect.terminalStemNodeId ? stems.get(rect.terminalStemNodeId) ?? rect : rect);
    }
  }
  return result;
}
