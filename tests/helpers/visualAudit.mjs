/** One record's static frame audit: every Replay frame at each viewport, the
 * Canopy, and the painted index letters, checked by the visual invariants.
 * Shared by tests/visualInvariants.test.mjs and scripts/auditReplayVisuals.mjs. */
import { layoutCanopyVisualFrame, layoutReplayVisualFrames, prepareVisualRecord, VIEWPORTS } from './visualFrames.mjs';
import { paintedIndexGlyphs } from './visualGlyphs.mjs';
import { checkDuplicateGlyphs, checkVisualFrame, THRESHOLDS } from './visualInvariants.mjs';

/** Violations of one frame and subject merge across viewports; `viewports`
 * lists where they occur and `px` keeps the largest fault. */
export function auditVisualRecord(record, { viewports = VIEWPORTS, canopy = true, thresholds = THRESHOLDS } = {}) {
  const visual = prepareVisualRecord(record);
  const frames = layoutReplayVisualFrames(visual, viewports);
  if (canopy) for (const viewport of viewports) {
    const frame = layoutCanopyVisualFrame(visual, viewport);
    if (frame) frames.push(frame);
  }
  const found = [...frames.flatMap(frame => checkVisualFrame(frame, thresholds)), ...checkDuplicateGlyphs(paintedIndexGlyphs(visual.prepared))];
  const merged = new Map();
  for (const violation of found) {
    const key = JSON.stringify([violation.rule, violation.frame, violation.subject]);
    const entry = merged.get(key);
    if (!entry) { merged.set(key, { ...violation, viewports: violation.viewport ? [violation.viewport] : [] }); continue; }
    if (violation.viewport && !entry.viewports.includes(violation.viewport)) entry.viewports.push(violation.viewport);
    if ((violation.px ?? -Infinity) > (entry.px ?? -Infinity)) Object.assign(entry, { px: violation.px, detail: violation.detail });
  }
  const violations = [...merged.values()].map(({ viewport: _viewport, ...violation }) => violation);
  return { steps: visual.prepared.playbackSteps.length, frames: frames.length, violations };
}
