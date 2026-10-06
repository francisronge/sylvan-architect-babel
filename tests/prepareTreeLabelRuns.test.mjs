import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareTreeLabelRuns } from '../replay/prepareTreeLabelRuns.ts';
import { treeLabelRunKey, treeLabelRunsForStep } from '../replay/treeLabelRuns.ts';

const prepared = () => {
  const canvas={id:'n',label:'N long label that needs wrapping',word:'Book₁₀'};
  const playbackSteps=[0,1].map(stage=>({replayFrameIndex:stage,replayStageStepIndex:0,replayKind:'relation',
    replayRelationIdentity:{stageIndex:stage,relationIndex:0},replayCanvasData:canvas,replayVisibleNodeIds:['n'],replayRelationLinks:[]}));
  return {playbackSteps,replayDerivationFrames:[{workspaceForest:[canvas]},{workspaceForest:[canvas]}],
    relationRenderPlan:{frames:[0,1].map(stage=>({items:[{kind:'coindex',familyId:'identity.occurrences',
      index:stage?'作者₂':'𝒾₁',nodeIds:['n'],appearsAtStage:stage,relationRef:{stageIndex:stage,relationIndex:0}}]}))},
    movementChainIndexCatalogue:{forest:[canvas],links:[],authoredIndicesByNodeId:new Map()}};
};
const measure=text=>[...text].length*45;
test('shared canvas identity keeps exact variants from every relation moment',()=>{
 const replay=prepared(),snapshot=structuredClone(replay),map=prepareTreeLabelRuns(replay,measure),canvas=replay.playbackSteps[0].replayCanvasData;
 assert.equal(map.size,1);const actual=new Set(map.get(canvas).get('n').map(treeLabelRunKey));
 const expected=new Set(replay.playbackSteps.flatMap((_step,index)=>treeLabelRunsForStep(replay,index,measure).get('n').map(treeLabelRunKey)));
 assert.deepEqual(actual,expected);assert(actual.size>=3);
 const terminal=map.get(canvas).get('n').filter(run=>run.kind==='terminal');
 assert(terminal.some(run=>run.indices.some(index=>index.text==='𝒾₁')));
 assert(terminal.some(run=>run.indices.some(index=>index.text==='作者₂')));
 assert.deepEqual(replay,snapshot,'preparing display runs must not alter Replay');
});
test('disabled relation overlays retain exact base notation and omit authored overlay indices',()=>{
 const replay=prepared(),map=prepareTreeLabelRuns(replay,measure,{includeRelationIndices:false});
 const variants=map.get(replay.playbackSteps[0].replayCanvasData).get('n');
 assert(variants.every(run=>run.indices.length===0));
 assert(variants.some(run=>run.kind==='terminal'&&run.text==='Book₁₀'));
});
test('prepared category descriptors preserve the current wrapping callback',()=>{
 const replay=prepared(),wide=prepareTreeLabelRuns(replay,()=>10,{includeRelationIndices:false});
 const narrow=prepareTreeLabelRuns(replay,measure,{includeRelationIndices:false});
 const category=map=>map.get(replay.playbackSteps[0].replayCanvasData).get('n').find(run=>run.kind==='category');
 assert(category(narrow).lines.length>category(wide).lines.length);
 assert.notEqual(treeLabelRunKey(category(narrow)),treeLabelRunKey(category(wide)));
});
