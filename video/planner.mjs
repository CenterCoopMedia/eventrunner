import crypto from 'node:crypto';
export const words=text=>(text.match(/\S+/g)??[]).length;
export const readingFrames=text=>Math.ceil(Math.max(2,words(text)/2.6+0.6)*30);
export function plan(script){
  if(script.verticalScenes){const {verticalScenes,...base}=script;plan({...base,scenes:verticalScenes});}
  const clock={...script,fps:30,bpm:120,periods:[],silence:[],kind:'tutorial',settle:script.duration-60};
  const scenes=clock.scenes;
  if(!scenes.length||scenes[0].start!==0||scenes.at(-1).end!==clock.duration)throw new Error('Timeline must fill duration');
  for(let i=0;i<scenes.length;i++){
    const s=scenes[i];if(s.end<=s.start||(i&&s.start!==scenes[i-1].end))throw new Error('Timeline gap/overlap');
    if(s.action&&!(s.start<=s.action.moveStart&&s.action.moveStart<s.action.moveEnd&&s.action.moveEnd<=s.action.press-3&&s.action.press<s.end))throw new Error('Pointer must settle before pressing');
    if(s.typing&&s.typing.start+s.typing.length*s.typing.interval>s.end-60)throw new Error('Typing needs a clean reading hold');
  }
  for(let i=0;i<scenes.length;){let j=i+1;while(j<scenes.length&&scenes[j].caption===scenes[i].caption&&scenes[j].detail===scenes[i].detail)j++;
    if(scenes[j-1].end-scenes[i].start<Math.max(readingFrames(scenes[i].caption),readingFrames(scenes[i].detail??'')))throw new Error('Insufficient reading time');i=j;
  }
  clock.sourceHash=crypto.createHash('sha256').update(JSON.stringify(script)).digest('hex');return clock;
}
