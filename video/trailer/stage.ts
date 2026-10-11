import type {Project,Rect} from '../types';
import {captureAt} from '../frame-state';
import {cropFor,dimensions} from '../layout';
import {colors,drawPointer,text} from '../ui';
import {projectPoint,studyLayout,progress,smooth,out,mix,type Pose} from './geometry';

type Ctx=CanvasRenderingContext2D;
const textures=new Map<string,HTMLCanvasElement>();
const blueprints=new WeakMap<HTMLCanvasElement,HTMLCanvasElement>();
export function studyAssets(p:Project,f:number){
 const s=p.clock.scenes.find(s=>f>=s.start&&f<s.end)!;
 const names=[captureAt(s,f),...(s.montage??[])];
 if(f>=60&&f<90)names.push('edit-section');
 return [...new Set(names)];
}
function texture(p:Project,images:Map<string,HTMLImageElement>,name:string,whole=false,noPad=false){
 const key=p.format+'/'+name+'/'+whole+'/'+noPad;if(textures.has(key))return textures.get(key)!;
 const shot=p.captures[name],img=images.get(name);if(!shot||!img)throw new Error('Unloaded study image '+name);
 const crop=whole?{x:0,y:0,...shot.viewport}:cropFor(shot),pad=whole||noPad?0:18;
 const c=document.createElement('canvas');c.width=Math.ceil((crop.width+pad*2)*2);c.height=Math.ceil((crop.height+pad*2)*2);
 const g=c.getContext('2d')!;g.fillStyle='white';g.fillRect(0,0,c.width,c.height);
 g.drawImage(img,crop.x*shot.scale,crop.y*shot.scale,crop.width*shot.scale,crop.height*shot.scale,pad*2,pad*2,crop.width*2,crop.height*2);
 textures.set(key,c);if(textures.size>16)textures.delete(textures.keys().next().value!);return c;
}
function polygon(c:Ctx,points:{x:number;y:number}[]){c.beginPath();points.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();}
function blueprint(img:HTMLCanvasElement){
 if(blueprints.has(img))return blueprints.get(img)!;
 const sheet=document.createElement('canvas');sheet.width=img.width;sheet.height=img.height;
 const g=sheet.getContext('2d')!;g.fillStyle=colors.blue;g.fillRect(0,0,sheet.width,sheet.height);
 // The prototype surface retains the actual page's structure at low contrast.
 // Sharp page text appears only after the camera has stopped.
 g.globalAlpha=.035;g.drawImage(img,0,0);g.globalAlpha=1;
 g.strokeStyle='rgba(128,178,238,.1)';g.lineWidth=3;g.strokeRect(1.5,1.5,sheet.width-3,sheet.height-3);
 blueprints.set(img,sheet);return sheet;
}
function plane(c:Ctx,img:HTMLCanvasElement,p:Pose,alpha=1,blur=0){
 if(alpha<=0)return;
 c.save();c.globalAlpha*=alpha;
 const corners=[[0,0],[1,0],[1,1],[0,1]].map(([u,v])=>projectPoint(u,v,p));
 c.shadowColor='rgba(0,0,0,.42)';c.shadowBlur=48;c.shadowOffsetY=22;c.fillStyle='#07111d';polygon(c,corners);c.fill();c.shadowColor='transparent';
 c.filter=blur>.1?`blur(${blur}px)`:'none';
 if(Math.abs(p.rx??0)+Math.abs(p.ry??0)<.001){c.translate(p.x,p.y);c.rotate((p.rz??0)*Math.PI/180);c.drawImage(img,-p.width/2,-p.height/2,p.width,p.height);c.restore();return;}
 const cols=10,rows=4;
 function triangle(a:number[],b:number[],d:number[]){
  const A=projectPoint(a[0],a[1],p),B=projectPoint(b[0],b[1],p),D=projectPoint(d[0],d[1],p);
  const sx0=a[0]*img.width,sy0=a[1]*img.height,sx1=b[0]*img.width,sy1=b[1]*img.height,sx2=d[0]*img.width,sy2=d[1]*img.height;
  const den=(sx1-sx0)*(sy2-sy0)-(sx2-sx0)*(sy1-sy0);
  const aa=((B.x-A.x)*(sy2-sy0)-(D.x-A.x)*(sy1-sy0))/den;
  const bb=((B.y-A.y)*(sy2-sy0)-(D.y-A.y)*(sy1-sy0))/den;
  const cc=((D.x-A.x)*(sx1-sx0)-(B.x-A.x)*(sx2-sx0))/den;
  const dd=((D.y-A.y)*(sx1-sx0)-(B.y-A.y)*(sx2-sx0))/den;
  c.save();const center={x:(A.x+B.x+D.x)/3,y:(A.y+B.y+D.y)/3};
  polygon(c,[A,B,D].map(q=>{const dx=q.x-center.x,dy=q.y-center.y,length=Math.hypot(dx,dy);return{x:q.x+dx/length*.65,y:q.y+dy/length*.65};}));c.clip();
  c.transform(aa,bb,cc,dd,A.x-aa*sx0-cc*sy0,A.y-bb*sx0-dd*sy0);c.drawImage(img,0,0);c.restore();
 }
 for(let row=0;row<rows;row++)for(let col=0;col<cols;col++){
  const a=[col/cols,row/rows],b=[(col+1)/cols,row/rows],d=[col/cols,(row+1)/rows],e=[(col+1)/cols,(row+1)/rows];triangle(a,b,d);triangle(b,e,d);
 }
 c.filter='none';c.strokeStyle='rgba(250,250,249,.3)';c.lineWidth=1;polygon(c,corners);c.stroke();c.restore();
}
function pageSurface(c:Ctx,img:HTMLCanvasElement,pose:Pose,reality:number,alpha=1,blur=0){
 plane(c,blueprint(img),pose,alpha,blur);
 if(reality>0)plane(c,img,pose,alpha*reality,blur);
}
function backdrop(c:Ctx,w:number,h:number,mode:'dark'|'blue'|'light'){
 c.fillStyle=mode==='light'?colors.paper:mode==='blue'?colors.blue:colors.ink;c.fillRect(0,0,w,h);
 if(mode!=='light'){
  const g=c.createLinearGradient(0,0,w,h);g.addColorStop(0,mode==='blue'?'rgba(128,178,238,.16)':'rgba(26,82,150,.22)');g.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=g;c.fillRect(0,0,w,h);
 }
}
function rule(c:Ctx,x:number,y:number,width:number,alpha=1){
 c.save();c.globalAlpha*=alpha;const g=c.createLinearGradient(x,y,x+width,y);g.addColorStop(0,'rgba(128,178,238,0)');g.addColorStop(.15,colors.bright);g.addColorStop(.5,colors.paper);g.addColorStop(.85,colors.bright);g.addColorStop(1,'rgba(128,178,238,0)');
 c.fillStyle=g;c.shadowColor=colors.bright;c.shadowBlur=18;c.fillRect(x,y,width,3);c.restore();
}
function measuredCard(c:Ctx,p:Project,images:Map<string,HTMLImageElement>,name:string,rect:Rect,f:number,from:number,tilt=0){
 const img=texture(p,images,name),enter=out(progress(f,from,13)),ratio=img.width/img.height;
 const width=Math.min(rect.width,rect.height*ratio),height=width/ratio;
 const pose={x:rect.x+rect.width/2+100*(1-enter),y:rect.y+rect.height/2+30*(1-enter),width,height,ry:tilt*(1-enter),rz:-2*(1-enter)};
 plane(c,img,pose,enter,(1-enter)*2);return{pose,crop:cropFor(p.captures[name]),pad:18};
}
function word(c:Ctx,p:Project,f:number,label:string,start:number,mode:'type'|'frame'|'join'){
 const r=studyLayout(p.format).word,vertical=p.format==='vertical',size=vertical?198:285,light=mode==='frame',ink=light?colors.ink:colors.paper;
 c.save();c.font=`800 ${size}px Bricolage`;c.textBaseline='top';c.fillStyle=ink;
 const total=c.measureText(label).width,origin=vertical?r.x+(r.width-total-48)/2:mode==='type'?110:mode==='frame'?1810-total-48:r.x+(r.width-total-48)/2;
 if(mode==='type'){
  const shown=Math.min(label.length,Math.max(0,Math.floor((f-start)/4)+1));c.fillText(label.slice(0,shown),origin,r.y);
  if(f<start+17){const x=origin+c.measureText(label.slice(0,shown)).width+9;c.fillRect(x,r.y+size*.15,8,size*.76);}
 }else if(mode==='frame'){
  const reveal=smooth(progress(f,start,15));c.save();c.beginPath();c.rect(origin-20,r.y-10,(total+60)*reveal,r.height);c.clip();c.fillText(label,origin,r.y);c.restore();
  c.strokeStyle=colors.blue;c.lineWidth=6;const length=(total+40)*out(progress(f,start,15));c.beginPath();c.moveTo(origin-20,r.y+size+12);c.lineTo(origin-20+length,r.y+size+12);c.stroke();
 }else{
  let x=origin;for(let i=0;i<label.length;i++){const char=label[i],t=out(progress(f,start+i*.6,12));c.save();c.globalAlpha=t;c.fillText(char,x+(i-label.length/2)*58*(1-t),r.y+70*(1-t));c.restore();x+=c.measureText(char).width;}
 }
 const index=label==='Plan'?0:label==='Shape'?1:2;
 if(f>=p.clock.periods[index]){c.fillStyle=light?colors.blue:colors.bright;c.fillText('.',origin+total,r.y);}
 c.restore();
 return {x:origin+total+9,y:r.y+size*.15,width:8,height:size*.76};
}
function pointerOnCard(c:Ctx,p:Project,name:string,card:ReturnType<typeof measuredCard>,f:number){
 const s=p.clock.scenes.find(s=>f>=s.start&&f<s.end)!;if(!s.action||name!==s.capture)return;
 const shot=p.captures[name],{pose,crop,pad}=card,scale=pose.width/(crop.width+pad*2);
 drawPointer(c,shot.boxes[s.action.target],{x:pose.x-pose.width/2+pad*scale,y:pose.y-pose.height/2+pad*scale,scale},crop,f,s.action);
}
export function drawStudy(c:Ctx,p:Project,images:Map<string,HTMLImageElement>,mark:HTMLImageElement,f:number,integer:number){
 const {width:w,height:h}=dimensions(p.format),vertical=p.format==='vertical',r=studyLayout(p.format),q=p.clock.cinematic!;
 const scene=p.clock.scenes.find(s=>integer>=s.start&&integer<s.end)!,name=captureAt(scene,integer);
 f=Math.max(f,scene.start);
 backdrop(c,w,h,f<q.plan||f>=q.gather?'dark':f<q.shape?'blue':'light');
 if(f<q.plan){
  const shot=p.captures['edit-section'],box=cropFor(shot),hero=texture(p,images,'edit-section',false,true),page=texture(p,images,'edit-section',true);
  const pull=smooth(progress(f,q.pullback,q.lands[2]-q.pullback)),open=out(progress(f,12,q.lands[0]-12));
  const reality=smooth(progress(f,q.lands[2],8));
  const heroWidth=vertical?780:1540,finalScale=vertical?Math.min(580/shot.viewport.width,1120/shot.viewport.height):1260/shot.viewport.width;
  const scale=Math.exp(mix(Math.log(heroWidth/box.width),Math.log(finalScale),pull));
  const startY=h*.48+(shot.viewport.height/2-box.y-box.height/2)*scale;
  const cy=mix(startY,vertical?900:535,pull),cx=w/2;
  if(pull>0)pageSurface(c,page,{x:cx,y:cy,width:shot.viewport.width*scale,height:shot.viewport.height*scale},reality,smooth(progress(f,q.lands[1]-8,20)));
  const hx=cx+(box.x+box.width/2-shot.viewport.width/2)*scale,hy=cy+(box.y+box.height/2-shot.viewport.height/2)*scale;
  c.save();c.beginPath();c.rect(0,hy-box.height*scale*open/2,w,Math.max(3,box.height*scale*open));c.clip();pageSurface(c,hero,{x:hx,y:hy,width:box.width*scale,height:box.height*scale,ry:-9*(1-open)},reality,open);c.restore();
  rule(c,hx-box.width*scale/2,hy+box.height*scale*open/2,box.width*scale,1-pull);
  if(f>=82){const t=out(progress(f,82,8));c.fillStyle=colors.blue;c.fillRect(0,h*(1-t),w,h*t);}
 }else if(f<q.shape){
  const caret=word(c,p,integer,'Plan',q.plan,'type');
  const card=measuredCard(c,p,images,name,r.field,f,scene.start===q.plan?q.plan+17:scene.start,-12);pointerOnCard(c,p,name,card,integer);
  if(integer>=q.plan+17&&integer<q.plan+24){
   const t=smooth(progress(f,q.plan+17,7)),field=p.captures[name].boxes.field,{crop,pad,pose}=card;
   const u=(field.x+10-crop.x+pad)/(crop.width+2*pad),v=(field.y+8-crop.y+pad)/(crop.height+2*pad);
   const target=projectPoint(u,v,pose),scale=pose.width/(crop.width+2*pad);
   c.fillStyle=colors.paper;c.fillRect(mix(caret.x,target.x,t),mix(caret.y,target.y,t),mix(caret.width,3*scale,t),mix(caret.height,28*scale,t));
  }
  if(f>=q.shape-9){const t=smooth(progress(f,q.shape-9,9));c.fillStyle=colors.paper;c.fillRect(w*(1-t),0,w*t,h);}
 }else if(f<q.gather){
  word(c,p,integer,'Shape',q.shape,'frame');
  const control=vertical?{x:100,y:700,width:880,height:200}:{x:140,y:530,width:780,height:210};
  if(f<q.preview){const card=measuredCard(c,p,images,name,control,f,q.shape+8,12);pointerOnCard(c,p,name,card,integer);}
  else{
   const t=out(progress(f,q.preview,15));
   if(scene.action&&scene.capture==='theme-publish-hover'){
    const card=measuredCard(c,p,images,name,control,f,scene.start);pointerOnCard(c,p,name,card,integer);
   }else measuredCard(c,p,images,'style-chosen',control,f,q.shape+8);
   const b=texture(p,images,'preview-phone-light');const bh=vertical?500:480,bw=bh*b.width/b.height;
   plane(c,b,{x:vertical?w/2:1410,y:vertical?1190:740,width:bw,height:bh,ry:16*(1-t),rz:4*(1-t)},t,(1-t)*2);
  }
  if(f>=q.gather-9){const t=smooth(progress(f,q.gather-9,9));c.fillStyle=colors.ink;c.fillRect(0,0,w*t,h);}
 }else if(f<q.reveal){
  word(c,p,integer,'Gather',q.gather,'join');
  const card=measuredCard(c,p,images,name,r.field,f,scene.start===q.gather?q.gather+12:scene.start,-8);pointerOnCard(c,p,name,card,integer);
 }else if(f<q.title){
  // The edited hero is the same persistent object as the opening. Pull back
  // from its real measured region until the rest of the actual page surrounds it.
  const shot=p.captures[name],box=cropFor(shot),page=texture(p,images,name,true),hero=texture(p,images,name,false,true);
  const t=smooth(progress(f,q.reveal+12,q.pageLand-q.reveal-12)),fold=smooth(progress(f,q.fold+8,q.title-q.fold-8));
  const reality=smooth(progress(f,q.pageLand,6))*(1-smooth(progress(f,q.fold,8)));
  const firstScale=(vertical?810:1640)/box.width,lastScale=vertical?Math.min(580/shot.viewport.width,1120/shot.viewport.height):1260/shot.viewport.width;
  const scale=Math.exp(mix(Math.log(firstScale),Math.log(lastScale),t));
  const cy=mix(h*.48+(shot.viewport.height/2-box.y-box.height/2)*scale,vertical?900:535,t);
  const pose={x:w/2,y:mix(cy,vertical?1110:592,fold),width:shot.viewport.width*scale,height:shot.viewport.height*scale*(1-.985*fold),rx:-68*fold,ry:0};
  if(t<1)pageSurface(c,hero,{x:w/2+(box.x+box.width/2-shot.viewport.width/2)*scale,y:cy+(box.y+box.height/2-shot.viewport.height/2)*scale,width:box.width*scale,height:box.height*scale},0);
  pageSurface(c,page,pose,reality,t*(1-fold),fold*2);
  rule(c,w*.12,vertical?1110:592,w*.76,fold);
 }else{
  const t=out(progress(f,q.title,22)),rise=85*(1-t);c.save();c.globalAlpha=t;
  const title=r.title;const size=vertical?210:218;c.font=`800 ${size}px Bricolage`;c.fillStyle=colors.paper;c.textBaseline='top';c.textAlign='center';
  if(vertical){c.fillText('Event',w/2,title.y+rise);c.fillText('Runner',w/2,title.y+200+rise);}else c.fillText('Event Runner',w/2,title.y+rise);
  c.textAlign='left';c.restore();
  rule(c,w*.12,vertical?1110:592,w*.76);
  const tag=out(progress(f,q.title+12,16));c.save();c.globalAlpha=tag;const rr={...r.tagline,y:r.tagline.y+15*(1-tag)};c.font=`600 ${vertical?53:58}px Source`;c.fillStyle=colors.paper;c.textBaseline='top';c.textAlign='center';c.fillText('Make room for your event.',w/2,rr.y);c.textAlign='left';
  const logo=vertical?72:64,x=w/2-logo/2,y=vertical?1370:790;c.fillStyle=colors.paper;c.beginPath();c.roundRect(x-12,y-12,logo+24,logo+24,12);c.fill();c.drawImage(mark,x,y,logo,logo);c.restore();
 }
 const light=f>=q.shape&&f<q.gather;
 text(c,'EVENT RUNNER',{x:80,y:vertical?275:58,width:w-160,height:40},vertical?25:23,light?colors.muted:colors.paper,500,'Mono');
 text(c,'Fictional event · Direction study',r.footer,vertical?24:21,light?colors.muted:colors.paper,400,'Mono');
}
