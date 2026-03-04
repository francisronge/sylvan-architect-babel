import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { DerivationStep, FeatureCheckEvent, SyntaxNode } from '../types';
import { ResolvedMovementEventLink } from '../movementEvents';
import RootLogo from './RootLogo';

interface TreeVisualizerProps {
  data: SyntaxNode;
  animated?: boolean;
  derivationSteps?: DerivationStep[];
  resolvedMovementLinks?: ResolvedMovementEventLink[];
  abstractionMode?: boolean;
  sentence?: string;
}

type HierNode = d3.HierarchyNode<SyntaxNode>;
type VisibleLink = d3.HierarchyLink<SyntaxNode>;

interface PlaybackStep {
  operation: DerivationStep['operation'];
  targetNodeId: string;
  targetLabel: string;
  sourceNodeIds?: string[];
  sourceLabels: string[];
  recipe?: string;
  workspaceAfter?: string[];
  featureChecking?: FeatureCheckEvent[];
  note?: string;
}

interface MovementArrow {
  source: HierNode;
  target: HierNode;
  traceNode?: HierNode;
  step: number;
  index?: string | null;
}

const getNodeId = (node: HierNode): string => (node as any).__vizId as string;
const STEP_DELAY_MS = 1000;
const MOVEMENT_ARROW_COLOR = '#10b981';
const MOVEMENT_ARC_STROKE = 2.6;

const applyVizIds = (root: HierNode) => {
  const used = new Set<string>();
  let generated = 1;
  root.eachBefore((node) => {
    const raw = typeof node.data.id === 'string' ? node.data.id.trim() : '';
    let id = raw;
    if (!id || used.has(id)) {
      while (used.has(`n${generated}`)) generated += 1;
      id = `n${generated}`;
      generated += 1;
    }
    used.add(id);
    (node as any).__vizId = id;
  });
};

const resolveNodeLabel = (node: HierNode): string => node.data.label || node.data.word || '';
const resolveLeafSurface = (node: HierNode): string => (node.data.word || node.data.label || '').trim();
const NULL_LIKE_LABEL = /^(∅|Ø|ε|NULL|EPSILON)$/i;
const HEAD_CATEGORIES = new Set(['C', 'INFL', 'T', 'V', 'D', 'N', 'A', 'P']);
const NULLABLE_HEAD_CATEGORIES = new Set(['C', 'INFL', 'T', 'I', 'D', 'NEG', 'ASP']);
const EXPLICIT_NULL_TERMINAL = '∅';
const SUBSCRIPT_MAP: Record<string, string> = {
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9',
  'ᵢ': 'i', 'ⱼ': 'j', 'ₐ': 'a', 'ₑ': 'e', 'ₒ': 'o', 'ₓ': 'x', 'ₕ': 'h', 'ₖ': 'k', 'ₗ': 'l', 'ₘ': 'm',
  'ₙ': 'n', 'ₚ': 'p', 'ₛ': 's', 'ₜ': 't'
};

const isTraceLike = (label: string): boolean => {
  const text = label.trim();
  if (!text) return false;
  const normalized = [...text].map((ch) => SUBSCRIPT_MAP[ch] || ch).join('');
  const unwrapped = normalized.replace(/^[\s([{<⟨"']+|[\s)\]}>⟩"']+$/g, '');
  return (
    /^t\d*$/i.test(unwrapped) ||
    /^t(?:[_-](?:\{?[A-Za-z0-9]+\}?|\[[A-Za-z0-9]+\]|\([A-Za-z0-9]+\)))+$/i.test(unwrapped) ||
    /^trace\b/i.test(unwrapped) ||
    /^copy$/i.test(unwrapped) ||
    /^<[^>]+>$/.test(normalized) ||
    /^⟨[^⟩]+⟩$/.test(normalized)
  );
};

const normalizeToken = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/^<|>$/g, '')
    .replace(/^⟨|⟩$/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
};

const extractMovementIndex = (label: string): string | null => {
  const text = [...label.trim()].map((ch) => SUBSCRIPT_MAP[ch] || ch).join('');
  const braced = text.match(/_(?:\{|\[|\()([A-Za-z0-9]+)(?:\}|\]|\))$/);
  if (braced?.[1]) return braced[1].toLowerCase();
  const plain = text.match(/_([A-Za-z0-9]+)$/);
  if (plain?.[1]) return plain[1].toLowerCase();
  const danglingSubscript = text.match(/([A-Za-z0-9]+)$/);
  return danglingSubscript?.[1] && /[₀-₉ᵢⱼₐₑₒₓₕₖₗₘₙₚₛₜ]/.test(label) ? danglingSubscript[1].toLowerCase() : null;
};

const isNullLike = (label: string): boolean => NULL_LIKE_LABEL.test(label.trim());
const isIndexedSurface = (label: string): boolean => {
  const trimmed = label.trim();
  return Boolean(trimmed) && !isTraceLike(trimmed) && !isNullLike(trimmed) && Boolean(extractMovementIndex(trimmed));
};

const getReadyNodePriority = (node: HierNode): number => {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  if (hasChildren) return 1;
  const leaf = resolveLeafSurface(node);
  if (!leaf) return 2;
  if (isIndexedSurface(leaf)) return 2;
  if (isTraceLike(leaf)) return 3;
  if (isNullLike(leaf)) return 4;
  return 0;
};

const buildBottomUpSequence = (root: HierNode, visibleIds: Set<string>): HierNode[] => {
  const visibleNodes = root.descendants().filter((node) => visibleIds.has(getNodeId(node)));
  if (visibleNodes.length <= 1) return visibleNodes;

  const orderByTraversal = new Map<string, number>();
  visibleNodes.forEach((node, index) => orderByTraversal.set(getNodeId(node), index));

  const pendingChildren = new Map<string, number>();
  visibleNodes.forEach((node) => {
    const visibleChildCount = (node.children || []).filter((child) => visibleIds.has(getNodeId(child))).length;
    pendingChildren.set(getNodeId(node), visibleChildCount);
  });

  const ready: HierNode[] = visibleNodes.filter((node) => (pendingChildren.get(getNodeId(node)) ?? 0) === 0);
  const sequence: HierNode[] = [];

  const compareReady = (a: HierNode, b: HierNode): number => {
    const priorityDelta = getReadyNodePriority(a) - getReadyNodePriority(b);
    if (priorityDelta !== 0) return priorityDelta;

    const depthDelta = b.depth - a.depth;
    if (depthDelta !== 0) return depthDelta;

    return (orderByTraversal.get(getNodeId(a)) ?? 0) - (orderByTraversal.get(getNodeId(b)) ?? 0);
  };

  while (ready.length > 0) {
    ready.sort(compareReady);
    const current = ready.shift();
    if (!current) break;
    sequence.push(current);

    const parent = current.parent;
    if (!parent || !visibleIds.has(getNodeId(parent))) continue;

    const parentId = getNodeId(parent);
    const nextPending = (pendingChildren.get(parentId) ?? 0) - 1;
    pendingChildren.set(parentId, nextPending);
    if (nextPending === 0) {
      ready.push(parent);
    }
  }

  return sequence;
};

const mapProvidedStepsToNodes = (
  visibleNodes: HierNode[],
  derivationSteps?: DerivationStep[]
): Map<string, DerivationStep> => {
  if (!derivationSteps || derivationSteps.length === 0) return new Map();

  const nodeById = new Map(visibleNodes.map((node) => [getNodeId(node), node]));
  const used = new Set<string>();
  const mapped = new Map<string, DerivationStep>();

  for (const step of derivationSteps) {
    if (!step.targetNodeId) continue;
    const chosen = nodeById.get(step.targetNodeId);
    if (!chosen) continue;
    const targetNodeId = getNodeId(chosen);
    if (used.has(targetNodeId)) continue;
    used.add(targetNodeId);
    mapped.set(targetNodeId, step);
  }

  return mapped;
};

const createInferredPlaybackSteps = (
  fallbackSequence: HierNode[],
  visibleIds: Set<string>
): PlaybackStep[] => {
  const workspace = new Map<string, string>();
  const inferred: PlaybackStep[] = [];

  for (const node of fallbackSequence) {
    const nodeId = getNodeId(node);
    const targetLabel = resolveNodeLabel(node);
    const childNodes = (node.children || []).filter((child) => visibleIds.has(getNodeId(child)));
    const sourceLabels = childNodes.map((child) => resolveNodeLabel(child)).filter(Boolean);

    if (childNodes.length === 0) {
      workspace.set(nodeId, targetLabel);
      inferred.push({
        operation: 'LexicalSelect',
        targetNodeId: nodeId,
        targetLabel,
        sourceNodeIds: [],
        sourceLabels: [node.data.word || targetLabel],
        recipe: `Select ${node.data.word || targetLabel}`,
        workspaceAfter: Array.from(workspace.values())
      });
      continue;
    }

    childNodes.forEach((child) => workspace.delete(getNodeId(child)));
    workspace.set(nodeId, targetLabel);
    inferred.push({
      operation: childNodes.length === 1 ? 'Project' : 'ExternalMerge',
      targetNodeId: nodeId,
      targetLabel,
      sourceNodeIds: childNodes.map((child) => getNodeId(child)),
      sourceLabels,
      recipe: `${sourceLabels.join(' + ')} -> ${targetLabel}`,
      workspaceAfter: Array.from(workspace.values())
    });
  }

  return inferred;
};

const normalizeLabelKey = (label?: string): string => (label || "").trim().toUpperCase();
const isMoveLikeOperation = (operation?: DerivationStep['operation']): boolean =>
  operation === 'Move' || operation === 'InternalMerge';

const stepMatchesSourceLabel = (step: PlaybackStep, sourceLabel: string): boolean => {
  const normalizedSource = normalizeLabelKey(sourceLabel);
  if (!normalizedSource) return false;
  if (normalizeLabelKey(step.targetLabel) === normalizedSource) return true;

  const recipe = (step.recipe || "").trim().toUpperCase();
  if (!recipe) return false;
  return recipe.startsWith(`SELECT ${normalizedSource}`);
};

const getMovementDependencyIndex = (steps: PlaybackStep[], stepIndex: number): number => {
  const step = steps[stepIndex];
  if (!step) return stepIndex;
  if (!isMoveLikeOperation(step.operation)) return stepIndex;

  const sourceNodeIds = (step.sourceNodeIds || []).filter((id) => id && id !== step.targetNodeId);
  if (sourceNodeIds.length > 0) {
    let dependencyById = -1;
    sourceNodeIds.forEach((sourceId) => {
      steps.forEach((candidate, idx) => {
        if (idx === stepIndex) return;
        if (candidate.targetNodeId !== sourceId) return;
        dependencyById = Math.max(dependencyById, idx);
      });
    });
    if (dependencyById >= 0) return dependencyById;
  }

  const normalizedTarget = normalizeLabelKey(step.targetLabel);
  const sourceLabels = (step.sourceLabels || [])
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .filter((label) => normalizeLabelKey(label) !== normalizedTarget);

  if (sourceLabels.length === 0) return stepIndex;

  let dependencyIndex = -1;
  sourceLabels.forEach((sourceLabel) => {
    steps.forEach((candidate, idx) => {
      if (idx === stepIndex) return;
      if (!stepMatchesSourceLabel(candidate, sourceLabel)) return;
      dependencyIndex = Math.max(dependencyIndex, idx);
    });
  });

  return dependencyIndex;
};

const getTraceDependencyIndex = (steps: PlaybackStep[], stepIndex: number): number => {
  const step = steps[stepIndex];
  if (!step) return stepIndex;
  if (step.operation !== 'LexicalSelect') return stepIndex;
  if (!isTraceLike(step.targetLabel)) return stepIndex;

  const traceIndex = extractMovementIndex(step.targetLabel);
  if (!traceIndex) return stepIndex;

  let dependencyIndex = -1;

  steps.forEach((candidate, idx) => {
    if (idx === stepIndex) return;
    if (!isMoveLikeOperation(candidate.operation)) return;

    const sourceMentionsIndex = (candidate.sourceLabels || []).some((label) => extractMovementIndex(label) === traceIndex);
    const targetMentionsIndex = extractMovementIndex(candidate.targetLabel) === traceIndex;
    const recipeMentionsIndex = (candidate.recipe || '').toLowerCase().includes(`_${traceIndex}`);

    if (sourceMentionsIndex || targetMentionsIndex || recipeMentionsIndex) {
      dependencyIndex = Math.max(dependencyIndex, idx);
    }
  });

  if (dependencyIndex >= 0) return dependencyIndex;

  steps.forEach((candidate, idx) => {
    if (idx === stepIndex) return;
    if (candidate.operation !== 'LexicalSelect') return;
    const labelIndex = extractMovementIndex(candidate.targetLabel);
    if (!labelIndex || labelIndex !== traceIndex) return;
    if (isTraceLike(candidate.targetLabel)) return;
    dependencyIndex = Math.max(dependencyIndex, idx);
  });

  return dependencyIndex;
};

const reorderMovementSteps = (steps: PlaybackStep[]): PlaybackStep[] => {
  if (steps.length < 2) return steps;
  const reordered = [...steps];

  let changed = true;
  let safety = 0;
  while (changed && safety < reordered.length * reordered.length) {
    changed = false;
    safety += 1;

    for (let idx = 0; idx < reordered.length; idx += 1) {
      const step = reordered[idx];
      if (isMoveLikeOperation(step.operation)) {
        const dependencyIndex = getMovementDependencyIndex(reordered, idx);
        if (dependencyIndex >= idx) {
          const [current] = reordered.splice(idx, 1);
          const insertAt = Math.min(dependencyIndex, reordered.length - 1) + 1;
          reordered.splice(insertAt, 0, current);
          changed = true;
          break;
        }
      }

      if (step.operation === 'LexicalSelect' && isTraceLike(step.targetLabel)) {
        const traceDependencyIndex = getTraceDependencyIndex(reordered, idx);
        if (traceDependencyIndex >= idx) {
          const [current] = reordered.splice(idx, 1);
          const insertAt = Math.min(traceDependencyIndex, reordered.length - 1) + 1;
          reordered.splice(insertAt, 0, current);
          changed = true;
          break;
        }
      }
    }
  }

  return reordered;
};

const buildPlaybackSteps = (
  root: HierNode,
  visibleNodes: HierNode[],
  derivationSteps?: DerivationStep[]
): PlaybackStep[] => {
  const visibleIds = new Set(visibleNodes.map((node) => getNodeId(node)));
  const fallbackSequence = buildBottomUpSequence(root, visibleIds);
  const inferred = createInferredPlaybackSteps(fallbackSequence, visibleIds);

  if (!derivationSteps || derivationSteps.length === 0) return reorderMovementSteps(inferred);

  const mappedProvidedSteps = mapProvidedStepsToNodes(visibleNodes, derivationSteps);
  const withProvided = inferred.map((step) => {
    const provided = mappedProvidedSteps.get(step.targetNodeId);
    if (!provided) return step;
    return {
      ...step,
      operation: provided.operation || step.operation,
      sourceNodeIds: provided.sourceNodeIds && provided.sourceNodeIds.length > 0 ? provided.sourceNodeIds : step.sourceNodeIds,
      sourceLabels: provided.sourceLabels && provided.sourceLabels.length > 0 ? provided.sourceLabels : step.sourceLabels,
      recipe: provided.recipe || step.recipe,
      workspaceAfter: provided.workspaceAfter && provided.workspaceAfter.length > 0 ? provided.workspaceAfter : step.workspaceAfter,
      featureChecking: provided.featureChecking && provided.featureChecking.length > 0
        ? provided.featureChecking
        : step.featureChecking,
      note: provided.note || step.note
    };
  });

  return reorderMovementSteps(withProvided);
};

const buildNodeStepIndex = (steps: PlaybackStep[]): Map<string, number> => {
  return new Map(steps.map((step, idx) => [step.targetNodeId, idx]));
};

const buildMovementArrowsFromLinks = (
  visibleNodes: HierNode[],
  resolvedMovementLinks: ResolvedMovementEventLink[] | undefined,
  nodeStepIndex: Map<string, number>,
  playbackSteps: PlaybackStep[]
): MovementArrow[] => {
  if (!resolvedMovementLinks || resolvedMovementLinks.length === 0) return [];

  const nodeById = new Map(visibleNodes.map((node) => [getNodeId(node), node]));
  const arrows: MovementArrow[] = [];
  const seen = new Set<string>();
  const lastStep = playbackSteps.length > 0 ? playbackSteps.length - 1 : 0;

  resolvedMovementLinks.forEach((link) => {
    const source = nodeById.get(String(link.sourceAnchorId || '').trim());
    const target = nodeById.get(String(link.movedAnchorId || '').trim());
    const traceNode = link.traceAnchorId
      ? nodeById.get(String(link.traceAnchorId).trim()) || undefined
      : undefined;
    if (!source || !target) return;
    const sourceId = getNodeId(source);
    const targetId = getNodeId(target);
    if (sourceId === targetId) return;

    const key = `${sourceId}->${targetId}`;
    if (seen.has(key)) return;
    seen.add(key);

    const derivedStep = Math.max(
      nodeStepIndex.get(sourceId) ?? 0,
      nodeStepIndex.get(targetId) ?? 0,
      traceNode ? (nodeStepIndex.get(getNodeId(traceNode)) ?? 0) : 0
    );

    const rawStep = Number(link.stepIndex);
    const explicitStep = Number.isInteger(rawStep) && rawStep >= 0 ? rawStep : undefined;
    const step = explicitStep !== undefined ? Math.min(explicitStep, lastStep) : derivedStep;
    const index = String(link.movementIndex || '').trim().toLowerCase() || null;

    arrows.push({
      source,
      target,
      traceNode: traceNode || undefined,
      step,
      index
    });
  });

  return arrows;
};

const formatOperationLabel = (operation?: DerivationStep['operation']): string => {
  if (!operation) return 'Derivation';
  if (operation === 'LexicalSelect') return 'Select';
  return operation.replace(/([a-z])([A-Z])/g, '$1 $2');
};

const formatFeatureCheckingEntry = (entry: FeatureCheckEvent): string => {
  const probe = entry.probeLabel || entry.probeNodeId || '';
  const goal = entry.goalLabel || entry.goalNodeId || '';
  const status = entry.status ? `[${entry.status}]` : '';
  const value = entry.value ? `=${entry.value}` : '';
  const relation = probe && goal ? `${probe} -> ${goal}` : (probe || goal || '');
  const core = `${entry.feature}${value}`;
  const base = relation ? `${core} @ ${relation}` : core;
  return status ? `${base} ${status}` : base;
};

const getTerminalWords = (node: SyntaxNode): string[] => {
  if (!node.children || node.children.length === 0) {
    return node.word ? [node.word] : [node.label];
  }
  return node.children.flatMap(getTerminalWords);
};

const markTriangulatedNodes = (rootHierarchy: HierNode) => {
  rootHierarchy.each((d) => {
    const label = (d.data.label || "").trim().toUpperCase();
    const isBackbone =
      label.startsWith('CP') ||
      label.startsWith('INFLP') ||
      label.startsWith('TP') ||
      label.startsWith('VP') ||
      label.includes("'") ||
      label.includes("BAR") ||
      label === 'C' ||
      label === 'INFL' ||
      label === 'V' ||
      label === 'T' ||
      label === 'v';

    const isPhrase = label.endsWith('P');
    const terminals = getTerminalWords(d.data);

    if (isPhrase && !isBackbone && terminals.length >= 2) {
      (d as any).isTriangulated = true;
      (d as any).triangulatedWords = terminals.join(' ');
    }
  });
};

const isUnderTriangulation = (d: HierNode) => {
  let current = d.parent;
  while (current) {
    if ((current as any).isTriangulated) return true;
    current = current.parent;
  }
  return false;
};

const isAbstractCanopyLeaf = (rawLabel: string, overtSurfaceSet: Set<string> | null): boolean => {
  const raw = rawLabel.trim();
  if (!raw) return true;
  const normalized = normalizeToken(raw);
  if (normalized && overtSurfaceSet?.has(normalized)) {
    return false;
  }

  if (isTraceLike(raw)) return true;
  if (/^\[[^\]]+\]$/.test(raw)) return true;
  if (/^[+-][A-Za-z][A-Za-z0-9,_\-]*$/i.test(raw)) return true;
  if (/^-[A-Za-z]+$/i.test(raw)) return true;
  if (/^(pres|past|fut|tense|agr|agreement|phi|case|infl|cp|tp|ip)$/i.test(normalized)) return true;
  if (/^t(?:race)?_?[a-z0-9]+$/i.test(normalized)) return true;

  return false;
};

const pruneTracesForCanopy = (node: SyntaxNode, overtSurfaceSet: Set<string> | null): SyntaxNode => {
  const walk = (current: SyntaxNode, isRoot: boolean): SyntaxNode | null => {
    const rawLabel = (current.word || current.label || '').trim();
    const prunedChildren = (current.children || [])
      .map((child) => walk(child, false))
      .filter((child): child is SyntaxNode => Boolean(child));

    if (!isRoot && prunedChildren.length === 0 && isAbstractCanopyLeaf(rawLabel, overtSurfaceSet)) {
      return null;
    }

    if (!isRoot && current.children && prunedChildren.length === 0) {
      return null;
    }

    const next: SyntaxNode = { label: current.label };
    if (prunedChildren.length > 0) next.children = prunedChildren;
    if (prunedChildren.length === 0 && typeof current.word === 'string') next.word = current.word;
    return next;
  };

  return walk(node, true) || node;
};

const shouldExpandPreterminalLeaf = (node: SyntaxNode): boolean => {
  if (Array.isArray(node.children) && node.children.length > 0) return false;
  const label = String(node.label || '').trim();
  const word = typeof node.word === 'string' ? node.word.trim() : '';
  if (!label || !word) return false;
  if (normalizeToken(label) === normalizeToken(word)) return false;
  const normalizedCategory = label.replace(/['\s]/g, '').toUpperCase();
  return HEAD_CATEGORIES.has(normalizedCategory);
};

const materializeCanopyPreterminals = (node: SyntaxNode): SyntaxNode => {
  const walk = (current: SyntaxNode): SyntaxNode => {
    const children = Array.isArray(current.children) ? current.children.map(walk) : [];
    const next: SyntaxNode = { label: current.label };
    if (typeof current.id === 'string' && current.id.trim()) {
      next.id = current.id;
    }

    if (children.length > 0) {
      next.children = children;
      return next;
    }

    const word = typeof current.word === 'string' ? current.word.trim() : '';
    const normalizedCategory = String(current.label || '').replace(/['\s]/g, '').toUpperCase();

    if (!word && NULLABLE_HEAD_CATEGORIES.has(normalizedCategory)) {
      next.children = [{ label: EXPLICIT_NULL_TERMINAL, word: EXPLICIT_NULL_TERMINAL }];
      return next;
    }
    if (!word) return next;

    if (shouldExpandPreterminalLeaf(current)) {
      next.children = [{ label: word, word }];
      return next;
    }

    next.word = word;
    return next;
  };

  return walk(node);
};

const TreeVisualizer: React.FC<TreeVisualizerProps> = ({
  data,
  animated = false,
  derivationSteps,
  resolvedMovementLinks,
  abstractionMode = false,
  sentence = ''
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalMorphRef = useRef<Map<string, { preText: string; postText: string; step: number; hideBefore: boolean }>>(new Map());
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const derivationStepsSignature = useMemo(() => {
    const steps = derivationSteps || [];
    return steps
      .map((step, idx) => [
        idx,
        step.operation || '',
        step.targetNodeId || '',
        step.targetLabel || '',
        (step.sourceNodeIds || []).join(','),
        (step.sourceLabels || []).join(','),
        step.recipe || '',
        (step.featureChecking || [])
          .map((entry) => [
            entry.feature || '',
            entry.value || '',
            entry.status || '',
            entry.probeNodeId || '',
            entry.goalNodeId || '',
            entry.probeLabel || '',
            entry.goalLabel || '',
            entry.note || ''
          ].join(','))
          .join(';')
      ].join(':'))
      .join('|');
  }, [derivationSteps]);
  const movementLinksSignature = useMemo(() => {
    const links = resolvedMovementLinks || [];
    return links
      .map((link, idx) => [
        idx,
        link.movementIndex || '',
        link.sourceAnchorId || '',
        link.movedAnchorId || '',
        link.traceAnchorId || '',
        link.stepIndex ?? ''
      ].join(':'))
      .join('|');
  }, [resolvedMovementLinks]);
  const playbackSteps = useMemo(() => {
    if (!animated) return [];
    const hierarchy = d3.hierarchy(JSON.parse(JSON.stringify(data)));
    applyVizIds(hierarchy);
    if (abstractionMode) {
      markTriangulatedNodes(hierarchy);
    }
    const visibleNodes = hierarchy.descendants().filter((node) => !isUnderTriangulation(node));
    return buildPlaybackSteps(hierarchy, visibleNodes, derivationSteps);
  }, [animated, data, derivationSteps, abstractionMode]);
  const overtSurfaceSet = useMemo(() => {
    const tokens = String(sentence || '')
      .split(/\s+/)
      .map((token) => normalizeToken(token))
      .filter(Boolean);
    return tokens.length > 0 ? new Set(tokens) : null;
  }, [sentence]);
  const canvasData = useMemo(() => {
    if (animated) return data;
    const pruned = pruneTracesForCanopy(data, overtSurfaceSet);
    return materializeCanopyPreterminals(pruned);
  }, [animated, data, overtSurfaceSet]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observeTarget = containerRef.current;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setDimensions({ width, height });
      }
    });
    resizeObserver.observe(observeTarget);
    return () => resizeObserver.unobserve(observeTarget);
  }, []);

  useEffect(() => {
    if (!animated || playbackSteps.length === 0) {
      setActiveStepIndex(0);
      setIsAutoPlaying(false);
      return;
    }

    setActiveStepIndex(0);
    setIsAutoPlaying(true);
  }, [animated, playbackSteps, data]);

  useEffect(() => {
    if (!animated || !isAutoPlaying || isScrubbing || playbackSteps.length === 0) {
      return;
    }

    if (activeStepIndex >= playbackSteps.length - 1) {
      setIsAutoPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setActiveStepIndex((index) => Math.min(index + 1, playbackSteps.length - 1));
    }, STEP_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [activeStepIndex, animated, isAutoPlaying, isScrubbing, playbackSteps]);

  useEffect(() => {
    if (!isScrubbing) return;

    const clearScrubState = () => setIsScrubbing(false);
    window.addEventListener('pointerup', clearScrubState);
    window.addEventListener('pointercancel', clearScrubState);
    window.addEventListener('mouseup', clearScrubState);
    window.addEventListener('touchend', clearScrubState);
    window.addEventListener('touchcancel', clearScrubState);

    return () => {
      window.removeEventListener('pointerup', clearScrubState);
      window.removeEventListener('pointercancel', clearScrubState);
      window.removeEventListener('mouseup', clearScrubState);
      window.removeEventListener('touchend', clearScrubState);
      window.removeEventListener('touchcancel', clearScrubState);
    };
  }, [isScrubbing]);

  useEffect(() => {
    if (!svgRef.current) return;
    const revealThreshold = animated ? activeStepIndex : Number.MAX_SAFE_INTEGER;
    const svg = d3.select(svgRef.current);

    svg.selectAll<SVGPathElement, unknown>('.branch')
      .style('opacity', function () {
        const step = Number((this as SVGPathElement).getAttribute('data-step') || 0);
        return step <= revealThreshold ? '0.6' : '0';
      });

    svg.selectAll<SVGGElement, unknown>('.node-group')
      .style('opacity', function () {
        const step = Number((this as SVGGElement).getAttribute('data-step') || 0);
        return step <= revealThreshold ? '1' : '0';
      });

    svg.selectAll<SVGPathElement, unknown>('.movement-arrow')
      .style('opacity', function () {
        const step = Number((this as SVGPathElement).getAttribute('data-step') || 0);
        return step <= revealThreshold ? '0.95' : '0';
      });

    svg.selectAll<SVGTextElement, unknown>('.terminal-label')
      .text(function () {
        const element = this as SVGTextElement;
        const nodeId = element.getAttribute('data-node-id') || '';
        const fallback = element.getAttribute('data-default-label') || '';
        const morph = terminalMorphRef.current.get(nodeId);
        if (!morph) return fallback;
        if (revealThreshold < morph.step) {
          return morph.hideBefore ? '' : morph.preText;
        }
        return morph.postText;
      });
  }, [activeStepIndex, animated, data, dimensions, abstractionMode]);

  useEffect(() => {
    if (!canvasData || !svgRef.current || dimensions.width === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width: containerWidth, height: containerHeight } = dimensions;

    const rootHierarchy = d3.hierarchy(JSON.parse(JSON.stringify(canvasData)));
    const maxDepth = rootHierarchy.height;
    applyVizIds(rootHierarchy);

    // Logic for Triangulation (Abstraction Mode)
    if (abstractionMode) {
      markTriangulatedNodes(rootHierarchy);
    }

    const nodeCount = rootHierarchy.descendants().length;
    const width = Math.max(containerWidth * 1.5, nodeCount * 180);
    const height = Math.max(containerHeight, (maxDepth + 2) * 220);
    
    const margin = { top: 120, right: 300, bottom: 400, left: 300 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.attr('width', '100%').attr('height', '100%').append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 10])
      .on('zoom', (event) => g.attr('transform', event.transform));
    svg.call(zoom as any);

    const treeLayout = d3.tree<SyntaxNode>()
      .size([innerWidth, innerHeight])
      .separation((a, b) => (a.parent === b.parent ? 2.5 : 3.5));

    const treeData = treeLayout(rootHierarchy);
    
    // COLOR PALETTE - ABSOLUTE CONSTANTS
    const BRANCH_COLOR = '#593a0e';
    const PURE_WHITE = '#ffffff';
    const TARGET_EMERALD = '#10b981';

    // 1. RENDER BRANCHES
    const visibleNodes = treeData.descendants().filter((node) => !isUnderTriangulation(node));
    const visibleLinks = treeData.links().filter((link) => !isUnderTriangulation(link.target)) as VisibleLink[];
    const inferredTimeline = buildPlaybackSteps(rootHierarchy, visibleNodes, derivationSteps);
    const timeline = animated && playbackSteps.length > 0 ? playbackSteps : inferredTimeline;
    const nodeStepIndex = buildNodeStepIndex(timeline);
    const revealThreshold = animated ? activeStepIndex : Number.MAX_SAFE_INTEGER;
    const movementArrows = animated && !abstractionMode
      ? buildMovementArrowsFromLinks(visibleNodes, resolvedMovementLinks, nodeStepIndex, timeline)
      : [];
    const nodeRevealStepIndex = new Map(nodeStepIndex);
    const terminalMorph = new Map<string, { preText: string; postText: string; step: number; hideBefore: boolean }>();
    const buildTraceLabel = (index?: string | null): string => (index ? `t_{${index}}` : 't');

    movementArrows.forEach((arrow) => {
      const sourceId = getNodeId(arrow.source);
      const targetId = getNodeId(arrow.target);
      const sourceStep = nodeRevealStepIndex.get(sourceId) ?? 0;
      const targetStep = nodeRevealStepIndex.get(targetId) ?? 0;
      nodeRevealStepIndex.set(sourceId, Math.min(sourceStep, targetStep, arrow.step));
      nodeRevealStepIndex.set(targetId, Math.max(targetStep, arrow.step));
      if (arrow.traceNode) {
        const traceId = getNodeId(arrow.traceNode);
        const traceStep = nodeRevealStepIndex.get(traceId) ?? 0;
        nodeRevealStepIndex.set(traceId, Math.min(traceStep, arrow.step));
      }

      if ((arrow.source.children && arrow.source.children.length > 0) || (arrow.target.children && arrow.target.children.length > 0)) {
        return;
      }

      const sourceSurface = resolveLeafSurface(arrow.source);
      const targetSurface = resolveLeafSurface(arrow.target);
      if (!targetSurface) return;

      const traceAnchor = arrow.traceNode || (isTraceLike(sourceSurface) ? arrow.source : null);
      if (traceAnchor) {
        const traceId = getNodeId(traceAnchor);
        const traceSurface = resolveLeafSurface(traceAnchor);
        const movementIndex = arrow.index || extractMovementIndex(traceSurface) || extractMovementIndex(targetSurface) || null;
        terminalMorph.set(traceId, {
          preText: targetSurface,
          postText: isTraceLike(traceSurface) ? traceSurface : buildTraceLabel(movementIndex),
          step: arrow.step,
          hideBefore: false
        });
      }

      terminalMorph.set(targetId, {
        preText: '',
        postText: targetSurface,
        step: arrow.step,
        hideBefore: true
      });
    });

    terminalMorphRef.current = terminalMorph;

    const link = g.selectAll('.branch')
      .data(visibleLinks)
      .enter()
      .append('path')
      .attr('class', 'branch')
      .attr('fill', 'none')
      .attr('stroke', BRANCH_COLOR)
      .attr('stroke-width', 4)
      .attr('data-step', (d: any) => String(nodeRevealStepIndex.get(getNodeId(d.target)) ?? 0))
      .attr('opacity', (d: any) => {
        const step = nodeRevealStepIndex.get(getNodeId(d.target)) ?? 0;
        return step <= revealThreshold ? 0.6 : 0;
      })
      .style('transition', 'opacity 280ms ease')
      .attr('d', d3.linkVertical().x((d: any) => d.x).y((d: any) => d.y) as any);

    if (movementArrows.length > 0) {
      const defs = g.append('defs');
      defs.append('marker')
        .attr('id', 'movement-arrowhead')
        .attr('viewBox', '0 0 10 10')
        .attr('refX', 9)
        .attr('refY', 5)
        .attr('markerWidth', 7)
        .attr('markerHeight', 7)
        .attr('orient', 'auto-start-reverse')
        .append('path')
        .attr('d', 'M 0 0 L 10 5 L 0 10 z')
        .attr('fill', MOVEMENT_ARROW_COLOR);

      g.selectAll('.movement-arrow')
        .data(movementArrows)
        .enter()
        .append('path')
        .attr('class', 'movement-arrow')
        .attr('fill', 'none')
        .attr('stroke', MOVEMENT_ARROW_COLOR)
        .attr('stroke-width', MOVEMENT_ARC_STROKE)
        .attr('stroke-linecap', 'round')
        .attr('marker-end', 'url(#movement-arrowhead)')
        .attr('data-step', (arrow) => String(arrow.step))
        .style('transition', 'opacity 260ms ease')
        .attr('opacity', (arrow) => (arrow.step <= revealThreshold ? 0.9 : 0))
        .style('filter', 'drop-shadow(0 0 4px rgba(16,185,129,0.35))')
        .attr('d', (arrow) => {
          const direction = Math.sign(arrow.target.x - arrow.source.x) || 1;
          const sx = arrow.source.x + 8 * direction;
          const sy = arrow.source.y + 24;
          const tx = arrow.target.x - 8 * direction;
          const ty = arrow.target.y + 24;
          const controlX = (sx + tx) / 2;
          const controlY = Math.max(sy, ty) + Math.max(42, Math.abs(tx - sx) * 0.2);
          return `M ${sx} ${sy} Q ${controlX} ${controlY}, ${tx} ${ty}`;
        });
    }

    // 2. RENDER NODE GROUPS
    const nodeGroups = g.selectAll('.node-group')
      .data(visibleNodes)
      .enter()
      .append('g')
      .attr('class', 'node-group')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('data-step', (d) => String(nodeRevealStepIndex.get(getNodeId(d)) ?? 0))
      .attr('opacity', (d) => {
        const step = nodeRevealStepIndex.get(getNodeId(d)) ?? 0;
        return step <= revealThreshold ? 1 : 0;
      })
      .style('transition', 'opacity 260ms ease');

    // 3. CATEGORY LABELS (Internal Nodes) - PURE WHITE
    const categories = nodeGroups.filter((d) =>
      (Boolean(d.children) && d.children.length > 0) || shouldExpandPreterminalLeaf(d.data)
    );
    categories.append('text')
      .attr('y', -10)
      .attr('text-anchor', 'middle')
      .attr('font-size', '42px') // Slightly reduced to balance visuals
      .attr('font-weight', '900')
      .attr('fill', PURE_WHITE)
      .style('fill', PURE_WHITE, 'important')
      .style('font-family', 'Quicksand, sans-serif')
      .style('paint-order', 'stroke')
      .style('stroke', '#020806')
      .style('stroke-width', '10px')
      .text(d => d.data.label);

    // 4. TERMINAL WORDS (Leaf Nodes) - ABSOLUTE EMERALD
    const terminals = nodeGroups.filter(d => !d.children || d.children.length === 0);

    // Render leaf node text in Emerald - Reduced Font Size
    terminals.append('text')
      .attr('class', 'terminal-label')
      .attr('data-node-id', (d) => getNodeId(d))
      .attr('data-default-label', (d) => d.data.word || d.data.label || '')
      .attr('y', 115) // Adjusted vertical offset for smaller font
      .attr('text-anchor', 'middle')
      .attr('font-size', '56px') // Reduced from 84px to be more proportional
      .attr('font-weight', '900')
      .attr('fill', TARGET_EMERALD)
      .attr('style', `fill: ${TARGET_EMERALD} !important; font-family: 'Quicksand', sans-serif; font-style: italic; paint-order: stroke; stroke: #020806; stroke-width: 8px;`)
      .style('fill', TARGET_EMERALD, 'important')
      .text(d => {
        const nodeId = getNodeId(d);
        const fallback = d.data.word || d.data.label || '';
        const morph = terminalMorphRef.current.get(nodeId);
        if (!morph) return fallback;
        if (revealThreshold < morph.step) {
          return morph.hideBefore ? '' : morph.preText;
        }
        return morph.postText;
      });

    // Vertical dashed connection for leaf nodes
    terminals.append('line')
      .attr('x1', 0).attr('y1', 20).attr('x2', 0).attr('y2', 65)
      .attr('stroke', BRANCH_COLOR).attr('stroke-width', 3).attr('stroke-dasharray', '8,8').attr('opacity', 0.6);

    // 5. ABSTRACTION MODE (Triangles)
    const triangles = nodeGroups.filter((d: any) => d.isTriangulated);
    triangles.selectAll('text').remove();
    triangles.append('path')
      .attr('d', d => {
        const wordString = (d as any).triangulatedWords;
        const textWidth = wordString.length * 20;
        const half = Math.max(70, textWidth / 2 + 30);
        return `M 0,25 L ${-half},110 L ${half},110 Z`;
      })
      .attr('fill', 'rgba(16, 185, 129, 0.2)')
      .attr('stroke', PURE_WHITE)
      .attr('stroke-width', 3);

    triangles.append('text')
      .attr('y', 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', '38px')
      .attr('font-weight', '900')
      .attr('fill', PURE_WHITE)
      .style('fill', PURE_WHITE, 'important')
      .style('font-family', 'Quicksand, sans-serif')
      .style('paint-order', 'stroke')
      .style('stroke', '#020806')
      .style('stroke-width', '9px')
      .text((d) => d.data.label || '');

    triangles.append('text')
      .attr('y', 155)
      .attr('text-anchor', 'middle')
      .attr('font-size', '52px') // Reduced for consistency
      .attr('font-weight', '900')
      .attr('fill', TARGET_EMERALD)
      .attr('style', `fill: ${TARGET_EMERALD} !important; font-family: 'Quicksand', sans-serif; font-style: italic; paint-order: stroke; stroke: #020806; stroke-width: 8px;`)
      .text((d: any) => (d as any).triangulatedWords);

    // Initial viewport fit:
    // Use actual rendered bounds so terminal labels are not clipped/off-canvas.
    const fitToRenderedBounds = () => {
      const rendered = g.node() as SVGGElement | null;
      if (!rendered) return false;

      const bbox = rendered.getBBox();
      if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height) || bbox.width <= 0 || bbox.height <= 0) {
        return false;
      }

      const viewportPadX = 28;
      const viewportPadTop = 34;
      // Reserve space for bottom overlays (input tray / growth controls) so terminals remain visible.
      const viewportPadBottom = animated ? 170 : 250;
      const availableWidth = Math.max(120, containerWidth - viewportPadX * 2);
      const availableHeight = Math.max(120, containerHeight - viewportPadTop - viewportPadBottom);

      const scaleX = availableWidth / bbox.width;
      const scaleY = availableHeight / bbox.height;
      const initialScale = Math.max(0.06, Math.min(scaleX, scaleY, 1));

      const bboxCenterX = bbox.x + bbox.width / 2;
      const bboxCenterY = bbox.y + bbox.height / 2;
      const targetCenterX = containerWidth / 2;
      const targetCenterY = viewportPadTop + availableHeight / 2;
      const initialX = targetCenterX - bboxCenterX * initialScale;
      const initialY = targetCenterY - bboxCenterY * initialScale;

      svg.call(zoom.transform as any, d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
      return true;
    };

    if (!fitToRenderedBounds() && visibleNodes.length > 0) {
      // Fallback fit in case getBBox is unavailable.
      const minNodeX = d3.min(visibleNodes, (node) => node.x) ?? 0;
      const maxNodeX = d3.max(visibleNodes, (node) => node.x) ?? 0;
      const minNodeY = d3.min(visibleNodes, (node) => node.y) ?? 0;
      const maxNodeY = d3.max(visibleNodes, (node) => node.y + (!node.children || node.children.length === 0 ? 130 : 0)) ?? 0;
      const contentWidth = Math.max(1, (maxNodeX - minNodeX) + 440);
      const contentHeight = Math.max(1, (maxNodeY - minNodeY) + 320);
      const scaleX = Math.max(0.01, (containerWidth - 56) / contentWidth);
      const scaleY = Math.max(0.01, (containerHeight - 220) / contentHeight);
      const initialScale = Math.max(0.06, Math.min(scaleX, scaleY, 1));
      const centerX = (minNodeX + maxNodeX) / 2;
      const centerY = (minNodeY + maxNodeY) / 2;
      const initialX = containerWidth / 2 - centerX * initialScale;
      const initialY = (containerHeight - 140) / 2 - centerY * initialScale;
      svg.call(zoom.transform as any, d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));
    }

  }, [canvasData, dimensions, animated, abstractionMode, derivationStepsSignature, movementLinksSignature]);

  const activeStep = animated && playbackSteps.length > 0
    ? playbackSteps[Math.min(activeStepIndex, playbackSteps.length - 1)]
    : null;
  const stepPercent = playbackSteps.length > 1
    ? (activeStepIndex / (playbackSteps.length - 1)) * 100
    : 0;
  const operationLabel = formatOperationLabel(activeStep?.operation);
  const canStepBackward = animated && playbackSteps.length > 0 && activeStepIndex > 0;
  const canStepForward = animated && playbackSteps.length > 0 && activeStepIndex < playbackSteps.length - 1;

  const handlePrevStep = () => {
    setIsScrubbing(false);
    setIsAutoPlaying(false);
    setActiveStepIndex((index) => Math.max(0, index - 1));
  };

  const handleNextStep = () => {
    setIsScrubbing(false);
    setIsAutoPlaying(false);
    setActiveStepIndex((index) => Math.min(playbackSteps.length - 1, index + 1));
  };

  const handleTogglePlayback = () => {
    if (!animated || playbackSteps.length === 0) return;
    setIsScrubbing(false);
    if (activeStepIndex >= playbackSteps.length - 1) {
      setActiveStepIndex(0);
      setIsAutoPlaying(true);
      return;
    }
    setIsAutoPlaying((playing) => !playing);
  };

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden border-2 border-white/5 rounded-[3rem] tree-canvas-bg shadow-2xl relative">
      <div className="absolute top-8 left-10 pointer-events-none z-10 opacity-30 select-none">
        <div className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.6em] flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${abstractionMode ? 'bg-amber-500 shadow-[0_0_15px_#f59e0b]' : 'bg-emerald-500 shadow-[0_0_15px_#10b981]'}`}></div>
          {abstractionMode ? 'CONSTITUENT GLYPHING ACTIVE' : (animated ? 'DERIVATION SEQUENCE ACTIVE' : 'ARBORETUM CANOPY')}
        </div>
        {animated && playbackSteps.length > 0 && (
          <div className="mt-2 text-[9px] font-black text-emerald-500/80 uppercase tracking-[0.35em]">
            Step {activeStepIndex + 1}/{playbackSteps.length}
            {activeStep?.recipe ? ` - ${activeStep.recipe}` : ''}
          </div>
        )}
      </div>
      {animated && playbackSteps.length > 0 && (
        <div className="absolute left-10 bottom-28 z-40 w-[min(640px,calc(100%-9rem))] bg-black/60 backdrop-blur-lg border border-white/10 rounded-2xl p-4 shadow-2xl">
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              onClick={handlePrevStep}
              disabled={!canStepBackward}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] text-white/70 enabled:hover:text-emerald-300 enabled:hover:border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={handleTogglePlayback}
              className="px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300 hover:bg-emerald-500/20"
            >
              {isAutoPlaying ? 'Pause' : (activeStepIndex >= playbackSteps.length - 1 ? 'Replay' : 'Play')}
            </button>
            <button
              type="button"
              onClick={handleNextStep}
              disabled={!canStepForward}
              className="px-3 py-1.5 rounded-lg border border-white/10 text-[10px] font-black uppercase tracking-[0.2em] text-white/70 enabled:hover:text-emerald-300 enabled:hover:border-emerald-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
            <div className="ml-auto text-[10px] font-black tracking-[0.14em] text-emerald-400/80">
              {operationLabel}
            </div>
          </div>
          <div className="relative h-8">
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-2 bg-black/50 rounded-full border border-white/5" />
            <div
              className={`absolute left-0 top-1/2 -translate-y-1/2 h-2 bg-[#064e3b] rounded-full ${isScrubbing ? '' : 'transition-all duration-150'}`}
              style={{ width: `${stepPercent}%` }}
            />
            <input
              type="range"
              min={0}
              max={Math.max(playbackSteps.length - 1, 0)}
              value={activeStepIndex}
              onPointerDown={() => {
                setIsAutoPlaying(false);
                setIsScrubbing(true);
              }}
              onPointerUp={() => setIsScrubbing(false)}
              onPointerCancel={() => setIsScrubbing(false)}
              onMouseUp={() => setIsScrubbing(false)}
              onTouchEnd={() => setIsScrubbing(false)}
              onBlur={() => setIsScrubbing(false)}
              onChange={(event) => {
                setIsAutoPlaying(false);
                setActiveStepIndex(Number(event.target.value));
              }}
              className="derivation-slider absolute inset-0 w-full h-full z-10"
            />
            <div
              className={`absolute top-1/2 -translate-y-1/2 pointer-events-none ${isScrubbing ? '' : 'transition-all duration-150'}`}
              style={{ left: `${stepPercent}%`, transform: 'translate(-50%, -50%)' }}
            >
              <div className="w-5 h-5 rounded-full bg-emerald-100 border border-emerald-200 flex items-center justify-center shadow-[0_0_12px_rgba(167,243,208,0.75)]">
                <RootLogo size={12} blend={false} zoom={1.12} />
              </div>
            </div>
          </div>
	          <div className="mt-3 space-y-1.5">
	            <div className="text-[11px] text-emerald-100/80 font-semibold">
	              {activeStep?.recipe || `${activeStep?.targetLabel || 'Node'} created`}
	            </div>
	            {activeStep?.workspaceAfter && activeStep.workspaceAfter.length > 0 && (
	              <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-400/65">
	                Derivation Set: {activeStep.workspaceAfter.join(' | ')}
	              </div>
	            )}
            {activeStep?.featureChecking && activeStep.featureChecking.length > 0 && (
              <div className="pt-1">
                <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-300/75 mb-1">
                  Feature Checking
                </div>
                <div className="space-y-0.5">
                  {activeStep.featureChecking.map((entry, idx) => (
                    <div key={`${entry.feature}-${idx}`} className="text-[11px] text-emerald-100/75">
                      {formatFeatureCheckingEntry(entry)}
                      {entry.note ? ` - ${entry.note}` : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activeStep?.note && (
              <div className="text-[11px] text-emerald-50/70 italic">
                {activeStep.note}
              </div>
            )}
          </div>
        </div>
      )}
      <svg ref={svgRef} className="cursor-grab active:cursor-grabbing w-full h-full block" />
      <style>{`
        .derivation-slider {
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          cursor: pointer;
        }
        .derivation-slider::-webkit-slider-runnable-track {
          height: 100%;
          background: transparent;
        }
        .derivation-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 1px;
          height: 1px;
          opacity: 0;
        }
        .derivation-slider::-moz-range-track {
          height: 100%;
          background: transparent;
          border: 0;
        }
        .derivation-slider::-moz-range-thumb {
          width: 1px;
          height: 1px;
          opacity: 0;
          border: 0;
        }
      `}</style>
    </div>
  );
};

export default TreeVisualizer;
