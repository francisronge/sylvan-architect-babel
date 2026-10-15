// Case is established before a later stage builds C and raises its governor.
export function persistentCaseMovement(exact = false) {
  const verb = { id: 'verb', label: 'V', word: 'give', lineageId: 'predicate' };
  const object = { id: 'object', label: 'DP', children: [{ id: 'noun', label: 'N', word: 'books' }] };
  const tense = moved => ({ id: 'tense', label: 'I', children: [
    ...(moved ? [{ ...verb, id: 'raised' }] : []), { id: 'suffix', label: 'I', word: '-ed' }
  ] });
  const clause = moved => ({ id: 'ip', label: 'IP', children: [{ id: 'ibar', label: 'I′', children: [
    { id: 'vp', label: 'VP', children: [object, moved
      ? { id: 'lower', label: 'V trace', silent: true, lineageId: 'predicate' } : verb] }, tense(moved)
  ] }] });
  const stage = (workspaceForest, relations) => ({ statement: 'A completed state.', stageRecord: 'Authored state.', workspaceForest, relations });
  return {
    sentence: 'give books',
    derivationStages: [stage([clause(false)], [{
      relation: exact ? 'CaseAssignment' : 'Government and objective Case',
      anchors: exact ? { assigner: 'verb', bearer: 'object' } : { governor: 'verb', caseBearer: 'object' },
      values: exact ? { feature: 'Case', value: 'objective' } : { case: 'objective' }
    }, { relation: 'ThetaAssignment', anchors: { predicate: 'verb', Theme: 'object' } }]),
    stage([{ id: 'cp', label: 'CP', children: [{ id: 'cbar', label: 'C′', children: [
      clause(true), { id: 'c', label: 'C', silent: true }
    ] }] }], [{ relation: 'V-to-I head movement',
      anchors: { raisedHead: 'raised', trace: 'lower', landingHead: 'tense' },
      priorAnchors: { source: 'verb', target: 'tense' }
    }])]
  };
}
