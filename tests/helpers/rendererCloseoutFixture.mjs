// Provider-free controls for changed claim values, multiple roots and a malformed
// relation. These records test preservation and rendering, not linguistic quality.
export const closeoutSentence = 'The the dog slept.';
export const closeoutPayload = () => {
  const forest = [{ id: 'abandoned', label: 'D', word: 'The', tokenIndex: 0 },
    { id: 'clause', label: 'TP', children: [
      { id: 'subject', label: 'DP', children: [{ id: 'd', label: 'D', word: 'the', tokenIndex: 1 },
        { id: 'n', label: 'N', word: 'dog', tokenIndex: 2 }] },
      { id: 'bar', label: 'T′', children: [{ id: 't', label: 'T', silent: true },
        { id: 'vp', label: 'VP', children: [{ id: 'v', label: 'V', word: 'slept', tokenIndex: 3 }] }] }
    ] }];
  const complete = node => { node.children ??= []; node.children.forEach(complete); };
  forest.forEach(complete);
  const relation = features => ({ relation: 'Authored feature state', anchors: { holder: 't' }, values: { features } });
  return { derivationStages: [
    { statement: 'First recorded state', stageRecord: 'The detached D and finite clause are both present.',
      workspaceForest: forest, relations: [relation(['number: singular'])] },
    { statement: 'A changed feature value', stageRecord: 'The new feature claim replaces its earlier value.',
      workspaceForest: [{ refId: 'abandoned' }, { refId: 'clause' }], relations: [
        { ...relation(['number: plural']), priorAnchors: { holder: 't' } },
        { relation: 'Malformed value control', anchors: { witness: 'abandoned' }, values: ['retained original value'] }
      ] },
    { statement: 'An added value', stageRecord: 'The updated claim includes an additional row.',
      workspaceForest: [{ refId: 'abandoned' }, { refId: 'clause' }], relations: [
        { ...relation(['number: plural', 'Case: nominative']), priorAnchors: { holder: 't' } }
      ] }
  ] };
};
