import fs from 'node:fs';
import path from 'node:path';
import {ROOT,REPO,isWithin} from '../project.mjs';

const target=process.argv[2];
if(!target||!path.isAbsolute(target))throw new Error('Pass an absolute external review directory');
fs.mkdirSync(target,{recursive:true});
if(isWithin(target,REPO))throw new Error('Direction-study media must stay outside the checkout');
const config=path.join(target,'project.json');
if(fs.existsSync(config)&&!JSON.parse(fs.readFileSync(config,'utf8')).directionStudy)throw new Error('This directory belongs to another project');
if(!fs.existsSync(config)&&fs.readdirSync(target).length)throw new Error('Use an empty directory or an existing direction study');
for(const folder of ['trailer-study','assets/audio','.cache','review'])fs.mkdirSync(path.join(target,folder),{recursive:true});
const captures=path.join(target,'assets/captures'),source=path.join(ROOT,'assets/captures');
if(fs.existsSync(captures)&&fs.realpathSync(captures)!==fs.realpathSync(source))throw new Error('Study captures must refer to the public fictional fixture');
if(!fs.existsSync(captures))fs.symlinkSync(source,captures,'dir');
fs.writeFileSync(config,JSON.stringify({directionStudy:true},null,2)+'\n');
fs.copyFileSync(new URL('./study-timeline.ts',import.meta.url),path.join(target,'trailer-study/timeline.ts'));
console.log('Prepared fictional direction study:',target);
