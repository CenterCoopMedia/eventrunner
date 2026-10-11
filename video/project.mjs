import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {publicExperience} from './trailer/assembly/experience.mjs';
export const ROOT=path.dirname(fileURLToPath(import.meta.url));
export const REPO=path.resolve(ROOT,'..');
export const PUBLIC=Object.freeze(['general-trailer','publish-page','save-schedule','change-style']);
export const formats=['landscape','vertical'];
export function isWithin(candidate,root){const real=p=>fs.realpathSync(p);const a=real(candidate),b=real(root);return a===b||a.startsWith(b+path.sep);}
export function options(args=process.argv.slice(2)){
 const value=k=>args.includes(k)?args[args.indexOf(k)+1]:null;
 const privateRoot=value('--private-project');if(privateRoot&&isWithin(path.resolve(privateRoot),REPO))throw new Error('Private project must stay outside repository');
 const root=privateRoot?path.resolve(privateRoot):ROOT;const piece=value('--piece');
 if(!privateRoot&&piece&&!PUBLIC.includes(piece))throw new Error('Piece is not on public allowlist');
 return{root,privateRoot,pieces:piece?[piece]:PUBLIC,both:args.includes('--both'),format:value('--format'),stills:args.includes('--stills'),frames:value('--frames')};
}
export async function readProject(root,piece,format){
 if(!/^[a-z0-9-]+$/.test(piece))throw new Error('Invalid piece');
 const {timeline}=await import(pathToFileURL(path.join(root,piece,'timeline.ts')).href);
 const {verticalScenes,...base}=timeline;const clock={...base,scenes:format==='vertical'&&verticalScenes?verticalScenes:base.scenes};
 const captures=JSON.parse(fs.readFileSync(path.join(root,'assets/captures',format,'boxes.json'),'utf8'));
 const configFile=path.join(root,'project.json'),config=fs.existsSync(configFile)?JSON.parse(fs.readFileSync(configFile,'utf8')):{};
 return{clock,format,captures,assetBase:'/captures/'+format,...(clock.assembly&&root===ROOT?{experience:publicExperience()}:{}),...config};
}
export function captureNames(clock){const names=new Set();for(const s of clock.scenes){if(s.capture)names.add(s.capture);for(const n of s.montage??[])names.add(n);if(s.after)names.add(s.after);if(s.typing)for(let i=s.typing.prefix==='typing-'?0:1;i<=s.typing.length;i++)names.add(s.typing.prefix+(s.typing.prefix==='typing-'?String(i).padStart(2,'0'):i));}return[...names];}
