import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchRelationClaims } from '../replay/relations/tier2RelationDispatch.ts';
import { compileRelationRenderPlan } from '../replay/relations/renderPlanCompiler.ts';

const leaf=(id,label,word=id)=>({id,label,word});
const forest=[{id:'clause',label:'TP',children:[
 {id:'nominal',label:'D',children:[leaf('det','D'),{id:'nominalCore',label:'N',children:[leaf('adj','A'),leaf('noun','N')]}]},
 leaf('subject','DP'),leaf('object','DP'),leaf('trace','DP'),leaf('inflection','I⁰'),leaf('verb','V'),leaf('otherVerb','V'),leaf('neg','Neg'),leaf('adv','Adv'),
 {id:'complement',label:'CP',children:[leaf('c','C'),leaf('embedded','TP')]}
]}];
const dispatch=(relation,currentForest=forest)=>dispatchRelationClaims({relation,currentForest,stageIndex:0,relationIndex:0});
const plan=(relation,currentForest=forest)=>compileRelationRenderPlan([{statement:'',stageRecord:'',workspaceForest:currentForest,relations:[relation]}]).frames[0].items;
const recipes=(relation,currentForest=forest)=>dispatch(relation,currentForest).claims.filter(c=>c.tier===2).map(c=>c.facet.recipe.id);
const paths=relation=>plan(relation).filter(item=>item.kind==='directed-path');
const theta=relation=>plan(relation).find(item=>item.plaqueStyle==='theta-grid');

test('explicit plural agreement bearers each retain their controller and typed bundle', () => {
 const base = { relation: 'subject-controlled participial agreement',
  anchors: { agreementBearers: ['verb', 'otherVerb'], controller: 'subject' },
  values: { agreementBearers: ['been', 'read'], number: 'plural' } };
 const original = structuredClone(base), result = dispatch(base);
 assert.deepEqual(paths(base).map(path => [path.fromNodeId, path.toNodeId]), [['verb', 'subject'], ['otherVerb', 'subject']]);
 assert.deepEqual(base, original);
 assert.deepEqual(result.evidenceCoverage.fields.find(field => field.field === 'values' && field.key === 'agreementBearers').unrecoveredItemIndices, [0, 1]);
 const claims = result.claims.filter(claim => claim.tier === 2 && claim.facet.recipe.id === 'feature.dependency');
 assert.equal(claims.length, 2);
 assert.deepEqual(claims.map(claim => claim.consumedEvidence.find(ref => ref.field === 'anchors' && ref.key === 'agreementBearers').itemIndices), [[0], [1]]);
 for (const relation of [
  { ...base, relation: 'possible participial agreement' }, { ...base, relation: 'a participial observation' },
  { ...base, anchors: { ...base.anchors, probe: 'inflection' } },
  { ...base, anchors: { ...base.anchors, agreementBearers: ['verb', 'verb'] } },
  { ...base, anchors: { ...base.anchors, agreementBearers: ['verb', 'missing'] } },
  { ...base, anchors: { ...base.anchors, controller: ['subject', 'object'] } },
  { ...base, values: { agreementBearers: ['been', 'read'] } },
  { ...base, relation: 'Agree' }
 ]) assert.equal(paths(relation).length, 0, JSON.stringify(relation));
});

test('explicit theta scopes retain generic governors, selected complements and exact thematic occurrences',()=>{
 for(const relation of [
  {relation:'internal theta assignment',anchors:{governor:'verb',argument:'object'},values:{thetaRole:'Theme'}},
  {relation:'selected complement theta assignment',anchors:{selector:'verb',complement:'complement'},values:{thetaRole:'propositional Content'}},
  {relation:'argument dependency',anchors:{predicate:'verb',thematicOccurrence:'trace'},values:{argumentRole:'theme of this predicate'}}
 ]){
  const before=structuredClone(relation);assert(theta(relation),JSON.stringify(relation));assert.deepEqual(relation,before);
 }
 const mixed={relation:'argument-chain licensing',anchors:{lexicalLicensor:'verb',thetaAndCasePosition:'trace',chainHead:'object'},values:{thetaRole:'Theme',case:'accusative'}};
 assert.deepEqual(theta(mixed).thetaRoles.map(r=>r.nodeId),['trace']);
 assert(paths(mixed).some(p=>p.fromNodeId==='verb'&&p.toNodeId==='trace'&&p.pathStyle==='case-assignment'));
});

test('theta meaning is not inferred from bare selection, prose, uncertain assertions or competing owners',()=>{
 const base={relation:'internal theta assignment',anchors:{governor:'verb',argument:'object'},values:{thetaRole:'Theme'}};
 for(const r of [
  {...base,relation:'complement selection'}, {...base,relation:'possible internal theta assignment'},
  {...base,relation:'no internal theta assignment'}, {...base,anchors:{...base.anchors,selector:'otherVerb'}},
  {...base,values:{description:'Theme'}}, {...base,anchors:{governor:'verb',argument:'missing'}},
  {...base,values:{thetaRole:['Theme','Agent']}}
 ])assert(!theta(r),JSON.stringify(r));
});

test('qualified Case fields keep independently paired literal rows and exact endpoints',()=>{
 const r={relation:'government and internal-argument Case licensing',anchors:{governor:'verb',accusativeArgument:'object',dativeArgument:'subject'},values:{accusativeArgument:'accusative',dativeArgument:'lexically selected dative'}};
 const original=structuredClone(r),p=paths(r);assert.equal(p.length,2);assert.deepEqual(p.map(x=>x.toNodeId).sort(),['object','subject']);assert.deepEqual(r,original);
 const open={relation:'matrix Case licensing',anchors:{objectLicensor:'verb',objectNP:'object'},values:{objectNP:'abstract object Case without an overt suffix'}};
 assert(paths(open).some(x=>x.toNodeId==='object'));
 const finite={relation:'nominative Case licensing',anchors:{finiteLicenser:'inflection',subject:'subject'},values:{case:'nominative'}};
 assert(paths(finite).some(x=>x.fromNodeId==='inflection'&&x.toNodeId==='subject'));
});

test('same-key Case scopes reject missing or ambiguous pairings and denied claims',()=>{
 const base={relation:'Case licensing',anchors:{governor:'verb',dativeArgument:'object'},values:{dativeArgument:'dative'}};
 for(const r of [
  {...base,anchors:{...base.anchors,licensor:'otherVerb'}}, {...base,values:{otherArgument:'dative'}},
  {...base,values:{dativeArgument:['dative','accusative']}}, {...base,relation:'possible Case licensing'},
  {...base,relation:'no Case licensing'}, {...base,anchors:{governor:'verb',dativeArgument:'missing'}},
  {...base,relation:'an observation about nouns'}
 ])assert.equal(paths(r).length,0,JSON.stringify(r));
});

test('nominal controller and plural targets retain direction with exact item ownership',()=>{
 const r={relation:'Nominal concord',anchors:{controller:'noun',targets:['det','adj']},values:{features:'feminine singular'}};
 assert.deepEqual(recipes(r),['feature.dependency']);
 const claim=dispatch(r).claims.find(c=>c.tier===2);
 const targets=claim.consumedEvidence.find(x=>x.field==='anchors'&&x.key==='targets');
 assert(targets);assert.deepEqual(targets.itemIndices??[0,1],[0,1]);
 assert.equal(plan(r).filter(x=>x.linkStyle==='feature-sharing').length,0);
 assert.deepEqual(paths(r).map(x=>[x.fromNodeId,x.toNodeId]),[['noun','det'],['noun','adj']]);
 for(const bad of [
  {...r,relation:'Control'}, {...r,relation:'possible Nominal concord'}, {...r,relation:'failed Nominal concord'},
  {...r,anchors:{controller:'verb',targets:['det','adj']}}, {...r,anchors:{controller:'noun',targets:['det','det']}},
  {...r,anchors:{controller:'noun',targets:['det','subject']}}, {...r,values:{features:''}},
  {...r,values:{features:'feminine singular',outcome:'pending'}}
 ])assert(!recipes(bad).includes('feature.dependency'),JSON.stringify(bad));
});

test('category-proven inflection and literal feature domains recover without head movement',()=>{
 for(const r of [
  {relation:'finite subject licensing',anchors:{finiteInflection:'inflection',subject:'subject'},values:{agreement:'third-person singular',case:'nominative'}},
  {relation:'null-subject licensing',anchors:{agreement:'inflection',subject:'subject',inflectedPredicate:'verb'},values:{agreement:'third-person singular'}},
  {relation:'tense agreement',anchors:{tenseHead:'inflection',inflectedVerb:'verb'},values:{tense:'past'}},
  {relation:'jussive licensing',anchors:{licenser:'neg',target:'verb',finiteHead:'inflection'},values:{mood:'jussive',form:'x'}}
 ]){assert(recipes(r).includes('feature.dependency'),JSON.stringify(r));assert(!recipes(r).includes('movement.path'));}
 const badCategory=structuredClone(forest);badCategory[0].children.find(x=>x.id==='inflection').label='N';
 assert(!recipes({relation:'finite subject licensing',anchors:{finiteInflection:'inflection',subject:'subject'},values:{agreement:'third-person singular'}},badCategory).includes('feature.dependency'));
 for(const name of ['possible tense agreement','no tense agreement','failed tense agreement']){
  const r={relation:name,anchors:{tenseHead:'inflection',inflectedVerb:'verb'},values:{tense:'past'}};
  assert(!paths(r).some(p=>!p.outcome),name);
 }
});

test('polarity dependent is recovered only inside an asserted polarity licensing claim',()=>{
 const base={relation:'temporal polarity licensing',anchors:{licenser:'neg',dependent:'adv'},values:{reading:'yet'}};
 assert(recipes(base).includes('polarity.licensing'));
 for(const r of [
  {...base,relation:'temporal licensing'}, {...base,relation:'possible temporal polarity licensing'},
  {...base,relation:'no temporal polarity licensing'}, {...base,anchors:{licenser:'neg',dependent:'missing'}},
  {...base,values:{reading:'yet',outcome:'failed'}}
 ])assert(!recipes(r).includes('polarity.licensing'),JSON.stringify(r));
});

test('explicit nominal comparison failure keeps its negative outcome and excludes contextual NP',()=>{
 const r={relation:'Nominal number-concord violation',anchors:{demonstrative:'det',nominal:'nominal',noun:'noun'},values:{demonstrativeNumber:'plural',nounNumber:'singular',status:'incompatible in standard English'}};
 const p=paths(r);assert.equal(p.length,2);assert(p.every(x=>x.outcome==='blocked'&&x.fromNodeId==='det'&&x.toNodeId==='noun'));
 assert.deepEqual(p.map(x=>x.featureRow),[{label:'demonstrativeNumber',value:'plural'},{label:'nounNumber',value:'singular'}]);
 for(const bad of [
  {...r,relation:'Nominal concord'}, {...r,values:{...r.values,status:'compatible'}},
  {...r,values:{...r.values,status:'not incompatible'}}, {...r,values:{...r.values,status:'incompatible but possible'}},
  {...r,values:{...r.values,nominalNumber:'plural'}}, {...r,values:{demonstrativeNumber:'plural',status:'failed'}}
 ])assert(!recipes(bad).includes('feature.dependency'),JSON.stringify(bad));
});

test('qualified recovery requires a complete asserted clause and preserves independent siblings',()=>{
 const caseRecord={relation:'matrix Case licensing',anchors:{governor:'verb',dativeArgument:'object'},values:{dativeArgument:'dative'}};
 for(const name of ['no internal-argument Case licensing','possible matrix Case licensing','not matrix Case licensing',
  'no lexical Case licensing','failed matrix Case licensing','an inquiry about matrix Case licensing'])
  assert.equal(paths({...caseRecord,relation:name}).length,0,name);
 const thematic={relation:'argument dependency',anchors:{predicate:'verb',thematicOccurrence:'trace'},values:{thetaRole:'Theme'}};
 for(const prefix of ['Possible','No','rejected','denied','absence of','whether there is'])
  assert(!theta({...thematic,relation:`${prefix} argument dependency`}),prefix);
 for(const relation of ['theme role assignment; failed agreement','theme role assignment; no Case licensing'])
  assert(theta({relation,anchors:{predicate:'verb',argument:'object'},values:{role:'Theme'}}),relation);
 const mood={relation:'jussive licensing',anchors:{licenser:'neg',target:'verb',finiteHead:'inflection'},values:{mood:'jussive'}};
 const polarity={relation:'temporal polarity licensing',anchors:{licenser:'neg',dependent:'adv'},values:{reading:'yet'}};
 for(const prefix of ['unlicensed','rejected','denied','absence of','whether there is','an inquiry about']){
  assert(!recipes({...mood,relation:`${prefix} ${mood.relation}`}).includes('feature.dependency'),prefix);
  assert(!recipes({...polarity,relation:`${prefix} ${polarity.relation}`}).includes('polarity.licensing'),prefix);
 }
});

test('inflectional head evidence does not flatten projection levels or infer compound heads',()=>{
 const record={relation:'tense agreement',anchors:{tenseHead:'inflection',inflectedVerb:'verb'},values:{tense:'past'}};
 for(const label of ['T′','Agr′','TP','T+V']){
  const changed=structuredClone(forest);changed[0].children.find(n=>n.id==='inflection').label=label;
  assert(!recipes(record,changed).includes('feature.dependency'),label);
 }
 for(const label of ['T','T°','T⁰','T0','I^0','Agr']){
  const changed=structuredClone(forest);changed[0].children.find(n=>n.id==='inflection').label=label;
  assert(recipes(record,changed).includes('feature.dependency'),label);
 }
 const subjectAgreement={relation:'subject-verb agreement',anchors:{finiteHead:'inflection',inflectedVerb:'verb',subject:'subject'},values:{number:'singular',person:'third'}};
 assert.deepEqual(paths(subjectAgreement).map(p=>p.toNodeId),['subject','subject']);
});
