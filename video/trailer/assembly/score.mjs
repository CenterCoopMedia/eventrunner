// Original composition and instruments. Every sample is calculated from
// oscillators, seeded noise and recursive filters; no instrument bank or loop.
import {RATE} from '../../synth.mjs';
import {masterGain} from '../../audio-plan.mjs';
const TAU=Math.PI*2,clamp=x=>Math.max(0,Math.min(1,x)),smooth=x=>{x=clamp(x);return x*x*(3-2*x);},hz=n=>440*2**((n-69)/12);
export function compose(clock){
 const count=Math.round(clock.duration/clock.fps*RATE),q=clock.assembly,beat=60/clock.bpm;
 const bus=()=>({left:new Float64Array(count),right:new Float64Array(count)});
 const keys=bus(),drums=bus(),pad=bus(),bass=bus(),foley=bus(),air=bus();
 let seed=clock.seed;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
 function place(target,data,time,gain=1,pan=0){
  const start=Math.round(time*RATE),l=Math.cos((pan+1)*Math.PI/4)*gain,r=Math.sin((pan+1)*Math.PI/4)*gain;
  for(let i=Math.max(0,-start);i<data.length&&i+start<count;i++){target.left[start+i]+=data[i]*l;target.right[start+i]+=data[i]*r;}
 }
 function instrument(kind,note,velocity,duration){
  const frequency=hz(note),v=velocity/127,seconds=kind==='piano'?duration+1.1:duration;
  const data=new Float64Array(Math.round(seconds*RATE));let low=0,high=0,phase=0;
  for(let i=0;i<data.length;i++){
   const t=i/RATE,p=TAU*frequency*t,noise=random();let x=0;
   if(kind==='piano'){
    // Nonlinear pickup around a struck tine: body, decaying FM bark, a quiet
    // inharmonic attack and a long damped release. No repeating bell motif.
    const index=(.25+v*.9)*Math.exp(-t/.16),body=Math.sin(p+index*Math.sin(p*2.001));
    x=body*Math.exp(-t/3.6)+.20*Math.sin(p*2.004)*Math.exp(-t/1.4)+.035*Math.sin(p*7.01)*Math.exp(-t/.065);
    x=Math.tanh(x*1.35)/1.35*v**1.4*smooth(t/.007)*(t<duration?1:Math.exp(-(t-duration)/.24))*smooth((seconds-t)/.04);
   }else if(kind==='bass'){
    const cutoff=360+1500*Math.exp(-t/.09);let wave=0;
    for(let k=1;k<=8;k++)wave+=Math.sin(p*k)/(k*(1+(frequency*k/cutoff)**2));
    x=Math.tanh(wave*1.6)/1.6*smooth(t/.012)*smooth((seconds-t)/.075);
   }else if(kind==='kick'){
    phase+=TAU*(46+102*Math.exp(-t/.019))/RATE;
    x=(Math.sin(phase)*Math.exp(-t/.115)+noise*.17*Math.exp(-t/.003))*smooth(t/.0015);
   }else if(kind==='snare'){
    low+=.10*(noise-low);high+=.64*(noise-high);
    x=(Math.sin(TAU*183*t)*.5+Math.sin(TAU*337*t)*.19)*Math.exp(-t/.045)+(high-low)*Math.exp(-t/.105)*.91;
    x*=smooth(t/.001);
   }else if(kind==='hat'||kind==='openHat'){
    const metal=[404,623,813,1207,1739,2427].reduce((sum,f)=>sum+Math.tanh(Math.sin(TAU*f*t)*8),0)/6;
    const raw=metal*.37+noise*.63;low+=.63*(raw-low);
    x=(raw-low)*Math.exp(-t/(kind==='hat'?.024:.12))*smooth(t/.0008);
   }else if(kind==='shaker'){
    low+=.52*(noise-low);x=(noise-low)*(Math.exp(-t/.022)+(t>.028?.55*Math.exp(-(t-.028)/.016):0))*smooth(t/.001);
   }else if(kind==='rim'){
    x=(Math.sin(TAU*1840*t)*.33+Math.sin(TAU*1090*t)*.3+Math.sin(TAU*240*t)*.6)*Math.exp(-t/.014)*smooth(t/.001);
   }else if(kind==='tom'){
    phase+=TAU*(frequency+35*Math.exp(-t/.035))/RATE;
    x=(Math.sin(phase)+.18*Math.sin(phase*1.57))*Math.exp(-t/.11)+noise*.12*Math.exp(-t/.009);x*=smooth(t/.002);
   }else if(kind==='tactile'){
    low+=.12*(noise-low);high+=.5*(noise-high);
    x=((Math.sin(TAU*178*t)+.28*Math.sin(TAU*463*t))*.65*Math.exp(-t/.027)+(high-low)*.23*Math.exp(-t/.008))*smooth(t/.0015);
   }else if(kind==='air'){
    low+=.042*(noise-low);high+=.36*(noise-high);x=(high-low)*Math.sin(Math.PI*t/seconds)**2;
   }
   data[i]=x*(kind==='piano'?1:v)*smooth((seconds-t)/.012);
  }
  return data;
 }
 const voicings=[
  [53,57,60,64,69],[53,57,60,64,69],[53,57,60,64,69],[53,57,60,64,69],
  [53,57,60,62,65],[53,57,60,62,65],[52,57,60,65,67],[52,57,60,65,67],
  [52,57,58,62,67],[52,57,58,62,67],[53,57,60,64,69],[53,57,60,64,69],
  [53,57,60,62,65],[53,57,60,62,65],[53,57,60,62,67],[52,57,60,65,67],
  [52,57,60,65,67],[52,57,58,62,67]
 ];
 const roots=[38,38,38,38,34,34,41,41,36,36,38,38,34,34,31,41,41,36];
 const hit=(kind,time,velocity,duration=.22,note=40,pan=0)=>place(drums,instrument(kind,note,velocity,duration),time,.22,pan);
 for(let bar=0;bar<18;bar++){
  const start=bar*4*beat,chord=voicings[bar];
  const positions=[0,1,6,15].includes(bar)?[0]:[0,2.75];
  for(const [j,pos]of positions.entries())chord.forEach((note,i)=>place(keys,instrument('piano',note,49+i%3*5+(j?4:0),j?1.4:1.8),start+pos*beat+i*.009,.21,(i-2)*.15));
  if([3,5,9,11,13,16].includes(bar))for(const [pos,note,vel,dur]of [[1.5,chord.at(-1)+12,50,.34],[2.25,chord.at(-2)+12,43,.8]])place(keys,instrument('piano',note,vel,dur),start+pos*beat,.17,.15);
  if(bar<2){for(const pos of [0,2])hit('kick',start+pos*beat,47,.4);continue;}
  if(bar===6){hit('rim',start,51,.1);hit('snare',start+3*beat,53,.25);continue;}
  const energy=bar>=10?1:.88;
  for(const [pos,vel]of [[0,105],[1.75,72],[2.5,91],[3.5,62]])hit('kick',start+pos*beat,vel*energy,.4);
  for(const pos of [1,3])hit('snare',start+pos*beat+.010,(bar<15?81:87)*energy,.3);
  if(bar%2)hit('snare',start+2.75*beat,25,.18,.1);
  for(let step=0;step<16;step++)hit('hat',start+(step*.25+(step%2?.036:0))*beat,[44,24,58,29][step%4]+random()*4,.085,40,step%2?.28:-.28);
  if(bar>=10)for(const pos of [.5,2.5])hit('shaker',start+pos*beat,40,.12,40,.5);
  if([7,11,15,17].includes(bar))hit('openHat',start+3.5*beat,44,.36,40,-.25);
  if([5,9,14,17].includes(bar))for(const [pos,note,vel]of [[3.25,45,53],[3.5,47,50],[3.75,41,61]])hit('tom',start+pos*beat,vel,.32,note,(note-44)*.12);
  for(const [pos,dur,note]of [[0,.73,roots[bar]],[1.75,.33,roots[bar]],[2.5,.44,roots[bar]+12],[3.25,.38,roots[bar]+7]])place(bass,instrument('bass',note,127,dur),start+pos*beat,.15);
 }
 function ensemble(notes,start,seconds,gain){
  const length=Math.round(seconds*RATE);
  notes.forEach(note=>{
   const frequency=hz(note),phases=[random()*Math.PI,random()*Math.PI,random()*Math.PI];
   for(let side=0;side<2;side++){
    const data=new Float64Array(length);
    for(let i=0;i<length;i++){
     const t=i/RATE,env=smooth(t/.23)*smooth((seconds-t)/.95),cutoff=1100+650*Math.sin(Math.PI*t/seconds);let wave=0;
     for(let voice=0;voice<3;voice++){
      const p=TAU*frequency*(1+[-.0036,0,.0031][voice])*t+phases[voice]+side*.19;
      for(let k=1;k<=7;k++)wave+=Math.sin(p*k)/(k**1.4*(1+(frequency*k/cutoff)**2)*3);
     }
     data[i]=wave*env;
    }
    place(pad,data,start,gain,side?1:-1);
   }
  });
 }
 for(let bar=0;bar<18;bar+=2)ensemble(voicings[bar],bar*4*beat,8*beat+.65,.018);
 const hushSample=Math.round(clock.silence[0]/30*RATE),titleSample=Math.round(q.title/30*RATE);
 // The groove and its previous voicing end at the breath. Only the new
 // resolution is added after it; old drum/keyboard releases cannot reappear.
 for(const b of [keys,drums,pad,bass]){b.left.fill(0,hushSample);b.right.fill(0,hushSample);}
 const title=q.title/30,ending=[41,53,57,60,62,67,72];
 ending.forEach((note,i)=>place(keys,instrument('piano',note,57-i*2,4.7),title+i*.011,.19,(i-3)*.16));
 ensemble(ending.slice(0,6),title,6.45,.024);
 const events=[];
 const tactile=(frame,strength=1,pan=0)=>place(foley,instrument('tactile',40,127,.16),frame/30,.10*strength,pan);
 const sweep=(frame,duration=.55,strength=1,pan=0)=>place(air,instrument('air',40,127,duration),frame/30,.035*strength,pan);
 q.arrivals.forEach((f,i)=>{tactile(f,.6,(i-1.5)*.33);sweep(f-17,.57,.6,(i-1.5)*.33);events.push({kind:'component-arrival',frame:f});});
 for(const f of [q.join,q.themePublish]){tactile(f,1.15);events.push({kind:'assembly-action',frame:f});}
 q.styleFlow.forEach((f,i)=>{sweep(f-22,.85,.8,(i-1)*.4);tactile(f,.45,(i-1)*.4);events.push({kind:'style-arrival',frame:f});});
 for(const f of q.bookmarks){tactile(f);sweep(f+2,1.5,1,.2);tactile(f+47,.8,.45);events.push({kind:'bookmark',frame:f},{kind:'schedule-arrival',frame:f+47});}
 for(const f of [q.program,q.shape,q.gather,q.reveal,q.title]){sweep(f-16,.9,1.1,-.12);events.push({kind:'spatial-transition',frame:f});}
 function balance(b,db){let energy=0,n=0;for(let i=0;i<count;i++){const e=(b.left[i]**2+b.right[i]**2)/2;if(e>1e-8){energy+=e;n++;}}const gain=10**(db/20)/Math.sqrt(energy/Math.max(n,1));for(let i=0;i<count;i++){b.left[i]*=gain;b.right[i]*=gain;}}
 balance(keys,-24);balance(drums,-23);balance(pad,-27.5);balance(bass,-23);
 const wet=bus(),delays=[.0297,.0371,.0411,.0437];
 // Damped feedback combs into all-pass diffusers form a stereo room rather
 // than a list of audible repeat taps. The feedback is always below unity.
 for(let side=0;side<2;side++){
  const channel=side?'right':'left',input=new Float64Array(count),output=wet[channel];
  for(let i=0;i<count;i++)input[i]=keys[channel][i]*.18+pad[channel][i]*.25+foley[channel][i]*.10+drums[channel][i]*.045;
  delays.forEach((seconds,j)=>{const delay=Math.round((seconds+side*.0017)*RATE),buffer=new Float64Array(delay);let cursor=0,damped=0;
   for(let i=0;i<count;i++){if(i===titleSample){buffer.fill(0);damped=0;}const value=buffer[cursor];damped+=.32*(value-damped);buffer[cursor]=input[i]+damped*(.74-j*.025);output[i]+=value*.24;cursor=(cursor+1)%delay;}
  });
  for(const duration of [.0047,.0017]){const delay=Math.round((duration+side*.0003)*RATE),buffer=new Float64Array(delay);let cursor=0;for(let i=0;i<count;i++){if(i===titleSample)buffer.fill(0);const input=output[i],delayed=buffer[cursor];output[i]=delayed-input*.5;buffer[cursor]=input+delayed*.5;cursor=(cursor+1)%delay;}}
 }
 const mix=bus();let previousL=0,previousR=0,dcL=0,dcR=0;
 for(let i=0;i<count;i++){
  const time=i/RATE,frame=time*30,phase=((time-8*beat)%beat+beat)%beat;
  const duck=time>=8*beat&&time<title?.86+.14*smooth(phase/.17):1;
  const values=[];
  for(const [side,channel]of ['left','right'].entries()){
   const delay=.012+.0024*Math.sin(TAU*(side?.29:.23)*time+side*1.4),pos=i-delay*RATE,lo=Math.floor(pos),fraction=pos-lo;
   const chorus=lo>=0?keys[channel][lo]*(1-fraction)+keys[channel][lo+1]*fraction:0;
   let repeats=0;for(const [seconds,gain]of [[beat*.75,.14],[beat*1.5,.07],[beat*2.25,.035]]){const at=i-Math.round(seconds*RATE);if(at>=0&&(i<titleSample||at>=titleSample))repeats+=keys[side?'left':'right'][at]*gain;}
   const value=(keys[channel][i]+chorus*.24+pad[channel][i]+repeats)*duck+bass[channel][i]+drums[channel][i]+wet[channel][i]+foley[channel][i]+air[channel][i];values.push(Math.tanh(value*1.25)/1.25);
  }
  dcL=values[0]-previousL+.997*dcL;dcR=values[1]-previousR+.997*dcR;previousL=values[0];previousR=values[1];
  const gain=masterGain(clock,frame);mix.left[i]=dcL*gain;mix.right[i]=dcR*gain;
 }
 let peak=0;for(let i=0;i<count;i++){if(!Number.isFinite(mix.left[i]+mix.right[i]))throw new Error('Non-finite score');peak=Math.max(peak,Math.abs(mix.left[i]),Math.abs(mix.right[i]));}
 if(peak>.94)for(let i=0;i<count;i++){mix.left[i]*=.94/peak;mix.right[i]*=.94/peak;}
 const rms=b=>{let v=0;for(let i=0;i<count;i++)v+=b.left[i]**2+b.right[i]**2;return 20*Math.log10(Math.sqrt(v/count/2));};
 return{...mix,count,arrangement:{composer:'Original Event Runner synthesis',bpm:clock.bpm,bars:21,instrumentation:['modeled tine electric piano','synthesized acoustic and metallic percussion','filtered harmonic bass','detuned harmonic ensemble','tactile foley','diffused stereo room'],events:events.sort((a,b)=>a.frame-b.frame),rawPeak:Math.min(.94,peak),stemRmsDb:Object.fromEntries(Object.entries({keys,drums,pad,bass,foley,wet}).map(([name,b])=>[name,rms(b)]))}};
}
