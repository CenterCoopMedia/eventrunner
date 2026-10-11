import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {build} from 'esbuild';
import {ROOT,REPO,readProject,captureNames} from './project.mjs';

export async function visualBundle(){
 const result=await build({entryPoints:[path.join(ROOT,'bootstrap.ts')],bundle:true,format:'iife',platform:'browser',write:false});
 return result.outputFiles[0].contents;
}
export async function renderProject(root,piece,format){
 const project=await readProject(root,piece,format);
 project.captures=Object.fromEntries(captureNames(project.clock).map(name=>{
  if(!project.captures[name])throw new Error(`Missing capture ${format}/${name}`);
  return[name,project.captures[name]];
 }));
 return project;
}
export function inputDigest(root,project,bundle){
 const files=[...['render.mjs','visual-key.mjs','project.mjs','provenance.mjs','package-lock.json'].map(f=>path.join(ROOT,f)),path.join(REPO,'docs/tokens.css'),path.join(REPO,'docs/favicon.svg'),...fs.readdirSync(path.join(REPO,'docs/fonts')).filter(f=>f.endsWith('.woff2')).sort().map(f=>path.join(REPO,'docs/fonts',f)),...Object.values(project.captures).map(s=>path.join(root,'assets/captures',project.format,s.file)),path.join(root,'assets/audio',`${project.clock.id}-${project.format}.wav`)];
 if(project.logo){if(root===ROOT)throw new Error('Private logo in public project');files.push(path.join(root,project.logo.slice('/private/'.length)));}
 if(project.clock.assembly)for(const f of ['merriweather-700-latin.woff2','fraunces-latin.woff2','public-sans-latin.woff2'])files.push(path.join(REPO,'apps/web/public/fonts',f));
 if(project.identityFont)files.push(path.join(REPO,'apps/web/public/fonts/merriweather-700-latin.woff2'));
 const hash=crypto.createHash('sha256').update('canvas-png-h264-crf19-v4').update(JSON.stringify(project)).update(bundle);
 for(const file of files)hash.update(fs.readFileSync(file));
 return hash.digest('hex');
}
export function requireFreshRender(record,digest,clock){
 if(record.digest!==digest||record.start!==0||record.end!==clock.duration-1)throw new Error('Rendered video is stale or partial; render the current inputs before verifying or exporting');
}
