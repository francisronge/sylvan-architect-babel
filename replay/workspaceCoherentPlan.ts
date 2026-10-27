import type { SyntaxNode } from '../types.ts';
import { getNodeId } from './displayIdentity.ts';
import type { TreeCoordinateReservation, TreeDirection } from './treeLayout.ts';
import { WORKSPACE_ALTERNATE_SEED_LIMIT, workspaceAlternateSeeds } from './workspaceAlternateSeeds.ts';
import {
  evaluateWorkspaceClearance,
  WORKSPACE_INITIAL_CLEARANCE_CORRECTIONS,
  WORKSPACE_SEED_CLEARANCE_CORRECTIONS
} from './workspaceClearancePreference.ts';
import {
  earlierWorkspaceForks,
  prepareWorkspaceHistoryGuard,
  WORKSPACE_HISTORY_EVALUATION_LIMIT
} from './workspaceHistoryRefinement.ts';
import {
  prepareWorkspaceLifetimeContours,
  workspaceContourCandidates,
  WorkspaceContourClearanceError,
  type ContourFrame,
  type Point
} from './workspaceLifetimeContours.ts';
import {
  matchesWorkspaceNativeVerticalReference,
  workspaceNativeVerticalReference
} from './workspaceNativeVerticalReference.ts';
import { pairedWorkspaceClearance, WORKSPACE_PAIRED_EVALUATION_LIMIT } from './workspacePairedClearance.ts';
import { rigidPoseGraph } from './workspacePoseGraph.ts';
import { placeRigidGroups } from './workspacePosePlacement.ts';
import {
  validateWorkspacePlacement,
  type WorkspacePlanMeasurements,
  type WorkspacePlanRender,
  type WorkspacePlanScene
} from './workspacePlanValidation.ts';
import { receivingHeadForks, receivingHeadOffsets, receivingHeadPreferences } from './workspaceReceivingHeadSlots.ts';
import { workspaceContinuityReflows } from './workspaceShapeReflows.ts';
import { withinWorkspaceVisualPreference } from './workspaceVisualPreference.ts';
import {
  adjustWorkspaceGapPreference,
  compareWorkspaceVisualScores,
  keepsWorkspaceFinalExtent,
  keepsWorkspaceFinalWidth,
  workspaceFinalWidth,
  workspaceGapProposals,
  workspaceRealizedGap,
  workspaceVisualScore,
  workspaceVisualSummary,
  type WorkspaceVisualScore,
  type WorkspaceVisualSummary
} from './workspaceVisualScore.ts';
type Reservations = ReadonlyMap<SyntaxNode, TreeCoordinateReservation>;
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
  historyEvaluations?: number;
  historyCorrections?: number;
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
export function planCoherentWorkspace({ scenes, baseline, direction, render, metrics = {}, minimumSiblingGap = 0 }: {
  scenes: readonly WorkspacePlanScene[];
  baseline: Reservations;
  direction: TreeDirection;
  render: WorkspacePlanRender;
  metrics?: WorkspacePlanMeasurements;
  minimumSiblingGap?: number;
}): CoherentWorkspaceResult {
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
  const referenceFrames = originals.map(nodes => ({ nodes: nodes.map(node => ({ id: getNodeId(node), x: direction === 'rtl' ? -node.x : node.x, y: node.y })) }));
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
      const frames = compose(undefined, { inheritCurrentSlots: true, minimumSiblingGap,
        preferred: preferences, baseline: gapTrial?.frames ?? baseline });
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
    const validation = validateWorkspacePlacement({ scenes, baseline, direction, placement, render, metrics });
    if (validation.valid === false) return failed(validation.reason, validation.detail);
    const coordinates = validation.coordinates;
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
  diagnostic.historyEvaluations = 0;
  diagnostic.historyCorrections = 0;
  // Final-frame refinement cannot distinguish an unnecessary earlier span from
  // an equally good compact history. Try only expanded completed-stage forks,
  // keeping the final contour and every completed stage's current geometry safe.
  const earlier = earlierWorkspaceForks(best.frames, parts.values(), referencePreferences);
  for (const { part, index, reference } of earlier) {
    if (diagnostic.historyEvaluations >= WORKSPACE_HISTORY_EVALUATION_LIMIT) break;
    const initial = best, initialPreferences = preferred;
    const current = initial.frames[part.last].nodes.get(part.id)!;
    const currentGap = current.members.get(part.children[index].id)!.x - current.members.get(part.children[index - 1].id)!.x;
    const guard = prepareWorkspaceHistoryGuard(initial.frames, references, placement.coordinates);
    let low = reference, high = currentGap;
    let selected: { preferences: typeof preferred; plan: typeof acceptedPlans[number] } | undefined;
    for (let attempt = 0; diagnostic.historyEvaluations < WORKSPACE_HISTORY_EVALUATION_LIMIT; attempt++) {
      const wanted = attempt ? (low + high) / 2 : low;
      if (high - wanted <= 1e-6) break;
      const points = adjustWorkspaceGapPreference(initialPreferences.get(part.incarnation)!, part.children.map(child => child.id), index, currentGap, wanted);
      if (!points) break;
      const preferences = new Map(initialPreferences).set(part.incarnation, points);
      const trial = { frames: initial.frames, incarnation: part.incarnation, split: index };
      if (compose.preservesLockedGap(initial.frames, preferences, trial)) break;
      diagnostic.historyEvaluations++;
      const candidate = evaluate(preferences, undefined, trial);
      const composed = candidate?.frames[part.last].nodes.get(part.id);
      const gap = composed && composed.members.get(part.children[index].id)!.x - composed.members.get(part.children[index - 1].id)!.x;
      if (!candidate || gap === undefined || gap >= high - 1e-6 || !guard.contours(candidate.frames)) { low = wanted; continue; }
      const next = placeRigidGroups(candidate.graph, referenceFrames);
      if (next.accepted === false || !guard.placement(next.coordinates)) { low = wanted; continue; }
      high = wanted;
      selected = { preferences, plan: { candidate, placement: next, finalWidth: workspaceFinalWidth(next.coordinates.at(-1)!) } };
      if (!attempt) break;
    }
    if (selected) {
      preferred = selected.preferences; best = selected.plan.candidate; placement = selected.plan.placement;
      acceptedPlans.push(selected.plan);
      diagnostic.corrections++; diagnostic.historyCorrections++;
      validatedStop = undefined;
    }
    compose.retainOnlyBaseline(best.frames);
  }
  // A receiving head that grows into its head complex keeps its place in the
  // unchanged fork above it: the fork before the moment takes the slots the
  // moment composes. Each fork is tried alone and kept only when the completed
  // tree and every completed stage keep their shape and width.
  const completedFrames = best.frames.flatMap((frame, index) => frame.step.replayKind === 'macro' || index === best.frames.length - 1 ? [index] : []);
  const keepsShape = (before: readonly ContourFrame[], after: readonly ContourFrame[], index: number) =>
    before[index].roots.length === after[index].roots.length && before[index].roots.every((root, rootIndex) => {
      const current = after[index].roots[rootIndex];
      return current.id === root.id && current.members.size === root.members.size && [...root.members].every(([id, point]) => {
        const moved = current.members.get(id);
        return moved && Math.abs(moved.x - point.x) <= 1e-6 && Math.abs(moved.y - point.y) <= 1e-6;
      });
    });
  for (const { frame, receiver } of receivingHeadForks(best.frames)) {
    const fork = receivingHeadForks(best.frames).find(item => item.frame === frame && item.receiver === receiver);
    const [offset] = fork ? receivingHeadOffsets(best.frames, [fork]) : [0];
    const aligned = fork && offset > 1e-6 ? receivingHeadPreferences(preferred, [fork]) : undefined;
    const candidate = aligned && evaluate(aligned, undefined, undefined, best.frames);
    const next = candidate && placeRigidGroups(candidate.graph, referenceFrames);
    const placed = placement.coordinates;
    const widths = completedFrames.map(index => workspaceFinalWidth(placed[index]));
    if (aligned && candidate && next && next.accepted !== false
      && receivingHeadOffsets(candidate.frames, [fork!])[0] < offset - 1e-6
      && completedFrames.every((index, position) => keepsShape(best.frames, candidate.frames, index)
        && workspaceFinalWidth(next.coordinates[index]) <= widths[position] + 1e-6)) {
      preferred = aligned; best = candidate; placement = next;
      acceptedPlans.push({ candidate, placement: next, finalWidth: workspaceFinalWidth(next.coordinates.at(-1)!) });
      diagnostic.corrections++;
      validatedStop = undefined;
    }
    compose.retainOnlyBaseline(best.frames);
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
