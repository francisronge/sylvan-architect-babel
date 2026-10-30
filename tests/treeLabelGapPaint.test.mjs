import assert from 'node:assert/strict';
import test from 'node:test';
import { treeLabelRunsForStep } from '../replay/treeLabelRuns.ts';

const ref = relationIndex => ({ stageIndex: 0, relationIndex });
const gap = (overrides = {}) => ({ kind:'node-badges', badgeStyle:'gap-notation',
  familyId:'trajectory.across-the-board', relationRef:ref(0), appearsAtStage:0,
  badges:[{nodeId:'low',text:'tᵢ',shape:'plain'}], ...overrides });
const identity = (index='i') => ({kind:'coindex',familyId:'identity.occurrences',
  relationRef:ref(0),appearsAtStage:0,nodeIds:['a'],index});
function prepared(items, forest) {
  const canvas=forest ?? {id:'root',label:'CP',children:[
    {id:'low',label:'DP',children:[{id:'a',label:'N',word:'book'},{id:'b',label:'N',word:'other'}]},
    {id:'outside',label:'N',word:'book'}]};
  const ids=[];const visit=n=>{ids.push(n.id);n.children?.forEach(visit)};visit(canvas);
  return {playbackSteps:[undefined,0,1].map(relationIndex=>({replayCanvasData:canvas,replayVisibleNodeIds:ids,
    replayFrameIndex:0,replayKind:relationIndex===undefined?'micro':'relation',
    replayRelationIdentity:relationIndex===undefined?undefined:ref(relationIndex),replayRelationLinks:[]})),
    replayDerivationFrames:[{workspaceForest:[canvas]}], relationRenderPlan:{frames:[{items}]},
    movementChainIndexCatalogue:{forest:[canvas],links:[],authoredIndicesByNodeId:new Map()}};
}
const terminal = (p,step,id,options) => treeLabelRunsForStep(p,step,undefined,options).get(id)?.filter(r=>r.kind==='terminal');

// Babel never writes trace notation over the model's words: no relation
// family's gap label replaces a terminal's text.
test('a gap label never rewrites the tree: the model\'s words stay as written',()=>{
 for(const familyId of ['trajectory.across-the-board','trajectory.sideward','parasitic-gap.composition','tier2.gap-notation']) {
  const p=prepared([gap({familyId})]);
  assert.deepEqual([terminal(p,1,'a')[0].text,terminal(p,1,'b')[0].text,terminal(p,1,'outside')[0].text],['book','other','book'],familyId);
 }
});
test('a gap label on a terminal leaves its identity index in place',()=>{
 for(const items of [[identity('χ'),gap({badges:[{nodeId:'a',text:'tᵢ',shape:'plain'}]})],[gap({badges:[{nodeId:'a',text:'tᵢ',shape:'plain'}]}),identity('χ')]])
  assert.deepEqual(terminal(prepared(items),1,'a'),[{kind:'terminal',text:'book',indices:[{text:'χ',mode:'identity'}]}]);
});
