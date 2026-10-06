import test from 'node:test';
import assert from 'node:assert/strict';
import {createTreeLabelMeasure} from '../components/treeLabelMeasure.ts';

function documentFixture(measure, measureCanvas) {
 const roots=[], removed=[];
 const context = { measureText(text) { return measureCanvas(text, this); } };
 class Element {
  constructor(tag){this.tag=tag;this.style={};this.attributes={};this.children=[];this.textContent='';}
  setAttribute(key,value){this.attributes[key]=value;}
  appendChild(child){this.children.push(child);return child;}
  getBBox(){return measure(this);}
  remove(){removed.push(this);}
 }
 return {roots,removed,doc:{createElement:()=>({getContext:()=>measureCanvas ? context : null}),createElementNS:(_,tag)=>new Element(tag),body:{appendChild:root=>roots.push(root)}}};
}
test('native styled measurement preserves complete text, ordered mixed indices and exact inherited style',()=>{
 const fixture=documentFixture(label=>{
  assert.equal(label.style.font,'italic 900 56px Quicksand, sans-serif');
  assert.equal(label.attributes['text-anchor'],'middle');assert.equal(label.attributes.y,'115');
  assert.equal(label.textContent,'Book₁₀');
  assert.deepEqual(label.children.map(s=>s.textContent),['猫٢','j']);
  assert.deepEqual(label.children[0].attributes,{dx:'5','font-size':'30px','font-family':'Crimson Pro, Georgia, serif','font-style':'italic','baseline-shift':'sub'});
  assert.deepEqual(label.children[1].attributes,{dx:'5','font-size':'30px','font-family':'Crimson Pro, Georgia, serif','font-style':'italic',dy:'14'});
  return {x:-102,y:58,width:208,height:80};
 });
 const measure=createTreeLabelMeasure(fixture.doc),run={kind:'terminal',text:'Book₁₀',indices:[{text:'猫٢',mode:'identity'},{text:'j',mode:'theta'}]};
 assert.deepEqual(measure(run),{x:-118,y:42,width:240,height:112});
 assert.deepEqual(measure({...run}),{x:-118,y:42,width:240,height:112});
 assert.equal(fixture.roots.length,1);assert.equal(fixture.removed.length,1);
});
test('wrapped category measurement uses the painted line baselines and category stroke',()=>{
 const fixture=documentFixture(label=>{
  assert.equal(label.style.font,'900 42px Quicksand, sans-serif');assert.equal(label.attributes['xml:space'],'preserve');
  assert.deepEqual(label.children.map(s=>[s.textContent,s.attributes]),[
   ['DP ',{x:'0',y:'-58'}],['[trace]',{x:'0',y:'-10'}],['χ',{dx:'5','font-size':'22px','font-family':'Crimson Pro, Georgia, serif','font-style':'italic','baseline-shift':'sub'}]
  ]);return {x:-100,y:-99,width:215,height:100};
 });
 assert.deepEqual(createTreeLabelMeasure(fixture.doc)({kind:'category',text:'DP [trace]',lines:['DP ','[trace]'],indices:[{text:'χ',mode:'identity'}]}),{x:-120,y:-119,width:255,height:140});
 assert.equal(fixture.removed.length,1);
});
test('failed or invalid native bounds are cached as unavailable and hidden measurement nodes are removed',()=>{
 for(const fn of [()=>{throw Error('detached')},()=>({x:0,y:0,width:0,height:3}),()=>({x:0,y:0,width:5,height:NaN})]){
  const fixture=documentFixture(fn),measure=createTreeLabelMeasure(fixture.doc),run={kind:'terminal',text:'Book',indices:[]};
  assert.equal(measure(run),undefined);assert.equal(measure(run),undefined);assert.equal(fixture.roots.length,1);assert.equal(fixture.removed.length,1);
 }
 assert.equal(createTreeLabelMeasure(undefined)({kind:'terminal',text:'Book',indices:[]}),undefined);
});

// A 30-degree join survives SVG's default miter limit of 4: its tip is
// 3.864 half-widths from the vertex. Half-width-only bounds omit that tip.
test('the native label envelope contains permitted acute stroke joins',()=>{
 for(const [kind,halfWidth]of [['category',5],['terminal',4]]){
  const fixture=documentFixture(()=>({x:0,y:0,width:40,height:40}));
  const bounds=createTreeLabelMeasure(fixture.doc)({kind,text:'acute',indices:[]});
  const tip={x:20,y:-halfWidth/Math.sin(Math.PI/12)};
  assert.ok(tip.y < -halfWidth,'the former half-width envelope misses this allowed join');
  assert.ok(tip.y >= bounds.y && tip.y <= bounds.y+bounds.height);
  assert.ok(tip.x >= bounds.x && tip.x <= bounds.x+bounds.width);
  assert.equal(-bounds.y,halfWidth*4,'reserve derives from the actual miter limit');
 }
});


const glyph = (ascent, descent) => ({width:100,actualBoundingBoxLeft:0,actualBoundingBoxRight:100,
 actualBoundingBoxAscent:ascent,actualBoundingBoxDescent:descent,fontBoundingBoxAscent:56,fontBoundingBoxDescent:14});

test('plain terminal uses its exact glyph height plus the full miter reach',()=>{
 const requests=[];
 const fixture=documentFixture(()=>({x:-67,y:59,width:138,height:70}),(text,context)=>{
  requests.push(text);assert.equal(context.font,'italic 900 56px Quicksand, sans-serif');
  assert.equal(context.textAlign,'left');assert.equal(context.textBaseline,'alphabetic');return glyph(41,0);
 });
 const measure=createTreeLabelMeasure(fixture.doc),run={kind:'terminal',text:'think',indices:[]};
 assert.deepEqual(measure(run),{x:-83,y:58,width:170,height:73});
 assert.deepEqual(measure(run),{x:-83,y:58,width:170,height:73});
 assert.deepEqual(requests,['think']);assert.equal(fixture.removed.length,1);
});
test('plain wrapped category uses each painted line baseline and keeps its full horizontal envelope',()=>{
 const requests=[];
 const fixture=documentFixture(()=>({x:-100,y:-100,width:215,height:101}),(text,context)=>{
  requests.push(text);assert.equal(context.font,'900 42px Quicksand, sans-serif');
  return text==='Á' ? glyph(52,0) : glyph(31,14);
 });
 const run={kind:'category',text:'Ágj',lines:['Á','gj'],indices:[]};
 assert.deepEqual(createTreeLabelMeasure(fixture.doc)(run),{x:-120,y:-130,width:255,height:154});
 assert.deepEqual(requests,['Á','gj']);
});
test('generated inline indices and Unicode are measured as the complete actual single-font text',()=>{
 const requests=[];
 const fixture=documentFixture(()=>({x:-110,y:59,width:220,height:75}),text=>{requests.push(text);return glyph(44,19);});
 assert.deepEqual(createTreeLabelMeasure(fixture.doc)({kind:'terminal',text:'Book₁₀猫𝒾',indices:[]}),
  {x:-126,y:55,width:252,height:95});
 assert.deepEqual(requests,['Book₁₀猫𝒾']);
});
test('styled index runs retain the SVG envelope even when plain glyph metrics are available',()=>{
 for(const mode of ['identity','theta']){
  const fixture=documentFixture(()=>({x:-100,y:50,width:205,height:90}),()=>{throw Error('styled runs must not use plain bounds');});
  assert.deepEqual(createTreeLabelMeasure(fixture.doc)({kind:'terminal',text:'Book₁₀',indices:[{text:'χ作者',mode}]}),
   {x:-116,y:34,width:237,height:122});
 }
});
test('unavailable, incomplete or empty glyph bounds keep the complete previous envelope',()=>{
 for(const result of [undefined,{},glyph(NaN,0),glyph(0,0),{...glyph(30,0),actualBoundingBoxDescent:undefined}]){
  const fixture=documentFixture(()=>({x:-30,y:-52,width:60,height:53}),()=>result);
  assert.deepEqual(createTreeLabelMeasure(fixture.doc)({kind:'category',text:'DetP',lines:['DetP'],indices:[]}),
   {x:-50,y:-72,width:100,height:93});
 }
 const fixture=documentFixture(()=>({x:-100,y:-100,width:200,height:101}),text=>text==='ok'?glyph(30,0):glyph(NaN,0));
 assert.deepEqual(createTreeLabelMeasure(fixture.doc)({kind:'category',text:'okbad',lines:['ok','bad'],indices:[]}),
  {x:-120,y:-120,width:240,height:141});
});
test('plain glyph refinement still contains an acute join allowed by the actual miter limit',()=>{
 const fixture=documentFixture(()=>({x:-50,y:-52,width:100,height:53}),()=>glyph(30,0));
 const bounds=createTreeLabelMeasure(fixture.doc)({kind:'category',text:'acute',indices:[]});
 const glyphTop=-10-30,tip=glyphTop-5/Math.sin(Math.PI/12);
 assert.ok(tip<glyphTop-5,'a half-stroke envelope would miss this join');
 assert.ok(tip>=bounds.y);assert.equal(bounds.y,glyphTop-20);
 assert.equal(bounds.x,-70);assert.equal(bounds.width,140);
});
