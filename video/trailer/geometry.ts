import type {Format,Rect} from '../types';
export type Pose={x:number;y:number;width:number;height:number;rx?:number;ry?:number;rz?:number;z?:number};
export const progress=(f:number,start:number,length:number)=>Math.max(0,Math.min(1,(f-start)/length));
export const smooth=(t:number)=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
export const out=(t:number)=>1-(1-Math.max(0,Math.min(1,t)))**4;
export const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
export function projectPoint(u:number,v:number,p:Pose){
 const ax=(p.rx??0)*Math.PI/180,ay=(p.ry??0)*Math.PI/180,az=(p.rz??0)*Math.PI/180;
 const x=(u-.5)*p.width,y=(v-.5)*p.height;
 const yy=y*Math.cos(ax),z1=y*Math.sin(ax),xx=x*Math.cos(ay)+z1*Math.sin(ay),z=-x*Math.sin(ay)+z1*Math.cos(ay)+(p.z??0);
 const scale=2600/(2600-z);
 return{x:p.x+(xx*Math.cos(az)-yy*Math.sin(az))*scale,y:p.y+(xx*Math.sin(az)+yy*Math.cos(az))*scale};
}
export function studyLayout(format:Format):Record<string,Rect>{
 return format==='vertical'?{
  word:{x:70,y:370,width:940,height:245},
  field:{x:90,y:830,width:900,height:240},
  preview:{x:180,y:710,width:720,height:690},
  title:{x:80,y:600,width:920,height:475},
  tagline:{x:100,y:1160,width:880,height:155},
  footer:{x:80,y:1480,width:920,height:36}
 }:{
  word:{x:110,y:140,width:1700,height:320},
  field:{x:220,y:595,width:1480,height:245},
  preview:{x:300,y:455,width:1320,height:480},
  title:{x:150,y:350,width:1620,height:225},
  tagline:{x:260,y:615,width:1400,height:90},
  footer:{x:80,y:1010,width:1760,height:34}
 };
}
