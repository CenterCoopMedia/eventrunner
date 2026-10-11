/* global window, document */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {chromium} from '@playwright/test';
import {REPO,options} from './project.mjs';
import {requireCurrentScore} from './score-provenance.mjs';
import {visualKey} from './visual-key.mjs';
import {visualBundle,renderProject,inputDigest} from './provenance.mjs';
const opt=options(),cache=path.join(opt.root,'.cache');fs.mkdirSync(cache,{recursive:true});
const bundle=await visualBundle();fs.writeFileSync(path.join(cache,'bundle.js'),bundle);
const escapeRegExp=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const html=`<!doctype html><html><head><link rel="stylesheet" href="/brand/tokens.css"><style>@font-face{font-family:Bricolage;src:url('/fonts/bricolage-grotesque-latin.woff2');font-weight:700 800}@font-face{font-family:Source;src:url('/fonts/source-sans-3-latin.woff2');font-weight:400 700}@font-face{font-family:Mono;src:url('/fonts/ibm-plex-mono-400-latin.woff2')}@font-face{font-family:Merriweather;src:url('/fonts/merriweather-700-latin.woff2');font-weight:700}@font-face{font-family:Fraunces;src:url('/fonts/fraunces-latin.woff2');font-weight:100 900}@font-face{font-family:PublicSans;src:url('/fonts/public-sans-latin.woff2');font-weight:100 900}body{margin:0}canvas{display:block}</style></head><body><canvas></canvas><script src="/bundle.js"></script></body></html>`;
const server=http.createServer((req,res)=>{
 try{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);let file;
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
  if(pathname==='/bundle.js')file=path.join(cache,'bundle.js');
  else if(pathname==='/brand/tokens.css')file=path.join(REPO,'docs/tokens.css');
  else if(pathname==='/brand/mark.svg')file=path.join(REPO,'docs/favicon.svg');
  else if(pathname.startsWith('/fonts/')){file=path.join(REPO,'docs/fonts',path.basename(pathname));if(!fs.existsSync(file))file=path.join(REPO,'apps/web/public/fonts',path.basename(pathname));}
  else if(pathname.startsWith('/captures/')){file=path.resolve(opt.root,'assets',pathname.slice(1));if(!file.startsWith(path.join(opt.root,'assets/captures')+path.sep))throw new Error('Escaped capture root');}
  else if(pathname.startsWith('/private/')){if(!opt.privateRoot)throw new Error('Private inputs forbidden');file=path.resolve(opt.root,pathname.slice(9));if(!file.startsWith(opt.root+path.sep))throw new Error('Escaped private root');}
  else throw new Error('Unknown input');
  res.setHeader('Content-Type',({'js':'application/javascript','css':'text/css','svg':'image/svg+xml','png':'image/png','woff2':'font/woff2'})[path.extname(file).slice(1)]??'application/octet-stream');res.end(fs.readFileSync(file));
 }catch{res.statusCode=404;res.end('Not found');}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({chromiumSandbox:true});
async function ffmpeg(args){await new Promise((resolve,reject)=>{const p=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(new Error(`ffmpeg ${code}`)));});}
try{for(const piece of opt.pieces){for(const format of opt.format?[opt.format]:['landscape','vertical']){
 const project=await renderProject(opt.root,piece,format);if(!opt.stills)requireCurrentScore(opt.root,piece,format,project.clock);
 const width=format==='landscape'?1920:1080,height=format==='landscape'?1080:1920;
 const digest=inputDigest(opt.root,project,bundle);const framesDir=path.join(cache,'frames',digest+(opt.frames?'-'+opt.frames:''));fs.mkdirSync(framesDir,{recursive:true});
 const output=path.join(opt.root,'out'),review=path.join(opt.root,'review');fs.mkdirSync(output,{recursive:true});fs.mkdirSync(review,{recursive:true});
 const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,colorScheme:'light',serviceWorkers:'block'});await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 const page=await context.newPage();page.on('pageerror',e=>console.error(e.message));await page.goto(origin);await page.waitForFunction(()=>!!window.__VIDEO);await page.evaluate(p=>window.__VIDEO.load(p),project);
 const [start,end]=opt.frames?opt.frames.split('-').map(Number):[0,project.clock.duration-1];
 if(start<0||end>=project.clock.duration||end<start)throw new Error('Invalid frame range');
 if(opt.stills){const stillPattern=new RegExp(`^${escapeRegExp(piece)}-${escapeRegExp(format)}-[0-9]+\\.png$`);for(const name of fs.readdirSync(review))if(stillPattern.test(name))fs.unlinkSync(path.join(review,name));const frames=[...new Set([...project.clock.scenes.flatMap(s=>[s.start,Math.min(s.end-1,s.start+75),...(project.clock.cinematic||project.clock.assembly?[Math.floor((s.start+s.end)/2),...(s.action?[s.action.press,s.action.press+11]:[])]:[]),s.end-1]),project.clock.settle,project.clock.duration-1])].sort((a,b)=>a-b);
  for(const f of frames){await page.evaluate(f=>window.__VIDEO.seek(f),f);await page.screenshot({path:path.join(review,`${piece}-${format}-${String(f).padStart(4,'0')}.png`)});}
  console.log('Stills',piece,format,frames.length);await context.close();continue;
 }
 const used=new Map();let unique=0;const started=Date.now();
 for(let f=start;f<=end;f++){
  const key=visualKey(project.clock,f);const number=String(f-start).padStart(6,'0');const file=path.join(framesDir,`${number}.png`);
  if(!fs.existsSync(file)){if(used.has(key))fs.linkSync(used.get(key),file);else{const png=await page.evaluate(async f=>{await window.__VIDEO.seek(f);return document.querySelector('canvas').toDataURL('image/png').split(',')[1];},f);fs.writeFileSync(file,Buffer.from(png,'base64'));unique++;}}
  used.set(key,file);if((f-start)%300===0)console.log('Frames',piece,format,f,`unique ${unique}`,`${Math.round((Date.now()-started)/1000)}s`);
 }
 await context.close();const suffix=opt.frames?`-${start}-${end}`:'';const final=path.join(output,`${piece}-${format}${suffix}.mp4`);const wav=path.join(opt.root,'assets/audio',`${piece}-${format}.wav`);
 const args=['-framerate','30','-i',path.join(framesDir,'%06d.png'),'-ss',String(start/30),'-i',wav];
 args.push('-frames:v',String(end-start+1),'-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-r','30','-threads','3');
 args.push('-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-t',String((end-start+1)/30));args.push('-movflags','+faststart',final);await ffmpeg(args);
 await page.close().catch(()=>{});
 fs.writeFileSync(path.join(output,`${piece}-${format}${suffix}.render.json`),JSON.stringify({piece,format,dimensions:{width,height},fps:30,frames:end-start+1,start,end,digest,uniqueFrames:used.size,scoreHash:fs.existsSync(wav)?crypto.createHash('sha256').update(fs.readFileSync(wav)).digest('hex'):null,renderer:'Playwright canvas / FFmpeg',workers:1},null,2));
 console.log('Rendered',final);
}}}finally{await browser.close();await new Promise(r=>server.close(r));}
