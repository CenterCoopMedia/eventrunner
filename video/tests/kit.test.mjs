import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {ROOT,REPO,PUBLIC,readProject,captureNames,options} from '../project.mjs';import {plan,readingFrames} from '../planner.mjs';import {tutorialRects,trailerRects,endRects,cropFor,fitCrop,validateRects} from '../layout.ts';import {samples,endPose}from'../motion.ts';import {visualKey}from'../visual-key.mjs';
import {expectedScoreSources} from '../score-provenance.mjs';
import {requireFreshRender}from'../provenance.mjs';
const digest=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
for(const piece of PUBLIC)for(const format of ['landscape','vertical']){
 test(`${piece}/${format}: timeline, targets, safe layout and end pose`,async()=>{
  const p=await readProject(ROOT,piece,format),c=p.clock;assert.equal(c.fps,30);assert.ok(c.settle<=c.duration-60);assert.equal(c.scenes[0].start,0);assert.equal(c.scenes.at(-1).end,c.duration);
  for(let i=0;i<c.scenes.length;i++){const s=c.scenes[i];assert.ok(s.end>s.start);if(i)assert.equal(s.start,c.scenes[i-1].end);if(s.action){assert.ok(s.action.moveStart>=s.start);assert.ok(s.action.moveEnd<=s.action.press-3);assert.ok(s.action.press<s.end);const shot=p.captures[s.capture],box=shot.boxes[s.action.target],crop=cropFor(shot,s.focus);assert.ok(box);assert.ok(box.x>=crop.x-.1&&box.y>=crop.y-.1&&box.x+box.width<=crop.x+crop.width+.1&&box.y+box.height<=crop.y+crop.height+.1,`${s.id} pointer target outside crop`);}}
  for(let f=0;f<c.duration;f++){const n=samples(c,f);assert.ok(Number.isInteger(n)&&n>=1&&n<=16);}
  assert.deepEqual(endPose(c,c.settle),endPose(c,c.duration-1));
  for(const name of captureNames(c)){const shot=p.captures[name];assert.ok(shot,`Missing ${name}`);assert.ok(fs.existsSync(path.join(ROOT,'assets/captures',format,shot.file)));const crop=cropFor(shot);assert.ok(crop.width>0&&crop.height>0);for(const key of shot.focus){const b=shot.boxes[key];assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=shot.viewport.width+.1&&b.y+b.height<=shot.viewport.height+.1,`Captured target offscreen ${name}/${key}`);}}
  const w=format==='landscape'?1920:1080,h=format==='landscape'?1080:1920;const safeTop=format==='vertical'?250:24,safeBottom=format==='vertical'?1540:h-24;
  for(const layout of [tutorialRects(format),trailerRects(format),endRects(format)])for(const [name,r]of Object.entries(layout)){assert.ok(r.x>=24&&r.x+r.width<=w-24,`${name} horizontal overflow`);assert.ok(r.y>=safeTop&&r.y+r.height<=safeBottom,`${name} unsafe vertical position`);}
 });
 test(`${piece}/${format}: score matches clock and sources`,async()=>{
  const {clock}=await readProject(ROOT,piece,format),file=path.join(ROOT,'assets/audio',`${piece}-${format}`),record=JSON.parse(fs.readFileSync(file+'.json','utf8'));
  assert.deepEqual(record.clock,clock);assert.equal(record.samples,clock.duration/30*48000);assert.ok(Math.abs(record.lufs-record.target)<=.5);assert.ok(record.truePeak<=-1);assert.equal(record.wavHash,digest(file+'.wav'));
  assert.deepEqual(record.sources,expectedScoreSources(ROOT,piece,clock));
  const b=fs.readFileSync(file+'.wav');assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');let offset=12,dataLength,formatData;while(offset+8<=b.length){const type=b.toString('ascii',offset,offset+4),length=b.readUInt32LE(offset+4);if(type==='fmt ')formatData=b.subarray(offset+8,offset+8+length);if(type==='data')dataLength=length;offset+=8+length+(length%2);}assert.equal(formatData.readUInt16LE(2),2);assert.equal(formatData.readUInt32LE(4),48000);assert.equal(formatData.readUInt16LE(14),16);assert.equal(dataLength,record.samples*4);
 });
}
test('planner rejects deliberately broken timing, reading and typing inputs',()=>{
 const source=JSON.parse(fs.readFileSync(path.join(ROOT,'publish-page/script.json'),'utf8'));const valid=plan(source);assert.equal(valid.duration,2250);
 for(const change of [d=>{d.scenes[1].start++},d=>{d.scenes[1].action.moveEnd=d.scenes[1].action.press},d=>{d.scenes[3].typing.interval=30},d=>{d.scenes[1].caption='Many '.repeat(100)}]){const broken=structuredClone(source);change(broken);assert.throws(()=>plan(broken));}
 assert.equal(readingFrames('One two three four five six seven'),99);
});
test('crop and safe layout tests reject deliberately defective geometry',()=>{
 assert.throws(()=>cropFor({viewport:{width:390,height:844},boxes:{},focus:['missing']}));
 const r=tutorialRects('vertical').browser;const broken={...r,y:1500};assert.throws(()=>validateRects({browser:broken},'vertical'),/Unsafe rectangle/);
 assert.throws(()=>cropFor({viewport:{width:390,height:844},boxes:{target:{x:0,y:830,width:100,height:40}},focus:['target']}),/leaves the capture/);
 const fitted=fitCrop({x:0,y:0,width:390,height:600},r);assert.ok(fitted.x>=r.x&&fitted.y>=r.y);
});
test('private output cannot enter the public allowlist',()=>{
 assert.throws(()=>options(['--piece','unlisted-client']));assert.throws(()=>options(['--private-project',REPO]),/outside repository/);assert.throws(()=>options(['--private-project',ROOT]),/outside repository/);assert.deepEqual(options(['--all-public']).pieces,PUBLIC);
});
test('kinetic word cache distinguishes every changing frame',async()=>{const {clock}=await readProject(ROOT,'general-trailer','landscape');assert.notEqual(visualKey(clock,139),visualKey(clock,146));assert.equal(visualKey(clock,1310),visualKey(clock,1349));});
test('verification rejects stale and partial render provenance',()=>{const clock={duration:1350};requireFreshRender({digest:'new',start:0,end:1349},'new',clock);assert.throws(()=>requireFreshRender({digest:'old',start:0,end:1349},'new',clock),/stale/);assert.throws(()=>requireFreshRender({digest:'new',start:0,end:1199},'new',clock),/partial/);});
test('validated flash detector rejects general, red and moving-detail defects',()=>{const result=spawnSync('python',[path.join(ROOT,'flash.py'),'--self-test'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const r=JSON.parse(result.stdout);for(const n of ['five_hz','cumulative_flash','saturated_red','linear_red','moving_detail'])assert.equal(r[n].pass,false);assert.equal(r.still.pass,true);});
test('all overlay and browser-bar text pairs exceed 4.5:1',()=>{
 const css=fs.readFileSync(path.join(REPO,'docs/tokens.css'),'utf8');
 const token=name=>css.match(new RegExp('--'+name+'-rgb: ([0-9 ]+);'))[1].split(' ').map(Number);
 const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
 const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
 const ink=token('brand-ink'),paper=token('brand-surface'),muted=token('brand-ink-muted'),blue=token('brand-primary');
 for(const [a,b]of [[ink,paper],[muted,paper],[blue,paper],[paper,blue],[paper,[25,26,28]],[[128,178,238],[25,26,28]],[muted,token('rule-hairline')]])assert.ok(ratio(a,b)>=4.5,`Contrast ${ratio(a,b)}`);
 assert.ok(ratio([160,160,160],paper)<4.5,'Deliberately faint text must fail');
});
