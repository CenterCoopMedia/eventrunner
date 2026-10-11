import type {Project,Experience,Assembly,Rect} from '../../types';
import {at,mix,mixRect,curve,clamp,selection,graphicRect} from './state';
import {palette as P,label,lines,surface,round,line,bookmark,person,check,orbit,tether,rgba,blend,type Ctx} from './primitives';

// Every visible item below is type, geometry, or a semantic record. No screen
// texture is drawn. The same session IDs survive assembly, theming and saving.
type Session=Experience['sessions'][number];
type Speaker=Experience['speakers'][number];
const artwork=document.createElement('canvas');artwork.width=1200;artwork.height=1000;
const artworkContext=artwork.getContext('2d')!;
const people=(e:Experience,s:Session)=>s.speakerIds.map(id=>e.speakers.find(p=>p.id===id)!);
const first=(e:Experience,s:Session)=>people(e,s)[0];
function opacity(c:Ctx,a:number,fn:()=>void){if(a<=0)return;c.save();c.globalAlpha*=clamp(a);fn();c.restore();}
function frame(c:Ctx,r:Rect,fn:()=>void){c.save();c.translate(r.x,r.y);c.scale(r.width/1160,r.height/780);fn();c.restore();}

function background(c:Ctx,w:number,h:number,f:number,q:Assembly){
 c.fillStyle=P.night;c.fillRect(0,0,w,h);
 const shift=at(f,q.shape,64)-at(f,q.gather,64)*.5,light=c.createRadialGradient(w*.72,h*.5,0,w*.62,h*.45,w*.75);
 light.addColorStop(0,blend('#183c58','#2b344e',shift));light.addColorStop(.65,'#0e2438');light.addColorStop(1,P.night);c.fillStyle=light;c.fillRect(0,0,w,h);
 const a=at(f,0,50)*(1-at(f,q.title-8,50));
 opacity(c,a*.36,()=>{
  orbit(c,{x:w*.66,y:h*.62},w*.50,h*.31,-.38,rgba(P.blue,.27),1,1.2);
  orbit(c,{x:w*.68,y:h*.62},w*.42,h*.23,-.38,rgba(P.blue,.15),1,1.2);
  orbit(c,{x:w*.66,y:h*.62},w*.53,h*.35,-.38,rgba(P.peach,.11),1,1.2);
 });
}

function session(c:Ctx,e:Experience,s:Session,r:Rect,accent:string,{font='Source',selected=0,flat=false,scale=1}:{font?:string;selected?:number;flat?:boolean;scale?:number}={}){
 surface(c,r,{depth:flat?0:7,radius:16});
 c.fillStyle=accent;c.fillRect(r.x,r.y+20,5,r.height-40);
 label(c,s.time+' – '+s.end,r.x+26,r.y+22,25*scale,accent,'Mono',400);
 label(c,s.room,r.x+r.width-235*scale,r.y+22,25*scale,P.ink);
 const size=35*scale;
 lines(c,s.title,{x:r.x+26,y:r.y+61,width:r.width-102,height:r.height-69},size,P.ink,font,700,1.12,true);
 bookmark(c,r.x+r.width-35,r.y+r.height-39,28*scale,selected,accent);
}
function profile(c:Ctx,p:Speaker,r:Rect,accent:string,font='Source',small=false){
 surface(c,r,{depth:8});person(c,p.name,r.x+25,r.y+26,small?52:70,P.peach);
 label(c,'SPEAKER',r.x+(small?93:113),r.y+33,small?18:22,accent,'Mono',400);
 lines(c,p.name,{x:r.x+25,y:r.y+(small?94:123),width:r.width-50,height:small?75:145},small?31:43,P.ink,font,700,1.12,true);
 lines(c,p.role,{x:r.x+25,y:r.y+r.height-89,width:r.width-50,height:72},small?23:28,'#50616c','Source',500,1.2);
}

function parts(c:Ctx,e:Experience,q:Assembly,f:number){
 const s=e.sessions[1],p=first(e,s),join=at(f,q.join-57,57),build=at(f,q.program-22,58);
 const card=mixRect({x:140,y:240,width:900,height:375},{x:140,y:310,width:900,height:190},build);
 opacity(c,at(f,10,44)*(1-build),()=>{
  orbit(c,{x:580,y:419},524,206,-.15,rgba(P.blue,.34),at(f,10,96),2);
  const grow=1-join;
  tether(c,{x:240,y:560},{x:860,y:170},rgba(P.blue,.3),grow,100);
  tether(c,{x:105,y:315},{x:940,y:574},rgba(P.mint,.28),grow,-50);
 });
 opacity(c,at(f,q.join-35,28),()=>surface(c,card,{depth:mix(14,7,build)}));
 opacity(c,build,()=>{
  const offset=(1-build)*95;
  session(c,e,e.sessions[0],{x:140,y:85-offset,width:900,height:190},e.before.accent);
  session(c,e,e.sessions[2],{x:140,y:535+offset,width:900,height:205},e.before.accent);
  line(c,{x:84,y:166},{x:84,y:637},rgba(P.blue,.48),3);
  for(const y of [169,405,635]){c.beginPath();c.arc(84,y,7,0,Math.PI*2);c.fillStyle=P.blue;c.fill();line(c,{x:92,y},{x:126,y},rgba(P.blue,.5),2);}
 });
 const ink=blend(P.paper,P.ink,join),accent=e.before.accent;
 // Independent components move on different arcs and at different depths.
 const titleStart={x:35,y:264},titleEnd={x:166,y:mix(335,369,build)};
 const timeStart={x:65,y:570},timeEnd={x:166,y:mix(270,334,build)};
 const placeStart={x:805,y:550},placeEnd={x:775,y:mix(270,334,build)};
 const speakerStart={x:685,y:73},speakerEnd={x:166,y:mix(514,448,build)};
 const coords=[titleStart,timeStart,placeStart,speakerStart];
 const ends=[titleEnd,timeEnd,placeEnd,speakerEnd];
 for(let i=0;i<4;i++){
  const arrival=at(f,q.arrivals[i]-25,25),t=curve(coords[i],ends[i],join,i===3?70:-30),dy=(1-arrival)*(i%2?80:-80);
  opacity(c,arrival,()=>{
   c.translate(t.x,t.y+dy);const angle=(1-join)*(1-build)*[.028,-.075,.065,-.045][i];c.rotate(angle);c.scale(1+(1-arrival)*.12,1+(1-arrival)*.12);
   if(i===0){
    opacity(c,1-join,()=>label(c,'THE CONVERSATION',0,-39,22,P.muted,'Mono',400));
    lines(c,s.title,{x:0,y:0,width:mix(700,805,join),height:mix(225,mix(150,80,build),join)},mix(mix(77,53,join),35,build),ink,'Bricolage',700,1.08,true);
   }else if(i===1){
    opacity(c,1-join,()=>{surface(c,{x:-25,y:-22,width:300,height:114},{fill:P.blue,depth:12,radius:22});label(c,'THE TIME',0,-61,22,P.muted,'Mono',400);});
    label(c,s.time+(join>.8?' – '+s.end:''),0,0,mix(53,25,join),join>.7?accent:P.ink,'Mono',400);
   }else if(i===2){
    opacity(c,1-join,()=>{surface(c,{x:-23,y:-22,width:320,height:112},{fill:P.mint,depth:12,radius:22});label(c,'THE PLACE',0,-62,22,P.muted,'Mono',400);});
    label(c,s.room,0,0,mix(43,25,join),join>.7?P.ink:P.ink,'Source',600);
   }else{
    opacity(c,1-join,()=>label(c,'THE PEOPLE',0,-39,22,P.muted,'Mono',400));
    const sz=mix(82,32,join);person(c,p.name,0,0,sz,P.peach);
    const names=people(e,s),credit=names.length>2?`${p.name} + ${names.length-1} speakers`:names.map(p=>p.name).join(' + ');
    label(c,join>.92?credit:p.name,sz+18,mix(5,1,join),mix(39,25,join),ink,'Source',600);
    opacity(c,1-join,()=>label(c,p.role,sz+18,55,24,P.muted,'Source',500));
   }
  });
 }
 opacity(c,build,()=>{bookmark(c,1000,467,28,0,accent);});
 opacity(c,at(f,q.join,16)*(1-at(f,q.program-15,20)),()=>{
  c.strokeStyle=rgba(P.mint,.8*(1-at(f,q.join+5,27)));c.lineWidth=2;round(c,{x:card.x-11,y:card.y-11,width:card.width+22,height:card.height+22},26);c.stroke();
 });
}

function miniProgram(c:Ctx,e:Experience,r:Rect,accent:string,font='Source',selectedIds:string[]=[],count=3){
 c.save();c.translate(r.x,r.y);const k=r.width/720;c.scale(k,k);
 label(c,'The program',0,0,42,P.paper,font,700);
 e.sessions.slice(0,count).forEach((s,i)=>session(c,e,s,{x:0,y:77+i*160,width:720,height:144},accent,{font:'Source',selected:selectedIds.includes(s.id)?1:0,scale:.83}));
 c.restore();
}
function styledHeading(c:Ctx,e:Experience,r:Rect,t:number){
 const accent=blend(e.before.accent,e.after.accent,t);
 surface(c,r,{depth:12});label(c,e.dates,r.x+32,r.y+27,26,accent,'Mono',400);
 const box={x:r.x+32,y:r.y+80,width:r.width-65,height:r.height-91};
 opacity(c,1-t,()=>lines(c,e.name,box,59,P.ink,e.before.font,700,1.15,true));
 opacity(c,t,()=>lines(c,e.name,box,59,P.ink,e.after.font,700,1.15,true));
 c.fillStyle=accent;c.fillRect(r.x+32,r.y+r.height-25,r.width-64,5);
}
function shape(c:Ctx,e:Experience,q:Assembly,f:number,discrete=Math.round(f)){
 const enter=at(f,q.shape,44),flow=q.styleFlow.map(t=>at(f,t,25));
 const head={x:0,y:mix(-100,25,enter),width:1130,height:242};
 opacity(c,enter,()=>styledHeading(c,e,head,flow[0]));
 const programRect=mixRect({x:140,y:30,width:900,height:700},{x:0,y:330,width:720,height:420},enter);
 opacity(c,enter,()=>{
  miniProgram(c,e,programRect,blend(e.before.accent,e.after.accent,flow[1]),flow[1]>.5?e.after.font:e.before.font,[],2);
  profile(c,e.speakers[0],{x:790+(1-enter)*100,y:334,width:340,height:394},blend(e.before.accent,e.after.accent,flow[2]),flow[2]>.5?e.after.font:e.before.font);
 });
 opacity(c,1-enter,()=>parts(c,e,q,q.shape-1));
 // A single style source sends a pulse through each component. Text and accent
 // change at the arrival, not at an unrelated scene cut.
 const source={x:600,y:290};
 opacity(c,at(f,q.shape+38,18)*(1-at(f,q.themePublish+18,30)),()=>{
  for(let i=0;i<3;i++){
   const target=[{x:600,y:265},{x:338,y:324},{x:970,y:330}][i];
   tether(c,source,target,rgba(P.blue,.3),1,30);
   const travel=at(f,q.styleFlow[i]-22,22),pos=curve(source,target,travel,35);
   opacity(c,at(f,q.styleFlow[i]-22,5)*(1-at(f,q.styleFlow[i]+3,12)),()=>{c.beginPath();c.arc(pos.x,pos.y,9,0,Math.PI*2);c.fillStyle=P.peach;c.fill();});
  }
 });
 opacity(c,at(f,q.shape+45,20),()=>{
  const bar={x:210,y:mix(804,751,at(f,q.shape+45,32)),width:710,height:68};surface(c,bar,{fill:'#203c52',depth:0,radius:34});
  const published=discrete>=q.themePublish;
  c.beginPath();c.arc(bar.x+35,bar.y+34,11,0,Math.PI*2);c.fillStyle=published?P.mint:P.peach;c.fill();
  label(c,published?'Theme published':`${e.before.name}  →  ${e.after.name}`,bar.x+63,bar.y+19,27,P.paper,'Source',600);
  if(published)check(c,bar.x+bar.width-36,bar.y+34,P.mint,20);
 });
}

function agendaItem(c:Ctx,e:Experience,s:Session,r:Rect,accent:string,alpha=1){
 opacity(c,alpha,()=>{
  const k=r.height/234;
  surface(c,r,{fill:P.paper,depth:8,radius:18});label(c,s.time,r.x+23,r.y+21*k,25*k,accent,'Mono',400);
  bookmark(c,r.x+r.width-31,r.y+33*k,25*k,1,accent);
  lines(c,s.title,{x:r.x+23,y:r.y+65*k,width:r.width-46,height:r.height-107*k},32*k,P.ink,'Source',650,1.1,true);
  label(c,s.room,r.x+23,r.y+r.height-43*k,23*k,'#50616c','Source',500);
 });
}
function gather(c:Ctx,e:Experience,q:Assembly,f:number,vertical=false,discrete=Math.round(f)){
 const enter=at(f,q.gather,43),state=selection(e,q,discrete),accent=e.after.accent;
 const prog=mixRect({x:0,y:330,width:720,height:430},{x:0,y:108,width:655,height:650},enter);
 opacity(c,1-enter,()=>shape(c,e,q,q.gather-1));
 opacity(c,enter,()=>{
  if(vertical){
   label(c,'The program',0,0,43,P.paper,'Source',650);
   e.sessions.slice(0,3).forEach((s,i)=>{
    const y=77+i*108;surface(c,{x:0,y,width:1150,height:92},{depth:5});label(c,s.time,24,y+29,29,accent,'Mono',400);
    lines(c,s.title,{x:183,y:y+27,width:885,height:54},34,P.ink,'Source',650,1.12,true);
    bookmark(c,1112,y+46,29,state.saved.includes(s.id)?1:0,accent);
   });
   label(c,'My schedule',0,461,43,P.paper,'Source',650);
  }else{
   miniProgram(c,e,prog,accent,'Source',state.saved);
   label(c,'My schedule',804,109,41,P.paper,'Source',650);
   label(c,'A day that’s yours.',804,165,26,P.muted,'Source',500);
   line(c,{x:778,y:242},{x:778,y:737},rgba(P.mint,.4),2);
  }
  const targets=vertical?[{x:0,y:546,width:545,height:269},{x:605,y:546,width:545,height:269}]:[{x:808,y:233,width:342,height:234},{x:808,y:499,width:342,height:234}];
  targets.forEach((r,i)=>{
   const press=q.bookmarks[i],s=e.sessions[i+1],p=at(f,press+2,45),show=discrete>=press;
   opacity(c,(1-p)*.65,()=>{round(c,r,18);c.setLineDash([8,11]);c.lineWidth=2;c.strokeStyle=rgba(P.blue,.3);c.stroke();c.setLineDash([]);});
   if(!show)return;
   const sy=vertical?77+(i+1)*108:prog.y+(77+(i+1)*160)*prog.width/720;
   const origin=vertical?{x:0,y:sy,width:1150,height:92}:{x:prog.x,y:sy,width:prog.width,height:144*prog.width/720};
   const moving=mixRect(origin,r,p),pos=curve(origin,r,p,i===0?145:-90);moving.x=pos.x;moving.y=pos.y;
   const from=vertical?{x:1110,y:sy+46}:{x:prog.x+prog.width,y:sy+64},to=vertical?{x:r.x+r.width-32,y:r.y+38}:{x:r.x-23,y:r.y+48};
   opacity(c,1-at(f,press+49,20),()=>tether(c,from,to,P.mint,p,i===0?70:-65));
   c.save();const cx=moving.x+moving.width/2,cy=moving.y+moving.height/2;c.translate(cx,cy);c.rotate(Math.sin(p*Math.PI)*(i===0?-.09:.09));c.translate(-cx,-cy);
   agendaItem(c,e,s,moving,accent,at(f,press,8));c.restore();
   if(!vertical)opacity(c,at(f,press+45,8),()=>{c.beginPath();c.arc(778,r.y+45,8,0,Math.PI*2);c.fillStyle=P.mint;c.fill();});
  });
  if(f>q.bookmarks[1]+55){const a=at(f,q.bookmarks[1]+55,20);opacity(c,a,()=>{const x=vertical?24:826,y=vertical?876:790;check(c,x,y,P.mint,20);label(c,'Saved to your schedule',x+24,y-16,28,P.paper,'Source',500);});}
 });
}

function website(c:Ctx,e:Experience,r:Rect,accent:string){
 surface(c,r,{depth:14,radius:24});c.save();round(c,r,24);c.clip();
 const k=r.width/800;c.translate(r.x,r.y);c.scale(k,k);
 label(c,e.shortName,30,30,35,accent,e.after.font,700);label(c,'Home    Schedule    Speakers',370,38,20,P.ink,'Source',600);
 line(c,{x:30,y:88},{x:770,y:88},'#c9d2d6',1.5);
 label(c,e.dates+'  /  '+e.venue,30,120,21,accent,'Mono',400);
 lines(c,e.headline,{x:30,y:162,width:720,height:170},59,P.ink,e.after.font,700,1.13,true);
 label(c,'Explore the program',30,350,27,accent,'Source',650);
 const rows=e.sessions.slice(0,3);
 rows.forEach((s,i)=>{const y=412+i*105;label(c,s.time,30,y,23,accent,'Mono',400);lines(c,s.title,{x:160,y,width:565,height:82},28,P.ink,'Source',650,1.14,true);line(c,{x:30,y:y+85},{x:770,y:y+85},'#d5dcdf',1);});
 c.restore();
}
function phone(c:Ctx,e:Experience,r:Rect,accent:string){
 surface(c,{...r,x:r.x-10,y:r.y-10,width:r.width+20,height:r.height+20},{fill:'#263e52',depth:12,radius:43});surface(c,r,{fill:P.paper,radius:35});
 c.save();round(c,r,35);c.clip();const k=r.width/322;c.translate(r.x,r.y);c.scale(k,k);
 round(c,{x:111,y:14,width:100,height:10},5);c.fillStyle='#263e52';c.fill();
 label(c,e.shortName,23,55,22,accent,'Source',650);label(c,'My schedule',23,104,33,P.ink,'Source',700);
 e.sessions.slice(1,3).forEach((s,i)=>agendaItem(c,e,s,{x:14,y:175+i*220,width:294,height:209},accent));c.restore();
}
function reveal(c:Ctx,e:Experience,q:Assembly,f:number,vertical=false){
 const t=at(f,q.reveal,61),depart=at(f,q.title-36,52),accent=e.after.accent;
 opacity(c,1-t,()=>gather(c,e,q,q.reveal-1,vertical));
 const r={x:mix(-135,0,t)-depart*130,y:mix(160,40,t)+depart*65,width:mix(670,800,t),height:mix(625,720,t)};
 opacity(c,t*(1-depart),()=>{
  c.save();c.translate(r.x+r.width/2,r.y+r.height/2);c.transform(1,0,-.085*(1-t),1,0,0);c.translate(-r.x-r.width/2,-r.y-r.height/2);website(c,e,r,accent);c.restore();
  const pr={x:mix(808,824,t)+depart*250,y:mix(233,230,t)-depart*80,width:mix(342,310,t),height:mix(500,610,t)};
  phone(c,e,pr,accent);
  const pulse=at(f,q.reveal+38,25);tether(c,{x:738,y:630},{x:810,y:605},rgba(P.mint,.8),pulse,40);
 });
}

export function drawAssembly(c:Ctx,project:Project,mark:HTMLImageElement,f:number,clientLogo:HTMLImageElement|null=null,discrete=Math.round(f)){
 const q=project.clock.assembly!,e=project.experience!,vertical=project.format==='vertical',w=vertical?1080:1920,h=vertical?1920:1080;
 // Freeze all coordinates and illumination at the declared settle frame.
 f=Math.min(f,q.settle);background(c,w,h,f,q);
 const ending=at(f,q.title,30),outgoing=1-at(f,q.title-36,22),captionEnter=at(f,8,32);
 const top=vertical?260:79,left=vertical?84:88;
 opacity(c,outgoing*captionEnter,()=>{
  surface(c,{x:left-4,y:top-4,width:46,height:46},{fill:P.paper,radius:10});c.drawImage(mark,left+3,top+3,32,32);label(c,'EVENT RUNNER',left+55,top+6,27,P.paper,'Source',650);
  if(clientLogo){const width=vertical?220:260,height=width*clientLogo.height/clientLogo.width;surface(c,{x:w-left-width-14,y:top-14,width:width+28,height:height+28},{fill:P.paper,radius:10});c.drawImage(clientLogo,w-left-width,top,width,height);}
  const title=f<129?'Bring the\npieces together.':f<q.shape?'A program.\nWith purpose.':f<q.gather?'Make it feel\nlike your event.':f<q.reveal?'A whole program.\nA personal day.':'One connected\nexperience.';
  const part=f<q.shape?'PLAN':f<q.gather?'SHAPE':f<q.reveal?'GATHER':'EVENT RUNNER';
  const subtitle=f<129?'People. Places. Possibilities.':f<q.shape?'Sessions, speakers, and spaces.':f<q.gather?'Your type. Your color. Your identity.':f<q.reveal?'Save the sessions that matter to you.':'From the first idea to the day itself.';
  const boundary=f<129?0:f<q.shape?129:f<q.gather?q.shape:f<q.reveal?q.gather:q.reveal;
  const entrance=at(f,boundary,25)*(f<129?0:f<q.shape?at(f,143,25):1);
  opacity(c,entrance,()=>{
   const wide=!vertical&&f>=q.shape&&f<q.gather;
   const y=vertical?369:wide?145:291;label(c,part,left,y,24,P.blue,'Mono',400);
   lines(c,wide?title.replace('\n',' '):title,{x:left,y:y+53+(1-entrance)*19,width:vertical?910:wide?1740:562,height:vertical?207:327},vertical?83:wide?72:78,P.paper,'Bricolage',700,1.04);
   if(!wide)lines(c,subtitle,{x:left,y:vertical?608:655,width:vertical?910:490,height:115},vertical?31:32,P.muted,'Source',500,1.25);
  });
  const note=project.privateLabel??'Harborlight Forum · Sample event';
  label(c,note,left,vertical?1505:1008,23,P.muted,'Source',500);
 });
 const graphic=graphicRect(vertical,q,f);
 if(!vertical&&f>=q.shape&&f<q.gather){
  const flow=at(f,q.styleFlow[0]-22,25);
  opacity(c,at(f,q.shape+22,25)*(1-at(f,q.gather-22,22))*(1-ending),()=>{
   opacity(c,1-flow,()=>label(c,'Aa',117,424,208,P.paper,e.before.font,700));
   opacity(c,flow,()=>label(c,'Aa',117,424,208,P.paper,e.after.font,700));
   [e.before.accent,e.after.accent].forEach((col,i)=>{c.beginPath();c.arc(148+i*108,749,30,0,Math.PI*2);c.fillStyle=col;c.fill();c.strokeStyle=rgba(P.paper,.65);c.lineWidth=2;c.stroke();});
   label(c,'Type + color',117,824,32,P.paper,'Source',500);
   tether(c,{x:311,y:750},{x:703,y:550},rgba(P.mint,.5),at(f,q.styleFlow[0]-22,22),120);
  });
 }
 artworkContext.clearRect(0,0,artwork.width,artwork.height);
 if(f<q.shape)parts(artworkContext,e,q,f);
 else if(f<q.gather)shape(artworkContext,e,q,f,discrete);
 else if(f<q.reveal)gather(artworkContext,e,q,f,vertical,discrete);
 else reveal(artworkContext,e,q,f,vertical);
 // Lens softness follows spatial velocity. Large moving glyphs resolve only
 // when they land, avoiding a train of sharp light/dark strokes across a pixel.
 const moves=[[90,50,vertical?0:18],[q.join-57,57,12],[q.program-22,58,11],
  [q.shape,44,14],[q.gather,43,14],...q.bookmarks.map(v=>[v+2,45,8]),[q.reveal,61,13],[q.title-36,52,9]];
 const travel=Math.max(...moves.filter(v=>v[2]>0).map(([start,duration])=>at(f,start-12,12)*(1-at(f,start+duration,12))));
 const blur=Math.max(...moves.map(([start,duration,amount])=>Math.sin(Math.PI*at(f,start,duration))*amount))*.15;
 opacity(c,outgoing*(1-.78*travel),()=>frame(c,graphic,()=>{c.filter=blur>.1?`blur(${blur}px)`:'none';c.drawImage(artwork,0,0);c.filter='none';}));
 if(ending>0){
  const land=at(f,q.title,45),spread=at(f,q.title-14,57);
  opacity(c,ending,()=>{
   // Two open arcs make physical room for the name. No folded page or copied
   // kinetic verb treatment; the last gesture extends the relationship paths.
   orbit(c,{x:w*.5,y:h*.56},mix(w*.2,w*.70,spread),h*.29,-.36,rgba(P.blue,.18),.88,2);
   orbit(c,{x:w*.5,y:h*.56},mix(w*.15,w*.65,spread),h*.245,-.36,rgba(P.mint,.16),.86,2);
   const x=vertical?86:186,y=vertical?448:255;
   surface(c,{x,y,width:88,height:88},{fill:P.paper,radius:22});c.drawImage(mark,x+16,y+16,56,56);
   label(c,'Event Runner',x+112,y+18,vertical?59:65,P.paper,'Bricolage',700);
   lines(c,'Make room\nfor your event.',{x,y:y+167+(1-land)*25,width:vertical?920:1540,height:vertical?340:355},vertical?106:150,P.paper,'Bricolage',700,1.04);
   opacity(c,at(f,q.title+27,25),()=>{
    label(c,'Plan. Shape. Gather.',x,y+(vertical?565:556),vertical?39:41,P.blue,'Source',600);
    label(c,project.privateLabel?'A concept for your community.':'centercoopmedia.github.io/eventrunner',x,y+(vertical?647:633),vertical?29:30,P.muted,'Source',500);
    if(project.privateLabel)label(c,project.privateLabel,x,y+(vertical?713:693),24,P.muted,'Source',500);
   });
  });
 }
}
