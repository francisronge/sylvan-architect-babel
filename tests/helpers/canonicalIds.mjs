import { canonicalizeMovementIdentity } from '../../server/babelParser/movementIdentity.js';
/** Tests name nodes by the ids their analyses author. Replay reads every
 * movement hop with the source keeping the continuing id (see
 * server/babelParser/movementIdentity.js), so a landing the model let keep an
 * id carries another one in Replay. `canonicalId` gives the id Replay uses for
 * an authored id of stage `stageIndex` (by default the last stage), through
 * the renames prepareReplay returns. Use it where a test looks up a node by
 * its authored id; it never changes which occurrence the test means. */
export const canonicalId = (replay, id, stageIndex = (replay.idRenamesByStage?.length ?? 1) - 1) => {
  const renames = replay.idRenamesByStage?.[stageIndex] ?? {};
  // A derived display id (`want::__leaf`) follows its owner's id.
  const [owner, ...suffix] = String(id).split('::');
  return [renames[owner] ?? owner, ...suffix].join('::');
};

/** `canonicalId` for each id of a list. */
export const canonicalIds = (replay, ids, stageIndex) => ids.map(id => canonicalId(replay, id, stageIndex));

/** The stages prepareReplay reads for a record (canonical movement identity):
 * what layout helpers that take stages beside Replay's steps must be given,
 * as TreeVisualizer gives them Replay's own frames. */
export const replayStages = record => canonicalizeMovementIdentity(record.derivationStages).stages;
