import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { SyntaxNode } from '../types';

interface TreeVisualizerProps {
  data: SyntaxNode;
  animated?: boolean;
  abstractionMode?: boolean;
}

const TreeVisualizer: React.FC<TreeVisualizerProps> = ({ data, animated = false, abstractionMode = false }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

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
    if (!data || !svgRef.current || dimensions.width === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const { width: containerWidth, height: containerHeight } = dimensions;

    // Helper to extract words for triangulation mode
    const getTerminalWords = (node: SyntaxNode): string[] => {
      if (!node.children || node.children.length === 0) {
        return node.word ? [node.word] : [node.label];
      }
      return node.children.flatMap(getTerminalWords);
    };

    const rootHierarchy = d3.hierarchy(JSON.parse(JSON.stringify(data)));
    const maxDepth = rootHierarchy.height;
    
    // Animation Timing
    const LAYER_DELAY = 600;
    const TRANSITION_DUR = 800;

    // Logic for Triangulation (Abstraction Mode)
    if (abstractionMode) {
      rootHierarchy.each(d => {
        const label = (d.data.label || "").trim().toUpperCase();
        const isBackbone = 
          label.startsWith('CP') || 
          label.startsWith('INFLP') || 
          label.startsWith('TP') || 
          label.startsWith('VP') || 
          label.includes("'") || 
          label.includes("BAR") ||
          label === 'C' || label === 'INFL' || label === 'V' || label === 'T' || label === 'v';

        const isPhrase = label.endsWith('P');
        const terminals = getTerminalWords(d.data);

        if (isPhrase && !isBackbone && terminals.length >= 2) {
          (d as any).isTriangulated = true;
          (d as any).triangulatedWords = terminals.join(' ');
        }
      });
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

    // Helper to hide nodes tucked under a triangle
    const isUnderTriangulation = (d: d3.HierarchyNode<SyntaxNode>) => {
      let current = d.parent;
      while (current) {
        if ((current as any).isTriangulated) return true;
        current = current.parent;
      }
      return false;
    };

    const getDerivationDelay = (depth: number) => {
      return (maxDepth - depth) * LAYER_DELAY;
    };

    // 1. RENDER BRANCHES
    const link = g.selectAll('.branch')
      .data(treeData.links().filter(l => !isUnderTriangulation(l.target)))
      .enter()
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', BRANCH_COLOR)
      .attr('stroke-width', 4)
      .attr('opacity', 0.6)
      .attr('d', d3.linkVertical().x((d: any) => d.x).y((d: any) => d.y) as any);

    if (animated) {
      link.each(function(d: any) {
        const length = (this as SVGPathElement).getTotalLength();
        const delay = getDerivationDelay(d.target.depth);
        d3.select(this)
          .attr('stroke-dasharray', `${length} ${length}`)
          .attr('stroke-dashoffset', length)
          .transition()
          .delay(delay)
          .duration(TRANSITION_DUR)
          .attr('stroke-dashoffset', 0);
      });
    }

    // 2. RENDER NODE GROUPS
    const nodeGroups = g.selectAll('.node-group')
      .data(treeData.descendants().filter(d => !isUnderTriangulation(d)))
      .enter()
      .append('g')
      .attr('transform', (d) => `translate(${d.x},${d.y})`)
      .attr('opacity', animated ? 0 : 1);

    if (animated) {
      nodeGroups.each(function(d) {
        const delay = getDerivationDelay(d.depth);
        d3.select(this)
          .transition()
          .delay(delay)
          .duration(TRANSITION_DUR)
          .style('opacity', 1);
      });
    }

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

  }, [data, dimensions, animated, abstractionMode]);

  return (
    <div ref={containerRef} className="w-full h-full overflow-hidden border-2 border-white/5 rounded-[3rem] tree-canvas-bg shadow-2xl relative">
      <div className="absolute top-8 left-10 pointer-events-none z-10 opacity-30 select-none">
        <div className="text-[10px] font-black text-emerald-500 uppercase tracking-[0.6em] flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${abstractionMode ? 'bg-amber-500 shadow-[0_0_15px_#f59e0b]' : 'bg-emerald-500 shadow-[0_0_15px_#10b981]'}`}></div>
          {abstractionMode ? 'CONSTITUENT GLYPHING ACTIVE' : (animated ? 'DERIVATION SEQUENCE ACTIVE' : 'ARBORETUM CANOPY')}
        </div>
      </div>
      <svg ref={svgRef} className="cursor-grab active:cursor-grabbing w-full h-full block" />
    </div>
  );
};

export default TreeVisualizer;