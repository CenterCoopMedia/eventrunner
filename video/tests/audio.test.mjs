import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLIC,ROOT,readProject} from '../project.mjs';
import {captureAt} from '../frame-state.ts';
import {audioEvents,readingGain,masterGain} from '../audio-plan.mjs';
import {synth} from '../synth.mjs';

function validateSynchronization(clock,events){
 for(const scene of clock.scenes){
  if(scene.action)assert.equal(events.filter(e=>e.kind==='click'&&e.scene===scene.id)[0]?.frame,scene.action.press);
  if(scene.typing){
   const changes=[];
   for(let frame=scene.typing.start;frame<scene.end;frame++)if(captureAt(scene,frame)!==captureAt(scene,frame-1)&&captureAt(scene,frame)!=='typing-00')changes.push(frame);
   assert.deepEqual(events.filter(e=>e.kind==='key'&&e.scene===scene.id).map(e=>e.frame),changes);
  }
 }
 assert.deepEqual(events.filter(e=>e.kind==='period').map(e=>e.frame),clock.periods);
 assert.equal(events.find(e=>e.kind==='resolve')?.frame,clock.scenes.find(s=>s.endCard)?.start);
}
for(const piece of PUBLIC)for(const format of ['landscape','vertical'])test(`${piece}/${format}: each effect lands on its visible event`,async()=>{
 const{clock}=await readProject(ROOT,piece,format);const events=audioEvents(clock);validateSynchronization(clock,events);
 const broken=structuredClone(events),effect=broken.find(e=>e.kind==='click'||e.kind==='period');effect.frame+=6;
 assert.throws(()=>validateSynchronization(clock,broken),'A six-frame late effect must fail');
});
test('reading automation and title breath have continuous sample-level envelopes',async()=>{
 const{clock:tutorial}=await readProject(ROOT,'publish-page','landscape');
 const{clock:trailer}=await readProject(ROOT,'general-trailer','landscape');
 for(const clock of [tutorial,trailer]){
  let previous=readingGain(clock,0),master=masterGain(clock,0);
  for(let sample=1;sample<clock.duration/30*48000;sample+=8){const frame=sample/1600,next=readingGain(clock,frame),envelope=masterGain(clock,frame);assert.ok(Math.abs(next-previous)<.002);assert.ok(Math.abs(envelope-master)<.03);previous=next;master=envelope;}
  assert.equal(masterGain(clock,clock.duration-1/1600),0);
 }
 for(let f=trailer.silence[0];f<trailer.silence[1];f+=.25)assert.equal(masterGain(trailer,f),0);
});
test('synthesis is deterministic and its test mix has silent edges and no clipping',()=>{
 const clock={duration:90,fps:30,bpm:120,seed:19,kind:'trailer',periods:[15],silence:[52,60],scenes:[{id:'hook',start:0,end:60},{id:'end',start:60,end:90,endCard:true}]};
 const a=synth(clock),b=synth(clock);assert.deepEqual(a.left,b.left);assert.deepEqual(a.right,b.right);
 for(const ch of [a.left,a.right]){assert.equal(ch[0],0);assert.equal(ch.at(-1),0);assert.ok(ch.every(v=>Number.isFinite(v)&&Math.abs(v)<1));assert.ok(ch.subarray(52*1600,60*1600).every(v=>v===0));}
});
