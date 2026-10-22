import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as d3 from 'd3';
import { prepareReplay } from '../replay/prepareReplay.ts';
import { buildStageCoordinateReservations } from '../replay/stageCoordinates.ts';
import { buildStageLayoutGroups, stageTreeLayoutSize } from '../replay/stageCamera.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { workspaceContinuityReflows } from '../replay/workspaceShapeReflows.ts';
import { constructionReceivingAttachments, movementReceivingAttachments, movementReceivingHosts } from '../replay/workspaceReceivingHost.ts';
import { directionsFor } from './helpers/rtlMirror.mjs';

const record = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/receiving-head-slot.json', import.meta.url)));
const close = (a,b,message) => assert(Math.abs(a-b)<1e-6,`${message}: ${a} vs ${b}`);
function setup(input,width,height,direction) {
  const steps=prepareReplay({...input,includePlayback:true}).playbackSteps;
  const groups=buildStageLayoutGroups(steps,input.derivationStages);
  const sizes=new Map(input.derivationStages.map((_,i)=>[i,stageTreeLayoutSize(steps,i,width,height,groups)]));
  const points=new Map([...sizes].flatMap(([i,size])=>[...buildStageCoordinateReservations(steps,i,size,i=>sizes.get(i),direction)]));
  const render=(step,p)=>{const root=d3.hierarchy(step.replayCanvasData);applyVizIds(root);const v=new Set(step.replayVisibleNodeIds);return layoutSyntaxTree(root,sizes.get(step.replayFrameIndex),direction,p,v).descendants().filter(n=>v.has(getNodeId(n))&&!n.data.replayLayoutOnly&&n.data.replayOrigin?.kind!=='workspace');};
  const scenes=steps.map(step=>({step,canvas:step.replayCanvasData,nodes:new Map(render(step,points.get(step.replayCanvasData)).map(n=>[getNodeId(n),n]))}));
  assert.deepEqual(workspaceContinuityReflows(scenes,points,(s,p)=>render(s.step,p)),[]);
  return {steps,scenes};
}
// Right to left this runs only for a record whose layout is not the reflection of
// its left-to-right layout (tests/helpers/rtlMirror.mjs).
for(const [width,height]of [[1600,948],[390,844]])for(const direction of directionsFor('replay-regressions/receiving-head-slot.json#'))test(`${width}px ${direction}: successive movement wrappers retain the same outer attachment slot`,()=>{
  const original=JSON.stringify(record),{steps,scenes}=setup(record,width,height,direction);
  const before=scenes[29].nodes,after=scenes[30].nodes;
  assert.equal(steps[30].replayKind,'relation');
  assert(!before.has('cliticizedI'));assert(after.has('cliticizedI'));
  close(before.get('finiteHost').x,after.get('cliticizedI').x,'the existing host occupies the new outer parent slot');
  close(before.get('finiteHost').y,after.get('cliticizedI').y,'the outer attachment row is retained');
  for(const frame of [26,27,28,29])for(const id of ['matrixIP','matrixIbar','giuliaNP','matrixVP']) {
    close(scenes[frame].nodes.get(id).x,after.get(id).x,`${id} does not reserve a later horizontal gap`);
    close(scenes[frame].nodes.get(id).y,after.get(id).y,`${id} keeps its row`);
  }
  for(const id of ['want','finiteI','want::__leaf'])for(const zoom of [0.4,1,2]){
    close((before.get(id).x-before.get('finiteHost').x)*zoom,(after.get(id).x-after.get('finiteHost').x)*zoom,'the compound keeps its whole interior under zoom');
    close(before.get(id).y-before.get('finiteHost').y,after.get(id).y-after.get('finiteHost').y,'the compound translates rigidly');
  }
  assert.equal(before.get('object').data.word,'lo','source pronunciation is retained');
  assert(!before.has('objectTrace'));assert(after.has('objectTrace'));
  assert.equal(JSON.stringify(record),original,'authored syntax and claims stay unchanged');
});

test('opaque occurrence IDs retain the same receiving-slot geometry',()=>{
  const ids=new Set();const visit=n=>{ids.add(n.id);n.children?.forEach(visit);};record.derivationStages.forEach(s=>s.workspaceForest.forEach(visit));
  const renamed=JSON.parse(JSON.stringify(record,(_,v)=>typeof v==='string'&&ids.has(v)?`opaque/${v}`:v));
  const a=setup(record,1600,948,'ltr'),b=setup(renamed,1600,948,'ltr');
  a.scenes.forEach((scene,i)=>{for(const[id,node]of scene.nodes){const other=b.scenes[i].nodes.get('opaque/'+id);assert(other);close(node.x,other.x,'ID-independent x');close(node.y,other.y,'ID-independent y');}});
});

const ordinaryWrapper = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/head-movement-ordinary-wrapper.json', import.meta.url)));
// Right to left this runs only for a record whose layout is not the reflection of
// its left-to-right layout (tests/helpers/rtlMirror.mjs).
for (const [width, height] of [[1600, 948], [390, 844]]) for (const direction of directionsFor('replay-regressions/head-movement-ordinary-wrapper.json#')) {
  test(`${width}px ${direction}: movement followed by an ordinary wrapper uses one outer receiving slot`, () => {
    const original = JSON.stringify(ordinaryWrapper), { steps, scenes } = setup(ordinaryWrapper, width, height, direction);
    const before = scenes[26].nodes, movement = scenes[27].nodes, merge = scenes[28].nodes;
    assert.equal(steps[27].replayKind, 'relation');
    assert.equal(steps[28].operation, 'ExternalMerge');
    for (const axis of ['x', 'y']) {
      close(before.get('i_infl')[axis], movement.get('i_finite')[axis], 'the bare receiver occupies the complete landing slot');
      close(movement.get('i_finite')[axis], merge.get('i_complex')[axis], 'the later ordinary wrapper retains that outer slot');
      close(before.get('i_pro')[axis], merge.get('i_pro')[axis], 'the unrelated subject stays stationary');
    }
    assert.equal(before.get('i_v').data.word, 'vive');
    assert(!before.has('i_finite') && !before.has('i_complex') && !before.has('i_vtrace'));
    assert(movement.has('i_finite') && movement.has('i_vtrace') && !movement.has('i_complex'));
    for (const id of ['i_v', 'i_infl', 'i_v::__leaf']) for (const zoom of [0.4, 1, 2]) {
      close((movement.get(id).x - movement.get('i_finite').x) * zoom,
        (merge.get(id).x - merge.get('i_finite').x) * zoom, 'ordinary merge translates the complete compound rigidly');
      close(movement.get(id).y - movement.get('i_finite').y,
        merge.get(id).y - merge.get('i_finite').y, 'the compound keeps its internal ranks');
    }
    const receivingX = before.get('i_infl').x;
    for (const scene of scenes.slice(0, 27)) if (scene.nodes.has('i_infl'))
      close(scene.nodes.get('i_infl').x, receivingX, 'construction uses the same receiving slot throughout its lifetime');
    assert.equal(JSON.stringify(ordinaryWrapper), original, 'authored syntax, relation order and words are preserved');
  });
}

test('the combined receiving lifetime does not depend on occurrence-ID spelling', () => {
  const ids = new Set();
  const visit = n => { ids.add(n.id); n.children?.forEach(visit); };
  ordinaryWrapper.derivationStages.forEach(stage => stage.workspaceForest.forEach(visit));
  const renamed = JSON.parse(JSON.stringify(ordinaryWrapper, (_, value) =>
    typeof value === 'string' && ids.has(value) ? `opaque/${value}` : value));
  const a = setup(ordinaryWrapper, 1600, 948, 'ltr'), b = setup(renamed, 1600, 948, 'ltr');
  a.scenes.forEach((scene, i) => { for (const [id, node] of scene.nodes) {
    const other = b.scenes[i].nodes.get('opaque/' + id); assert(other);
    close(node.x, other.x, 'ID-independent x'); close(node.y, other.y, 'ID-independent y');
  } });
});

// Right to left this runs only for a record whose layout is not the reflection of
// its left-to-right layout (tests/helpers/rtlMirror.mjs).
for (const direction of directionsFor('replay-regressions/ordinary-receiving-width-control.json#')) test(`${direction}: ordinary wrappers preserve an already compact movement receiver`, () => {
  const control = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/ordinary-receiving-width-control.json', import.meta.url)));
  const { scenes } = setup(control, 1600, 948, direction), before = scenes[26].nodes;
  const receivingTree = before.get('p_ip').descendants().filter(node => before.has(getNodeId(node)));
  const xs = receivingTree.map(node => node.x);
  assert(Math.max(...xs) - Math.min(...xs) <= 2426.976378643945 + 1e-6,
    'a later ordinary wrapper must not undo the earlier accepted movement contraction');
});

function topology(rows){const map=new Map(rows),parents=new Map(rows.flatMap(([id,children])=>children.map(child=>[child,id])));return {has:id=>map.has(id),parent:id=>parents.get(id),children:id=>map.get(id)??[],contains:(root,id)=>{for(let x=id;x;x=parents.get(x))if(x===root)return true;return false;}};}

test('ordinary receiving slots require the exact new wrapper, sources and sole retained child', () => {
  const before = topology([['root', ['host', 'peer']], ['host', ['word']], ['word', []], ['peer', []], ['input', []]]);
  const after = topology([['root', ['wrapper', 'peer']], ['wrapper', ['input', 'host']], ['host', ['word']], ['word', []], ['peer', []], ['input', []]]);
  const step = { replayKind: 'micro', operation: 'ExternalMerge', targetNodeId: 'wrapper', sourceNodeIds: ['input', 'host'] };
  assert.deepEqual(constructionReceivingAttachments(step, before, after, () => true), [{ host: 'host', wrapper: 'wrapper' }]);
  assert.deepEqual(constructionReceivingAttachments(step, before, after, () => false), []);
  for (const patch of [{ replayKind: 'relation' }, { operation: 'Project' }, { targetNodeId: 'unrelated' },
    { sourceNodeIds: [] }, { sourceNodeIds: ['host', 'host'] }, { sourceNodeIds: ['other', 'host'] }])
    assert.deepEqual(constructionReceivingAttachments({ ...step, ...patch }, before, after, () => true), []);
  const attachedInput = topology([['root', ['host', 'peer']], ['host', ['word']], ['word', []], ['peer', ['input']], ['input', []]]);
  assert.deepEqual(constructionReceivingAttachments(step, attachedInput, after, () => true), [], 'a source inside another subtree cannot borrow the slot');
  assert.deepEqual(constructionReceivingAttachments(step, after, after, () => true), [], 'an existing wrapper is not a new receiving boundary');
});
for(const count of [0,1,2,3])test(`receiving slots recognize arbitrary interior branching: ${count} daughters`,()=>{
  const members=Array.from({length:count},(_,i)=>'member'+i),leaves=members.map(id=>[id,[]]);
  const before=topology([['root',['host','source']],['host',members],['source',[]],...leaves]);
  const after=topology([['root',['wrapper','lower']],['wrapper',['landing','host']],['landing',[]],['host',members],['lower',[]],...leaves]);
  const step={replayKind:'relation',replayRelationIdentity:{stageIndex:1,relationIndex:0},replayRelationLinks:[{authoredRelationKey:'1:0',movementTransition:true,priorSourceNodeId:'source',witnessNodeId:'lower',targetNodeId:'landing'}]};
  assert.deepEqual(movementReceivingAttachments(step,before,after,()=>true),[{host:'host',wrapper:'wrapper'}]);
  assert.deepEqual(movementReceivingAttachments(step,before,after,()=>false),[],'changed topology cannot borrow a receiving slot');
  assert.deepEqual(movementReceivingAttachments({...step,replayKind:'micro'},before,after,()=>true),[],'construction cannot borrow movement ownership');
  assert.deepEqual(movementReceivingAttachments({...step,replayRelationIdentity:{stageIndex:2,relationIndex:0}},before,after,()=>true),[],'a stale drawing cannot authorize placement');
});

test('an existing head opens its preserved receiving material only at the proved head-movement moment', () => {
  const before = topology([['clause', ['receiver', 'domain']], ['receiver', ['tense', 'agreement']],
    ['tense', []], ['agreement', []], ['domain', ['source']], ['source', []]]);
  const current = topology([['clause', ['receiver', 'domain']], ['receiver', ['landing', 'tense', 'agreement']],
    ['landing', []], ['tense', []], ['agreement', []], ['domain', ['lower']], ['lower', []]]);
  const step = { replayKind: 'relation', replayRelationIdentity: { stageIndex: 1, relationIndex: 0 }, replayRelationLinks: [{
    authoredRelationKey: '1:0', movementTransition: true, trajectoryKind: 'head',
    priorSourceNodeId: 'source', witnessNodeId: 'lower', targetNodeId: 'landing' }] };
  assert.deepEqual([...movementReceivingHosts(step, before, current, () => true)], ['receiver', 'tense', 'agreement']);
  assert.deepEqual([...movementReceivingHosts({ ...step, replayKind: 'micro' }, before, current, () => true)], []);
  assert.deepEqual([...movementReceivingHosts(step, before, current, () => false)], []);
  const phrasal = structuredClone(step); phrasal.replayRelationLinks[0].trajectoryKind = 'phrasal';
  assert.deepEqual([...movementReceivingHosts(phrasal, before, current, () => true)], []);
  const reordered = topology([['clause', ['receiver', 'domain']], ['receiver', ['landing', 'agreement', 'tense']],
    ['landing', []], ['tense', []], ['agreement', []], ['domain', ['lower']], ['lower', []]]);
  assert.deepEqual([...movementReceivingHosts(step, before, reordered, () => true)], []);
});

for (const retainedChildren of [1, 2]) for (const [width, height] of [[1600,948], [390,844]]) for (const direction of ['ltr','rtl']) {
  test(`${width}px ${direction}: head movement with ${retainedChildren} retained items cannot expand the earlier clause during C selection`, () => {
    const r = JSON.parse(fs.readFileSync(new URL('../fixtures/movement/qualified-contexts.json', import.meta.url)))
      .find(r => r.name === 'preserved-progressive-contents');
    if (retainedChildren === 1) {
      const omitAgreement = node => {
        if (!node.children) return;
        node.children = node.children.filter(child => child.id !== 'mAgr');
        node.children.forEach(omitAgreement);
      };
      r.priorForest.forEach(omitAgreement);
      r.currentForest.forEach(omitAgreement);
    }
    const stages = [r.priorForest, r.currentForest].map((workspaceForest, i) => ({
      statement: '', stageRecord: '', workspaceForest, relations: i ? [r.relation] : [] }));
    const { scenes, steps } = setup({ sentence: '', derivationStages: stages }, width, height, direction);
    const prior = scenes.findLast(s => s.step.replayFrameIndex === 0 && s.step.replayKind === 'macro');
    const selectionIndex = steps.findIndex(s => s.replayFrameIndex === 1 && s.operation === 'LexicalSelect');
    assert(selectionIndex >= 0);
    for (const id of ['mI', 'mProgressive', ...(retainedChildren === 2 ? ['mAgr'] : [])]) {
      close(prior.nodes.get(id).x, scenes[selectionIndex].nodes.get(id).x, `${id} keeps its x before movement`);
      close(prior.nodes.get(id).y, scenes[selectionIndex].nodes.get(id).y, `${id} keeps its rank before movement`);
    }
    if (retainedChildren === 1) {
      const movement = scenes.find(s => s.step.replayRelationIdentity);
      assert(movement.nodes.has('mVHigh'), 'the moved head is introduced at its owning moment');
      for (const axis of ['x', 'y']) close(prior.nodes.get('mProgressive')[axis],
        movement.nodes.get('mProgressive')[axis], 'the sole retained child remains stationary through movement');
    }
  });
}

for (const direction of ['ltr','rtl']) test(`${direction}: a receiving slot cannot widen an earlier completed workspace`, () => {
  const control=JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/receiving-slot-width-control.json',import.meta.url)));
  const {scenes}=setup(control,1600,948,direction);
  const limits=direction==='ltr'?[5211.004132903316,5211.004132903316,5211.004132903316,5211.004132903316,5211.004132903316,6148.776695324776,6148.776695324776]
    :[5762.373922334782,5762.373922334782,5762.373922334782,5762.373922334782,5762.373922334781,6594.768638462082,6594.768638462082];
  scenes.filter(s=>s.step.replayKind==='macro').forEach((scene,i)=>{
    const xs=[...scene.nodes.values()].map(n=>n.x);
    assert(Math.max(...xs)-Math.min(...xs)<=limits[i]+1e-6,'slot alignment cannot transfer excess width to an earlier completed state');
  });
});

// The same Neg-to-I incorporation, authored with neutral role names and with worded
// movement roles. The receiving head keeps its identity while a new inner I⁰ takes
// over its auxiliary and tense beside the landing. Read as movement, the claim must
// reserve exactly the room its neutral reading reserves, in every frame.
const retainedHead = JSON.parse(fs.readFileSync(new URL('../fixtures/replay-regressions/retained-head-attachment.json', import.meta.url)));
const retainedHeadAsMovement = structuredClone(retainedHead);
Object.assign(retainedHeadAsMovement.derivationStages[2].relations[0],
  { anchors: { lowerCopy: 'tNegTrace', higherCopy: 'tNegHigh' }, priorAnchors: { source: 'tNeg' } });
for (const [width, height] of [[1600, 948], [390, 844]]) for (const direction of ['ltr', 'rtl']) {
  test(`${width}px ${direction}: a head landing whose receiver keeps its identity reserves the room of its neutral reading`, () => {
    const laid = input => {
      const steps = prepareReplay({ ...structuredClone(input), includePlayback: true }).playbackSteps;
      const groups = buildStageLayoutGroups(steps, input.derivationStages);
      const sizes = new Map(input.derivationStages.map((_, i) => [i, stageTreeLayoutSize(steps, i, width, height, groups)]));
      const points = new Map([...sizes].flatMap(([i, size]) => [...buildStageCoordinateReservations(steps, i, size, i => sizes.get(i), direction)]));
      return { steps, scenes: steps.map(step => {
        const root = d3.hierarchy(step.replayCanvasData); applyVizIds(root);
        const visible = new Set(step.replayVisibleNodeIds);
        return new Map(layoutSyntaxTree(root, sizes.get(step.replayFrameIndex), direction, points.get(step.replayCanvasData), visible)
          .descendants().filter(n => visible.has(getNodeId(n))).map(n => [getNodeId(n), n]));
      }) };
    };
    const playsAsMovement = steps => steps.some(step => (step.replayRelationLinks ?? [])
      .some(link => link.renderFamily === 'trajectory' && link.authoredRelationKey === '2:0'));
    const neutral = laid(retainedHead), movement = laid(retainedHeadAsMovement);
    assert(!playsAsMovement(neutral.steps) && playsAsMovement(movement.steps), 'only the worded claim is read as movement');
    assert.equal(movement.scenes.length, neutral.scenes.length);
    neutral.scenes.forEach((nodes, frame) => {
      for (const [id, node] of nodes) {
        const other = movement.scenes[frame].get(id);
        if (!other) continue;
        close(node.x, other.x, `frame ${frame + 1} ${id} x`);
        close(node.y, other.y, `frame ${frame + 1} ${id} y`);
      }
    });
  });
}
