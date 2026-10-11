import type {Assembly,Experience,Rect} from '../../types';
export const clamp=(t:number)=>Math.max(0,Math.min(1,t));
export const smooth=(t:number)=>{t=clamp(t);return t*t*t*(t*(t*6-15)+10);};
export const at=(f:number,start:number,duration:number)=>smooth((f-start)/duration);
export const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
export const mixRect=(a:Rect,b:Rect,t:number):Rect=>({x:mix(a.x,b.x,t),y:mix(a.y,b.y,t),width:mix(a.width,b.width,t),height:mix(a.height,b.height,t)});
export function graphicRect(vertical:boolean,q:Assembly,f:number):Rect{
 if(vertical)return{x:72,y:695,width:936,height:629.4};
 const normal={x:680,y:152,width:1140,height:766.55},wide={x:714,y:305,width:996,height:669.72};
 const opening=mixRect(normal,{x:220,y:118,width:1460,height:981.72},1-at(f,90,50));
 if(f<q.shape)return opening;
 if(f<q.gather)return mixRect(normal,wide,at(f,q.shape,44));
 return mixRect(wide,normal,at(f,q.gather,43));
}
export function curve(a:{x:number;y:number},b:{x:number;y:number},t:number,lift=0){return{x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)-Math.sin(Math.PI*t)*lift};}
export function selection(experience:Experience,q:Assembly,f:number){
 const chosen=experience.sessions.slice(1,3);
 return {program:experience.sessions.map(s=>s.id),saved:chosen.filter((_,i)=>f>=q.bookmarks[i]).map(s=>s.id),arrived:chosen.filter((_,i)=>f>=q.bookmarks[i]+47).map(s=>s.id)};
}
export function validateExperience(e:Experience){
 if(e.sessions.length<3)throw new Error('The assembly requires three program sessions');
 const ids=new Set(e.speakers.map(s=>s.id)),sessions=new Set();
 for(const s of e.sessions){if(sessions.has(s.id))throw new Error('Duplicate session');sessions.add(s.id);if(!s.speakerIds.length||s.speakerIds.some(id=>!ids.has(id)))throw new Error('Missing speaker relationship');if(s.end<=s.time)throw new Error('Session ends before it begins');}
}
