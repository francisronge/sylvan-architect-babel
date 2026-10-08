import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const { cases } = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/qualified-assignment-context.json', import.meta.url)));
const walk = forest => forest.flatMap(node => [node, ...walk(node.children ?? [])]);
const inspect = input => {
  const relation = input.stage.relations[input.relationIndex];
  const result = dispatchRelationClaims({ relation, currentForest: input.stage.workspaceForest, stageIndex: 0, relationIndex: 0 });
  return { result, families: result.facets.map(f => f.recipe.id), items: compileRelationRenderPlan([
    { ...input.stage, relations: [relation] }
  ]).frames[0].items };
};

for (const [index, source] of cases.entries()) {
  const family = source.expectedFamily;
  test(`${source.id}: recover ${family} from exact participants without changing the record`, () => {
    const original = structuredClone(source);
    const out = inspect(source);
    assert(out.families.includes(family));
    assert.deepEqual(source, original);
    if (index === 1) {
      const context = out.result.evidenceCoverage.fields.find(f => f.field === 'anchors' && f.key === 'verb');
      assert(!context.recognizedBy.some(c => c.claim === 'theta-grid'));
    }
    const changed = structuredClone(source);
    const remap = new Map(walk(changed.stage.workspaceForest).map(n => [n.id, `n-${n.id}`]));
    for (const n of walk(changed.stage.workspaceForest)) { n.id = remap.get(n.id); if (n.word) n.word = 'unrelated'; }
    const r = changed.stage.relations[changed.relationIndex];
    for (const [key, value] of Object.entries(r.anchors)) r.anchors[key] = Array.isArray(value) ? value.map(id => remap.get(id)) : remap.get(value);
    assert(inspect(changed).families.includes(family), 'no sentence or node-ID special case');
  });

  test(`${source.id}: incomplete or denied evidence cannot acquire ${family}`, () => {
    for (const mutate of [
      r => { r.relation = `Possible ${r.relation}`; },
      r => { r.values = { ...r.values, status: 'denied' }; },
      r => { const key = Object.keys(r.anchors).find(key => key !== 'adjunctionResult'); r.anchors[key] = 'missing'; }
    ]) {
      const changed = structuredClone(source); mutate(changed.stage.relations[changed.relationIndex]);
      assert(!inspect(changed).families.includes(family), String(mutate));
    }
  });
}

test('a complement needs its actual assigner as a sister and an explicit role literal', () => {
  for (const mutate of [
    (s, r) => { delete r.values.thetaRole; },
    (s, r) => { r.anchors.complement = 'subjectDP'; },
    (s, r) => { r.values.thetaRole = ['Theme', 'Agent']; },
    (s, r) => { r.anchors.verb = ['vBase', 'iTense']; }
  ]) {
    const changed = structuredClone(cases[0]); mutate(changed.stage, changed.stage.relations[changed.relationIndex]);
    assert(!inspect(changed).families.includes('theta-grid'), String(mutate));
  }
});

test('a different or competing lexical head cannot be dismissed as predicate context', () => {
  for (const mutate of [
    (s, r) => { r.anchors.verb = 'yesterdayAdv'; },
    (s, r) => { r.anchors.lexicalPredicate = 'vBase'; },
    (s, r) => { walk(s.workspaceForest).find(n => n.id === 'vPrime').children.push({ id: 'competingV', label: 'V', children: [] }); }
  ]) {
    const changed = structuredClone(cases[1]); mutate(changed.stage, changed.stage.relations[changed.relationIndex]);
    assert(!inspect(changed).families.includes('theta-grid'), String(mutate));
  }
});

test('a modified domain or clause must identify the actual adjacent attachment host', () => {
  for (const source of cases.filter(c => c.expectedFamily === 'pair-merge')) {
    const changed = structuredClone(source), r = changed.stage.relations[changed.relationIndex];
    const key = Object.keys(r.anchors).find(k => k.startsWith('modified'));
    r.anchors[key] = walk(changed.stage.workspaceForest).find(n => n.word)?.id;
    assert(!inspect(changed).families.includes('pair-merge'));
  }
});
