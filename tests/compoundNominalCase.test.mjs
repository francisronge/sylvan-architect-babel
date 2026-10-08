import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';
import { dispatchStageRelations } from '../replay/relations/tier2RelationDispatch.ts';
import { prepareReplay } from '../replay/prepareReplay.ts';

const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/german-paired-case.json', import.meta.url)));
const paths = stage => compileRelationRenderPlan([stage]).frames[0].items.filter(item => item.pathStyle === 'case-assignment');
const shape = items => items.map(({ fromNodeId, toNodeId, label, outcome }) => ({ fromNodeId, toNodeId, label, outcome }));
const node = (id, children = []) => ({ id, label: 'X', children });
const forest = [node('root', [node('first', [node('a'), node('b')]), node('second', [node('c'), node('d')])])];
const stage = relation => ({ statement: '', stageRecord: '', workspaceForest: forest, relations: [relation] });

for (const example of fixture.examples) {
  test(`saved ${example.model}: both finite heads license their exact declared subjects in one moment`, () => {
    const original = structuredClone(example.stage);
    const relation = example.stage.relations[example.relationIndex];
    const sources = relation.anchors.licensers ?? relation.anchors.governors;
    const scoped = { ...example.stage, relations: [relation] };
    assert.deepEqual(shape(paths(scoped)), sources.map((source, index) => ({
      fromNodeId: source, toNodeId: relation.anchors.subjects[index], label: 'nominative', outcome: undefined
    })));
    const explicit = structuredClone(scoped);
    explicit.relations[0].anchors.caseRecipients = explicit.relations[0].anchors.subjects;
    delete explicit.relations[0].anchors.subjects;
    if (explicit.relations[0].values.subjects) {
      explicit.relations[0].values.caseRecipients = explicit.relations[0].values.subjects;
      delete explicit.relations[0].values.subjects;
    }
    assert.deepEqual(shape(paths(scoped)), shape(paths(explicit)), 'uses the existing compound-assignment drawing and pairing');
    const result = dispatchStageRelations([scoped])[0][0];
    assert.equal(result.facets.filter(facet => facet.recipe.id === 'feature.dependency').length, 2);
    const steps = prepareReplay({ sentence: example.sentence, derivationStages: [scoped], includePlayback: true }).playbackSteps;
    assert.equal(steps.filter(step => step.replayKind === 'relation').length, 1);
    assert.deepEqual(example.stage, original);
  });
}

test('declared nominal roles normalize plurals while preserving exact value-field pairing', () => {
  for (const role of ['subject', 'subjects', 'object', 'objects', 'nominal', 'nominals']) {
    for (const sourceRole of ['governors', 'licensers']) {
      const relation = { relation: 'Finite Case licensing', anchors: { [sourceRole]: ['a', 'c'], [role]: ['b', 'd'] },
        values: { [role]: ['An authored Case', 'Another authored Case'] } };
      const expected = [{ fromNodeId: 'a', toNodeId: 'b', label: 'An authored Case', outcome: undefined },
        { fromNodeId: 'c', toNodeId: 'd', label: 'Another authored Case', outcome: undefined }];
      assert.deepEqual(shape(paths(stage(relation))), expected, `${sourceRole}/${role}`);
      const reversed = structuredClone(relation);
      reversed.anchors[sourceRole].reverse(); reversed.anchors[role].reverse(); reversed.values[role].reverse();
      assert.deepEqual(shape(paths(stage(reversed))), [...expected].reverse());
    }
  }
});

test('nominal Case lists still require independent unambiguous structural pairing', () => {
  const relation = { relation: 'Finite Case licensing', anchors: { governors: ['a', 'c'], subjects: ['b', 'd'] },
    values: { subjects: ['nominative', 'nominative'] } };
  const cases = [
    { ...stage(relation), workspaceForest: [node('root', ['a', 'b', 'c', 'd'].map(id => node(id)))] },
    { ...stage(relation), workspaceForest: [node('root', [node('first', [node('a'), node('d')]), node('second', [node('c'), node('b')])])] },
    stage({ ...relation, anchors: { ...relation.anchors, subjects: ['d', 'b'] } }),
    stage({ ...relation, anchors: { ...relation.anchors, subjects: ['b', 'missing'] } }),
    stage({ ...relation, anchors: { ...relation.anchors, subjects: ['b', 'b'] } }),
    stage({ ...relation, values: {} }),
    stage({ ...relation, values: { subject: ['nominative', 'nominative'] } }),
    stage({ ...relation, values: { subjects: ['nominative'] } }),
    stage({ ...relation, anchors: { ...relation.anchors, unknownNominals: relation.anchors.subjects, subjects: [] } }),
    stage({ ...relation, relation: 'Case Assignment' })
  ];
  for (const candidate of cases) assert.equal(paths(candidate).length, 0, JSON.stringify(candidate));
});

test('a governor and nominal properties do not assert Case licensing', () => {
  const anchors = { governors: ['a', 'c'], subjects: ['b', 'd'] };
  for (const source of ['governors', 'licensers']) for (const relation of ['Property sharing', 'Head government', 'Nominal licensing']) {
    assert.equal(paths(stage({ relation, anchors: { [source]: ['a', 'c'], subjects: ['b', 'd'] },
      values: { subjects: ['red', 'blue'] } })).length, 0, `${source}/${relation}`);
  }
  for (const relation of ['Property sharing', 'Head government', 'Nominal licensing', 'Nominative comparison']) {
    for (const subjects of [['red', 'blue'], ['nominative', 'nominative']]) {
      assert.equal(paths(stage({ relation, anchors, values: { subjects } })).length, 0, relation);
    }
  }
  for (const relation of ['Finite nominative licensing', 'Possible nominative licensing', 'Nominative licensing if successful']) {
    assert.equal(paths(stage({ relation, anchors, values: { subjects: ['red', 'blue'] } })).length, 0);
  }
  for (const relation of ['Possible nominative licensing', 'Nominative licensing if successful', 'Expected Case licensing']) {
    assert.equal(paths(stage({ relation, anchors, values: { subjects: ['nominative', 'nominative'] } })).length, 0);
  }
});

test('negative and unresolved Case outcomes never become successful licensing', () => {
  const relation = { relation: 'Finite Case licensing', anchors: { governors: ['a', 'c'], subjects: ['b', 'd'] },
    values: { subjects: ['nominative', 'nominative'] } };
  for (const status of ['failed', 'blocked', 'unlicensed']) {
    const marks = paths(stage({ ...relation, values: { ...relation.values, status } }));
    assert.equal(marks.length, 2);
    assert(marks.every(mark => mark.outcome === 'blocked'));
  }
  for (const status of ['pending', 'unknown', 'not established']) {
    assert.equal(paths(stage({ ...relation, values: { ...relation.values, status } })).length, 0);
  }
  for (const value of ['unassigned', 'not yet licensed', 'unvalued']) {
    assert.equal(paths(stage({ ...relation, values: { subjects: [value, value] } })).length, 0);
  }
});
