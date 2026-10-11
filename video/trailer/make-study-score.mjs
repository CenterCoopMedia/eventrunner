import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {writeWav,normalize,RATE} from '../synth.mjs';
import {audioEvents,masterGain} from '../audio-plan.mjs';

// An original arrangement for the replacement direction, made from oscillators
// and seeded noise. No reference audio, samples or reference source is bundled.
const root=process.argv[2];if(!root)throw new Error('Pass the external direction-study root');
const {timeline:clock}=await import(pathToFileURL(path.join(root,'trailer-study/timeline.ts')));
const q=clock.cinematic,N=clock.duration/30*RATE,makeBus=()=>({left:new Float64Array(N),right:new Float64Array(N)});
const drums=makeBus(),bass=makeBus(),music=makeBus(),fx=makeBus(),ui=makeBus(),send=makeBus();
let seed=clock.seed;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
const hz=n=>440*2**((n-69)/12),smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
function tone(kind,frequency,seconds){
 const length=Math.round(seconds*RATE),data=new Float64Array(length);let low=0,mid=0,phase=0;
 for(let i=0;i<length;i++){
  const t=i/RATE,u=t/seconds,n=random(),edge=smooth(t/.002)*smooth((seconds-t)/.015);let x=0;
  if(kind==='kick')x=Math.sin(2*Math.PI*(48*t+2.8*(1-Math.exp(-t/.022))))*Math.exp(-t/.14)+n*.13*Math.exp(-t/.004);
  else if(kind==='clap'){
   low+=.22*(n-low);const bursts=[0,.009,.018].reduce((sum,at)=>sum+(t>=at?Math.exp(-(t-at)/.019):0),0);
   x=(n-low)*(bursts*.3+Math.exp(-t/.07)*.35);
  }else if(kind==='hat'){low+=.62*(n-low);x=(n-low)*Math.exp(-t/.024);}
  else if(kind==='key'||kind==='click'){low+=.22*(n-low);x=((n-low)*.7+Math.sin(2*Math.PI*frequency*t)*.3)*Math.exp(-t/(kind==='key'?.004:.012));}
  else if(kind==='knock')x=(Math.sin(2*Math.PI*frequency*t)*Math.exp(-t/.15)+.32*Math.sin(2*Math.PI*frequency*2.73*t)*Math.exp(-t/.045)+.12*Math.sin(2*Math.PI*frequency*5.1*t)*Math.exp(-t/.02)+n*.16*Math.exp(-t/.004));
  else if(kind==='air'){
   const cutoff=350+9000*u*u,a=1-Math.exp(-2*Math.PI*cutoff/RATE);low+=a*(n-low);mid+=.028*(n-mid);x=(low-mid)*Math.sin(Math.PI*u)**2;
  }else if(kind==='impact')x=Math.sin(2*Math.PI*(46*t+.95*(1-Math.exp(-t/.08))))*Math.exp(-t/.38)+n*.07*Math.exp(-t/.2);
  else{
   phase+=frequency/RATE;const p=2*Math.PI*phase;
   // A short harmonic series is band-limited below Nyquist. Its moving cutoff
   // gives the bass/pluck a changing timbre instead of a pure-sine beep.
   let raw=0;
   const cutoff=kind==='bass'?600+2600*Math.exp(-t/.07):kind==='pad'?1400+1700*Math.sin(Math.PI*u):1400+6000*Math.exp(-t/.05);
   for(let k=1;k<=10&&frequency*k<18000;k++)raw+=Math.sin(p*k)/(k*(1+(frequency*k/cutoff)**2));
   if(kind==='pad')raw=(raw+.18*Math.sin(p*1.004)+.12*Math.sin(p*.997))*smooth(t/.09)*smooth((seconds-t)/.25);
   else raw*=smooth(t/.002)*Math.exp(-t/(kind==='bass'?.25:.13));
   x=raw;
  }
  data[i]=x*edge;
 }
 return data;
}
function place(bus,kind,frame,seconds,frequency,level,pan=0,verb=0){
 const data=tone(kind,frequency,seconds),start=Math.round(frame/30*RATE),l=Math.cos((pan+1)*Math.PI/4)*level,r=Math.sin((pan+1)*Math.PI/4)*level;
 for(let i=0;i<data.length&&start+i<N;i++){if(start+i<0)continue;const index=start+i;bus.left[index]+=data[i]*l;bus.right[index]+=data[i]*r;if(verb){send.left[index]+=data[i]*l*verb;send.right[index]+=data[i]*r*verb;}}
}
const events=audioEvents(clock),extra=[];
place(fx,'air',0,.8,0,.23,0,.12);
q.lands.forEach((frame,i)=>{place(fx,'knock',frame,.6,hz([69,73,76][i]),.25,(i-1)*.45,.2);extra.push({kind:'landing',frame});});
place(fx,'air',q.pullback,.8,0,.11,0,.16);
const chords=[[57,61,64,71],[52,56,59,64],[54,57,61,64],[50,54,57,61]];
const roots=[45,40,42,38],hook=[76,73,71,69,73,76,78,76];
for(let f=q.plan;f<clock.silence[0]-9;f+=7.5){
 const eighth=Math.round((f-q.plan)/7.5),beat=Math.floor(eighth/2),bar=Math.floor(beat/4),chord=chords[bar%4],breakdown=f>=q.shape&&f<q.shape+30,energy=f>=q.gather?1:.84;
 if(eighth%2===0&&!breakdown)place(drums,'kick',f,.4,0,.31*energy);
 if(eighth%4===2&&!breakdown)place(drums,'clap',f,.22,0,.19*energy,0,.10);
 if(eighth%2===1)place(drums,'hat',f,.10,0,.085*energy,(eighth%4-1.5)*.25);
 if(f>=q.gather&&eighth%2===0)place(drums,'hat',f+3.75,.07,0,.035,.4);
 if([0,3,4,6].includes(eighth%8))place(bass,'bass',f,.31,hz(roots[bar%4]),.18*energy);
 if(!breakdown)place(music,'pluck',f,.58,hz(hook[eighth%8]),.105*energy,Math.sin(eighth*.9)*.42,.21);
 if(eighth%8===0)chord.forEach((note,i)=>place(music,'pad',f,1.95,hz(note),.042,(i-1.5)*.34,.16));
}
for(const event of events){
 if(event.kind==='key')place(ui,'key',event.frame,.035,1500+event.character%4*160,.09,(event.character%3-1)*.06);
 if(event.kind==='click')place(ui,'click',event.frame,.08,1950,.19,0,.03);
 if(event.kind==='period')place(fx,'knock',event.frame,.42,hz([81,83,85][event.index]),.13,0,.12);
}
for(const frame of [q.plan,q.shape,q.gather,q.reveal]){
 place(fx,'air',frame-9,.3,0,.20,-.15,.10);place(fx,'impact',frame,.8,0,frame===q.reveal?.21:.12);extra.push({kind:'transition-arrival',frame});
}
place(fx,'air',q.reveal,.95,0,.14,.2,.15);
place(fx,'knock',q.pageLand,.75,hz(81),.15,0,.2);extra.push({kind:'page-arrival',frame:q.pageLand});
place(fx,'air',q.fold,(clock.silence[0]-q.fold)/30,0,.12,0,.12);extra.push({kind:'page-fold',frame:q.fold});
place(fx,'impact',q.title,1.3,0,.2);
[57,61,64,69,76].forEach((note,i)=>{place(music,'pad',q.title,2.5,hz(note),.048,(i-2)*.3,.3);place(fx,'knock',q.title,1.1,hz(note+12),.037,(i-2)*.2,.22);});
const mix=makeBus();
for(let i=0;i<N;i++){
 const frame=i/RATE*30,phase=(frame-q.plan)%15,sidechain=frame>=q.plan&&frame<q.title?.76+.24*smooth(phase/5):1;
 let l=drums.left[i]+bass.left[i]*sidechain+music.left[i]*sidechain+fx.left[i]+ui.left[i];
 let r=drums.right[i]+bass.right[i]*sidechain+music.right[i]*sidechain+fx.right[i]+ui.right[i];
 for(const [delay,gain,cross]of [[.079,.26,false],[.127,.19,true],[.211,.13,false],[.317,.09,true],[.439,.06,false]]){
  const at=i-Math.round(delay*RATE);if(at>=0){l+=(cross?send.right[at]:send.left[at])*gain;r+=(cross?send.left[at]:send.right[at])*gain;}
 }
 mix.left[i]=Math.tanh(l*.9)/.9*masterGain(clock,frame);mix.right[i]=Math.tanh(r*.9)/.9*masterGain(clock,frame);
}
const raw=path.join(root,'.cache/study-raw.wav');writeWav(raw,{...mix,count:N});
for(const format of ['landscape','vertical']){
 const out=path.join(root,'assets/audio',`trailer-study-${format}.wav`),level=normalize(raw,out,-16);
 const files=[new URL(import.meta.url),new URL('../synth.mjs',import.meta.url),new URL('../audio-plan.mjs',import.meta.url)];
 const sourceHash=crypto.createHash('sha256').update(Buffer.concat(files.map(f=>fs.readFileSync(f)))).digest('hex');
 fs.writeFileSync(out.replace('.wav','.json'),JSON.stringify({sampleRate:RATE,bits:16,channels:2,samples:N,clock,sourceHash,target:-16,...level,events:[...events,...extra].sort((a,b)=>a.frame-b.frame),wavHash:crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex')},null,2));console.log(format,level.lufs,level.truePeak);
}
