import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverMovementEvidence } from '../replay/relations/movementEvidence.ts';
import { buildReplayPlayback } from '../replay/replaySnapshot.ts';
const node = (id,label,children=[],extra={}) => ({id,label,children,...extra});
const priorHead = node('verb','V⁰',[],{word:'read',tokenIndex:0,lineageId:'predicate'});
const relation = {relation:'An authored dependency',anchors:{movedHead:'verb',trace:'lower',landingHead:'receiver'},priorAnchors:{sourceHead:'verb'}};
const retainedHost = (persistent=true) => {
 const exponent = node('features','Feature',[],{silent:true});
 const prior=[node('receiver','T⁰',[exponent]),node('predicate','VP',[priorHead])];
 const current=[node('receiver','T⁰',[{...priorHead,id:persistent?'verb':'upper'},structuredClone(exponent)]),node('predicate','VP',[node('lower','V⁰',[],{silent:true,lineageId:'predicate'})])];
 return {prior,current,relation:{...relation,anchors:{...relation.anchors,movedHead:persistent?'verb':'upper'}}};
};
const recover = input => recoverMovementEvidence(input.relation,input.current,input.prior);

test('retained receiving heads support different terminal feature categories and either occurrence ID convention', () => {
 for(const persistent of [false,true]) for(const category of ['Feature','Agr','Infl']) {
  const input=retainedHost(persistent),original=structuredClone(input);
  input.prior[0].children[0].label=category;
  input.current[0].children[1].label=category;
  const d=recover(input);
  assert.equal(d.movement?.trajectoryKind,'head');
  assert.equal(d.movement?.sourceNodeId,'lower');
  assert.equal(d.movement?.targetNodeId,persistent?'verb':'upper');
  assert.equal(d.movement?.transition,true);
  assert(d.movement.context.some(c=>c.nodeId==='receiver'));
  original.prior[0].children[0].label=category;
  original.current[0].children[1].label=category;
  assert.deepEqual(input,original);
 }
});

test('retained host evidence cannot turn branching syntax or changed contents into head exponents', () => {
 const mutations=[
  input=>{input.current[0].children[1].word='new';},
  input=>{input.current[0].children[1].children=[node('det','D',[],{word:'the'}),node('noun','N',[],{word:'book'})];input.prior[0].children[0]=structuredClone(input.current[0].children[1]);input.current[0].children[1].label='D';input.prior[0].children[0].label='D';},
  input=>{input.prior.push(node('receiver','T⁰'));},
  input=>{input.current[0].children.push(node('extra','Feature'));},
  input=>{input.current[0].children[0].lineageId='unrelated';}
 ];
 for(const [index,mutate] of mutations.entries()){const input=retainedHost();mutate(input);assert.equal(recover(input).movement,undefined,`mutation ${index}`);}
 const source=node('source','D',[],{word:'Jan',lineageId:'subject'});
 const clause=node('clause','v',[source,node('predicate','V',[node('verb','V',[],{word:'leaves'})])]);
 const prior=[node('retained','T',[clause])],current=[node('retained','T',[{...source,id:'high',silent:true},clause])];
 assert.notEqual(recoverMovementEvidence({relation:'subject internal merge',anchors:{higherOccurrence:'high',lowerOccurrence:'source'},priorAnchors:{source:'source'}},current,prior).movement?.trajectoryKind,'head');
});

test('a proved head landing and lower occurrence appear atomically at their relation', () => {
 const input=retainedHost();
 const stage=(workspaceForest,relations)=>({statement:'State',stageRecord:'Authored state.',workspaceForest,relations});
 const playback=buildReplayPlayback({sentence:'read',framework:'xbar',analyses:[{derivationStages:[stage(input.prior,[]),stage(input.current,[input.relation])]}]});
 const i=playback.steps.findIndex(s=>s.replayRelationIdentity?.stageIndex===1);
 assert(i>0);
 assert(!playback.steps[i-1].replayVisibleNodeIds.includes('lower'));
 assert(playback.steps[i].replayVisibleNodeIds.includes('lower'));
 assert.equal(playback.steps[i].replayRelationLinks.filter(l=>l.authoredRelationKey==='1:0'&&l.renderFamily==='trajectory').length,1);
});

const containedSource = () => {
 const source=node('member','D⁰',[],{word:'it',tokenIndex:0,lineageId:'member-chain'});
 const container=node('object','DP',[node('bar','D′',[source])]);
 const prior=[node('predicate','VP',[container]),node('host','T⁰',[],{silent:true})];
 const current=[node('predicate','VP',[node('object','DP',[node('bar','D′',[node('lower','D⁰',[],{silent:true,lineageId:'member-chain'})])])]),node('complex','T⁰',[source,node('host','T⁰',[],{silent:true})])];
 return {prior,current,relation:{relation:'An authored dependency',anchors:{clitic:'member',trace:'lower',host:'complex'},priorAnchors:{sourceHead:'member',sourceObject:'object'}}};
};

test('an independently proved moving head distinguishes its retained source container from a second source', () => {
 const input=containedSource(),original=structuredClone(input),d=recover(input);
 assert.equal(d.movement?.trajectoryKind,'head');
 assert.equal(d.movement?.priorSourceNodeId,'member');
 assert(d.movement.priorContextKeys.includes('sourceObject'));
 assert.deepEqual(input,original);
 for(const mutate of [
  input=>{input.current[0].children[0].children[0].children.reverse();input.current[0].children[0].children[0].children.unshift(node('unrelated','D⁰'));},
  input=>{input.current[0].children[0].id='different-container';},
  input=>{input.current.push(node('object','DP'));},
  input=>{input.prior[0].children[0].lineageId='other-chain';input.current[0].children[0].lineageId='changed-chain';},
  input=>{input.prior[0].children[0].lineageId='member-chain';input.current[0].children[0].lineageId='member-chain';}
 ]){const bad=containedSource();mutate(bad);assert.equal(recover(bad).movement,undefined);}
});

test('an explicitly named current lower object remains context around a proved moving head', () => {
 const input=containedSource();
 input.relation.anchors.lowerObject='object';
 const original=structuredClone(input),movement=recover(input).movement;
 assert.equal(movement?.priorSourceNodeId,'member');
 assert.equal(movement?.sourceNodeId,'lower');
 assert.equal(movement?.targetNodeId,'member');
 assert.equal(movement?.trajectoryKind,'head');
 assert.deepEqual(input,original);
 const stage=(workspaceForest,relations)=>({statement:'State',stageRecord:'Authored state.',workspaceForest,relations});
 const playback=buildReplayPlayback({sentence:'it',framework:'xbar',analyses:[{derivationStages:[
  stage(input.prior,[]),stage(input.current,[input.relation,{relation:'Later licensing',
   anchors:{clitic:'member',trace:'lower'},values:{case:'accusative'}}])
 ]}]});
 const index=playback.steps.findIndex(step=>step.replayRelationIdentity?.stageIndex===1
  &&step.replayRelationIdentity.relationIndex===0);
 assert(index>0);
 assert(!playback.steps[index-1].replayVisibleNodeIds.includes('lower'));
 assert(playback.steps[index].replayVisibleNodeIds.includes('lower'));
 assert.equal(playback.steps[index].replayRelationLinks.filter(link=>link.authoredRelationKey==='1:0'
  &&link.renderFamily==='trajectory').length,1);
 assert(!playback.steps[index].movementDiagnostics?.some(value=>value.startsWith('RELATION_TIMING_CONFLICT')));
});

test('a retained object cannot hide an independently moving container or unrelated lower source', () => {
 for(const independent of [false,true]){
  const input=containedSource();input.relation.anchors.lowerObject='object';
  if(independent){
   input.prior[0].children[0].lineageId='object-chain';
   input.current[0].children[0].lineageId='object-chain';
   input.current.push(node('other-object','DP',[],{lineageId:'object-chain'}));
   input.relation.anchors.higherOccurrence='other-object';
  }else input.relation.anchors.lowerObject='unrelated';
  assert.equal(recover(input).movement,undefined);
 }
});

test('a preceding root clause remains source context when a new projection wraps it', () => {
 const source=node('subject','NP',[],{word:'she',lineageId:'subject-chain'});
 const predicate=node('predicate','I′',[node('tense','I',[],{silent:true})]);
 const prior=[node('clause','IP',[source,predicate])];
 const current=[node('completed','CP',[{...source,id:'topic'},node('cbar','C′',[
  node('c','C',[],{silent:true}),node('clause','IP',[
   node('subject','t_NP',[],{silent:true,lineageId:'subject-chain'}),predicate])])])];
 const relation={relation:'An authored dependency',anchors:{topic:'topic',subjectTrace:'subject'},
  priorAnchors:{sourceSubject:'subject',sourceClause:'clause'}};
 const original=structuredClone({prior,current,relation});
 const movement=recoverMovementEvidence(relation,current,prior).movement;
 assert.equal(movement?.sourceNodeId,'subject');
 assert.equal(movement?.targetNodeId,'topic');
 assert.equal(movement?.trajectoryKind,'phrasal');
 assert(movement?.priorContextKeys.includes('sourceClause'));
 assert.deepEqual({prior,current,relation},original);
 for(const mutate of [
  input=>{input.current[0].children[1].children[1].children.reverse();},
  input=>{input.prior.push(node('clause','IP'));},
  input=>{input.current[0].children[1].children[1].lineageId='different';}
 ]){const input=structuredClone(original);mutate(input);
  assert.equal(recoverMovementEvidence(input.relation,input.current,input.prior).movement,undefined);}
});

test('a nested bare head assembly lands as a head beside its exact terminal host', () => {
 const verb=node('verb','V',[],{word:'reads',lineageId:'verb-chain'});
 const host=node('v','v',[],{silent:true,lineageId:'v-chain'});
 const inner=node('inner','v',[verb,host],{lineageId:'inner-chain'});
 const clitic=node('clitic','D',[],{word:'it',lineageId:'clitic-chain'});
 const assembly=node('assembly','v',[clitic,inner],{lineageId:'assembly-chain'});
 const prior=[node('phrase','v',[assembly,node('complement','VP',[])])];
 const rename=n=>({...n,id:'high-'+n.id,children:n.children.map(rename)});
 const lower=n=>({...n,silent:true,children:n.children.map(lower)});
 const tense=node('tense','T',[],{silent:true});
 const current=[node('tp','TP',[node('complex','T',[rename(assembly),tense]),
  node('phrase','v',[lower(assembly),node('complement','VP',[])])])];
 const relation={relation:'An authored dependency',anchors:{source:'assembly',landingOccurrence:'high-assembly',host:'tense'},
  priorAnchors:{source:'assembly'}};
 const result=recoverMovementEvidence(relation,current,prior);
 assert.equal(result.movement?.trajectoryKind,'head');
 assert(result.movement.context.some(context=>context.nodeId==='tense'));
 assert.deepEqual(result.diagnostics,[]);
 const unanchoredHost=structuredClone(relation);delete unanchoredHost.anchors.host;
 assert.equal(recoverMovementEvidence(unanchoredHost,current,prior).movement?.trajectoryKind,'phrasal');
 const malformed=structuredClone(current);
 malformed[0].children[0].children[0].children[0].label='DP';
 assert.notEqual(recoverMovementEvidence(relation,malformed,prior).movement?.trajectoryKind,'head');
});
