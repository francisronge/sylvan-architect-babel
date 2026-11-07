import assert from 'node:assert/strict';
import test from 'node:test';
import { rawCases } from '../docs/design/visual-relations-lab-cards.ts';
import { toRendererStages } from '../docs/design/visual-relations-lab-adapter.ts';
import { availableTreeViewport, containCamera } from '../components/treeViewport.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildRenderableDerivationCanvasData, indexHierarchyNodesByIdAndAliases } from '../replay/replayCanvas.ts';
import { bindingDomainTreeRect } from '../replay/relations/bindingDomainGeometry.ts';
import { trajectoryPlaqueObstacles } from '../replay/relations/trajectoryObstacles.ts';
import { buildStageCameraBounds, measureStagePlaqueSpace, STAGE_CAMERA_PADDING } from '../replay/stageCamera.ts';

// Stage cameras that left relation marks under the Replay controls (Orchard
// cards K and G3, reproduced in the app at 1600×1200 and 1440×900).
const prepare = code => {
  const card = rawCases.find(item => item.archetype.startsWith(code));
  const derivationStages = toRendererStages(card.derivationStages);
  const prepared = prepareReplay({ derivationStages, sentence: card.sentence, includePlayback: true });
  return { derivationStages, steps: prepared.playbackSteps, plan: prepared.relationRenderPlan };
};
const stageInput = ({ derivationStages, steps, plan }, stageIndex, width, height) => ({ steps, stageIndex, plan, width, height,
  completedCanvas: buildRenderableDerivationCanvasData(derivationStages[stageIndex].workspaceForest) });

test('a long movement curve that bows past the stage margin widens the stage camera by that excess', () => {
  const card = prepare('K.');
  let checked = 0;
  card.derivationStages.forEach((_, stageIndex) => {
    const input = stageInput(card, stageIndex, 1596, 1076);
    const bounds = buildStageCameraBounds(input);
    const trajectories = input.plan.frames[stageIndex].items.filter(item => item.kind === 'trajectory');
    for (const { nodes } of measureStagePlaqueSpace(input).scenes) {
      // The binder's actual routes, sampled into boxes with 5 units of stroke room.
      for (const box of trajectoryPlaqueObstacles(input.plan, stageIndex, trajectories, indexHierarchyNodesByIdAndAliases(nodes))) {
        assert(box.y + box.height - 5 <= bounds.maxY + STAGE_CAMERA_PADDING.y + 1e-6,
          `stage ${stageIndex + 1}: a curve reaches ${Math.round(box.y + box.height - 5)}, past the fitted ${Math.round(bounds.maxY + STAGE_CAMERA_PADDING.y)}`);
        checked++;
      }
    }
  });
  assert(checked > 0, 'the card draws its movement curves');
});

test('argument-sharing ovals stay in the view their tree-first stage camera contains', () => {
  const card = prepare('G3.');
  const stageIndex = card.derivationStages.length - 1;
  for (const [width, height] of [[1436, 718], [1596, 1076], [386, 528]]) {
    const input = stageInput(card, stageIndex, width, height);
    const ordinary = buildStageCameraBounds({ ...input, includeOverlays: false });
    const containment = buildStageCameraBounds({ ...input, includeOverlays: false, includePlaques: true, includeDomainEnclosures: true });
    const view = availableTreeViewport(width, height, { headerBottom: 80, panelTop: height - 230 });
    const k = Math.min(1, (view.right - view.left) / (ordinary.maxX - ordinary.minX + 2 * STAGE_CAMERA_PADDING.x),
      (view.bottom - view.top) / (ordinary.maxY - ordinary.minY + 2 * STAGE_CAMERA_PADDING.y));
    const fit = { k, x: (view.left + view.right) / 2 - (ordinary.minX + ordinary.maxX) * k / 2,
      y: (view.top + view.bottom) / 2 - (ordinary.minY + ordinary.maxY) * k / 2 };
    const camera = containCamera(fit, {
      minX: Math.min(containment.minX, ordinary.minX - STAGE_CAMERA_PADDING.x), maxX: Math.max(containment.maxX, ordinary.maxX + STAGE_CAMERA_PADDING.x),
      minY: Math.min(containment.minY, ordinary.minY - STAGE_CAMERA_PADDING.y), maxY: Math.max(containment.maxY, ordinary.maxY + STAGE_CAMERA_PADDING.y)
    }, view);
    const domains = input.plan.frames[stageIndex].items.filter(item => item.familyId === 'argument-sharing.domains' && item.kind === 'domain-mark');
    assert.equal(domains.length, 2);
    for (const { nodes } of measureStagePlaqueSpace(input).scenes) {
      const byId = indexHierarchyNodesByIdAndAliases(nodes), visible = new Set(nodes);
      for (const domain of domains) {
        // The painted oval (sharingDrawing.ts): label ink padded and widened by √2, tilted 10°.
        const members = [domain.rootNodeId, domain.sharedNodeId].flatMap(id => byId.get(id)?.descendants() ?? []);
        const rect = bindingDomainTreeRect(members.filter(node => visible.has(node)));
        if (!rect) continue;
        const rx = (rect.width / 2 + 18) * Math.SQRT2, ry = (rect.height / 2 + 16) * Math.SQRT2, angle = Math.PI / 18;
        const bottom = rect.y + rect.height / 2 + Math.hypot(rx * Math.sin(angle), ry * Math.cos(angle));
        assert(camera.y + bottom * camera.k <= view.bottom + 1e-6,
          `${width}×${height}: an oval reaches ${Math.round(camera.y + bottom * camera.k - view.bottom)}px under the controls`);
      }
    }
  }
});
