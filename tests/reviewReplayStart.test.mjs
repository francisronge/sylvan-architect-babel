import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source=ts.createSourceFile('TreeVisualizer.tsx',readFileSync(new URL('../components/TreeVisualizer.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let reset;
const visit=node=>{
  if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'){
    const body=node.arguments[0]?.getText(source)||'';
    if(body.includes('setActiveStepIndex(0)')&&body.includes('setIsAutoPlaying(autoPlay)'))reset=node.arguments[0];
  }
  ts.forEachChild(node,visit);
};
visit(source);
assert(reset,'the production analysis-reset effect must be present');
const makeReset=new Function('animated','autoPlay','playbackSteps','setActiveStepIndex','setIsAutoPlaying',ts.transpile(`return (${reset.getText(source)});`,{target:ts.ScriptTarget.ES2023}));

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
