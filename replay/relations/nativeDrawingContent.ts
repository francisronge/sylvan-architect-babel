import type { SyntaxNode } from '../../types.ts';
import type { Tier2FacetEvidence } from './tier2FacetRecipes.ts';


export type NativePlaqueContent =
  | { kind: 'correspondence'; sources: string[]; exponents: string[];
      links: Array<{ sourceIndex: number; exponentIndex: number }> }
  | { kind: 'fission'; inputFeatures: string[]; outputFeatures: [string[], string[]] }
  | { kind: 'impoverishment'; features: string[]; delinkIndex: number }
  | { kind: 'cooper-storage'; rows: Array<{ label: string; value: string }> }
  | { kind: 'linearization'; currentNodeIds: string[]; priorNodeIds: string[];
      currentRows: string[]; priorRows: string[]; conflict: boolean };

/** Ordered witnesses or explicitly named columns are required; generic rows imply no pairing. */
export const prepareNativeLinearizationContent = (
  evidence: Tier2FacetEvidence
): Extract<NativePlaqueContent, { kind: 'linearization' }> | undefined => {
  const currentNodeIds = [...(evidence.currentAnchors.order ?? [])];
  const priorNodeIds = [...(evidence.priorAnchors?.order ?? [])];
  for (const entries of [evidence.authoredCurrentAnchors, evidence.authoredPriorAnchors]) {
    const orders = entries?.filter((entry) => entry.concepts.includes('order')) ?? [];
    if (new Set(orders.map((entry) => JSON.stringify(entry.items))).size > 1) return;
  }
  const index = (forest: readonly SyntaxNode[]) => {
    const nodes = new Map<string, SyntaxNode>();
    const visit = (node: SyntaxNode) => { nodes.set(String(node.id), node); (node.children || []).forEach(visit); };
    forest.forEach(visit);
    return nodes;
  };
  const currentNodes = index(evidence.currentForest);
  const priorNodes = index(evidence.priorForest ?? []);
  if (currentNodeIds.some((id) => !currentNodes.has(id))
    || priorNodeIds.some((id) => !priorNodes.has(id))) return;
  const outcomes = (evidence.authoredValues ?? []).filter((entry) => entry.key === 'outcome').flatMap((entry) => entry.items);
  if (outcomes.length > 1) return;
  const rowsFor = (ids: string[], nodes: ReadonlyMap<string, SyntaxNode>) => {
    const labelFor = (node: SyntaxNode): string => {
      const surfaces: string[] = [];
      const visit = (part: SyntaxNode) => {
        if (part.children?.length) part.children.forEach(visit);
        else {
          const surface = String(part.word || part.label || '').trim();
          if (surface && surface !== '∅' && !/^\[.*\]$/.test(surface)) surfaces.push(surface);
        }
      };
      visit(node);
      return surfaces.join(' ') || String(node.word || node.label || node.id);
    };
    const labels = ids.map((id) => labelFor(nodes.get(id)!));
    return labels.slice(0, -1).map((label, index) => `${label} < ${labels[index + 1]}`);
  };
  const currentRows = currentNodeIds.length > 1 ? rowsFor(currentNodeIds, currentNodes) : [...(evidence.values['order.current'] ?? [])];
  const priorRows = priorNodeIds.length > 1 ? rowsFor(priorNodeIds, priorNodes) : [...(evidence.values['order.prior'] ?? [])];
  if (!currentRows.length || !priorRows.length || [...currentRows, ...priorRows].some((row) => !row.trim())) return;
  return { kind: 'linearization', currentNodeIds, priorNodeIds, currentRows, priorRows,
    conflict: outcomes[0] === 'conflict' };
};

export const nativeLinearizationPlateHeight = (content: NativePlaqueContent | undefined): number =>
  content?.kind === 'linearization' ? 70 + Math.max(content.priorRows.length, content.currentRows.length) * 17 : 0;

export const prepareNativeDependentCaseStep = (value: string | string[] | undefined): '1' | '2' | undefined => {
  const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
  if (items.length !== 1) return;
  const step = items[0].normalize('NFKC').trim();
  return step === '1' || step === '2' ? step : undefined;
};


/** Prepared content for the existing native plates. Missing grouping is not inferred. */
export const prepareNativePlaqueContent = (
  style: string,
  rows: ReadonlyArray<{ label: string; value: string }>,
  anchorNodeIds: readonly string[]
): NativePlaqueContent | undefined => {
  const list = (key: string) => rows.filter((row) => row.label === key).map((row) => row.value);
  if (style === 'fission') {
    const inputFeatures = list('inputFeatures');
    const first = list('outputOneFeatures');
    const second = list('outputTwoFeatures');
    if (anchorNodeIds.length !== 2 || !inputFeatures.length || !first.length || !second.length) return;
    return { kind: 'fission', inputFeatures, outputFeatures: [first, second] };
  }
  if (style === 'impoverishment') {
    const features = list('featureHierarchy');
    const after = list('delinkAfter');
    if (anchorNodeIds.length !== 1 || features.length < 2 || after.length !== 1) return;
    const matches = features.flatMap((value, index) => value === after[0] ? [index] : []);
    if (matches.length !== 1 || matches[0] === features.length - 1) return;
    return { kind: 'impoverishment', features, delinkIndex: matches[0] };
  }
  if (style === 'correspondence') {
    const sources = list('sources');
    const exponents = list('exponents');
    const authoredLinks = list('correspondence');
    if (anchorNodeIds.length !== 1 || !sources.length || !exponents.length || !authoredLinks.length) return;
    const links: Array<{ sourceIndex: number; exponentIndex: number }> = [];
    for (const entry of authoredLinks) {
      const parts = entry.split('=>');
      if (parts.length !== 2) return;
      const source = sources.flatMap((value, index) => value === parts[0].trim() ? [index] : []);
      const exponent = exponents.flatMap((value, index) => value === parts[1].trim() ? [index] : []);
      if (source.length !== 1 || exponent.length !== 1) return;
      links.push({ sourceIndex: source[0], exponentIndex: exponent[0] });
    }
    return { kind: 'correspondence', sources, exponents, links };
  }
  if (style === 'cooper-storage') {
    const category = list('category');
    if (anchorNodeIds.length !== 1 || category.length > 1) return;
    const displayRows = [
      ...category.map((value) => ({ label: 'category:', value })),
      ...['qstore', 'retrieved'].flatMap((key) => list(key).length
        ? [{ label: `${key}:`, value: `[${list(key).join(', ')}]` }] : [])
    ];
    return displayRows.length ? { kind: 'cooper-storage', rows: displayRows } : undefined;
  }
};


/** Every returned edge is an actual child edge on the exact named ancestor path. */
export const nativeAncestorEdges = (
  nodes: ReadonlyMap<string, SyntaxNode>, ancestor: string, descendant: string
): Array<{ fromNodeId: string; toNodeId: string }> | undefined => {
  if (ancestor === descendant) return;
  const visit = (node: SyntaxNode): Array<{ fromNodeId: string; toNodeId: string }> | undefined => {
    for (const child of node.children || []) {
      const edge = { fromNodeId: String(node.id), toNodeId: String(child.id) };
      if (child.id === descendant) return [edge];
      const rest = visit(child);
      if (rest) return [edge, ...rest];
    }
  };
  const root = nodes.get(ancestor);
  return root ? visit(root) : undefined;
};


/** Focus may first project from a complement's accent onto its sister head. */
export const isNativeProjectionPath = (
  nodes: ReadonlyMap<string, SyntaxNode>, accentBearer: string, projections: readonly string[]
): boolean => {
  const hops = [accentBearer, ...projections];
  return projections.length > 0 && new Set(hops).size === hops.length && projections.every((targetId, index) => {
    const sourceId = hops[index];
    if (nativeAncestorEdges(nodes, targetId, sourceId)) return true;
    if (index !== 0 || projections.length < 2) return false;
    const target = nodes.get(targetId);
    if (!target || (target.children || []).length > 0 || !target.word) return false;
    const parent = [...nodes.values()].find((node) => (node.children || []).some((child) => child.id === targetId));
    return Boolean(parent && nativeAncestorEdges(nodes, String(parent.id), accentBearer)
      && nativeAncestorEdges(nodes, projections[1], accentBearer)
      && nativeAncestorEdges(nodes, projections[1], targetId));
  });
};
