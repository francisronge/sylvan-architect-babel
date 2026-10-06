import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { layoutSyntaxTree } from '../replay/treeLayout.ts';
import { reserveCompleteComponentLifetime, retainUnchangedComponentLifetime } from '../replay/workspaceComponentLifetime.ts';

for (const direction of ['ltr', 'rtl']) test(`${direction}: birth-only clearance preserves the completed tree's proportions`, () => {
  const subtree = (id, label) => ({id, label, children:[{id:`${id}-word`,label:label.toLowerCase(),word:label.toLowerCase()}]});
  const a = () => subtree('a','N'), b = () => subtree('b','V');
  const forest = () => ({id:'workspace',label:'',replayOrigin:{kind:'workspace'},children:[a(),b()]});
  const canvases = [a(),forest(),forest(),{id:'phrase',label:'VP',children:[a(),b()]}];
  const coordinates = new Map();
  const size = [2000,1000];
  const scenes=canvases.map((canvas,index)=>{
    const root=d3.hierarchy(canvas);applyVizIds(root);
    const visible=new Set(root.descendants().map(getNodeId).filter(id=>id!=='workspace'));
    const points=new Map([
      ['a',{x:index<2?0:500,y:100}],['a-word',{x:index<2?0:500,y:300}],
      ['b',{x:index<2?500:1000,y:100}],['b-word',{x:index<2?500:1000,y:300}],['phrase',{x:750,y:0}]
    ]);
    coordinates.set(canvas,points);
    const nodes=new Map(layoutSyntaxTree(root,size,direction,points,visible).descendants().filter(n=>visible.has(getNodeId(n))).map(n=>[getNodeId(n),n]));
    return {canvas,coordinates:points,size,nodes,step:{replayKind:'micro',operation:index===3?'ExternalMerge':'LexicalSelect',targetNodeId:index===3?'phrase':'b'}};
  });
  const render=(scene,points)=>{
    const root=d3.hierarchy(scene.canvas);applyVizIds(root);
    return layoutSyntaxTree(root,size,direction,points,new Set(scene.nodes.keys())).descendants().filter(n=>scene.nodes.has(getNodeId(n)));
  };
  const saved=structuredClone([...coordinates].map(([canvas,points])=>[canvas,[...points]]));
  const result=reserveCompleteComponentLifetime(scenes,coordinates,direction,2,'a',render, { throughRelations: true });
  const atBirth=new Map(render(scenes[1],result.get(canvases[1])).map(n=>[getNodeId(n),n]));
  assert(Math.abs(atBirth.get('a').x-atBirth.get('b').x)>150,'birth receives real clearance');
  const before=new Map(render(scenes[3],coordinates.get(canvases[3])).map(n=>[getNodeId(n),n]));
  const after=new Map(render(scenes[3],result.get(canvases[3])).map(n=>[getNodeId(n),n]));
  for(const [id,node] of before){
    assert(Math.abs((after.get(id).x-after.get('phrase').x)-(node.x-before.get('phrase').x))<1e-6,`${id} keeps its final horizontal offset`);
    assert.equal(after.get(id).y-after.get('phrase').y,node.y-before.get('phrase').y);
  }
  assert.deepEqual([...coordinates].map(([canvas,points])=>[canvas,[...points]]),saved);
});

function scenario(direction, materialChange) {
  const nominal = () => ({id:'noun',label:'N',children:[{id:'noun-word',label:'name',word:'name'}]});
  const verbal = (changed=false) => ({id:'verb',label:'V',children:[{id:'verb-word',label:changed?'went':'go',word:changed?'went':'go'}]});
  const independent = () => ({id:'other-phrase',label:'XP',children:[{id:'other-a',label:'X'},{id:'other-b',label:'Y'}]});
  const separate = (index) => ({id:'workspace',label:'',replayOrigin:{kind:'workspace'},children:[nominal(),verbal(materialChange&&index>=3),...(index>=3?[independent()]:[])]});
  const canvases=[nominal(),separate(1),separate(2),separate(3),separate(4),{
    id:'workspace',label:'',replayOrigin:{kind:'workspace'},children:[
      {id:'phrase',label:'VP',children:[nominal(),verbal(materialChange)]},independent()]
  }];
  const size=[2200,1000],coordinates=new Map();
  const scenes=canvases.map((canvas,index)=>{
    const root=d3.hierarchy(canvas);applyVizIds(root);
    const visible=new Set(root.descendants().map(getNodeId).filter(id=>id!=='workspace'&&!(index===1&&id==='verb')));
    const points=new Map([
      ['noun',{x:index<4?0:500,y:100}],['noun-word',{x:index<4?0:500,y:300}],
      ['verb',{x:index<4?500:1000,y:100}],['verb-word',{x:index<4?500:1000,y:300}],
      ['phrase',{x:750,y:0}],['other-phrase',{x:1900,y:0}],['other-a',{x:1800,y:100}],['other-b',{x:2000,y:100}]
    ]);
    coordinates.set(canvas,points);
    const nodes=new Map(layoutSyntaxTree(root,size,direction,points,visible).descendants().filter(n=>visible.has(getNodeId(n))).map(n=>[getNodeId(n),n]));
    return {canvas,coordinates:points,size,nodes,step:{
      replayKind:index===3&&materialChange?'relation':'micro',
      operation:['Project','LexicalSelect','Project',materialChange?'PFRealization':'ExternalMerge','LexicalSelect','ExternalMerge'][index],
      targetNodeId:['noun','verb-word','verb',materialChange?'verb-word':'other-phrase','future','phrase'][index]
    }};
  });
  const render=(scene,points)=>{
    const root=d3.hierarchy(scene.canvas);applyVizIds(root);
    return layoutSyntaxTree(root,size,direction,points,new Set(scene.nodes.keys())).descendants().filter(n=>scene.nodes.has(getNodeId(n)));
  };
  const original=structuredClone([...coordinates].map(([canvas,points])=>[canvas,[...points]]));
  const result=reserveCompleteComponentLifetime(scenes,coordinates,direction,4,'noun',render, { throughRelations: true });
  const frame=(index,plan=result)=>new Map(render(scenes[index],plan.get(canvases[index])).map(n=>[getNodeId(n),n]));
  return {frame,coordinates,original,scenes};
}

for (const direction of ['ltr','rtl']) {
  test(`${direction}: source clearance survives projection and an unrelated merge, then ends at its own merge`,()=>{
    const run=scenario(direction,false),birth=run.frame(1),project=run.frame(2),other=run.frame(3);
    assert(Math.abs(birth.get('noun-word').x-birth.get('verb-word').x)>150,'the selected word receives clearance');
    assert.equal(project.get('verb-word').x,birth.get('verb-word').x,'unary projection keeps the selected word fixed');
    assert.equal(other.get('verb-word').x,project.get('verb-word').x,'a merge in another workspace cannot release clearance');
    const before=run.frame(5,run.coordinates),after=run.frame(5);
    for(const id of ['phrase','noun','noun-word','verb','verb-word']) {
      assert(Math.abs((after.get(id).x-after.get('phrase').x)-(before.get(id).x-before.get('phrase').x))<1e-6,`${id} retains the completed relative geometry`);
      assert.equal(after.get(id).y,before.get(id).y);
    }
    assert.deepEqual([...run.coordinates].map(([canvas,points])=>[canvas,[...points]]),run.original);
  });
  test(`${direction}: a changed material lifetime does not inherit the preceding birth offset`,()=>{
    const run=scenario(direction,true),before=run.frame(2),changed=run.frame(3),native=run.frame(3,run.coordinates);
    assert.notEqual(before.get('verb-word').x,run.frame(2,run.coordinates).get('verb-word').x,'the prior source had a clearance offset');
    assert.equal(changed.get('verb-word').data.word,'went');
    assert.equal(changed.get('verb-word').x,native.get('verb-word').x,
      'the new material does not inherit the preceding word offset');
  });
}

for (const direction of ['ltr', 'rtl']) test(`${direction}: a selected word reserves its projected head's clearance before either moves`, () => {
  const existing = () => ({id:'a',label:'NP',children:[{id:'aw',label:'long noun',word:'long noun'}]});
  const selected = () => ({id:'b',label:'V',children:[{id:'bw',label:'go',word:'go'}]});
  const forest = () => ({id:'workspace',label:'',children:[existing(),selected()]});
  const canvases = [existing(),forest(),forest(),{id:'phrase',label:'VP',children:[existing(),selected()]}];
  const size=[2200,1200],base=new Map();
  const scenes=canvases.map((canvas,index)=>{
    const hierarchy=d3.hierarchy(canvas);applyVizIds(hierarchy);
    const visible=new Set(hierarchy.descendants().map(getNodeId).filter(id=>id!=='workspace'&&!(index===1&&id==='b')));
    const coordinates=new Map([['a',{x:index===0?500:0,y:100}],['aw',{x:index===0?500:0,y:500}],['b',{x:500,y:100}],['bw',{x:500,y:700}],['phrase',{x:250,y:0}]]);
    base.set(canvas,coordinates);
    const nodes=new Map(layoutSyntaxTree(hierarchy,size,direction,coordinates,visible).descendants().filter(n=>visible.has(getNodeId(n))).map(n=>[getNodeId(n),n]));
    return{canvas,coordinates,size,nodes,step:{replayKind:'micro',operation:['Project','LexicalSelect','Project','ExternalMerge'][index],targetNodeId:['a','bw','b','phrase'][index]}};
  });
  const render=(scene,coordinates)=>{const hierarchy=d3.hierarchy(scene.canvas);applyVizIds(hierarchy);return layoutSyntaxTree(hierarchy,size,direction,coordinates,new Set(scene.nodes.keys())).descendants().filter(n=>scene.nodes.has(getNodeId(n)));};
  const result=retainUnchangedComponentLifetime(scenes,base,direction,1,'a',render);
  const frame=(index,reservations=result)=>new Map(render(scenes[index],reservations.get(canvases[index])).map(n=>[getNodeId(n),n]));
  const birth=frame(1),project=frame(2);
  assert.equal(birth.get('bw').x,project.get('bw').x,'projection cannot move the already selected word');
  assert(Math.abs(project.get('a').x-project.get('b').x)>150,'the future head receives clearance before selection');
  assert.deepEqual([...frame(3)].map(([id,n])=>[id,n.x,n.y]),[...frame(3,base)].map(([id,n])=>[id,n.x,n.y]),'the real attachment keeps native geometry');
});

for (const direction of ['ltr', 'rtl']) test(`${direction}: a relation attachment ends clearance of a newly selected source`, () => {
  const subtree = (id, label) => ({id, label, children:[{id:`${id}-word`,label:label.toLowerCase(),word:label.toLowerCase()}]});
  const a = () => subtree('a','N'), b = () => subtree('b','V');
  const forest = () => ({id:'workspace',label:'',replayOrigin:{kind:'workspace'},children:[a(),b()]});
  const canvases = [a(),forest(),forest(),{id:'phrase',label:'VP',children:[a(),b()]}];
  const coordinates = new Map();
  const size = [2000,1000];
  const scenes=canvases.map((canvas,index)=>{
    const root=d3.hierarchy(canvas);applyVizIds(root);
    const visible=new Set(root.descendants().map(getNodeId).filter(id=>id!=='workspace'));
    const points=new Map([
      ['a',{x:index<2?0:500,y:100}],['a-word',{x:index<2?0:500,y:300}],
      ['b',{x:index<2?500:1000,y:100}],['b-word',{x:index<2?500:1000,y:300}],['phrase',{x:750,y:0}]
    ]);
    coordinates.set(canvas,points);
    const nodes=new Map(layoutSyntaxTree(root,size,direction,points,visible).descendants().filter(n=>visible.has(getNodeId(n))).map(n=>[getNodeId(n),n]));
    return {canvas,coordinates:points,size,nodes,step:{replayKind:index===3?'relation':'micro',operation:index===3?'Attach a current phrase':'LexicalSelect',targetNodeId:index===3?'phrase':'b'}};
  });
  const render=(scene,points)=>{
    const root=d3.hierarchy(scene.canvas);applyVizIds(root);
    return layoutSyntaxTree(root,size,direction,points,new Set(scene.nodes.keys())).descendants().filter(n=>scene.nodes.has(getNodeId(n)));
  };
  const saved=structuredClone([...coordinates].map(([canvas,points])=>[canvas,[...points]]));
  const result=reserveCompleteComponentLifetime(scenes,coordinates,direction,2,'a',render, { throughRelations: true });
  const atBirth=new Map(render(scenes[1],result.get(canvases[1])).map(n=>[getNodeId(n),n]));
  assert(Math.abs(atBirth.get('a').x-atBirth.get('b').x)>150,'birth receives real clearance');
  const before=new Map(render(scenes[3],coordinates.get(canvases[3])).map(n=>[getNodeId(n),n]));
  const after=new Map(render(scenes[3],result.get(canvases[3])).map(n=>[getNodeId(n),n]));
  for(const [id,node] of before){
    assert(Math.abs((after.get(id).x-after.get('phrase').x)-(node.x-before.get('phrase').x))<1e-6,`${id} keeps its final horizontal offset`);
    assert.equal(after.get(id).y-after.get('phrase').y,node.y-before.get('phrase').y);
  }
  assert.deepEqual([...coordinates].map(([canvas,points])=>[canvas,[...points]]),saved);
});
