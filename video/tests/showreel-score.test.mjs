import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {compose} from '../showreel/score.mjs';

const {timeline}=await import(new URL('../showreel/timeline.ts',import.meta.url));
const score=compose(timeline);
const RATE=48000,sample=frame=>Math.round(frame/timeline.fps*RATE),barSample=bar=>Math.round((bar-1)*4*60/timeline.bpm*RATE);
const digest=s=>crypto.createHash('sha256').update(new Uint8Array(s.left.buffer)).update(new Uint8Array(s.right.buffer)).digest('hex');
const rms=(from,to)=>{let v=0;for(let i=from;i<to;i++)v+=score.left[i]**2+score.right[i]**2;return Math.sqrt(v/(to-from)/2);};
const bars=(first,last)=>rms(barSample(first),barSample(last+1));

test('the mix has the exact sample count of the 45-second clock',()=>{
 assert.equal(score.count,Math.round(timeline.duration/timeline.fps*RATE));
 assert.equal(score.count,2160000);
 assert.equal(score.left.length,score.count);
 assert.equal(score.right.length,score.count);
});

test('compose is deterministic',()=>{
 assert.equal(digest(compose(timeline)),digest(score));
});

test('the raw mix leaves headroom and is finite',()=>{
 let peak=0;
 for(let i=0;i<score.count;i++){assert.ok(Number.isFinite(score.left[i])&&Number.isFinite(score.right[i]));peak=Math.max(peak,Math.abs(score.left[i]),Math.abs(score.right[i]));}
 assert.ok(peak<=.9,`peak ${peak}`);
 assert.ok(peak>.3,`peak ${peak}`);
});

test('the pre-title gap and the final three frames are digital silence',()=>{
 const zero=(from,to)=>{for(let i=from;i<to;i++)if(score.left[i]!==0||score.right[i]!==0)return i;return -1;};
 const [a,b]=timeline.silence;
 assert.equal(zero(sample(a),sample(b)),-1);
 assert.equal(zero(sample(timeline.duration-3),score.count),-1);
 assert.ok(rms(sample(b),sample(b)+RATE/10)>.01,'the title impact follows the gap');
});

test('every picture cue has a sound event on its frame',()=>{
 const c=timeline.cues,expected=[];
 const add=(kind,v)=>{for(const f of [v].flat())expected.push([kind,f]);};
 for(const [section,cues]of Object.entries(c))for(const [name,value]of Object.entries(cues)){
  if(section==='plan'&&name==='word')continue;
  // Ranges are announced at their start.
  const ranges=['gather.checkIn','gather.delivered','stack.riser'];
  add(`${section}.${name}`,ranges.includes(`${section}.${name}`)?value[0]:value);
 }
 for(const [kind,frame]of expected)assert.ok(score.events.some(e=>e.kind===kind&&e.frame===frame),`${kind} at ${frame}`);
 for(let i=1;i<score.events.length;i++)assert.ok(score.events[i-1].frame<=score.events[i].frame,'events are sorted');
 assert.ok(score.events.every(e=>Number.isInteger(e.frame)&&e.frame>=0&&e.frame<timeline.duration));
});

test('section energy follows the arrangement',()=>{
 assert.ok(bars(1,2)<bars(3,6)*.5,'the open is quieter than the drop');
 assert.ok(bars(11,12)<bars(13,14),'gather starts lighter');
 assert.ok(bars(23,24)<bars(21,22)*.5,'the title decays');
 const montage=bars(19,20);
 for(let first=1;first<=23;first++)if(first!==19)assert.ok(bars(first,first+1)<montage,`bars ${first}-${first+1} exceed the montage`);
});
