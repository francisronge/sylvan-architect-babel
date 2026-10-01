export const blockedCollectionForest = [{ id: 'root', label: 'PP', children: [
  { id: 'assigner', label: 'P', word: 'with', tokenIndex: 0, children: [] },
  { id: 'clause', label: 'TP', children: [
    { id: 'head', label: 'T', silent: true, children: [] },
    { id: 'goal', label: 'DP', word: 'children', tokenIndex: 1, children: [] }
  ] }
] }];
const agreement = { relation: 'An authored agreement', anchors: { probe: 'head', goal: 'goal' }, values: { number: 'plural', outcome: 'blocked' } };
export const blockedCollectionCases = [
  { id: 'standalone', relations: [agreement] },
  { id: 'case-composed', relations: [
    { relation: 'CaseAssignment', anchors: { assigner: 'assigner', bearer: 'head' }, values: { Case: 'nominative' } },
    { relation: 'An authored agreement', anchors: { probe: 'head', goal: 'goal' }, values: { gender: 'feminine' } },
    agreement
  ] },
  { id: 'unpaired', relations: [
    { relation: 'An authored agreement', anchors: { featureSource: 'head', featureTarget: 'goal' }, values: { outcome: 'blocked' } }
  ] },
  { id: 'native-outcome-control', relations: [
    { relation: 'CaseAssignment', anchors: { assigner: 'assigner', bearer: 'head' }, values: { Case: 'nominative' } },
    { relation: 'Agree', anchors: { probe: 'head', goal: 'goal' }, values: { number: 'plural', status: 'blocked' } }
  ] }
];
export const blockedCollectionStage = relations => ({ statement: 'Feature dependency.', stageRecord: 'The authored feature claims.',
  workspaceForest: structuredClone(blockedCollectionForest), relations: structuredClone(relations) });
