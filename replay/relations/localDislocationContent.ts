import type { SyntaxNode } from '../../types.ts';

export interface LocalDislocationContent {
  kind: 'local-dislocation';
  beforeGroupSizes: number[];
  afterGroupSizes: number[];
}

export interface LocalDislocationInput {
  sequenceNodeIds: readonly string[];
  currentForest: readonly SyntaxNode[];
  priorForest?: readonly SyntaxNode[];
  rows?: ReadonlyArray<{ label: string; value: string }>;
  values?: Readonly<Record<string, string | readonly string[]>>;
}

type SequencePaths = Map<string, SyntaxNode[]>;
type Brackets = number | Brackets[];

const sequencePaths = (forest: readonly SyntaxNode[], ids: readonly string[]): SequencePaths | undefined => {
  const selected = new Set(ids);
  const paths: SequencePaths = new Map();
  let ambiguous = false;
  const visit = (node: SyntaxNode, ancestors: SyntaxNode[]) => {
    const path = [...ancestors, node];
    if (node.id && selected.has(node.id)) {
      if (paths.has(node.id) || ancestors.some(ancestor => ancestor.id && selected.has(ancestor.id))) {
        ambiguous = true;
      }
      paths.set(node.id, path);
    }
    (node.children ?? []).forEach(child => visit(child, path));
  };
  forest.forEach(root => visit(root, []));
  return !ambiguous && paths.size === ids.length ? paths : undefined;
};

const authoredPartition = (values: readonly string[], length: number): number[] | undefined => {
  if (!values.length || values.some(value => !/^[1-9]\d*$/.test(value.trim()))) return;
  const sizes = values.map(Number);
  if (sizes.some(size => !Number.isSafeInteger(size)) || sizes.reduce((sum, size) => sum + size, 0) !== length) return;
  return sizes;
};

/** The lanes show one bracket level. Unary projections carry no grouping distinction. */
const forestPartition = (paths: SequencePaths, ids: readonly string[]): number[] | undefined => {
  const firstPath = paths.get(ids[0])!;
  let commonLength = firstPath.length;
  ids.slice(1).forEach(id => {
    const path = paths.get(id)!;
    let length = 0;
    while (length < commonLength && firstPath[length] === path[length]) length += 1;
    commonLength = length;
  });
  if (!commonLength) return;
  const positions = new Map(ids.map((id, index) => [id, index]));
  const brackets = (node: SyntaxNode): Brackets | undefined => {
    const position = node.id ? positions.get(node.id) : undefined;
    if (position !== undefined) return position;
    if (!node.children?.length) return;
    const children = node.children.map(brackets);
    // Omitting an unnamed occurrence inside the sequence would invent adjacency.
    if (children.some(child => child === undefined)) return;
    const complete = children as Brackets[];
    return complete.length === 1 ? complete[0] : complete;
  };
  const groups = brackets(firstPath[commonLength - 1]);
  if (!Array.isArray(groups)) return;
  const order: number[] = [];
  const sizes: number[] = [];
  for (const group of groups) {
    if (typeof group === 'number') {
      order.push(group);
      sizes.push(1);
    } else {
      // Nested groups cannot be faithfully expressed by the existing flat lanes.
      if (group.some(member => typeof member !== 'number')) return;
      order.push(...group as number[]);
      sizes.push(group.length);
    }
  }
  return order.length === ids.length && order.every((position, index) => position === index) ? sizes : undefined;
};

/**
 * Explicit partitions describe PF grouping and may differ from syntax. Infer from forests
 * only when those fields are absent; invalid authored rows never fall back to inference.
 */
export const prepareLocalDislocationContent = ({
  sequenceNodeIds, currentForest, priorForest, rows = [], values
}: LocalDislocationInput): LocalDislocationContent | undefined => {
  if (sequenceNodeIds.length < 2 || sequenceNodeIds.some(id => !id)
    || new Set(sequenceNodeIds).size !== sequenceNodeIds.length) return;
  const currentPaths = sequencePaths(currentForest, sequenceNodeIds);
  if (!currentPaths) return;
  // Raw values preserve explicitly empty arrays, which flattening to rows would erase.
  const hasAuthoredValues = values !== undefined
    && ['beforeGroupSizes', 'afterGroupSizes'].some(key => Object.hasOwn(values, key));
  const groupRows = (key: string): readonly string[] => {
    if (!hasAuthoredValues) return rows.filter(row => row.label === key).map(row => row.value);
    const value = values?.[key];
    return value === undefined ? [] : typeof value === 'string' ? [value] : value;
  };
  const beforeRows = groupRows('beforeGroupSizes');
  const afterRows = groupRows('afterGroupSizes');
  let beforeGroupSizes: number[] | undefined;
  let afterGroupSizes: number[] | undefined;
  if (hasAuthoredValues || beforeRows.length || afterRows.length) {
    beforeGroupSizes = authoredPartition(beforeRows, sequenceNodeIds.length);
    afterGroupSizes = authoredPartition(afterRows, sequenceNodeIds.length);
  } else {
    if (!priorForest) return;
    const priorPaths = sequencePaths(priorForest, sequenceNodeIds);
    if (!priorPaths) return;
    beforeGroupSizes = forestPartition(priorPaths, sequenceNodeIds);
    afterGroupSizes = forestPartition(currentPaths, sequenceNodeIds);
  }
  if (!beforeGroupSizes || !afterGroupSizes
    || beforeGroupSizes.length === afterGroupSizes.length
      && beforeGroupSizes.every((size, index) => size === afterGroupSizes[index])) return;
  return { kind: 'local-dislocation', beforeGroupSizes, afterGroupSizes };
};
