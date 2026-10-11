import type {Scene} from './types';

// The integer frame owns discrete UI state, including under motion blur.
export function captureAt(scene:Scene,frame:number):string {
 if(scene.typing&&frame>=scene.typing.start){
  const typing=scene.typing,index=Math.min(typing.length,Math.max(0,Math.floor((frame-typing.start)/typing.interval)));
  if(typing.prefix!=='typing-'&&index===0)return scene.capture;
  return typing.prefix+(typing.prefix==='typing-'?String(index).padStart(2,'0'):index);
 }
 return scene.after&&scene.action&&frame>=scene.action.press+10?scene.after:scene.capture;
}
