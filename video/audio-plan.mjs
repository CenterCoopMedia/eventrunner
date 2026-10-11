// Every effect names the visible event that causes it. Frames come from the clock.
export function audioEvents(clock) {
 const events=[];
 for(const scene of clock.scenes){
  if(scene.action)events.push({kind:'click',frame:scene.action.press,scene:scene.id});
  if(scene.typing)for(let character=1;character<=scene.typing.length;character++)events.push({kind:'key',frame:scene.typing.start+character*scene.typing.interval,scene:scene.id,character});
 }
 clock.periods.forEach((frame,index)=>events.push({kind:'period',frame,index}));
 if(clock.kind==='trailer'){
  const seen=new Set();
  for(const scene of clock.scenes)if(scene.word&&!seen.has(scene.word)){seen.add(scene.word);events.push({kind:'transition',frame:scene.start,scene:scene.id});}
  const reveal=clock.scenes.find(s=>s.id.startsWith('reveal'));
  if(reveal)events.push({kind:'reveal',frame:reveal.start,scene:reveal.id});
 }
 const end=clock.scenes.find(s=>s.endCard);
 if(end)events.push({kind:'resolve',frame:end.start,scene:end.id});
 return events.sort((a,b)=>a.frame-b.frame);
}

const smooth=x=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
export function readingGain(clock,frame){
 if(clock.kind!=='tutorial')return 1;
 let activity=0;
 for(const scene of clock.scenes)if(scene.action){const a=scene.action;activity=Math.max(activity,smooth((frame-a.moveStart+9)/9)*(1-smooth((frame-a.press-6)/15)));}
 return .66+.20*activity;
}
export function masterGain(clock,frame){
 const fadeIn=smooth(frame/1.5),fadeOut=1-smooth((frame-(clock.duration-36))/35.999);
 let hush=1;
 if(clock.silence.length){const[start,end]=clock.silence;if(frame>=start-1.5&&frame<start)hush=1-smooth((frame-start+1.5)/1.5);else if(frame>=start&&frame<end)hush=0;else if(frame>=end&&frame<end+.3)hush=smooth((frame-end)/.3);}
 return fadeIn*fadeOut*hush;
}
