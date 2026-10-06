import * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';

/** A stage has one current vertical unit even when construction temporarily adds
 * a workspace container. Reserve positions and lifetime contours use this same unit. */
export function stageVerticalGeometry(frames: readonly PlaybackStep[], height: number) {
  const completedCanvas = frames.find(step => step.replayKind === 'macro')?.replayCanvasData;
  const completesSingleTree = Boolean(completedCanvas && completedCanvas.replayOrigin?.kind !== 'workspace');
  const temporaryRootDepth = (canvas: SyntaxNode) => Number(completesSingleTree && canvas.replayOrigin?.kind === 'workspace');
  const depth = Math.max(1, ...frames.filter(step => step.replayCanvasData).map(step =>
    d3.hierarchy(step.replayCanvasData!).height - temporaryRootDepth(step.replayCanvasData!)));
  return { rowHeight: height / depth, temporaryRootDepth };
}
