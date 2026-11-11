import fs from'node:fs';import path from'node:path';import crypto from'node:crypto';import{spawnSync}from'node:child_process';import{ROOT,REPO,PUBLIC}from'./project.mjs';
import{visualBundle,renderProject,inputDigest,requireFreshRender}from'./provenance.mjs';
import{videosPage}from'./videos-page.mjs';
import{requireCurrentScore}from'./score-provenance.mjs';
import{requireVerifiedExport}from'./export-guard.mjs';
const bundle=await visualBundle();
const analyzerHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'flash.py'))).digest('hex');
if(process.argv.includes('--private-project'))throw new Error('Public exporter refuses private projects');
const out=path.join(REPO,'docs/videos');fs.mkdirSync(out,{recursive:true});
const sections=[];for(const piece of PUBLIC){const players=[];for(const format of ['landscape','vertical']){
 const project=await renderProject(ROOT,piece,format),{clock}=project,digest=inputDigest(ROOT,project,bundle),name=`${piece}-${format}`,source=path.join(ROOT,'out',name+'.mp4'),report=JSON.parse(fs.readFileSync(path.join(ROOT,'review',name+'-verification.json'),'utf8'));
 requireCurrentScore(ROOT,piece,format,clock);
 requireFreshRender(JSON.parse(fs.readFileSync(source.replace('.mp4','.render.json'),'utf8')),digest,clock);
 const hash=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');requireVerifiedExport(report,digest,hash,analyzerHash);
 fs.copyFileSync(source,path.join(out,name+'.mp4'));
 const poster=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String(clock.settle/30),'-i',source,'-frames:v','1',path.join(out,name+'.png')],{encoding:'utf8'});if(poster.status)throw new Error(poster.stderr);
 players.push({format,seconds:clock.duration/30});
 }
 const transcript=fs.readFileSync(path.join(ROOT,piece,'transcript.md'),'utf8');fs.writeFileSync(path.join(out,piece+'-transcript.md'),transcript);
 sections.push({piece,players,transcript});
}
fs.writeFileSync(path.join(out,'index.html'),videosPage(sections));console.log('Exported eight verified public cuts to docs/videos.');
