import type {Rect} from '../../types';
import {clamp,mix} from './state';
export type Ctx=CanvasRenderingContext2D;
export const palette={night:'#091725',mid:'#142d44',paper:'#f7f5ef',ink:'#142738',muted:'#aebfc9',blue:'#8cbefe',mint:'#a8e2d0',peach:'#f3b893',rule:'#31495e'};
export function rgba(hex:string,a:number){return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${clamp(a)})`;}
export function blend(a:string,b:string,t:number){return '#'+[1,3,5].map(i=>Math.round(mix(parseInt(a.slice(i,i+2),16),parseInt(b.slice(i,i+2),16),clamp(t))).toString(16).padStart(2,'0')).join('');}
export function round(c:Ctx,r:Rect,radius=18){c.beginPath();c.roundRect(r.x,r.y,r.width,r.height,Math.min(radius,r.width/2,r.height/2));}
export function surface(c:Ctx,r:Rect,{fill=palette.paper,radius=18,depth=0,alpha=1}:{fill?:string;radius?:number;depth?:number;alpha?:number}={}){
 c.save();c.globalAlpha*=clamp(alpha);
 if(depth){round(c,{...r,y:r.y+depth},radius);c.fillStyle='#263f54';c.fill();}
 const grad=c.createLinearGradient(r.x,r.y,r.x+r.width,r.y+r.height);grad.addColorStop(0,fill);grad.addColorStop(1,blend(fill,'#a6becf',.055));round(c,r,radius);c.fillStyle=grad;c.fill();c.restore();
}
export function label(c:Ctx,value:string,x:number,y:number,size=26,color=palette.ink,font='Source',weight=600){c.font=`${weight} ${size}px ${font}`;c.fillStyle=color;c.textBaseline='top';c.fillText(value,x,y);}
export function lines(c:Ctx,value:string,r:Rect,size:number,color=palette.ink,font='Bricolage',weight=700,leading=1.14,fit=false):number{
 c.font=`${weight} ${size}px ${font}`;const rows:string[]=[];
 for(const para of value.split('\n')){let row='';for(const word of para.split(' ')){const next=row?row+' '+word:word;if(row&&c.measureText(next).width>r.width){rows.push(row);row=word;}else row=next;}rows.push(row);}
 if(rows.length*size*leading>r.height+1){if(fit&&size>18)return lines(c,value,r,size-1,color,font,weight,leading,true);throw new Error(`Illustrated text overflows: ${value} (${rows.length} × ${size} in ${r.height})`);}
 rows.forEach((row,i)=>label(c,row,r.x,r.y+i*size*leading,size,color,font,weight));return rows.length*size*leading;
}
export function line(c:Ctx,a:{x:number;y:number},b:{x:number;y:number},color:string,width=2){c.beginPath();c.moveTo(a.x,a.y);c.lineTo(b.x,b.y);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
export function bookmark(c:Ctx,x:number,y:number,size:number,fill:number,color:string){c.save();c.translate(x,y);c.lineJoin='round';c.lineWidth=2.8;c.beginPath();c.moveTo(-size*.32,-size*.45);c.lineTo(size*.32,-size*.45);c.lineTo(size*.32,size*.45);c.lineTo(0,size*.22);c.lineTo(-size*.32,size*.45);c.closePath();c.strokeStyle=color;c.stroke();c.globalAlpha*=clamp(fill);c.fillStyle=color;c.fill();c.restore();}
export function person(c:Ctx,name:string,x:number,y:number,size=48,color=palette.peach){c.beginPath();c.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);c.fillStyle=color;c.fill();const initials=name.split(' ').map(n=>n[0]).slice(0,2).join('');c.font=`700 ${size*.34}px Source`;c.textAlign='center';c.textBaseline='middle';c.fillStyle=palette.ink;c.fillText(initials,x+size/2,y+size/2);c.textAlign='left';c.textBaseline='top';}
export function check(c:Ctx,x:number,y:number,color:string,size=18){c.strokeStyle=color;c.lineWidth=3.5;c.lineCap='round';c.beginPath();c.moveTo(x-size*.4,y);c.lineTo(x-size*.08,y+size*.3);c.lineTo(x+size*.48,y-size*.4);c.stroke();}
export function orbit(c:Ctx,center:{x:number;y:number},rx:number,ry:number,rotation:number,color:string,progress=1,width=2){c.save();c.translate(center.x,center.y);c.rotate(rotation);c.beginPath();c.ellipse(0,0,rx,ry,0,-Math.PI*.7,-Math.PI*.7+Math.PI*2*clamp(progress));c.strokeStyle=color;c.lineWidth=width;c.stroke();c.restore();}
export function tether(c:Ctx,a:{x:number;y:number},b:{x:number;y:number},color:string,p=1,bend=70){c.beginPath();c.moveTo(a.x,a.y);const end={x:mix(a.x,b.x,p),y:mix(a.y,b.y,p)};c.bezierCurveTo(a.x+(end.x-a.x)*.42,a.y-bend,end.x-(end.x-a.x)*.15,end.y+bend*.35,end.x,end.y);c.strokeStyle=color;c.lineWidth=2.5;c.stroke();}
