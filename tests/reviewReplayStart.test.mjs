import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {initialReplayStepIndex} from '../replay/initialReplayStep.ts';

const source=ts.createSourceFile('TreeVisualizer.tsx',readFileSync(new URL('../components/TreeVisualizer.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let reset;
const visit=node=>{
  if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'){
    const body=node.arguments[0]?.getText(source)||'';
    if(body.includes('setActiveStepIndex(initialStepIndex)')&&body.includes('setIsAutoPlaying(autoPlay)'))reset=node.arguments[0];
  }
  ts.forEachChild(node,visit);
};
visit(source);
assert(reset,'the production analysis-reset effect must be present');
const extractedReset=new Function('animated','autoPlay','playbackSteps','initialStepIndex','setActiveStepIndex','setIsAutoPlaying',ts.transpile(`return (${reset.getText(source)});`,{target:ts.ScriptTarget.ES2023}));
const makeReset=(animated,autoPlay,steps,setFrame,setPlaying,relation)=>
  extractedReset(animated,autoPlay,steps,initialReplayStepIndex(steps,relation),setFrame,setPlaying);

test('switching review analyses returns to frame one without starting a timer',()=>{
  let frame=26,playing=true;
  const reset=makeReset(true,false,[{},{}],value=>frame=value,value=>playing=value);
  reset();assert.equal(frame,0);assert.equal(playing,false);
  frame=14;playing=true;reset();assert.equal(frame,0);assert.equal(playing,false);
});
test('explicit autoplay is preserved and an empty replay stays stopped',()=>{
  let frame=8,playing=false;
  makeReset(true,true,[{}],value=>frame=value,value=>playing=value)();assert.equal(frame,0);assert.equal(playing,true);
  makeReset(true,true,[],value=>frame=value,value=>playing=value)();assert.equal(frame,0);assert.equal(playing,false);
});

test('an explicit relation moment resets to its frame without starting playback',()=>{
  const relation={stageIndex:1,relationIndex:0};
  const steps=[{},{},{replayKind:'relation',replayRelationIdentity:relation},{}];
  let frame=0,playing=true;
  const reset=makeReset(true,false,steps,value=>frame=value,value=>playing=value,relation);
  reset();assert.equal(frame,2);assert.equal(playing,false);
  frame=3;playing=true;reset();assert.equal(frame,2);assert.equal(playing,false);
  makeReset(true,true,steps,value=>frame=value,value=>playing=value,relation)();
  assert.equal(frame,2);assert.equal(playing,true);
});

test('a relation initial frame does not enable playback for a static tree or empty replay',()=>{
  const relation={stageIndex:1,relationIndex:0};
  const steps=[{},{replayKind:'relation',replayRelationIdentity:relation}];
  let frame=1,playing=true;
  makeReset(false,true,steps,value=>frame=value,value=>playing=value,relation)();
  assert.equal(frame,0);assert.equal(playing,false);
  frame=1;playing=true;
  makeReset(true,true,[],value=>frame=value,value=>playing=value,relation)();
  assert.equal(frame,0);assert.equal(playing,false);
});
