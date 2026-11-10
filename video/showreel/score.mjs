// Original showreel teaser score in E major. Every sample is calculated from
// oscillators, seeded noise and recursive filters; no instrument bank or loop.
import {RATE} from '../synth.mjs';
const TAU=Math.PI*2,clamp=x=>x<0?0:x>1?1:x,smooth=x=>{x=clamp(x);return x*x*(3-2*x);},hz=n=>440*2**((n-69)/12);

// Voicings (MIDI). Bass roots sit in octave 1 for a round sub.
const CHORDS={
 'Emaj9':{root:28,notes:[52,56,59,63,66]},
 'C#m9':{root:37,notes:[49,52,56,59,63]},
 'Amaj9':{root:33,notes:[45,52,56,59,61]},
 'B6/9':{root:35,notes:[47,54,56,61,63]},
 'G#m7':{root:32,notes:[44,54,59,63]},
 'F#m11':{root:30,notes:[42,52,57,59,61]},
 'E6/9':{root:28,notes:[40,47,54,56,61,64]},
};
export const PROGRESSION=['Emaj9','Amaj9','Emaj9','C#m9','Amaj9','B6/9','Amaj9','B6/9','C#m9','B6/9','Emaj9','G#m7','Amaj9','B6/9','C#m9','Amaj9','F#m11','B6/9','Amaj9','B6/9','E6/9','E6/9','E6/9','E6/9'];
// Six style stabs climb through inversions: top line G#4 A4 B4 C#5 E5 G#5.
const STABS=[[57,61,64,68],[61,64,68,69],[63,66,68,71],[66,68,71,73],[68,71,73,76],[71,75,76,80]];

export function compose(clock,{stems=false}={}){
 const count=Math.round(clock.duration/clock.fps*RATE),fps=clock.fps,beat=60/clock.bpm,c=clock.cues;
 const S=frame=>Math.round(frame/fps*RATE),B=b=>Math.round(b*beat*RATE);
 const bus=gain=>({left:new Float64Array(count),right:new Float64Array(count),gain});
 // Bus gains are applied at placement, so room and echo sends are post-gain.
 const music=bus(1.55),drums=bus(.62),bass=bus(.58),fx=bus(.9),room=bus(1),echo=bus(1);
 let seed=clock.seed>>>0;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
 const events=[],mark=(kind,frame)=>events.push({kind,frame});

 function place(target,data,start,gain=1,pan=0,send=0,delay=0){
  const g=gain*target.gain,from=Math.max(0,-start),to=Math.min(data.length,count-start),moving=Array.isArray(pan);
  let gl=0,gr=0;
  const setPan=p=>{const a=clamp((p+1)/2)*Math.PI/2;gl=Math.cos(a)*g;gr=Math.sin(a)*g;};
  if(!moving)setPan(pan);
  for(let i=from;i<to;i++){
   if(moving&&(i&63)===0)setPan(pan[0]+(pan[1]-pan[0])*i/data.length);
   const v=data[i],j=start+i,l=v*gl,r=v*gr;target.left[j]+=l;target.right[j]+=r;
   if(send){room.left[j]+=l*send;room.right[j]+=r*send;}
   if(delay){echo.left[j]+=l*delay;echo.right[j]+=r*delay;}
  }
 }
 // Topology-preserving state-variable filter; coefficients are cached.
 function filter(){
  let s1=0,s2=0,lf=-1,lq=-1,g=0,k=0,a1=0,a2=0,a3=0;
  const f={band:0,high:0,run(x,fc,q=.707){
   if(fc!==lf||q!==lq){lf=fc;lq=q;g=Math.tan(Math.PI*Math.max(10,Math.min(fc,RATE*.46))/RATE);k=1/q;a1=1/(1+g*(g+k));a2=g*a1;a3=g*a2;}
   const v3=x-s2,v1=a1*s1+a2*v3,v2=s2+a2*s1+a3*v3;s1=2*v1-s1;s2=2*v2-s2;f.band=v1;f.high=x-k*v1-v2;return v2;
  }};
  return f;
 }
 function saw(phase=0){
  return freq=>{const dt=freq/RATE;phase+=dt;if(phase>=1)phase-=1;let v=2*phase-1;
   if(phase<dt){const t=phase/dt;v-=t+t-t*t-1;}else if(phase>1-dt){const t=(phase-1)/dt;v-=t*t+t+t+1;}return v;};
 }
 function render(seconds,fn){
  const n=Math.max(2,Math.round(seconds*RATE)),d=new Float64Array(n),fade=RATE*.004;
  for(let i=0;i<n;i++)d[i]=fn(i/RATE)*smooth((n-1-i)/fade);
  return d;
 }

 // Drums.
 const kick=({f0=47,sweep=125,tau=.03,decay=.15,len=.45,click=.12,drive=1.8}={})=>{let ph=0,lp=0;return render(len,t=>{
  ph+=TAU*(f0+sweep*Math.exp(-t/tau))/RATE;lp+=.3*(random()-lp);
  const x=Math.sin(ph)*smooth(t/.0015)*(t<.012?1:Math.exp(-(t-.012)/decay))+lp*click*Math.exp(-t/.003);
  return Math.tanh(x*drive)/Math.tanh(drive);});};
 const clap=()=>{const bp=filter();return render(.32,t=>{
  let env=0;for(const o of [0,.009,.018,.027])if(t>=o)env+=Math.exp(-(t-o)/.0035);
  if(t>.03)env+=.55*Math.exp(-(t-.03)/.08);
  bp.run(random(),1350,.9);return bp.band*env*2.2;});};
 const snare=(f=190)=>{const hp=filter(),lp=filter();return render(.3,t=>{
  hp.run(random(),1700);const n=lp.run(hp.high,6500);
  return((Math.sin(TAU*f*t)*.55*Math.exp(-t/.05)+Math.sin(TAU*f*1.71*t)*.2*Math.exp(-t/.03))+n*1.1*Math.exp(-t/.11))*smooth(t/.001);});};
 const hat=(decay=.032)=>{const hp=filter(),lp=filter();return render(decay*5,t=>{
  hp.run(random(),7200);return lp.run(hp.high,10500,.6)*Math.exp(-t/decay)*smooth(t/.0008);});};
 const tom=f=>{let ph=0;return render(.42,t=>{ph+=TAU*f*(1+.55*Math.exp(-t/.03))/RATE;
  return(Math.sin(ph)+.15*Math.sin(ph*1.5))*Math.exp(-t/.16)*smooth(t/.0015)+random()*.08*Math.exp(-t/.008);});};
 const impact=(size=1)=>{let ph=0;const lp=filter();return render(1.1*size+.6,t=>{
  ph+=TAU*(36+95*Math.exp(-t/.07))/RATE;
  const boom=Math.sin(ph)*Math.exp(-t/(.42*size))*smooth(t/.002);
  const crack=lp.run(random(),260+3800*Math.exp(-t/.045),.7)*Math.exp(-t/(.16*size))*.85;
  const knock=Math.sin(TAU*112*t)*Math.exp(-t/.07)*.35;
  return Math.tanh((boom+crack+knock)*1.5)/1.2;});};

 // Tonal instruments.
 const bassNote=(note,len)=>{const f=hz(note),sw=saw(),lp=filter();let ph=0;return render(len,t=>{
  ph+=TAU*f/RATE;const top=lp.run(sw(f),f*2.6+420*Math.exp(-t/.07),.8);
  const x=(Math.sin(ph)+.32*top)*smooth(t/.004)*Math.exp(-t/1.6)*smooth((len-t)/.03);
  return Math.tanh(x*1.3)/1.1;});};
 const pluck=(note,len,bright=1)=>{const f=hz(note),a=saw((random()+1)/2),b=saw((random()+1)/2),lp=filter();return render(len+.22,t=>{
  const fc=Math.min(5200,f*(1.1+bright*9*Math.exp(-t/.075))+180);
  const x=lp.run((a(f*1.004)+b(f*.996))*.5,fc,.85);
  return x*smooth(t/.0015)*Math.exp(-t/.3)*(t<len?1:Math.exp(-(t-len)/.06));});};
 const keys=(note,len,vel=.7,ring=2.4)=>{const f=hz(note);return render(len+.5,t=>{
  const p=TAU*f*t,index=(.35+vel*.9)*Math.exp(-t/.16);
  const x=Math.sin(p+index*Math.sin(p))*Math.exp(-t/ring)+.14*Math.sin(p*2.003)*Math.exp(-t/.9)+.025*Math.sin(p*6.98)*Math.exp(-t/.04);
  return Math.tanh(x*1.2)/1.2*smooth(t/.004)*(t<len?1:Math.exp(-(t-len)/.18));});};
 const bell=(note,len=1.2,{index=.9,ratio=3.5,decay=.45,cut=5000}={})=>{const f=hz(note),lp=filter();return render(len,t=>{
  const p=TAU*f*t;
  const x=(Math.sin(p+index*Math.exp(-t/.22)*Math.sin(p*ratio))*Math.exp(-t/decay)+.18*Math.sin(p*2.01)*Math.exp(-t/(decay*.4)))*smooth(t/.002);
  return lp.run(x,cut,.6);});};
 function pad(notes,len,{attack=.3,release=.6,cutoff=()=>1800,q=.8}={}){
  const sides=[];
  for(let side=0;side<2;side++){
   const osc=[],freq=[];
   for(const n of notes)for(const d of [-.0058,0,.0052]){osc.push(saw((random()+1)/2));freq.push(hz(n)*(1+d+(side?.0011:-.0011)));}
   const lp=filter(),norm=1/Math.sqrt(osc.length);let k=0,fc=0;
   sides.push(render(len,t=>{let s=0;for(let j=0;j<osc.length;j++)s+=osc[j](freq[j]);if((k++&31)===0)fc=cutoff(t);
    return lp.run(s*norm,fc,q)*smooth(t/attack)*smooth((len-t)/release);}));
  }
  return sides;
 }
 const placePad=(sides,start,gain,width=.75,send=.3)=>{place(music,sides[0],start,gain,-width,send);place(music,sides[1],start,gain,width,send);};

 // Effects.
 const blip=(f0,len=.14,f1=f0)=>{let ph=0;return render(len,t=>{ph+=TAU*f0*(f1/f0)**Math.min(1,t/(len*.6))/RATE;
  return Math.sin(ph)*smooth(t/.003)*Math.exp(-t/(len/3.2));});};
 const tick=(f,len=.06,noise=.5)=>{const bp=filter();return render(len,t=>{bp.run(random(),f*2,1.4);
  return Math.sin(TAU*f*t)*Math.exp(-t/.012)*smooth(t/.0008)+bp.band*noise*Math.exp(-t/.003);});};
 const wood=f=>{const bp=filter();let ph=0;return render(.18,t=>{ph+=TAU*f*(1+.25*Math.exp(-t/.006))/RATE;bp.run(random(),1200,1.2);
  return(Math.sin(ph)*Math.exp(-t/.06)+.35*Math.sin(ph*2.57)*Math.exp(-t/.03)+.12*Math.sin(ph*4.1)*Math.exp(-t/.015))*smooth(t/.001)+bp.band*.25*Math.exp(-t/.004);});};
 const thud=(f=105,len=.22)=>{const lp=filter();return render(len,t=>{
  return(Math.sin(TAU*f*t*(1+.3*Math.exp(-t/.01)))*Math.exp(-t/.055)+lp.run(random(),850)*.6*Math.exp(-t/.035))*smooth(t/.001);});};
 const whoosh=(len,f0,f1,shape='bell',q=1.3)=>{const bp=filter();return render(len,t=>{const x=t/len;
  bp.run(random(),f0*(f1/f0)**x,q);
  // Every shape is already audible at its first frame.
  const env=smooth(t/.008)*(shape==='rise'?.25*(1-x)+x**2.2:shape==='fall'?(1-x)**2:.35*(1-x)+.65*Math.sin(Math.PI*x)**2);
  return bp.band*env*2;});};
 const air=(len,cut=1400)=>{const lp=filter(),hp=filter();return render(len,t=>{hp.run(lp.run(random(),cut,.6),180);return hp.high*Math.sin(Math.PI*t/len)**2;});};
 const riser=(len,f0,f1)=>{const bp=filter(),lp=filter(),sw=saw();return render(len,t=>{const x=t/len;
  bp.run(random(),f0*(f1/f0)**x,2.2);
  const tone=lp.run(sw(hz(47)*2**(2*x)),900+2400*x,.9);
  return(bp.band*1.6+tone*.22)*x**2*smooth((len-t)/.004);});};
 const rip=len=>{const bp=filter();let gate=1,k=0;return render(len,t=>{if(k++%90===0)gate=.25+.75*Math.abs(random());
  bp.run(random(),2600-1200*t/len,1.5);return bp.band*gate*smooth(t/.004)*Math.exp(-t/(len*.45))*2.4;});};
 const pop=f=>blip(f*1.8,.07,f);
 const swell=(notes,len,peakAt=.35)=>{const lp=filter(),osc=notes.map(()=>saw((random()+1)/2));return render(len,t=>{
  let s=0;notes.forEach((n,j)=>{s+=osc[j](hz(n));});const x=t/len,env=.3*(1-x)+.7*(x<peakAt?(x/peakAt)**1.5:(1-(x-peakAt)/(1-peakAt))**2);
  return lp.run(s/notes.length+random()*.15,600+2600*env,.7)*env*smooth(t/.015);});};
 const reverse=(notes,len)=>{const lp=filter(),osc=notes.map(()=>saw((random()+1)/2));return render(len,t=>{
  let s=0;notes.forEach((n,j)=>{s+=osc[j](hz(n));});const x=t/len;
  return lp.run(s/notes.length+random()*.3,500+4500*x*x,.8)*x**3*smooth((len-t)/.006);});};

 // Arrangement on the exact beat grid (one beat is exactly 22,500 samples).
 const K=kick(),KL=kick({decay:.1,drive:1.4,click:.06}),KH=kick({f0:44,sweep:160,decay:.2,drive:2.2,click:.18});
 const CL=[clap(),clap(),clap()],SN=snare(),SN2=snare(230),HAT=[hat(),hat(.026),hat(),hat(.022)],OH=hat(.11);
 const hit=(data,b,gain,pan=0,send=0)=>place(drums,data,B(b),gain,pan,send);
 const pump=new Float64Array(count).fill(1);
 const duckAt=(b,depth=.32)=>{const s=B(b),n=Math.round(.22*RATE);for(let i=0;i<n&&s+i<count;i++){const v=1-depth*smooth(i/192)*(1-smooth(i/n));if(v<pump[s+i])pump[s+i]=v;}};
 const groove=new Set([3,4,5,6,7,8,9,13,14,17,18,19,20]);
 const riffA=[[0,3],[.75,1],[1.5,2],[2.25,0],[2.5,3],[3.25,2]];
 const riffGather=[[0,0],[.5,2],[1,1],[1.5,3],[2.5,2],[3,1],[3.5,3]];
 for(let bar=3;bar<=20;bar++){
  const s=4*(bar-1),chord=CHORDS[PROGRESSION[bar-1]],upper=chord.notes.slice(-4).map(n=>n+12),root=chord.root;
  const peak=bar>=19,drive=peak?1.1:bar>=17?.92:.9;
  // Kick.
  let kicks=[0,1,2,3];
  if(bar===10)kicks=[0,2];else if(bar===11||bar===12)kicks=[0,2.5];else if(bar===15)kicks=[2.5];else if(bar===16)kicks=[0,2];
  for(const k of kicks){const light=bar>=10&&bar<=12||bar===15||bar===16;hit(light?KL:K,s+k,(light?.7:.92)*drive);duckAt(s+k,light?.18:.32);}
  // Claps and backbeat.
  if(bar>=7&&bar<=9||bar===13||bar===14||peak)for(const k of [1,3])hit(CL[(bar+k)%3],s+k,peak?.42:.36,0,.12);
  if(bar===11||bar===12)hit(CL[bar%3],s+2,.3,0,.15);
  if(bar>=7&&bar<=9||peak)hit(SN,s+3,.12,0,.1);
  // Hats.
  if(groove.has(bar)){
   for(let k=0;k<4;k++)hit(HAT[k],s+k+.5,(.2+random()*.02)*(peak?1.15:1),.18);
   const sixteenths=bar>=7&&bar!==17&&bar!==18;
   if(sixteenths)for(let k=0;k<4;k++)for(const o of [.25,.75])hit(HAT[(k+1)%4],s+k+o+.012,.08+random()*.02,o===.25?-.3:.3);
   if([6,8,14,19,20].includes(bar))hit(OH,s+3.5,.12,-.2,.1);
  }else if(bar===11||bar===12)for(let k=0;k<8;k++)hit(HAT[k%4],s+k*.5+.25,.11+(k%2)*.04,k%2?.35:-.35);
  else if(bar===16)for(const k of [1.5,3.5])hit(HAT[0],s+k,.1,.2,.2);
  // Snare and tom roll accelerating into the montage.
  if(bar===17)for(let k=0;k<4;k++){hit(SN2,s+k,.22+k*.03,0,.1);hit(tom(hz(40+k*2)),s+k,.18,(k-1.5)*.15);}
  if(bar===18){
   for(let k=0;k<4;k++)hit(SN2,s+k*.5,.24+k*.03,0,.1);
   for(let k=0;k<8;k++){const b=s+2+k*.25;hit(SN2,b,.27+k*.025,0,.1);if(k%2)hit(tom(hz(47+k)),b,.16,(k-3.5)*.1);}
  }
  // Bass.
  let bassline=[[0,.45,0],[.75,.4,0],[1.5,.4,12],[2.5,.45,0],[3.25,.4,7]];
  if(bar===10)bassline=[[0,3.6,0]];
  if(bar===11||bar===12)bassline=[[0,.9,0],[1.5,.35,12],[2.5,.5,0],[3.5,.25,12]];
  if(bar===15||bar===16)bassline=[[0,3.7,0]];
  if(bar===17||bar===18)bassline=[0,.5,1,1.5,2,2.5,3,3.5].map((k,i)=>[k,.4,i%2?12:0]);
  if(peak)bassline=[[0,.45,0],[.75,.4,0],[1.5,.4,12],[2,.4,0],[2.5,.45,0],[3.25,.4,7],[3.75,.2,12]];
  for(const [k,len,iv]of bassline)place(bass,bassNote(root+iv,len*beat),B(s+k),bar===15||bar===16||bar===10?.7:peak?.95:.85);
  // Plucks and keys.
  let riff=riffA,pg=.2,len=.2,bright=1;
  if(bar===11||bar===12){riff=riffGather;pg=.13;len=.11;bright=.6;}
  if(bar===15||bar===16){riff=[[0,3],[1.5,2],[3,1]];pg=.16;len=.5;bright=.5;}
  if(bar===17||bar===18){riff=Array.from({length:16},(_,i)=>[i*.25,i%4+(bar===18&&i>=8?4:0)]);pg=.12+(bar-17)*.04;len=.1;}
  if(bar===10)pg=.15;
  for(const [k,idx]of riff){
   const note=upper[idx%4]+12*Math.floor(idx/4);
   place(music,pluck(note,len,bright),B(s+k),pg,Math.sin((s+k)*1.7)*.45,.22,.25);
  }
  if(bar>=7&&bar<=9||bar===13||bar===14||peak)for(const [k,idx]of [[.5,3],[1.5,2],[2.5,3],[3.5,1]])
   place(music,pluck(upper[idx]+12,.12,.45),B(s+k),.07,k%2?.6:-.6,.25,.3);
  // Bar pad, wider and louder in the open bars of the stack.
  if(bar!==10){const open=bar===15||bar===16,sides=pad(chord.notes,4*beat+.5,{attack:.08,release:.5,cutoff:t=>open?900+900*Math.sin(Math.PI*clamp(t/2)):1500});placePad(sides,B(s),open?.11:.07,.8,open?.45:.3);}
 }
 // Bar 10 dark switch: a darker sustained pad that the low-pass dip shapes.
 placePad(pad(CHORDS['B6/9'].notes,4*beat+.4,{attack:.05,release:.4,cutoff:()=>2400}),B(36),.09,.8,.35);

 // Opening swell and bar 2 tension.
 placePad(pad(CHORDS['Emaj9'].notes,4*beat+.6,{attack:1.4,release:.5,cutoff:t=>260+700*smooth(t/1.9)}),0,.12,.85,.4);
 placePad(pad(CHORDS['Amaj9'].notes,4*beat,{attack:.4,release:.01,cutoff:t=>500+2200*smooth(t/1.875)}),B(4),.1,.85,.4);
 place(fx,air(4*beat,1100),0,.085,0,.2);

 // Picture cues.
 const fxAt=(data,frame,gain,pan=0,send=.15,offset=0)=>place(fx,data,S(frame)+offset,gain,pan,send);
 const o=c.open,pl=c.plan,sh=c.shape,ga=c.gather,st=c.stack,mo=c.montage,ti=c.title;
 fxAt(blip(hz(76)),o.eyes[0],.5,-.15);mark('open.eyes',o.eyes[0]);
 fxAt(blip(hz(80)),o.eyes[1],.5,.15);mark('open.eyes',o.eyes[1]);
 fxAt(blip(hz(71),.24,hz(78)),o.smile,.45,0);mark('open.smile',o.smile);
 fxAt(tick(2200,.05,.6),o.badge,.45,.1);fxAt(thud(85,.2),o.badge,.6,0,.05);mark('open.badge',o.badge);
 fxAt(whoosh(.2,500,2600),o.lanyard,.5,[-.4,.2]);fxAt(thud(95,.22),o.lanyard,.6,.1,.05,Math.round(.19*RATE));mark('open.lanyard',o.lanyard);
 {const len=(B(8)-S(o.windup))/RATE;fxAt(riser(len,280,3200),o.windup,.3,0,.2);fxAt(blip(220,.22,330),o.windup,.2,0,.2);
  // Pitch rise on the tonic underneath the riser.
  const sw=saw(),lp=filter();fxAt(render(len,t=>lp.run(sw(hz(52)*2**(t/len)),500+1800*t/len,.9)*(t/len)**1.5),o.windup,.07,0,.15);}
 mark('open.windup',o.windup);
 fxAt(whoosh((B(8)-S(o.dash))/RATE,700,6000,'rise',1.1),o.dash,.32,[-.6,.6],.1);mark('open.dash',o.dash);

 place(drums,impact(1),B(8),.75,0,.1);mark('plan.word',pl.word);
 pl.cards.forEach((f,i)=>{fxAt(tick(hz([76,78,80,83][i]),.06,.4),f,.42,-.3+i*.2);mark('plan.cards',f);});
 fxAt(whoosh(.45,400,1800),pl.push,.8,[.3,-.3]);mark('plan.push',pl.push);
 pl.speakers.forEach((f,i)=>{fxAt(pop([600,760][i]),f,.5,i?.3:-.3);mark('plan.speakers',f);});
 fxAt(blip(900,.12,1700),pl.lift,.4,.2);mark('plan.lift',pl.lift);
 fxAt(wood(190),pl.drop,.6,0,.1);mark('plan.drop',pl.drop);
 fxAt(tick(2400,.04,.6),pl.publish,.35,0);fxAt(bell(83,1.4),pl.publish,.32,.15,.3);mark('plan.publish',pl.publish);
 fxAt(whoosh((B(24)-S(pl.wipe))/RATE,300,6000,'rise',1.2),pl.wipe,.7,[-.7,.7],.15);mark('plan.wipe',pl.wipe);

 sh.styles.forEach((f,i)=>{
  const b=24+2*i;
  STABS[i].forEach((n,j)=>place(music,keys(n,.55,.65,1.2),B(b)+j*120,.13,(j-1.5)*.22,.25,.15));
  STABS[i].forEach((n,j)=>place(music,pluck(n+12,.16,.9),B(b),.05,(j-1.5)*.3,.2));
  mark('shape.styles',f);
 });
 fxAt(tick(1800,.05,.7),sh.dark,.45,0);fxAt(thud(70,.18),sh.dark,.3);mark('shape.dark',sh.dark);
 fxAt(swell([59,63,66,71],.95),sh.wall,.9,0,.35);mark('shape.wall',sh.wall);
 fxAt(whoosh((B(40)-S(sh.exit))/RATE,400,5000,'rise',1.2),sh.exit,.5,[.6,-.6],.15);mark('shape.exit',sh.exit);

 fxAt(thud(120,.2),ga.ticket,.65,0,.08);mark('gather.ticket',ga.ticket);
 ga.steps.forEach((f,i)=>{fxAt(tick(hz([71,73,76,78,80][i]),.05,.35),f,.38,-.4+i*.2);if(i===4)fxAt(bell(92,.6,{index:.5,ratio:2,decay:.2,cut:4500}),f,.18,.4,.25);mark('gather.steps',f);});
 fxAt(rip(.2),ga.tear,.4,.2,.1);mark('gather.tear',ga.tear);
 {const a=S(ga.checkIn[0]),z=S(ga.checkIn[1]),step=B(.25),n=Math.ceil((z-a)/step);
  for(let k=0;k<n;k++)place(fx,tick(2100+(k%4)*90,.035,.3),a+k*step,.1,-.7+1.4*k/Math.max(1,n-1),.05);}
 mark('gather.checkIn',ga.checkIn[0]);
 ga.bookmarks.forEach((f,i)=>{fxAt(wood(820+i*60),f,.32,-.3+i*.3,.1);mark('gather.bookmarks',f);});
 ga.arrivals.forEach((f,i)=>{fxAt(bell([80,83,88][i],1.1,{index:.45,ratio:2,decay:.38,cut:4000}),f,.22,.3-i*.3,.35);mark('gather.arrivals',f);});
 fxAt(whoosh(.4,600,3500),ga.send,.7,[-.5,.5],.15);mark('gather.send',ga.send);
 {const a=S(ga.delivered[0]),z=S(ga.delivered[1]),notes=[83,85,88,90,92];
  for(let k=0;k<11;k++){const at=a+Math.floor((random()+1)/2*(z-a)),pan=random()*.8;
   place(fx,bell(notes[k%5],.7,{index:.3,ratio:2,decay:.2,cut:4000}),k?at:a,.08,pan,.4);}}
 mark('gather.delivered',ga.delivered[0]);

 place(drums,impact(1.4),B(56),.8,0,.15);fxAt(air(2.2,2600),st.explode,.13,0,.3);mark('stack.explode',st.explode);
 st.callouts.forEach((f,i)=>{fxAt(tick(1900+i*120,.04,.4),f,.45,i%2?.35:-.35);mark('stack.callouts',f);});
 st.compress.forEach((f,i)=>{fxAt(wood(hz([47,49,52,54][i])),f,.55,0,.08);mark('stack.compress',f);});
 place(drums,impact(.9),B(68),.7,0,.12);mark('stack.merge',st.merge);
 fxAt(bell(88,.8,{index:.6,ratio:3,decay:.25,cut:5500}),st.line,.26,.2,.25);mark('stack.line',st.line);
 place(fx,riser((B(72)-B(68))/RATE,250,5000),B(68),.3,[-.3,.3],.2);mark('stack.riser',st.riser[0]);

 mo.panels.forEach((f,i)=>{
  const b=72+i,chord=CHORDS[PROGRESSION[i<4?18:19]];
  hit(KH,b,.9);hit(CL[i%3],b,.25,0,.1);hit(tom(hz(43+i)),b,.16,(i-3.5)*.1);
  chord.notes.slice(-4).forEach((n,j)=>place(music,keys(n+12,.3,.75,.8),B(b)+j*90,.075,(j-1.5)*.25,.2));
  place(fx,whoosh(.18,900,5000,'rise',1.2),B(b)-Math.round(.18*RATE),.16,i%2?.4:-.4,.08);
  mark('montage.panels',f);
 });
 place(fx,reverse([59,63,66,71],.4),S(mo.pull)-Math.round(.4*RATE),.35,0,.15);mark('montage.pull',mo.pull);
 {const len=.2,end=B(79.5)-240;const bp=filter();let ph=0;
  place(fx,render(len,t=>{const x=t/len;bp.run(random(),4000*(200/4000)**x,1.4);ph+=TAU*(400*(60/400)**x)/RATE;return(bp.band*1.5+Math.sin(ph)*.4)*Math.sin(Math.PI*x)**1.5;}),end-Math.round(len*RATE),.5,0,.05);}
 mark('montage.implode',mo.implode);

 // Everything stops at beat 79.5; only the title content follows the gap.
 const cut=B(79.5),fade=240;
 for(const b of [music,drums,bass,fx,room,echo])for(const ch of [b.left,b.right]){
  for(let i=cut-fade;i<cut;i++)ch[i]*=smooth((cut-i)/fade);ch.fill(0,cut);
 }
 const title=B(80);
 place(drums,impact(2.2),title,.9,0,.2);
 CHORDS['E6/9'].notes.forEach((n,j)=>place(music,keys(n,4.6,.55,2.8),title+j*360,.055,(j-2.5)*.18,.35));
 placePad(pad(CHORDS['E6/9'].notes.slice(1),7,{attack:.12,release:3.2,cutoff:t=>700+1500*Math.exp(-t/2.5)}),title,.045,.85,.45);
 {const sides=pad([28],4.5,{attack:.01,release:3.4,cutoff:()=>200});place(bass,sides[0],title,.22,0);place(bass,sides[1],title,.22,0);}
 place(bass,bassNote(28,3.5),title,.4,0);
 mark('title.impact',ti.impact);
 fxAt(thud(90,.24),ti.land,.6,0,.1);fxAt(whoosh(.32,1800,700,'fall',1),ti.land,.22,[.0,.5],.15,Math.round(.02*RATE));mark('title.land',ti.land);
 [76,80,83,88,92].forEach((n,k)=>fxAt(bell(n,1.2,{index:.35,ratio:2,decay:.5,cut:4500}),ti.wordmark,.07+k*.012,-.5+k*.25,.5,Math.round(k*beat/3*RATE)));
 fxAt(air(.9,4000),ti.wordmark,.08,0,.3);mark('title.wordmark',ti.wordmark);
 place(music,keys(66,1.2,.45,1.6),S(ti.tagline),.075,-.2,.4);mark('title.tagline',ti.tagline);
 ti.words.forEach((f,i)=>{place(music,keys([68,71,76][i],1,.5,1.6),S(f),.085+i*.008,-.2+i*.2,.4);mark('title.words',f);});
 fxAt(tick(2300,.03,.3),ti.url,.18,.1,.1);mark('title.url',ti.url);
 fxAt(blip(hz(88),.08),ti.blink,.05,0,.1);mark('title.blink',ti.blink);

 // Short stereo room: damped feedback combs into all-pass diffusers. The
 // feedback stays below unity and the state is cleared at the title.
 const wet=bus(1);
 for(const [side,ch]of [[0,'left'],[1,'right']]){
  const src=room[ch],dst=wet[ch];
  [.0233,.0291,.0343,.0401].forEach((sec,j)=>{
   const n=Math.round((sec+side*.0017)*RATE),buf=new Float64Array(n),fb=.76-j*.02;let cur=0,damp=0;
   for(let i=0;i<count;i++){if(i===title){buf.fill(0);damp=0;}const v=buf[cur];damp+=.38*(v-damp);buf[cur]=src[i]+damp*fb;dst[i]+=v*.22;cur=cur+1===n?0:cur+1;}
  });
  for(const sec of [.0051,.0019]){const n=Math.round((sec+side*.0003)*RATE),buf=new Float64Array(n);let cur=0;
   for(let i=0;i<count;i++){if(i===title)buf.fill(0);const x=dst[i],d=buf[cur];dst[i]=d-x*.5;buf[cur]=x+d*.5;cur=cur+1===n?0:cur+1;}}
 }
 // Cross-fed dotted-eighth echo for the plucks; repeats never cross the title.
 const taps=[[B(.75),.32,true],[B(1.5),.14,false]];
 const mix={left:new Float64Array(count),right:new Float64Array(count)};
 // Music bus low-pass: open except for the dark-mode dip in bar 10.
 const cutoff=b=>b<36?19000:b<36.75?19000*(500/19000)**((b-36)/.75):b<38.5?500:b<40?500*(19000/500)**((b-38.5)/1.5):19000;
 const lpL=filter(),lpR=filter(),mL=filter(),mR=filter();
 let pl0=0,pr0=0,dl=0,dr=0;
 const silenceA=S(clock.silence[0]),silenceB=S(clock.silence[1]),last=S(clock.duration-3),fadeOut=S(clock.duration-3-36);
 for(let i=0;i<count;i++){
  const b=i/RATE/beat,fc=Math.round(cutoff(b)),p=pump[i];
  let el=0,er=0;
  for(const [d,g,cross]of taps){const j=i-d;if(j>=0&&(i<title||j>=title)){el+=(cross?echo.right[j]:echo.left[j])*g;er+=(cross?echo.left[j]:echo.right[j])*g;}}
  const ml=lpL.run(music.left[i]+el,fc),mr=lpR.run(music.right[i]+er,fc);
  let l=ml*p+bass.left[i]*p*p+drums.left[i]+fx.left[i]+wet.left[i],r=mr*p+bass.right[i]*p*p+drums.right[i]+fx.right[i]+wet.right[i];
  l=mL.run(l,15000,.6);r=mR.run(r,15000,.6);
  if(i===title){pl0=0;pr0=0;dl=0;dr=0;}
  // DC blocker before the master envelope, so silences stay exact.
  dl=l-pl0+.9985*dl;dr=r-pr0+.9985*dr;pl0=l;pr0=r;
  let gain=smooth(i/S(1));
  if(i>=silenceA&&i<silenceB)gain=0;
  if(i>=fadeOut)gain*=smooth((last-i)/(last-fadeOut));
  if(i>=last)gain=0;
  mix.left[i]=gain?Math.tanh(dl*1.1)/1.1*gain:0;mix.right[i]=gain?Math.tanh(dr*1.1)/1.1*gain:0;
 }
 let peak=0;
 for(let i=0;i<count;i++){if(!Number.isFinite(mix.left[i]+mix.right[i]))throw new Error('Non-finite score');peak=Math.max(peak,Math.abs(mix.left[i]),Math.abs(mix.right[i]));}
 if(peak>.88){const g=.88/peak;for(let i=0;i<count;i++){mix.left[i]*=g;mix.right[i]*=g;}}
 events.sort((a,b)=>a.frame-b.frame||(a.kind<b.kind?-1:a.kind>b.kind?1:0));
 return{left:mix.left,right:mix.right,count,events,...(stems?{stems:{music,drums,bass,fx,wet}}:{})};
}
