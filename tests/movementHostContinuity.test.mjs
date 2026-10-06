import assert from 'node:assert/strict';
import test from 'node:test';
import * as d3 from 'd3';
import { applyVizIds, getNodeId } from '../replay/displayIdentity.ts';
import { rigidMovementHosts } from '../replay/movementHostContinuity.ts';

const host = () => ({id:'host',label:'V',children:[{id:'word',label:'file',word:'file'}]});
const source = () => ({id:'source',label:'DP'});
function scenario({ stale=false, nonmovement=false, structural=false, stretch=false, existing=false, ambiguous=false, hidden=false }={}) {
  const beforeTree={id:'workspace',children:[host(),source(),...(ambiguous?[{id:'peer',label:'N'}]:[])]};
  if(existing) beforeTree.children[0]={id:'wrapper',label:'VP',children:[host()]};
  const afterTree={id:'workspace',children:[{id:'wrapper',label:'VP',children:[host(),{id:'landing',label:'DP'},...(ambiguous?[{id:'peer',label:'changed'}]:[])]},source()]};
  if(hidden)afterTree.children[0].children[0]={id:'hidden',children:[host()]};
  const nodes=(tree,moved)=>{
    const root=d3.hierarchy(tree);applyVizIds(root);
    return new Map(root.descendants().filter(n=>!['workspace','hidden'].includes(getNodeId(n))).map(n=>{
      const id=getNodeId(n),x=id==='host'||id==='word'?(moved?400:100):0;
      n.x=x+(moved&&stretch&&id==='word'?30:0);n.y=(id==='word'?200:100)+(moved?150:0);
      return[id,n];
    }));
  };
  const before=nodes(beforeTree,false),after=nodes(afterTree,true);
  const step={replayKind:structural?'micro':'relation',operation:structural?'ExternalMerge':'Internal Merge',replayRelationIdentity:{stageIndex:1,relationIndex:0},replayRelationLinks:[{
    authoredRelationKey:stale?'0:0':'1:0',renderFamily:nonmovement?'authored-anchor-link':'trajectory',priorSourceNodeId:'source',witnessNodeId:'source',targetNodeId:'landing'
  }]};
  return rigidMovementHosts(step,before,after,before,after);
}
test('the complete unchanged host can translate when its owning movement inserts its parent',()=>{
  assert.deepEqual([...scenario()].sort(),['host','word']);
});
for(const [name,options] of [
  ['one descendant deforms',{stretch:true}],['the trajectory is stale',{stale:true}],
  ['the current relation is not movement',{nonmovement:true}],['a structural step retains earlier links',{structural:true}],
  ['the parent already existed',{existing:true}],['two prior hosts compete, even if one changes material',{ambiguous:true}],
  ['an invisible parent disconnects the host',{hidden:true}]
]) test(`host translation is not permitted when ${name}`,()=>assert.equal(scenario(options).size,0));
