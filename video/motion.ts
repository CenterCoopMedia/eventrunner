import type {Clock,AssemblyClock} from './types';
export const clamp=(x:number,a=0,b=1)=>Math.max(a,Math.min(b,x));
export const ease=(x:number)=>1-(1-clamp(x))**3;
export function pointer(a:{x:number;y:number},b:{x:number;y:number},t:number){const p=ease(t);return{x:a.x+(b.x-a.x)*p+Math.sin(Math.PI*p)*12,y:a.y+(b.y-a.y)*p-Math.sin(Math.PI*p)*22};}
export function samples(clock:AssemblyClock,frame:number){if(clock.cinematic||clock.assembly)return frame<clock.settle?6:1;return clock.kind==='trailer'&&(frame<84||clock.scenes.some(s=>frame>=s.start&&frame<s.start+36))?4:1;}
export function endPose(clock:Clock,frame:number){const start=clock.scenes.find(s=>s.endCard)?.start??clock.duration-150;return{rise:18*(1-ease((frame-start)/30)),opacity:clamp((frame-start)/18)};}
