import type {Rect,Shot} from './types';
import {cropFor,fitCrop} from './layout';
import {clamp,pointer} from './motion';
export const colors={ink:'rgb(23 24 26)',paper:'rgb(250 250 249)',muted:'rgb(80 83 89)',blue:'rgb(26 82 150)',night:'rgb(25 26 28)',bright:'rgb(128 178 238)',line:'rgb(218 218 218)'};
// Values are hydrated from the checked-in brand tokens by bootstrap.ts.
export function text(ctx:CanvasRenderingContext2D,value:string,rect:Rect,size:number,color=colors.ink,weight=700,font='Bricolage',lineHeight=1.12){
 ctx.fillStyle=color;ctx.font=`${weight} ${size}px ${font}`;ctx.textBaseline='top';
 const lines:string[]=[];let line='';for(const word of value.split(/\s+/)){const next=line?line+' '+word:word;if(ctx.measureText(next).width>rect.width&&line){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
 if(lines.length*size*lineHeight>rect.height+2)throw new Error(`Text overflow: ${value} (${lines.length} lines in ${rect.height})`);
 for(let i=0;i<lines.length;i++){if(ctx.measureText(lines[i]).width>rect.width+1)throw new Error(`Text width overflow: ${lines[i]}`);ctx.fillText(lines[i],rect.x,rect.y+i*size*lineHeight);}
 return lines;
}
export function round(ctx:CanvasRenderingContext2D,r:Rect,radius=8){ctx.beginPath();ctx.roundRect(r.x,r.y,r.width,r.height,radius);}
export function browser(ctx:CanvasRenderingContext2D,img:HTMLImageElement,shot:Shot,rect:Rect,focus?:string[],cropOverride?:Rect){
 const crop=cropOverride??cropFor(shot,focus),initial=fitCrop(crop,{...rect,height:rect.height-44});
 const width=Math.min(rect.width,Math.max(rect.width*.64,crop.width*initial.scale+48));
 const height=Math.min(rect.height,Math.max(220,crop.height*initial.scale+92));
 rect={x:rect.x+(rect.width-width)/2,y:rect.y+(rect.height-height)/2,width,height};
 ctx.save();ctx.shadowColor='rgb(0 0 0 / 0.16)';ctx.shadowBlur=28;ctx.shadowOffsetY=12;ctx.fillStyle=colors.paper;round(ctx,rect,12);ctx.fill();ctx.shadowColor='transparent';round(ctx,rect,12);ctx.clip();
 const bar=44;ctx.fillStyle=colors.line;ctx.fillRect(rect.x,rect.y,rect.width,bar);
 // The local address is taken from capture metadata; never a substituted production URL.
 const raw=shot.route.replace(/^https?:\/\//,'');const size=rect.width<1000?17:20;
 ctx.fillStyle=colors.muted;ctx.font=`400 ${size}px Mono`;ctx.textBaseline='middle';
 const max=rect.width-65;let url=raw;while(ctx.measureText(url).width>max)url=url.slice(0,-2);if(url!==raw)url+='…';ctx.fillText(url,rect.x+24,rect.y+bar/2);
 const inside={x:rect.x,y:rect.y+bar,width:rect.width,height:rect.height-bar};const fit=fitCrop(crop,inside);
 ctx.fillStyle='white';ctx.fillRect(inside.x,inside.y,inside.width,inside.height);
 ctx.drawImage(img,crop.x*shot.scale,crop.y*shot.scale,crop.width*shot.scale,crop.height*shot.scale,fit.x,fit.y,crop.width*fit.scale,crop.height*fit.scale);
 ctx.restore();return{crop,fit};
}
export function drawPointer(ctx:CanvasRenderingContext2D,box:Rect,fit:{x:number;y:number;scale:number},crop:Rect,frame:number,action:{moveStart:number;moveEnd:number;press:number}){
 if(frame<action.moveStart-8||frame>action.press+18)return;
 const target={x:fit.x+(box.x+box.width*.58-crop.x)*fit.scale,y:fit.y+(box.y+box.height*.6-crop.y)*fit.scale};
 const pos=pointer({x:target.x-100,y:target.y+90},target,(frame-action.moveStart)/(action.moveEnd-action.moveStart));
 ctx.save();ctx.globalAlpha=clamp((frame-action.moveStart+8)/8)*clamp((action.press+18-frame)/8);
 const ring=(frame-action.press)/18;if(ring>=0&&ring<1){ctx.beginPath();ctx.arc(target.x,target.y,10+ring*36,0,Math.PI*2);ctx.strokeStyle=colors.blue;ctx.lineWidth=4;ctx.globalAlpha*=1-ring;ctx.stroke();ctx.globalAlpha=1;}
 ctx.translate(pos.x,pos.y);ctx.rotate(-0.09*Math.sin(Math.PI*clamp((frame-action.moveStart)/(action.moveEnd-action.moveStart))));
 ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(1,35);ctx.lineTo(11,26);ctx.lineTo(19,42);ctx.lineTo(26,38);ctx.lineTo(18,23);ctx.lineTo(31,21);ctx.closePath();ctx.fillStyle=colors.ink;ctx.strokeStyle=colors.paper;ctx.lineWidth=3;ctx.fill();ctx.stroke();ctx.restore();
}
