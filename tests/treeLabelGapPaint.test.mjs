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

test('active gap paint reserves the literal badge text on exactly its descendant terminals',()=>{
 for(const familyId of ['trajectory.across-the-board','trajectory.sideward']) {
  const p=prepared([gap({familyId,badges:[{nodeId:'low',text:'t𝛼₁₀/作者',shape:'plain'}]})]);
  for(const id of ['a','b']) assert.deepEqual(terminal(p,1,id),[{kind:'terminal',text:'t𝛼₁₀/作者',indices:[]}]);
  assert.equal(terminal(p,1,'outside')[0].text,'book');
 }
});
test('unplayed, expired, missing, other-family and disabled overlays do not replace text',()=>{
 const active=prepared([gap()]);assert.equal(terminal(active,0,'a')[0].text,'book');
 const expired=prepared([gap({supersededAt:ref(1)})]);assert.equal(terminal(expired,2,'a')[0].text,'book');
 const missing=prepared([gap({badges:[{nodeId:'missing',text:'tᵢ',shape:'plain'}]})]);assert.equal(terminal(missing,1,'a')[0].text,'book');
 const other=prepared([gap({familyId:'parasitic-gap.composition'})]);assert.equal(terminal(other,1,'a')[0].text,'book');
 assert.equal(terminal(active,1,'a',{includeRelationIndices:false})[0].text,'book');
});
test('reuse uses the pre-paint labels, so a later equal badge cannot erase an identity index',()=>{
 const p=prepared([identity('χ'),gap({badges:[{nodeId:'a',text:'book',shape:'plain'}]})]);
 assert.deepEqual(terminal(p,1,'a'),[{kind:'terminal',text:'book',indices:[{text:'χ',mode:'identity'}]}]);
});
test('gap replacement and identity appending follow the same synchronous item order as the painter',()=>{
 const badge=gap({badges:[{nodeId:'a',text:'tᵢ',shape:'plain'}]});
 assert.deepEqual(terminal(prepared([identity('χ'),badge]),1,'a'),[{kind:'terminal',text:'tᵢ',indices:[]}]);
 assert.deepEqual(terminal(prepared([badge,identity('χ')]),1,'a'),[{kind:'terminal',text:'tᵢ',indices:[{text:'χ',mode:'identity'}]}]);
});
test('deferred theta uses the saved pre-gap identity base and preserves the synchronous visible state',()=>{
 const theta={kind:'node-plaque',plaqueStyle:'theta-grid',familyId:'theta.grid',relationRef:ref(0),appearsAtStage:0,
   anchorNodeIds:['outside'],rows:[],thetaRoles:[{nodeId:'a',index:'j',label:'Theme'}]};
 const p=prepared([identity('χ'),gap({badges:[{nodeId:'a',text:'tᵢ',shape:'plain'}]}),theta]);
 assert.deepEqual(terminal(p,1,'a'),[
  {kind:'terminal',text:'book',indices:[{text:'j',mode:'theta'}],lines:undefined},
  {kind:'terminal',text:'tᵢ',indices:[]}
 ]);
});
test('pending occurrence transfers use the same visible owner as the current painter',()=>{
 const canvas={id:'root',label:'CP',children:[{id:'a',label:'N',word:'book'},{id:'later',label:'N',word:'book'}]};
 const item=gap({badges:[{nodeId:'later',text:'tᵢ',shape:'plain'}],
  occurrenceTransfers:[{fromNodeId:'a',toNodeId:'later',stageIndex:0,relationIndex:1}]});
 const p=prepared([item],canvas);p.playbackSteps[1].replayVisibleNodeIds=['root','a'];
 assert.equal(terminal(p,1,'a')[0].text,'tᵢ');assert.equal(terminal(p,1,'later'),undefined);
 p.playbackSteps[2].replayVisibleNodeIds=['root','later'];
 assert.equal(terminal(p,2,'later')[0].text,'tᵢ');assert.equal(terminal(p,2,'a'),undefined);
});
