import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPoint,studyLayout} from '../trailer/geometry.ts';
import {validateRects} from '../layout.ts';
import {timeline} from '../trailer/study-timeline.ts';
import {audioEvents} from '../audio-plan.mjs';
import {captureAt} from '../frame-state.ts';
import {samples} from '../motion.ts';
import {visualKey} from '../visual-key.mjs';

test('style preview is published through its own action before the public reveal',()=>{
 const choice=timeline.scenes.find(s=>s.id==='shape-choice');
 const publish=timeline.scenes.find(s=>s.capture==='theme-publish-hover');
 assert.ok(publish,'A style selection must include the separate Publish the theme action');
 assert.equal(publish.after,'theme-published');
 assert.ok(publish.action.press>choice.action.press);
 assert.ok(publish.end<=timeline.scenes.find(s=>s.id==='gather-publish').start);
});

test('replacement direction has separate safe compositions in both formats',()=>{
 for(const format of ['landscape','vertical'])validateRects(studyLayout(format),format);
 const broken=structuredClone(studyLayout('vertical'));broken.title.y=1600;
 assert.throws(()=>validateRects(broken,'vertical'),/Unsafe/);
 assert.notEqual(studyLayout('vertical').preview.width/1080,studyLayout('landscape').preview.width/1920);
});
test('study picture and score use the same action and ending clock',()=>{
 const check=clock=>{
  assert.equal(clock.scenes[0].start,0);
  assert.equal(clock.scenes.at(-1).end,clock.duration);
  assert.equal(clock.cinematic.title,clock.scenes.find(s=>s.endCard).start);
  assert.equal(clock.silence[1],clock.cinematic.title);
  assert.ok(clock.cinematic.settle<=clock.duration-60);
  assert.equal(clock.settle,clock.cinematic.settle);
  assert.ok(clock.cinematic.pageLand+6<clock.cinematic.fold);
  assert.ok(clock.cinematic.fold+8<clock.silence[0]);
  const effects=audioEvents(clock);
  for(let i=0;i<clock.scenes.length;i++){
   const scene=clock.scenes[i];if(i)assert.equal(scene.start,clock.scenes[i-1].end);
   if(scene.action){assert.ok(scene.action.moveEnd<=scene.action.press-3);assert.ok(scene.action.press+10<scene.end);assert.equal(effects.find(e=>e.kind==='click'&&e.scene===scene.id).frame,scene.action.press);}
   if(scene.typing){
    const visible=[];for(let f=scene.start;f<scene.end;f++)if(captureAt(scene,f)!==captureAt(scene,f-1)&&captureAt(scene,f)!=='typing-00')visible.push(f);
    assert.deepEqual(effects.filter(e=>e.kind==='key'&&e.scene===scene.id).map(e=>e.frame),visible);
   }
  }
 };
 check(timeline);
 const broken=structuredClone(timeline);broken.cinematic.title+=1;assert.throws(()=>check(broken));
 const late=structuredClone(timeline);late.cinematic.fold=late.silence[0]-4;assert.throws(()=>check(late));
 assert.notEqual(visualKey(timeline,50),visualKey(timeline,51));
 assert.equal(visualKey(timeline,timeline.settle),visualKey(timeline,timeline.duration-1));
 for(let f=0;f<timeline.duration;f++)assert.ok(Number.isInteger(samples(timeline,f))&&samples(timeline,f)<=16);
});
test('perspective projection keeps flat UI proportions and turns around its own center',()=>{
 const pose={x:960,y:540,width:1320,height:300};
 const a=projectPoint(0,0,pose),b=projectPoint(1,1,pose);
 assert.equal((b.x-a.x)/(b.y-a.y),pose.width/pose.height);
 assert.deepEqual(projectPoint(.5,.5,{...pose,rx:20,ry:-14,rz:-6}),{x:960,y:540});
 for(const angle of [-30,-10,0,10,30])for(const u of [0,.5,1])for(const v of [0,.5,1]){
  const p=projectPoint(u,v,{...pose,rx:angle,ry:angle});assert.ok(Number.isFinite(p.x)&&Number.isFinite(p.y));
 }
});
