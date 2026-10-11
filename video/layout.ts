import type {Format,Rect,Shot} from './types';
export const dimensions=(f:Format)=>f==='landscape'?{width:1920,height:1080}:{width:1080,height:1920};
export function tutorialRects(f:Format):Record<string,Rect>{return f==='landscape'?{label:{x:80,y:68,width:1760,height:32},caption:{x:80,y:125,width:1760,height:85},detail:{x:80,y:213,width:1760,height:45},browser:{x:80,y:290,width:1760,height:640},footer:{x:80,y:974,width:1760,height:46}}:{label:{x:80,y:264,width:920,height:34},caption:{x:80,y:325,width:920,height:126},detail:{x:80,y:455,width:920,height:65},browser:{x:80,y:550,width:920,height:880},footer:{x:80,y:1480,width:920,height:44}};}
export function trailerRects(f:Format):Record<string,Rect>{return f==='landscape'?{label:{x:80,y:66,width:1760,height:36},word:{x:80,y:230,width:565,height:210},caption:{x:80,y:490,width:540,height:164},browser:{x:720,y:188,width:1120,height:690},footer:{x:80,y:974,width:1760,height:46}}:{label:{x:80,y:264,width:920,height:36},word:{x:80,y:350,width:920,height:150},caption:{x:80,y:516,width:920,height:110},browser:{x:110,y:674,width:860,height:760},footer:{x:80,y:1480,width:920,height:44}};}
export function endRects(f:Format):Record<string,Rect>{return f==='landscape'?{name:{x:170,y:325,width:1580,height:145},tagline:{x:170,y:505,width:1580,height:90},cta:{x:170,y:690,width:1580,height:110},footer:{x:80,y:974,width:1760,height:46}}:{name:{x:80,y:640,width:920,height:135},tagline:{x:80,y:835,width:920,height:160},cta:{x:80,y:1130,width:920,height:140},footer:{x:80,y:1480,width:920,height:44}};}
export function cropFor(shot:Shot,focus:string[]=shot.focus):Rect{
 const boxes=focus.map(k=>shot.boxes[k]);if(!boxes.length||boxes.some(b=>!b))throw new Error('Missing measured focus');
 for(const box of boxes)if(box.width<=0||box.height<=0||box.x<0||box.y<0||box.x+box.width>shot.viewport.width+.1||box.y+box.height>shot.viewport.height+.1)throw new Error('Measured focus leaves the capture');
 const left=Math.min(...boxes.map(b=>b.x)),right=Math.max(...boxes.map(b=>b.x+b.width)),top=Math.min(...boxes.map(b=>b.y)),bottom=Math.max(...boxes.map(b=>b.y+b.height));
 return{x:Math.max(0,left),y:Math.max(0,top),width:Math.min(shot.viewport.width,right)-Math.max(0,left),height:Math.min(shot.viewport.height,bottom)-Math.max(0,top)};
}
export function fitCrop(crop:Rect,frame:Rect){const scale=Math.min((frame.width-48)/crop.width,(frame.height-48)/crop.height,3);return{scale,x:frame.x+(frame.width-crop.width*scale)/2,y:frame.y+(frame.height-crop.height*scale)/2};}
export function validateRects(rects:Record<string,Rect>,format:Format){
 const {width,height}=dimensions(format),top=format==='vertical'?250:24,bottom=format==='vertical'?1540:height-24;
 for(const [name,r] of Object.entries(rects))if(!Object.values(r).every(Number.isFinite)||r.width<=0||r.height<=0||r.x<24||r.x+r.width>width-24||r.y<top||r.y+r.height>bottom)throw new Error(`Unsafe rectangle: ${name}`);
}
