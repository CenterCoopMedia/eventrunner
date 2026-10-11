import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {audioEvents,readingGain,masterGain} from './audio-plan.mjs';
export const RATE=48000;
const smooth=x=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
const midi=note=>440*2**((note-69)/12);

export function synth(clock,{includeStems=false}={}){
 const count=Math.round(clock.duration/clock.fps*RATE),bus=()=>({left:new Float64Array(count),right:new Float64Array(count)});
 const music=bus(),ui=bus(),accents=bus(),room=bus();let seed=clock.seed;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
 const tutorial=clock.kind==='tutorial',beat=clock.fps*60/clock.bpm;
 const end=clock.scenes.find(s=>s.endCard)?.start??clock.duration;
 const silence=clock.silence[0]??end;
 const events=audioEvents(clock);
 function place(target,frame,seconds,frequency,level,kind='pluck',pan=0,verb=0){
  const start=Math.round(frame/clock.fps*RATE),length=Math.round(seconds*RATE),angle=(pan+1)*Math.PI/4;
  const gl=Math.cos(angle)*level,gr=Math.sin(angle)*level;let low=0,high=0;
  for(let i=0;i<length&&start+i<count;i++){
   const index=start+i;if(index<0)continue;
   const t=i/RATE,p=i/(length-1),noise=random();
   low+=.12*(noise-low);high+=.65*(noise-high);
   const phase=2*Math.PI*frequency*t,tail=smooth((length-1-i)/(RATE*.012));let value;
   if(kind==='kick')value=Math.sin(2*Math.PI*(49*t+92*.022*(1-Math.exp(-t/.022))))*smooth(t/.002)*Math.exp(-t/.095);
   else if(kind==='hat')value=(noise-high)*smooth(t/.001)*Math.exp(-t/.018);
   else if(kind==='click'||kind==='key')value=((high-low)*.7+Math.sin(phase)*.16+Math.sin(2*Math.PI*180*t)*.12)*smooth(t/.001)*Math.exp(-t/(kind==='key'?.004:.010));
   else if(kind==='sweep')value=(high-low)*Math.sin(Math.PI*p)**2;
   else if(kind==='pad')value=(Math.sin(phase)+.12*Math.sin(phase*2))*smooth(t/.14)*smooth((seconds-t)/.35);
   else if(kind==='bell')value=(Math.sin(phase)*Math.exp(-t/.23)+.25*Math.sin(phase*2)*Math.exp(-t/.09)+.08*Math.sin(phase*3)*Math.exp(-t/.04))*smooth(t/.003);
   else value=(Math.sin(phase)+.2*Math.sin(phase*2)+.06*Math.sin(phase*3))*smooth(t/.004)*Math.exp(-t/.12);
   value*=tail;const l=value*gl,r=value*gr;target.left[index]+=l;target.right[index]+=r;
   if(verb){room.left[index]+=l*verb;room.right[index]+=r*verb;}
  }
 }
 const chords=[[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,53,59]];
 const firstWord=word=>clock.scenes.find(s=>s.word===word)?.start??0;
 const shape=firstWord('Shape'),gather=firstWord('Gather'),reveal=clock.scenes.find(s=>s.id.startsWith('reveal'))?.start??end;
 function harmony(frame){
  if(tutorial)return chords[Math.floor(frame/(beat*8))%chords.length];
  if(frame>=gather)return chords[3];
  if(frame>=shape)return chords[2];
  return chords[Math.floor(frame/(beat*8))%2];
 }
 // A quiet opening grows into the reveal. The groove ends before the title.
 for(let frame=0;frame<silence;frame+=beat){
  const b=Math.round(frame/beat),chord=harmony(frame),energy=tutorial?.42:frame<firstWord('Plan')?.58:frame<shape?.75:frame<gather?.85:1;
  if(frame<silence-beat){
   if(!tutorial||b%2===0)place(music,frame,.32,0,.13*energy,'kick');
   if(!tutorial)place(music,frame+beat/2,.06,0,.035*energy,'hat',b%2?.25:-.25);
   place(music,frame,.5,midi(chord[b%4]+12),.065*energy,'pluck',Math.sin(b*.7)*.35,.10);
   if(!tutorial&&frame>=shape&&frame<reveal)place(music,frame+beat/2,.34,midi(chord[(b+2)%4]+12),.022*energy,'pluck',-.25,.08);
  }
  if(b%4===0){
   const length=Math.min(2.18,(silence-frame)/clock.fps);
   chord.forEach((note,i)=>place(music,frame,length,midi(note),.041*energy,'pad',(i-1.5)*.25,.15));
   place(music,frame,.7,midi(chord[0]-12),.08*energy,'pluck',0);
  }
 }
 for(const event of events){
  if(event.kind==='click')place(ui,event.frame,.065,1500,.13,'click',0,.025);
  if(event.kind==='key')place(ui,event.frame,.025,740+(event.character%4)*65,.063,'key',(event.character%3-1)*.08);
  if(event.kind==='period')place(accents,event.frame,.65,midi([72,74,76][event.index]),.16,'bell',0,.13);
  if(event.kind==='transition')place(accents,event.frame-8,8/clock.fps,0,.035,'sweep',0,.04);
  if(event.kind==='reveal'){
   place(accents,event.frame-15,15/clock.fps,0,.048,'sweep',0,.05);
   [67,71,74].forEach((n,i)=>place(accents,event.frame,.7,midi(n),.065,'bell',(i-1)*.2,.12));
  }
  if(event.kind==='resolve'){
   // A single C-major arrival replaces the loop; no competing chord or beat.
   [48,55,60,64,67].forEach((n,i)=>place(accents,event.frame,Math.min(3.8,(clock.duration-end)/clock.fps),midi(n),tutorial?.030:.060,'pad',(i-2)*.18,.12));
   place(accents,event.frame,.8,midi(72),tutorial?.06:.14,'bell',0,.10);
  }
 }
 // Short, filtered stereo room. UI stays centered and predominantly dry.
 const wet=bus();for(const [delay,level]of [[.071,.30],[.113,.21],[.173,.12]]){
  const shift=Math.round(delay*RATE);for(let i=shift;i<count;i++){wet.left[i]+=room.left[i-shift]*level;wet.right[i]+=room.right[i-shift]*level;}
 }
 const mix=bus();let previousL=0,previousR=0,dcL=0,dcR=0;
 for(let i=0;i<count;i++){
  const frame=i/RATE*clock.fps,duck=readingGain(clock,frame),gain=masterGain(clock,frame);
  const l=music.left[i]*duck+ui.left[i]+accents.left[i]+wet.left[i],r=music.right[i]*duck+ui.right[i]+accents.right[i]+wet.right[i];
  // Gentle DC blocker before the final envelope, so silence stays exact.
  dcL=l-previousL+.997*dcL;dcR=r-previousR+.997*dcR;previousL=l;previousR=r;
  mix.left[i]=dcL*gain;mix.right[i]=dcR*gain;
 }
 return{...mix,count,events,...(includeStems?{stems:{music,ui,accents}}:{})};
}
export function writeWav(file,{left,right,count}){const b=Buffer.alloc(44+count*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(2,22);b.writeUInt32LE(RATE,24);b.writeUInt32LE(RATE*4,28);b.writeUInt16LE(4,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(count*4,40);for(let i=0;i<count;i++){b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,left[i]))*32767),44+i*4);b.writeInt16LE(Math.round(Math.max(-1,Math.min(1,right[i]))*32767),46+i*4);}fs.writeFileSync(file,b);}
export function command(args){const p=spawnSync('ffmpeg',['-hide_banner','-y',...args],{encoding:'utf8',maxBuffer:12*1024*1024});if(p.status)throw new Error(p.stderr);return p.stderr;}
export function measure(file){const log=command(['-i',file,'-af','ebur128=peak=true','-f','null','-']);const summary=log.slice(log.lastIndexOf('Summary:'));const lufs=Number(summary.match(/I:\s*([-\d.]+) LUFS/)?.[1]),truePeak=Number(summary.match(/Peak:\s*([-\d.]+) dBFS/)?.[1]);if(!Number.isFinite(lufs)||!Number.isFinite(truePeak))throw new Error('Missing loudness summary');return{lufs,truePeak,method:'FFmpeg ebur128=peak=true / BS.1770',summary};}
export function normalize(input,output,target){const probe=command(['-i',input,'-af',`loudnorm=I=${target}:TP=-2.0:LRA=11:print_format=json`,'-f','null','-']);const stats=JSON.parse(probe.slice(probe.lastIndexOf('{'),probe.indexOf('}',probe.lastIndexOf('{'))+1));command(['-i',input,'-af',`loudnorm=I=${target}:TP=-2.0:LRA=11:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`,'-ar','48000','-ac','2','-c:a','pcm_s16le',output]);return measure(output);}
