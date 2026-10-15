import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './types.ts';
import { TREE_ROW_HEIGHT } from './treeSpacing.ts';

/** A stage has one current vertical unit even when construction temporarily adds
 * a workspace container. Reserve positions and lifetime contours use this same unit. */
export function stageVerticalGeometry(frames: readonly PlaybackStep[]) {
  const completedCanvas = frames.find(step => step.replayKind === 'macro')?.replayCanvasData;
  const completesSingleTree = Boolean(completedCanvas && completedCanvas.replayOrigin?.kind !== 'workspace');
  const temporaryRootDepth = (canvas: SyntaxNode) => Number(completesSingleTree && canvas.replayOrigin?.kind === 'workspace');
  return { rowHeight: TREE_ROW_HEIGHT, temporaryRootDepth };
}
