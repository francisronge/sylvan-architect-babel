import { verticalObstacleIndex } from './verticalObstacleIndex.ts';
import { workspaceVisualScore, compareWorkspaceVisualScores, workspaceGapProposals, adjustWorkspaceGapPreference, workspaceRealizedGap, workspaceFinalWidth, keepsWorkspaceFinalWidth, keepsWorkspaceFinalExtent, workspaceVisualSummary, type WorkspaceVisualSummary, type WorkspaceVisualScore } from './workspaceVisualScore.ts';
import { withinWorkspaceVisualPreference } from './workspaceVisualPreference.ts';
import { workspaceNativeVerticalReference, matchesWorkspaceNativeVerticalReference } from './workspaceNativeVerticalReference.ts';
import { currentForkBranchesClear } from './workspaceForkClearance.ts';
import type * as d3 from 'd3';
import type { SyntaxNode } from '../types.ts';
import type { PlaybackStep } from './replayCompiler.ts';
import { getNodeId } from './displayIdentity.ts';
import type { TreeCoordinateReservation, TreeDirection } from './treeLayout.ts';
import { workspaceContinuityReflows } from './workspaceShapeReflows.ts';
import { treeInkObstacles, prepareTreeInkSubtrees, type TreeInkTextMeasure } from './treeInkGeometry.ts';
import type { CategoryTextMeasure } from './categoryTextLayout.ts';
import type { PreparedTreeLabelRuns, TreeLabelMeasure } from './treeLabelRuns.ts';
import { cubicIntersectsRect } from './relations/curveClearance.ts';
import { WorkspaceContourClearanceError, prepareWorkspaceLifetimeContours, workspaceContourCandidates, type Point, type ContourFrame } from './workspaceLifetimeContours.ts';
import { rigidPoseGraph } from './workspacePoseGraph.ts';
import { placeRigidGroups } from './workspacePosePlacement.ts';
import { pairedWorkspaceClearance, WORKSPACE_PAIRED_EVALUATION_LIMIT } from './workspacePairedClearance.ts';
import { workspaceAlternateSeeds, WORKSPACE_ALTERNATE_SEED_LIMIT } from './workspaceAlternateSeeds.ts';
import { evaluateWorkspaceClearance, WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS, WORKSPACE_SEED_CLEARANCE_CORRECTIONS } from './workspaceClearancePreference.ts';
type Node = d3.HierarchyPointNode<SyntaxNode>;
type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
type Scene = {
  step: PlaybackStep;
  canvas: SyntaxNode;
  size: [
    number,
    number
  ];
  currentRowHeight?: number;
  nodes: Map<string, Node>;
  coordinates: TreeCoordinateReservation;
};
type Render = (scene: Scene, coordinates: TreeCoordinateReservation) => Node[];
type Measurements = {
  measureCategoryText?: CategoryTextMeasure;
  measureTreeInk?: TreeInkTextMeasure;
  treeLabelRuns?: PreparedTreeLabelRuns;
  measureTreeLabel?: TreeLabelMeasure;
};
type Reflow = {
  index: number;
  rootId: string;
  kind?: 'unchanged-subtree-shape' | 'unowned-component-motion';
};
export type CoherentWorkspaceDiagnostic = {
  status: 'unchanged' | 'resolved' | 'infeasible';
  reflows: readonly Reflow[];
  reason?: 'contour' | 'temporal-constraints' | 'clearance' | 'render-validation';
  detail?: string;
  evaluations: number;
  pairedEvaluations?: number;
  alternateSeedEvaluations?: number;
  alternateSeedCorrections?: number;
  corrections: number;
  timings?: {
    detection: number;
    preparation: number;
    search: number;
    validation: number;
    total: number;
  };
  visualHistory?: readonly (WorkspaceVisualSummary & { finalWidth: number })[];
  finalDeviation?: {
    maxX: number;
    beforeWidth: number;
    afterWidth: number;
  };
};
export type CoherentWorkspaceResult = {
  coordinates: Reservations;
  diagnostic: CoherentWorkspaceDiagnostic;
};
/** A whole-analysis alternative for observed unchanged-component reflow. Valid plans
* return by identity. New plans use complete material lifetimes and are either
* accepted together or rejected without modifying the accepted reservations. */
export function planCoherentWorkspace(scenes: readonly Scene[], baseline: Reservations, direction: TreeDirection, render: Render, metrics: Measurements = {}): CoherentWorkspaceResult {
  const started = performance.now();
  const reflows = workspaceContinuityReflows(scenes, baseline, render);
  const detected = performance.now();
  const diagnostic: CoherentWorkspaceDiagnostic = { status: 'unchanged', reflows, evaluations: 0, corrections: 0 };
  if (!reflows.length)
    return { coordinates: baseline, diagnostic };
  const failed = (reason: CoherentWorkspaceDiagnostic['reason'], detail?: string): CoherentWorkspaceResult => ({ coordinates: baseline, diagnostic: { ...diagnostic, status: 'infeasible', reason, detail } });
  const steps = scenes.map(scene => scene.step);
  const originals = scenes.map(scene => render(scene, baseline.get(scene.canvas)!));
  const references = new Map(scenes.map((scene, index) => [scene.canvas, new Map(originals[index].map(node => [getNodeId(node), {
        x: direction === 'rtl' ? -node.x : node.x, y: node.y
      }]))]));
  const referenceFrames = scenes.map((scene, index) => ({ nodes: originals[index].map(node => ({ id: getNodeId(node), x: direction === 'rtl' ? -node.x : node.x, y: node.y })) }));
  const last = new Map(referenceFrames.at(-1)!.nodes.map(node => [node.id, node]));
  const originalFinalWidth = workspaceFinalWidth(last);
  const compose = prepareWorkspaceLifetimeContours(steps, metrics.measureCategoryText, metrics.measureTreeInk, metrics.treeLabelRuns, metrics.measureTreeLabel, direction, references, new Map(scenes.flatMap(scene =>
    scene.currentRowHeight === undefined ? [] : [[scene.step, scene.currentRowHeight] as const])));
  let intrinsic: ContourFrame[];
  try {
    intrinsic = compose();
  }
  catch (error) {
    return failed('contour', String(error));
  }
  const candidates = workspaceContourCandidates(intrinsic, references);
  let preferred: ReadonlyMap<number, ReadonlyMap<string, Point>> = new Map([...candidates].map(([id, items]) => [id, items.at(-1)!.positions]));
  const referencePreferences = preferred;
  const parts = new Map(intrinsic.flatMap(frame => [...frame.nodes.values()].map(part => [part.incarnation, part])));
  const preparedAt = performance.now();
  const controls = [...parts.values()].flatMap(part => part.children.slice(1).map((_, index) => ({ part, index: index + 1 })))
    .sort((a, b) => a.part.first - b.part.first || a.part.incarnation - b.part.incarnation || a.index - b.index);
  let initialFailure: unknown;
  const pairBudget = { remaining: WORKSPACE_PAIRED_EVALUATION_LIMIT, evaluations: 0 };
  const evaluate = (preferences: typeof preferred, limit?: WorkspaceVisualScore,
    gapTrial?: { frames: readonly ContourFrame[]; incarnation: number; split: number },
    baseline?: readonly ContourFrame[]) => {
    initialFailure = undefined;
    diagnostic.evaluations++;
    // Direct refinement of a completely locked fork reproduces the accepted
    // score exactly. Keep its evaluation count and ordinary score rejection,
    // without disturbing the composer's state for the next genuine trial.
    if (limit && gapTrial && compose.preservesLockedGap(gapTrial.frames, preferences, gapTrial)) return undefined;
    try {
      const frames = compose(undefined, { inheritCurrentSlots: true, preferred: preferences, baseline: gapTrial?.frames ?? baseline });
      const score = workspaceVisualScore(frames.at(-1)!, last);
      if (!score || (limit && (!keepsWorkspaceFinalExtent(score, limit) || compareWorkspaceVisualScores(score, limit) >= 0)))
        return undefined;
      const graph = rigidPoseGraph(frames);
      if (graph.conflicts.length) { initialFailure = Error(`Temporal conflict at frame ${graph.conflicts[0].frame}: ${JSON.stringify(graph.conflicts.slice(0, 3))}`); return undefined; }
      compose.retainBaseline(frames);
      return { frames, graph, score };
    }
    catch (error) {
      initialFailure = error;
      return undefined;
    }
  };
  const withClearance = (preferences: typeof preferred, correctionLimit: typeof WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS | typeof WORKSPACE_SEED_CLEARANCE_CORRECTIONS, limit?: WorkspaceVisualScore) =>
    evaluateWorkspaceClearance(preferences, parts, correctionLimit, points => {
      const value = evaluate(points, limit);
      return { value, clearance: initialFailure instanceof WorkspaceContourClearanceError ? initialFailure.preference : undefined };
    });
  const native = withClearance(preferred, WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS);
  preferred = native.preferences; diagnostic.corrections += native.corrections;
  let best = native.value;
  if (!best)
    return failed('contour', String(initialFailure ?? 'Complete preferred contours have incompatible current geometry or temporal witnesses.'));
  let placement = placeRigidGroups(best.graph, referenceFrames);
  if (placement.accepted === false)
    return failed('clearance', placement.reason);
  const acceptedPlans = [{ candidate: best, placement, finalWidth: workspaceFinalWidth(placement.coordinates.at(-1)!) }];
  const nativeVertical = best.frames.map(workspaceNativeVerticalReference);
  diagnostic.alternateSeedEvaluations = 0;
  diagnostic.alternateSeedCorrections = 0;
  if (!withinWorkspaceVisualPreference(best.frames.at(-1)!, last)) {
    const nativePlan = acceptedPlans[0];
    const alternatives: Array<{ preferences: typeof preferred; plan: typeof nativePlan }> = [];
    // Both alternatives use the same native base. Only measured earlier-fork
    // requests may repair them, and completed plans cannot worsen its extent.
    for (const seed of workspaceAlternateSeeds(preferred, parts.values()).slice(0, WORKSPACE_ALTERNATE_SEED_LIMIT)) {
      const attempt = withClearance(seed, WORKSPACE_SEED_CLEARANCE_CORRECTIONS, nativePlan.candidate.score);
      diagnostic.alternateSeedEvaluations += attempt.evaluations;
      diagnostic.alternateSeedCorrections += attempt.corrections;
      const candidate = attempt.value, preferences = attempt.preferences;
      if (!candidate) continue;
      const next = placeRigidGroups(candidate.graph, referenceFrames);
      if (next.accepted === false) continue;
      const finalWidth = workspaceFinalWidth(next.coordinates.at(-1)!);
      if (!keepsWorkspaceFinalWidth(finalWidth, nativePlan.finalWidth, originalFinalWidth)) continue;
      alternatives.push({ preferences, plan: { candidate, placement: next, finalWidth } });
    }
    alternatives.sort((a, b) => compareWorkspaceVisualScores(a.plan.candidate.score, b.plan.candidate.score));
    const selected = alternatives[0];
    if (selected) {
      preferred = selected.preferences; best = selected.plan.candidate; placement = selected.plan.placement;
      acceptedPlans.push(selected.plan); diagnostic.corrections++;
    }
  }
  compose.retainOnlyBaseline(best.frames);
  const change = (control: typeof controls[number], wanted: number, realizedCurrent: number) => {
    const points = adjustWorkspaceGapPreference(preferred.get(control.part.incarnation)!,
      control.part.children.map(child => child.id), control.index, realizedCurrent, wanted);
    return points && new Map(preferred).set(control.part.incarnation, points);
  };
  // Keep every placement-accepted state until the renderer has validated it.
  // Refinement is monotone in visual preference, so the newest state is first.
  const finishPlan = ({ candidate: best, placement }: typeof acceptedPlans[number]): CoherentWorkspaceResult => {
    const coordinates = new Map(baseline);
    const perCanvas = new Map<SyntaxNode, TreeCoordinateReservation>();
    for (const [index, scene] of scenes.entries()) {
      const next = new Map(baseline.get(scene.canvas)!);
      for (const [id, p] of placement.coordinates[index])
        next.set(id, { x: direction === 'rtl' ? scene.size[0] + p.x : p.x, y: p.y });
      const prior = perCanvas.get(scene.canvas);
      if (prior && [...next].some(([id, p]) => Math.hypot(p.x - prior.get(id)!.x, p.y - prior.get(id)!.y) > 1e-6))
        return failed('temporal-constraints', 'Shared canvas requires different coordinates.');
      perCanvas.set(scene.canvas, next);
      coordinates.set(scene.canvas, next);
    }
    for (const [index, scene] of scenes.entries()) {
      const nodes = new Map(render(scene, coordinates.get(scene.canvas)!).filter(node => !node.data.replayLayoutOnly && node.data.replayOrigin?.kind !== 'workspace').map(node => [getNodeId(node), node]));
      const expected = placement.coordinates[index], groups: Node[][] = [[...nodes.values()].filter(node => !node.parent || !nodes.has(getNodeId(node.parent)))];
      for (const node of nodes.values()) {
        const point = expected.get(getNodeId(node));
        if (!point || Math.hypot(node.x - (direction === 'rtl' ? -point.x : point.x), node.y - point.y) > 1e-6)
          return failed('render-validation', `Parent recentering at frame ${index + 1}.`);
        const children = (node.children ?? []).filter(child => nodes.has(getNodeId(child)));
        if (children.some(child => child.y <= node.y) || children.slice(1).some((child, i) => Math.abs(child.y - children[i].y) > 1e-6 || (direction === 'rtl' ? child.x >= children[i].x : child.x <= children[i].x)))
          return failed('render-validation', `Current rank or order at frame ${index + 1}.`);
        if (children.length > 1)
          groups.push(children);
      }
      const footprints = prepareTreeInkSubtrees(nodes, metrics.measureCategoryText, metrics.measureTreeInk,
        true, metrics.treeLabelRuns?.get(scene.canvas), metrics.measureTreeLabel);
      for (const parent of nodes.values()) {
        const children = (parent.children ?? []).filter(child => nodes.has(getNodeId(child)));
        if (children.length < 2) continue;
        if (!currentForkBranchesClear(parent, children.map(child => ({ point: child, obstacles: footprints(child).map(rect => ({ ...rect, x: rect.x - child.x, y: rect.y - child.y })) }))))
          return failed('render-validation', `Current fork branch crosses child ink at frame ${index + 1}.`);
      }
      const indexes = new Map<Node, ReturnType<typeof verticalObstacleIndex<ReturnType<typeof treeInkObstacles>[number]>>>();
      for (const roots of groups)
        for (let i = 0; i < roots.length; i++)
          for (let j = i + 1; j < roots.length; j++) {
            let query = indexes.get(roots[j]);
            if (!query) indexes.set(roots[j], query = verticalObstacleIndex(footprints(roots[j])));
            for (const a of footprints(roots[i]))
              if (query(a, b => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1e-6
                && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1e-6
                && (!a.curve || cubicIntersectsRect(a.curve, b, a.curvePadding))
                && (!b.curve || cubicIntersectsRect(b.curve, a, b.curvePadding))))
                return failed('render-validation', `Current ink overlap at frame ${index + 1}.`);
          }
    }
    const before = referenceFrames.at(-1)!.nodes, after = [...placement.coordinates.at(-1)!.values()];
    diagnostic.status = 'resolved';
    diagnostic.finalDeviation = { maxX: best.score.maxX,
      beforeWidth: Math.max(...before.map(p => p.x)) - Math.min(...before.map(p => p.x)), afterWidth: Math.max(...after.map(p => p.x)) - Math.min(...after.map(p => p.x)) };
    return { coordinates, diagnostic };
  };
  let validatedStop: CoherentWorkspaceResult | undefined;
  let earlyValidation = 0;
  // These bounds limit visual-preference search, not safety. Every retained
  // state independently satisfies the exact geometry and temporal constraints.
  for (let iteration = 0; iteration < 4; iteration++) {
    if (withinWorkspaceVisualPreference(best.frames.at(-1)!, last)) break;
    const finalVertical = nativeVertical.at(-1);
    if (finalVertical && withinWorkspaceVisualPreference(best.frames.at(-1)!, last, finalVertical)
      && best.frames.length === nativeVertical.length
      && best.frames.every((frame, index) => {
        const vertical = nativeVertical[index];
        return vertical !== undefined && matchesWorkspaceNativeVerticalReference(frame, vertical);
      })) {
      // Horizontal refinement cannot restore legacy ranks. Stop only when the
      // accepted native ranks persist in every frame and actual paint is safe.
      // A rejected render still gets the complete remaining search and fallback.
      const validationStarted = performance.now();
      const result = finishPlan(acceptedPlans.at(-1)!);
      earlyValidation += performance.now() - validationStarted;
      if (result.diagnostic.status === 'resolved') { validatedStop = result; break; }
    }
    // Correct the largest currently distorted fork first. Each trial still
    // composes the complete history and preserves final extent; a successful
    // improvement makes the remaining measurements stale, so start a new round.
    const priorities = controls.flatMap(control => {
      const realized = workspaceRealizedGap(control.part, control.index, best.frames, last, referencePreferences.get(control.part.incarnation)!);
      return realized ? [{ control, realized, distortion: Math.abs(realized.current / realized.reference - 1) }] : [];
    }).sort((a, b) => b.distortion - a.distortion);
    let accepted = false;
    for (const { control, realized } of priorities) {
      const improvements: Array<{
        preferences: typeof preferred;
        candidate: NonNullable<ReturnType<typeof evaluate>>;
      }> = [];
      for (const wanted of workspaceGapProposals(realized.current, realized.reference)) {
        const preferences = change(control, wanted, realized.current);
        if (!preferences) continue;
        const candidate = evaluate(preferences, best.score, { frames: best.frames, incarnation: control.part.incarnation, split: control.index });
        if (candidate)
          improvements.push({ preferences, candidate });
        else if (initialFailure instanceof WorkspaceContourClearanceError && pairBudget.remaining > 0) {
          const witness = initialFailure, acceptedBest = best;
          const paired = pairedWorkspaceClearance({
            attempted: { incarnation: control.part.incarnation, split: control.index },
            accepted: preferred, rejected: preferences, witness, forks: parts, budget: pairBudget,
            currentGap: obstruction => {
              const part = parts.get(obstruction.incarnation), current = part && acceptedBest.frames[part.last]?.nodes.get(part.id);
              if (!part || current?.incarnation !== part.incarnation) return undefined;
              const leftId = current.children[obstruction.split - 1]?.id, rightId = current.children[obstruction.split]?.id;
              const left = leftId && current.members.get(leftId), right = rightId && current.members.get(rightId);
              return left && right ? right.x - left.x : undefined;
            },
            evaluate: points => {
              const value = evaluate(points, acceptedBest.score, undefined, acceptedBest.frames);
              return { value, clearance: initialFailure instanceof WorkspaceContourClearanceError ? initialFailure : undefined };
            }
          });
          improvements.push(...paired);
        }
      }
      improvements.sort((a, b) => compareWorkspaceVisualScores(a.candidate.score, b.candidate.score));
      for (const improvement of improvements) {
        const next = placeRigidGroups(improvement.candidate.graph, referenceFrames);
        if (next.accepted === false)
          continue;
        const finalWidth = workspaceFinalWidth(next.coordinates.at(-1)!);
        if (!keepsWorkspaceFinalWidth(finalWidth, acceptedPlans.at(-1)!.finalWidth, originalFinalWidth)) continue;
        preferred = improvement.preferences;
        best = improvement.candidate;
        placement = next;
        acceptedPlans.push({ candidate: best, placement, finalWidth });
        diagnostic.corrections++;
        accepted = true;
        break;
      }
      if (accepted) break;
    }
    compose.retainOnlyBaseline(best.frames);
    if (!accepted)
      break;
  }
  const searchedAt = performance.now();
  diagnostic.pairedEvaluations = pairBudget.evaluations;
  diagnostic.visualHistory = acceptedPlans.map(plan => ({ ...workspaceVisualSummary(plan.candidate.score), finalWidth: plan.finalWidth }));
  const completed = (result: CoherentWorkspaceResult): CoherentWorkspaceResult => {
    const finished = performance.now();
    diagnostic.timings = { detection: detected - started, preparation: preparedAt - detected,
      search: searchedAt - preparedAt - earlyValidation, validation: finished - searchedAt + earlyValidation,
      total: finished - started };
    return result;
  };
  if (validatedStop) return completed(validatedStop);
  let firstFailure: CoherentWorkspaceResult | undefined;
  for (const plan of [...acceptedPlans].reverse()) {
    const result = finishPlan(plan);
    if (result.diagnostic.status === 'resolved') return completed(result);
    firstFailure ??= result;
  }
  return firstFailure!;
}
