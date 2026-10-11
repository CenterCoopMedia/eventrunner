import fs from 'node:fs';import path from 'node:path';import {spawnSync}from'node:child_process';import crypto from'node:crypto';
import {requireCurrentScore} from './score-provenance.mjs';
import {ROOT,options}from'./project.mjs';import {measure}from'./synth.mjs';
import {visualBundle,renderProject,inputDigest,requireFreshRender} from './provenance.mjs';
const bundle=await visualBundle();
const opt=options();for(const piece of opt.pieces)for(const format of opt.format?[opt.format]:['landscape','vertical']){
 const project=await renderProject(opt.root,piece,format),{clock}=project,digest=inputDigest(opt.root,project,bundle),file=path.join(opt.root,'out',`${piece}-${format}.mp4`),review=path.join(opt.root,'review');fs.mkdirSync(review,{recursive:true});
 requireCurrentScore(opt.root,piece,format,clock);
 requireFreshRender(JSON.parse(fs.readFileSync(file.replace('.mp4','.render.json'),'utf8')),digest,clock);
 const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'});if(probe.status)throw new Error(probe.stderr);const data=JSON.parse(probe.stdout),v=data.streams.find(s=>s.codec_type==='video'),a=data.streams.find(s=>s.codec_type==='audio');
 if(v.codec_name!=='h264'||v.pix_fmt!=='yuv420p'||v.avg_frame_rate!=='30/1'||Number(v.nb_frames)!==clock.duration||v.width!==(format==='landscape'?1920:1080)||v.height!==(format==='landscape'?1080:1920)||a.sample_rate!=='48000'||a.channels!==2||a.codec_name!=='aac')throw new Error('Delivery format mismatch');
 if(Math.abs(Number(data.format.duration)-clock.duration/30)>.08)throw new Error('Duration mismatch');
 const loudness=measure(file),target=clock.kind==='trailer'?-16:-19;if(Math.abs(loudness.lufs-target)>.5||loudness.truePeak>-1)throw new Error(`Audio gate failed ${piece} ${format}: ${JSON.stringify(loudness)}`);
 const flashFile=path.join(review,`${piece}-${format}-flash.json`);let flash;
 const analyzerHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'flash.py'))).digest('hex');
 const cached=fs.existsSync(flashFile)?JSON.parse(fs.readFileSync(flashFile,'utf8')):null;
 if(cached?.fileHash===hash&&cached?.analyzerHash===analyzerHash)flash=cached;
 else{console.log('Flash analysis',piece,format);const p=spawnSync('python',[path.join(ROOT,'flash.py'),file,'--output',flashFile],{encoding:'utf8',maxBuffer:16*1024*1024});if(p.status)throw new Error(p.stderr||p.stdout);flash=JSON.parse(fs.readFileSync(flashFile,'utf8'));flash.fileHash=hash;flash.analyzerHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,'flash.py'))).digest('hex');fs.writeFileSync(flashFile,JSON.stringify(flash,null,2));}
 if(!flash.pass)throw new Error('Flash gate failed');
 const report={inputDigest:digest,file:path.basename(file),sha256:hash,format: {width:v.width,height:v.height,fps:v.avg_frame_rate,pixelFormat:v.pix_fmt,codec:v.codec_name,frames:Number(v.nb_frames),duration:Number(data.format.duration)},audio:{target,...loudness},flash};fs.writeFileSync(path.join(review,`${piece}-${format}-verification.json`),JSON.stringify(report,null,2));console.log('Verified',piece,format,loudness.lufs,'LUFS',loudness.truePeak,'dBTP',flash.maxGeneralEpisodeTransitionsInOneSecond,'general transition episodes');
}
