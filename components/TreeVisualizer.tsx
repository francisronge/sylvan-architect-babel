import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Sprout } from 'lucide-react';
import { DerivationStep, SyntaxNode } from '../types';

interface TreeVisualizerProps {
  data: SyntaxNode;
  animated?: boolean;
  derivationSteps?: DerivationStep[];
  abstractionMode?: boolean;
}

type HierNode = d3.HierarchyNode<SyntaxNode>;
type VisibleLink = d3.HierarchyLink<SyntaxNode>;

interface PlaybackStep {
  operation: DerivationStep['operation'];
  targetNodeId: string;
  targetLabel: string;
  sourceLabels: string[];
  recipe?: string;
  workspaceAfter?: string[];
  note?: string;
}

const getNodeId = (node: HierNode): string => (node as any).__vizId as string;
const STEP_DELAY_MS = 1000;

const buildFallbackSequence = (node: HierNode, visibleIds: Set<string>, out: HierNode[]) => {
  if (node.children) {
    node.children.forEach((child) => buildFallbackSequence(child, visibleIds, out));
  }
  if (visibleIds.has(getNodeId(node))) {
    out.push(node);
  }
};

const resolveNodeLabel = (node: HierNode): string => node.data.label || node.data.word || '';

const mapProvidedStepsToNodes = (
  visibleNodes: HierNode[],
  derivationSteps?: DerivationStep[]
): Map<string, DerivationStep> => {
  if (!derivationSteps || derivationSteps.length === 0) return new Map();

  const nodeById = new Map(visibleNodes.map((node) => [getNodeId(node), node]));
  const nodesByLabel = new Map<string, HierNode[]>();
  visibleNodes.forEach((node) => {
    const labelKey = resolveNodeLabel(node).trim().toUpperCase();
    if (!labelKey) return;
    const bucket = nodesByLabel.get(labelKey);
    if (bucket) {
      bucket.push(node);
    } else {
      nodesByLabel.set(labelKey, [node]);
    }
  });

  const used = new Set<string>();
  const mapped = new Map<string, DerivationStep>();

  for (const step of derivationSteps) {
    let chosen: HierNode | undefined;
    if (step.targetNodeId) {
      const explicit = nodeById.get(step.targetNodeId);
      if (explicit && !used.has(getNodeId(explicit))) {
        chosen = explicit;
      }
    }

    if (!chosen && step.targetLabel) {
      const bucket = nodesByLabel.get(step.targetLabel.trim().toUpperCase()) || [];
      chosen = bucket.find((node) => !used.has(getNodeId(node)));
    }

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
      sourceLabels,
      recipe: `${sourceLabels.join(' + ')} -> ${targetLabel}`,
      workspaceAfter: Array.from(workspace.values())
    });
  }

  return inferred;
};

const buildPlaybackSteps = (
  root: HierNode,
  visibleNodes: HierNode[],
  derivationSteps?: DerivationStep[]
): PlaybackStep[] => {
  const visibleIds = new Set(visibleNodes.map((node) => getNodeId(node)));
  const fallbackSequence: HierNode[] = [];
  buildFallbackSequence(root, visibleIds, fallbackSequence);
  const inferred = createInferredPlaybackSteps(fallbackSequence, visibleIds);

  if (!derivationSteps || derivationSteps.length === 0) return inferred;

  const mappedProvidedSteps = mapProvidedStepsToNodes(visibleNodes, derivationSteps);
  return inferred.map((step) => {
    const provided = mappedProvidedSteps.get(step.targetNodeId);
    if (!provided) return step;
    return {
      ...step,
      operation: provided.operation || step.operation,
      sourceLabels: provided.sourceLabels && provided.sourceLabels.length > 0 ? provided.sourceLabels : step.sourceLabels,
      recipe: provided.recipe || step.recipe,
      workspaceAfter: provided.workspaceAfter && provided.workspaceAfter.length > 0 ? provided.workspaceAfter : step.workspaceAfter,
      note: provided.note || step.note
    };
  });
};

const buildNodeStepIndex = (steps: PlaybackStep[]): Map<string, number> => {
  return new Map(steps.map((step, idx) => [step.targetNodeId, idx]));
};

const formatOperationLabel = (operation?: DerivationStep['operation']): string => {
  if (!operation) return 'Derivation';
  if (operation === 'LexicalSelect') return 'Select';
  return operation.replace(/([a-z])([A-Z])/g, '$1 $2');
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

const TreeVisualizer: React.FC<TreeVisualizerProps> = ({ data, animated = false, derivationSteps, abstractionMode = false }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const playbackSteps = useMemo(() => {
    if (!animated) return [];
    const hierarchy = d3.hierarchy(JSON.parse(JSON.stringify(data)));
    hierarchy.eachBefore((node, idx) => {
      (node as any).__vizId = `n${idx + 1}`;
    });
    if (abstractionMode) {
      markTriangulatedNodes(hierarchy);
    }
    const visibleNodes = hierarchy.descendants().filter((node) => !isUnderTriangulation(node));
    return buildPlaybackSteps(hierarchy, visibleNodes, derivationSteps);
  }, [animated, data, derivationSteps, abstractionMode]);

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
  }, [activeStepIndex, animated, data, dimensions, abstractionMode]);

  useEffect(() => {
    if (!data || !svgRef.current || dimensions.width === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width: containerWidth, height: containerHeight } = dimensions;

    const rootHierarchy = d3.hierarchy(JSON.parse(JSON.stringify(data)));
    const maxDepth = rootHierarchy.height;
    
    rootHierarchy.eachBefore((node, idx) => {
      (node as any).__vizId = `n${idx + 1}`;
    });

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

    const link = g.selectAll('.branch')
      .data(visibleLinks)
      .enter()
      .append('path')
      .attr('class', 'branch')
      .attr('fill', 'none')
      .attr('stroke', BRANCH_COLOR)
      .attr('stroke-width', 4)
      .attr('data-step', (d: any) => String(nodeStepIndex.get(getNodeId(d.target)) ?? 0))
      .attr('opacity', (d: any) => {
        const step = nodeStepIndex.get(getNodeId(d.target)) ?? 0;
        return step <= revealThreshold ? 0.6 : 0;
      })
      .style('transition', 'opacity 280ms ease')
      .attr('d', d3.linkVertical().x((d: any) => d.x).y((d: any) => d.y) as any);

    // 2. RENDER NODE GROUPS
    const nodeGroups = g.selectAll('.node-group')
      .data(visibleNodes)
      .enter()
      .append('g')
      .attr('class', 'node-group')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('data-step', (d) => String(nodeStepIndex.get(getNodeId(d)) ?? 0))
      .attr('opacity', (d) => {
        const step = nodeStepIndex.get(getNodeId(d)) ?? 0;
        return step <= revealThreshold ? 1 : 0;
      })
      .style('transition', 'opacity 260ms ease');

    // 3. CATEGORY LABELS (Internal Nodes) - PURE WHITE
    const categories = nodeGroups.filter(d => !!d.children && d.children.length > 0);
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
      .attr('y', 115) // Adjusted vertical offset for smaller font
      .attr('text-anchor', 'middle')
      .attr('font-size', '56px') // Reduced from 84px to be more proportional
      .attr('font-weight', '900')
      .attr('fill', TARGET_EMERALD)
      .attr('style', `fill: ${TARGET_EMERALD} !important; font-family: 'Quicksand', sans-serif; font-style: italic; paint-order: stroke; stroke: #020806; stroke-width: 8px;`)
      .style('fill', TARGET_EMERALD, 'important')
      .text(d => d.data.word || d.data.label);

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
      .attr('y', 155)
      .attr('text-anchor', 'middle')
      .attr('font-size', '52px') // Reduced for consistency
      .attr('font-weight', '900')
      .attr('fill', TARGET_EMERALD)
      .attr('style', `fill: ${TARGET_EMERALD} !important; font-family: 'Quicksand', sans-serif; font-style: italic; paint-order: stroke; stroke: #020806; stroke-width: 8px;`)
      .text((d: any) => (d as any).triangulatedWords);

    // Initial Viewport Setting
    const initialScale = Math.min(1, containerWidth / (innerWidth + margin.left + margin.right)) * 0.82;
    const initialX = containerWidth / 2 - (treeData as any).x * initialScale;
    const initialY = 160;
    svg.call(zoom.transform as any, d3.zoomIdentity.translate(initialX, initialY).scale(initialScale));

  }, [data, dimensions, animated, abstractionMode, derivationSteps]);

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
    setIsAutoPlaying(false);
    setActiveStepIndex((index) => Math.max(0, index - 1));
  };

  const handleNextStep = () => {
    setIsAutoPlaying(false);
    setActiveStepIndex((index) => Math.min(playbackSteps.length - 1, index + 1));
  };

  const handleTogglePlayback = () => {
    if (!animated || playbackSteps.length === 0) return;
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
                <Sprout size={12} className="text-emerald-700" />
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="text-[11px] text-emerald-100/80 font-semibold">
              {activeStep?.recipe || `${activeStep?.targetLabel || 'Node'} created`}
            </div>
            {activeStep?.workspaceAfter && activeStep.workspaceAfter.length > 0 && (
              <div className="text-[10px] uppercase tracking-[0.16em] text-emerald-400/65">
                Workspace: {activeStep.workspaceAfter.join(' | ')}
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
