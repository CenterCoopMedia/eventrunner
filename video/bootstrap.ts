import {captureAt as capture} from './frame-state';
import type {Project,Clock} from './types';
import {dimensions,tutorialRects,trailerRects,endRects,cropFor} from './layout';
import {colors,text,browser,drawPointer} from './ui';
import {clamp,ease,samples,endPose} from './motion';
import {drawStudy,studyAssets} from './trailer/stage';
import {drawAssembly} from './trailer/assembly/stage';
import {validateExperience} from './trailer/assembly/state';
declare global{interface Window{__VIDEO:{load:(project:Project)=>Promise<void>;seek:(frame:number)=>Promise<{key:string;samples:number}>};}}
const canvas=document.querySelector('canvas')!;const ctx=canvas.getContext('2d',{alpha:false})!;
// Reuse one shutter buffer: allocating a full-size canvas on each moving frame
// can exhaust Chromium's graphics memory during a long render.
const shutter=document.createElement('canvas');const shutterContext=shutter.getContext('2d',{alpha:false})!;
let project:Project;const images=new Map<string,HTMLImageElement>();let mark:HTMLImageElement;let clientLogo:HTMLImageElement|null=null;let noise:CanvasPattern|null=null;
const loadImage=async(url:string)=>{const i=new Image();i.src=url;try{await i.decode();}catch{throw new Error('Cannot decode '+url);}return i;};
const active=(clock:Clock,frame:number)=>clock.scenes.find(s=>frame>=s.start&&frame<s.end)??clock.scenes.at(-1)!;

function stage(c:CanvasRenderingContext2D,frame:number,integerFrame:number){
 if(project.clock.assembly){drawAssembly(c,project,mark,frame,clientLogo,integerFrame);return;}
 if(project.clock.cinematic){drawStudy(c,project,images,mark,frame,integerFrame);return;}
 const clock=project.clock,s=active(clock,integerFrame),format=project.format,d=dimensions(format),vertical=format==='vertical',trailer=clock.kind==='trailer';
 const dark=s.theme==='dark',brand=s.theme==='brand';const palette=!s.endCard?project.palette:null;const bg=dark?(palette?.night??colors.night):brand?(palette?.brand??colors.blue):(palette?.paper??colors.paper);const ink=dark||brand?colors.paper:colors.ink;const accent=dark?colors.bright:brand?colors.paper:colors.blue;
 c.fillStyle=bg;c.fillRect(0,0,d.width,d.height);
 const r=trailer?trailerRects(format):tutorialRects(format);
 const footer=project.privateLabel??'Harborlight Forum · Sample event';
 text(c,footer,r.footer,vertical?30:24,dark||brand?colors.paper:colors.muted,400,'Mono');
 if(s.endCard){
  const e=endRects(format);const pose=endPose(clock,frame);c.save();c.globalAlpha=pose.opacity;c.translate(0,pose.rise);
  c.fillStyle=colors.blue;c.fillRect(e.name.x,e.name.y-48,Math.min(e.name.width,vertical?180:280),6);
  const logoSize=vertical?88:116;c.drawImage(mark,e.name.x,e.name.y+8,logoSize,logoSize);
  text(c,'Event Runner',{...e.name,x:e.name.x+logoSize+24,width:e.name.width-logoSize-24},vertical?84:128,colors.ink,800);
  text(c,'Make room for your event.',e.tagline,vertical?66:64,colors.ink,700);
  if(trailer){text(c,project.privateLabel?'Concept preview':'Explore Event Runner.',e.cta,vertical?37:38,colors.blue,600,'Source');if(!project.privateLabel)text(c,'centercoopmedia.github.io/eventrunner',{...e.cta,y:e.cta.y+56,height:52},vertical?27:30,colors.muted,400,'Mono');}
  c.restore();return;
 }
 text(c,trailer?'EVENT RUNNER':`EVENT RUNNER  /  ${s.chapter??'01'}  /  GUIDE`,r.label,vertical?25:26,dark||brand?colors.paper:colors.muted,500,'Mono');
 if(s.montage&&!vertical){
  text(c,s.caption,{x:80,y:158,width:1760,height:110},78,ink,800);
  const gap=32,width=(1760-gap*(s.montage.length-1))/s.montage.length;
  const revealStart=clock.scenes.find(scene=>scene.montage)?.start??s.start;
  s.montage.forEach((name,i)=>{const progress=ease((frame-revealStart-i*6)/24);c.save();c.globalAlpha=progress;browser(c,images.get(name)!,project.captures[name],{x:80+i*(width+gap),y:326+42*(1-progress),width,height:560});c.restore();});
  c.fillStyle=colors.blue;c.fillRect(80,920,1760*ease((frame-revealStart)/36),5);return;
 }
 if(trailer){
  const start=s.word==='Plan'?120:s.word==='Shape'?420:780;const t=frame-start;const period=clock.periods[s.word==='Plan'?0:s.word==='Shape'?1:2];
  if(s.word){
   c.save();let word=s.word;
   if(word==='Plan')word=word.slice(0,Math.max(0,Math.min(4,Math.floor(t/7))));
   if(s.word==='Shape'){c.beginPath();c.rect(r.word.x,r.word.y,r.word.width*ease(t/30),r.word.height);c.clip();}
   if(s.word==='Gather'&&t<30){c.font=`800 ${vertical?132:156}px Bricolage`;const split=c.measureText('Gat').width,offset=12*(1-ease(t/30));text(c,'Gat',{...r.word,x:r.word.x-offset},vertical?132:156,ink,800);text(c,'her',{...r.word,x:r.word.x+split+offset,width:r.word.width-split},vertical?132:156,ink,800);}
   else text(c,word,r.word,vertical?132:156,ink,800);
   if(frame>=period){c.font=`800 ${vertical?132:156}px Bricolage`;const x=c.measureText(s.word).width; text(c,'.',{...r.word,x:r.word.x+x,width:60},vertical?132:156,accent,800);}
   c.restore();
  }else if(s.id==='hook'&&clientLogo){c.fillStyle=colors.paper;c.fillRect(r.word.x,r.word.y,r.word.width,150);const width=Math.min(r.word.width-32,520);c.drawImage(clientLogo,r.word.x+16,r.word.y+16,width,width*clientLogo.height/clientLogo.width);}
  else text(c,s.id==='hook'?'Hello.':'Together.',r.word,vertical?132:105,ink,800);
  text(c,s.caption,r.caption,project.identityFont?42:vertical?49:53,ink,700,project.identityFont??'Bricolage');
  if(s.detail)text(c,s.detail,{...r.caption,y:r.caption.y+r.caption.height+28,height:45},vertical?23:24,ink,400,'Mono');
 }else{
  text(c,s.caption,r.caption,vertical?53:66,colors.ink,700);
  if(s.detail)text(c,s.detail,r.detail,vertical?29:33,colors.muted,400,'Source');
 }
 // One ruled edge carries trailer entrances; type is stationary while sharp.
 const enter=trailer?ease((frame-s.start)/24):1;
 const card={...r.browser,y:r.browser.y+(trailer?32*(1-enter):0)};
 if(trailer){c.fillStyle=accent;c.fillRect(r.word.x,vertical?637:724,(vertical?r.word.width:440)*enter,5);}
 const name=capture(s,integerFrame),shot=project.captures[name];if(!shot)throw new Error('Missing capture '+name);
 const img=images.get(name)!;c.save();c.globalAlpha=trailer?0.88+enter*.12:1;
 if(trailer){const cx=card.x+card.width/2,cy=card.y+card.height/2;c.translate(cx,cy);c.rotate(-.018*(1-enter));c.translate(-cx,-cy);}
 let opening;
 if(trailer&&s.id==='hook'){
  const target=cropFor(shot,s.focus),progress=ease(clamp((frame-12)/66));
  const width=Math.exp(Math.log(shot.viewport.width)*(1-progress)+Math.log(target.width)*progress),height=Math.exp(Math.log(shot.viewport.height)*(1-progress)+Math.log(target.height)*progress);
  opening={x:target.x*progress,y:target.y*progress,width,height};
  c.filter=`blur(${(1-progress)*1.5}px)`;
 }
 const {crop,fit}=browser(c,img,shot,card,s.focus,opening);c.filter='none';c.restore();
 if(s.action&&name===s.capture){const box=shot.boxes[s.action.target];if(!box)throw new Error('Missing pointer target '+name+'/'+s.action.target);drawPointer(c,box,fit,crop,frame,s.action);}
}
function visualKey(frame:number){const c=project.clock,s=active(c,frame);const moving=(c.kind==='trailer'&&frame<s.start+18)||(s.action&&frame>=s.action.moveStart-8&&frame<=s.action.press+18)||(s.endCard&&frame<c.settle);return moving?`f${frame}`:`${s.id}/${capture(s,frame)}/${s.word?(frame>=c.periods[s.word==='Plan'?0:s.word==='Shape'?1:2]):''}`;}
window.__VIDEO={
 async load(p){project=p;const d=dimensions(p.format);canvas.width=d.width;canvas.height=d.height;shutter.width=d.width;shutter.height=d.height;
  await Promise.all([document.fonts.load('800 120px Bricolage'),document.fonts.load('600 40px Source'),document.fonts.load('400 25px Mono'),document.fonts.ready]);
  if(p.identityFont)await document.fonts.load(`700 53px ${p.identityFont}`);
  if(p.clock.assembly){if(!p.experience)throw new Error('Missing illustrated experience');validateExperience(p.experience);await Promise.all(['Merriweather','Fraunces','PublicSans'].map(font=>document.fonts.load(`700 48px ${font}`)));}
  const css=getComputedStyle(document.documentElement);for(const [key,token]of Object.entries({ink:'brand-ink',paper:'brand-surface',muted:'brand-ink-muted',blue:'brand-primary',line:'rule-hairline'})){const val=css.getPropertyValue(`--${token}-rgb`).trim();if(!val)throw new Error('Missing brand token '+token);colors[key as keyof typeof colors]=`rgb(${val})`;}
  mark=await loadImage('/brand/mark.svg');clientLogo=p.logo?await loadImage(p.logo):null;images.clear();
  const grain=document.createElement('canvas');grain.width=128;grain.height=128;const g=grain.getContext('2d')!,data=g.createImageData(128,128);let seed=p.clock.seed;for(let i=0;i<data.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const value=seed>>>24;data.data[i]=data.data[i+1]=data.data[i+2]=value;data.data[i+3]=10;}g.putImageData(data,0,0);noise=ctx.createPattern(grain,'repeat');
 },
 async seek(frame){const scene=active(project.clock,frame),names=project.clock.assembly?[]:project.clock.cinematic?studyAssets(project,frame):scene.montage&&project.format==='landscape'?scene.montage:[capture(scene,frame)];for(const name of names)if(!images.has(name)){images.set(name,await loadImage(project.assetBase+'/'+project.captures[name].file));if(images.size>10)images.delete(images.keys().next().value!);}
  const n=samples(project.clock,frame);if(n===1)stage(ctx,frame,frame);else{ctx.fillStyle='black';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=1/n;for(let i=0;i<n;i++){stage(shutterContext,Math.max(0,frame-.5+(i+.5)/n*.5),frame);ctx.drawImage(shutter,0,0);}ctx.restore();}
  if(noise){ctx.fillStyle=noise;ctx.fillRect(0,0,canvas.width,canvas.height);}return{key:visualKey(frame),samples:n};
 }
};
