import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { neutralWorkspaceAttachments } from '../replay/workspaceNeutralAttachments.ts';
const leaf = id => ({id, children: []});
const fork = (id, ...children) => ({id, children});
function view(...roots) {
  const nodes=new Map(), parents=new Map();
  const visit=(node, owner)=>{nodes.set(node.id,node);if(owner)parents.set(node.id,owner);node.children.forEach(c=>visit(c,node.id));};
  roots.forEach(n=>visit(n));
  return {nodes,has:id=>nodes.has(id),parent:id=>parents.get(id),children:id=>nodes.get(id)?.children.map(c=>c.id)??[],
    contains:(root,id)=>{for(let at=id;at;at=parents.get(at))if(at===root)return true;return false;}};
}
const step=(overrides={})=>({replayKind:'relation',replayRelationIdentity:{stageIndex:2,relationIndex:0},
  replayTreeTransition:{relationKey:'2:0',priorNodeIds:['prior','retained','word'],currentNodeIds:['landing','retained','word','lower','verb']},...overrides});
function example() {
  const retained=fork('retained',leaf('word')), object=fork('object',leaf('noun')), verb=leaf('verb');
  const before=view(fork('clause',fork('prior',retained),fork('vp',object,verb)),leaf('outside'));
  const current=view(fork('clause',leaf('lower'),fork('vp',fork('wrapper',object,fork('landing',retained)),verb)),leaf('outside'));
  const same=id=>JSON.stringify(before.nodes.get(id))===JSON.stringify(current.nodes.get(id));
  return {before,current,same};
}
const names=value=>[...value].sort();
test('neutral rewrite retains identity limits while permitting exact changed attachments',()=>{
  const {before,current,same}=example(), input=step(), snapshot=JSON.stringify(input);
  assert.deepEqual(names(neutralWorkspaceAttachments(input,before,current,same)),['object','retained']);
  assert.equal(JSON.stringify(input),snapshot);
});
for(const [name,change] of [
  ['missing proof',s=>delete s.replayTreeTransition],
  ['wrong moment',s=>s.replayTreeTransition.relationKey='1:0'],
  ['macro moment',s=>s.replayKind='macro'],
  ['missing identity',s=>delete s.replayRelationIdentity],
  ['no earlier witness',s=>s.replayTreeTransition.priorNodeIds=['absent']],
  ['no current witness',s=>s.replayTreeTransition.currentNodeIds=[]],
])test(`${name} grants no attachment ownership`,()=>{
  const {before,current,same}=example(),input=step();change(input);
  assert.deepEqual(names(neutralWorkspaceAttachments(input,before,current,same)),[]);
});
test('an existing same-parent participant does not move merely because the rewrite names it',()=>{
  const {before,current,same}=example(), input=step();
  input.replayTreeTransition.priorNodeIds.push('verb','outside');
  input.replayTreeTransition.currentNodeIds.push('outside');
  assert.deepEqual(names(neutralWorkspaceAttachments(input,before,current,same)),['object','retained']);
});
test('topology-stable pronunciation changes grant no translation',()=>{
  const before=view({...leaf('word'),word:'old'}),current=view({...leaf('word'),word:'new'});
  const input=step({replayTreeTransition:{relationKey:'2:0',priorNodeIds:['word'],currentNodeIds:['word']}});
  assert.deepEqual(names(neutralWorkspaceAttachments(input,before,current,()=>false)),[]);
});
for(const mode of ['changed-host','wrong-parent','wrong-slot','extra-sibling'])test(`${mode} cannot prove wrapper attachment`,()=>{
  const {before,current,same}=example();
  if(mode==='wrong-parent')before.parent=id=>id==='object'?'elsewhere':id==='retained'?'prior':undefined;
  if(mode==='wrong-slot')current.nodes.get('vp').children.reverse();
  if(mode==='extra-sibling')current.nodes.get('wrapper').children.push(leaf('extra'));
  const result=neutralWorkspaceAttachments(step(),before,current,id=>mode==='changed-host'&&id==='object'?false:same(id));
  assert(!result.has('object'));
});

test('compiler exports exact neutral rewrite witnesses without promoting the relation to movement', () => {
  const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/astra-turkish-relative-2.json', import.meta.url)));
  const unchanged = structuredClone(record);
  const replay = prepareReplay({ ...record, includePlayback: true });
  const moment = replay.playbackSteps.find(step => step.replayKind === 'relation'
    && step.replayRelationIdentity?.stageIndex === 2 && step.replayRelationIdentity.relationIndex === 0);
  assert.deepEqual(moment.replayTreeTransition, {
    relationKey: '2:0',
    currentNodeIds: ['b_yesterday_low', 'b_yesterday_abar', 'b_yesterday_adv', 'b_read', 'b_yesterday_trace'],
    priorNodeIds: ['b_yesterday', 'b_yesterday_abar', 'b_yesterday_adv']
  });
  const links = moment.replayRelationLinks.filter(link => link.authoredRelationKey === '2:0');
  assert(links.length);
  assert(links.every(link => link.renderFamily === 'authored-anchor-link' && link.movementTransition !== true));
  assert.deepEqual(record, unchanged);
  assert(replay.playbackSteps.filter(step => step.replayKind !== 'relation').every(step => !step.replayTreeTransition));
});
