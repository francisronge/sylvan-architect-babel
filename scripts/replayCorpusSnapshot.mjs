import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { objectHash, sha256 } from './replayCorpusInputs.mjs';
import { layoutReplayFrames } from './replayFrameLayout.mjs';

const entries = ['replay/prepareReplay.ts', 'replay/stageCoordinates.ts', 'replay/stageCamera.ts',
  'replay/treeLayout.ts', 'replay/displayIdentity.ts', 'replay/workspaceShapeReflows.ts'];

async function sourceIdentity(root) {
  const files = new Map(), pending = [...entries, 'package.json', 'package-lock.json'];
  while (pending.length) {
    const name = pending.pop();
    if (files.has(name)) continue;
    const raw = await readFile(path.join(root, name), 'utf8');
    files.set(name, sha256(raw));
    for (const match of raw.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g))
      pending.push(path.normalize(path.join(path.dirname(name), match[1])));
  }
  const sources = [...files].sort(([left], [right]) => left.localeCompare(right));
  return { root, node: process.version, sha256: objectHash(sources), sources };
}

export async function buildCorpusSnapshot(root, records, { width, height, direction }) {
  const identity = await sourceIdentity(root);
  const [preparation, coordinates, camera, layout, display, continuity, d3] = await Promise.all([
    ...entries.map(name => import(pathToFileURL(path.join(root, name)).href)),
    import(pathToFileURL(path.join(root, 'node_modules/d3/src/index.js')).href)
  ]);
  const results = [];
  for (const record of records) {
    try {
      const input = structuredClone(record.input), authoredBeforeSha256 = objectHash(input.derivationStages);
      const prepared = preparation.prepareReplay(input), steps = prepared.playbackSteps;
      if (!steps.length) throw Error('Preparation produced no Replay frames');
      const { positions, render, scenes } = layoutReplayFrames({ steps, stages: input.derivationStages, width, height, direction },
        { coordinates, camera, layout, display, d3 });
      const invalid = [];
      const span = nodes => nodes.length ? Math.max(...nodes.map(node => node.x)) - Math.min(...nodes.map(node => node.x)) : 0;
      const frames = scenes.map((scene, index) => {
        for (const [id, node] of scene.nodes) {
          if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) invalid.push({ frame: index + 1, id, kind: 'nonfinite' });
          if (node.parent && scene.nodes.has(display.getNodeId(node.parent)) && node.y <= node.parent.y)
            invalid.push({ frame: index + 1, id, kind: 'branch-rank' });
          const children = (node.children ?? []).filter(child => scene.nodes.has(display.getNodeId(child)));
          if (children.some((child, childIndex) => childIndex && (direction === 'rtl'
            ? child.x >= children[childIndex - 1].x : child.x <= children[childIndex - 1].x)))
            invalid.push({ frame: index + 1, id, kind: 'sibling-order' });
        }
        const roots = [...scene.nodes.values()].filter(node => !node.parent || !scene.nodes.has(display.getNodeId(node.parent)));
        return { stage: scene.step.replayFrameIndex, kind: scene.step.replayKind, operation: scene.step.operation,
          target: scene.step.targetNodeId, relationIndex: scene.step.replayRelationIdentity?.relationIndex,
          points: [...scene.nodes].map(([id, node]) => ({ id, x: node.x, y: node.y })),
          widths: scene.step.replayKind === 'macro' ? [
            { root: '@forest', width: span([...scene.nodes.values()]) },
            ...roots.map(root => ({ root: display.getNodeId(root), width: span(root.descendants()
              .filter(node => scene.nodes.has(display.getNodeId(node)))) }))
          ] : [] };
      });
      const evidence = {
        movementMoments: steps.filter(step => step.replayKind === 'relation' && step.replayRelationIdentity
          && step.replayRelationLinks?.some(link => link.renderFamily === 'trajectory'
            && link.authoredRelationKey === `${step.replayRelationIdentity.stageIndex}:${step.replayRelationIdentity.relationIndex}`)).length,
        merges: steps.filter(step => step.operation === 'ExternalMerge').length,
        realizationGroups: input.derivationStages.reduce((count, stage) => count + (stage.realizations?.length ?? 0), 0),
        workspaceRoots: Math.max(...input.derivationStages.map(stage => stage.workspaceForest.length)),
        planStages: prepared.relationRenderPlan?.frames.map(frame => ({ stage: frame.stageIndex,
          facets: [...new Set(frame.items.map(item => item.tier2FacetId).filter(Boolean))],
          fallbackRelations: [...new Set(frame.items.filter(item => item.kind === 'fallback')
            .map(item => item.relationRef.relationIndex))] })) ?? []
      };
      const expectationFailures = [];
      for (const [key, field] of [['minMovementMoments', 'movementMoments'], ['minMerges', 'merges'],
        ['minRealizationGroups', 'realizationGroups'], ['minWorkspaceRoots', 'workspaceRoots']]) {
        if (record.expect[key] !== undefined && evidence[field] < record.expect[key])
          expectationFailures.push(`${key}: expected at least ${record.expect[key]}, got ${evidence[field]}`);
      }
      if (record.expect.maxMovementMoments !== undefined && evidence.movementMoments > record.expect.maxMovementMoments)
        expectationFailures.push(`maxMovementMoments: expected at most ${record.expect.maxMovementMoments}, got ${evidence.movementMoments}`);
      for (const check of record.expect.facets ?? []) {
        const present = evidence.planStages.find(frame => frame.stage === check.stage)?.facets.includes(check.facet) ?? false;
        if (present !== check.present) expectationFailures.push(`stage ${check.stage}: ${check.facet} presence must be ${check.present}`);
      }
      for (const check of record.expect.fallbacks ?? [])
        if (!evidence.planStages.find(frame => frame.stage === check.stage)?.fallbackRelations.includes(check.relationIndex))
          expectationFailures.push(`stage ${check.stage}: relation ${check.relationIndex} must retain its fallback`);
      for (const [index, check] of (record.expect.samePoints ?? []).entries()) {
        const points = check.map(({ node, ...selector }) => {
          const matches = frames.filter(frame => Object.entries(selector).every(([key, value]) => frame[key] === value));
          return matches.length === 1 ? matches[0].points.find(point => point.id === node) : undefined;
        });
        if (points.some(point => !point) || points.slice(1).some(point =>
          Math.hypot(point.x - points[0].x, point.y - points[0].y) > 1e-6))
          expectationFailures.push(`samePoints ${index}: the exact receiving attachment must keep its x and y`);
      }
      results.push({ id: record.id, inputSha256: objectHash(record.input), authoredBeforeSha256,
        authoredAfterSha256: objectHash(input.derivationStages), replaySha256: objectHash(steps),
        planSha256: objectHash(prepared.relationRenderPlan), frames, invalid,
        continuity: continuity.workspaceContinuityReflows(scenes, positions, render), evidence, expectationFailures });
    } catch (error) { results.push({ id: record.id, error: error.stack ?? String(error) }); }
  }
  const after = await sourceIdentity(root);
  if (identity.sha256 !== after.sha256) throw Error(`Sources changed while measuring ${root}`);
  return { identity, records: results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [requestPath, outputPath] = process.argv.slice(2);
  const request = JSON.parse(await readFile(requestPath, 'utf8'));
  const result = await buildCorpusSnapshot(request.root, request.records, request.layout);
  await writeFile(outputPath, JSON.stringify(result));
}
