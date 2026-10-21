import { buildRenderableDerivationCanvasData } from '../replay/replayCanvas.ts';
import { buildStageCameraBounds } from '../replay/stageCamera.ts';
import type { SyntaxNode } from '../types.ts';

type StageCameraInput = Parameters<typeof buildStageCameraBounds>[0];

/**
 * Frames the active stage's own workspace. Normalization accepts an empty
 * workspace before the final stage; it has no syntax to frame, so the stage
 * contributes no camera bounds and the ordinary fit applies.
 */
export function activeStageCameraBounds(forest: SyntaxNode[], input: Omit<StageCameraInput, 'completedCanvas'>) {
  const completedCanvas = buildRenderableDerivationCanvasData(forest);
  return completedCanvas ? buildStageCameraBounds({ ...input, completedCanvas }) : null;
}
