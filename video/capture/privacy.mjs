/* global document, window, Element, NodeFilter, HTMLInputElement, HTMLTextAreaElement, getComputedStyle */
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {DEMO_SPEAKERS}=require('../../scripts/lib/demo-event.cjs');
export const knownNames=Object.freeze([...new Set([...DEMO_SPEAKERS.map(s=>`${s.firstName} ${s.lastName}`),'Catherine Komp','Joe Amditis'])]);
export const replacements=Object.fromEntries(knownNames.map((n,i)=>[n,`Sample participant ${i+1}`]));
export function isLoopback(url) {
  const u=new URL(url);
  return ['http:','https:','ws:','wss:'].includes(u.protocol)&&['127.0.0.1','localhost','[::1]'].includes(u.hostname);
}
export async function secureContext(context,{canonicalRoot=null}={}) {
  const blocked=[];
  await context.addInitScript(()=>{const original=Element.prototype.attachShadow;window.__videoClosedShadows=0;Element.prototype.attachShadow=function(options){if(options.mode==='closed')window.__videoClosedShadows++;return original.call(this,options);};});
  await context.route('**/*',async route=>{
    const url=route.request().url();
    if(isLoopback(url))return route.continue();
    if(canonicalRoot&&url.startsWith('https://centercoopmedia.github.io/eventrunner/demo/')){
      const {readFile}=await import('node:fs/promises');const path=await import('node:path');
      const relative=decodeURIComponent(new URL(url).pathname.slice('/eventrunner/demo/'.length));
      const resolved=path.resolve(canonicalRoot,relative);
      if(!resolved.startsWith(path.resolve(canonicalRoot)+path.sep))throw new Error('Asset escaped local root');
      try{return await route.fulfill({body:await readFile(resolved)});}catch{/* fail closed */}
    }
    blocked.push(url);return route.abort('blockedbyclient');
  });
  if(context.routeWebSocket)await context.routeWebSocket(/.*/,ws=>{if(isLoopback(ws.url()))ws.connectToServer();else{blocked.push(ws.url());ws.close();}});
  return blocked;
}
export async function sanitize(page,{allowNames=[],publicFixture=true,allowedImages=[]}={}) {
  const forbidden=knownNames.filter(n=>!allowNames.includes(n));
  for(const frame of page.frames()){
    if(frame!==page.mainFrame()&&!isLoopback(frame.url())&&!frame.url().startsWith('about:'))throw new Error('Inaccessible external frame');
    await frame.evaluate(({forbidden,replacements})=>{
      if(window.__videoClosedShadows)throw new Error('Privacy guard refused inaccessible closed shadow root');
      const replace=s=>forbidden.reduce((v,n)=>v.replaceAll(n,replacements[n]),s);
      const walk=root=>{
        const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
        while(walker.nextNode()){
          const n=walker.currentNode;
          if(!['SCRIPT','STYLE'].includes(n.parentElement?.tagName))n.textContent=replace(n.textContent??'');
        }
        for(const e of root.querySelectorAll('*')){
          if(['SCRIPT','STYLE'].includes(e.tagName))continue;
          for(const a of [...e.attributes])if(['title','alt','aria-label','placeholder','value','data-name'].includes(a.name))e.setAttribute(a.name,replace(a.value));
          if(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement)e.value=replace(e.value);
          if(e.shadowRoot)walk(e.shadowRoot);
        }
      };walk(document);
    },{forbidden,replacements});
    const remaining=await frame.evaluate(({forbidden,publicFixture,allowedImages})=>{
      const values=[],unapproved=[];
      function checkImage(value){const source=new URL(value,document.baseURI);if(!['http:','https:'].includes(source.protocol)||!allowedImages.includes(source.pathname))unapproved.push('unapproved image');}
      function scan(root){
        values.push(root.textContent??'');
        for(const e of root.querySelectorAll('*')){
          if(['SCRIPT','STYLE'].includes(e.tagName))continue;
          values.push(...[...e.attributes].map(a=>a.value));
          if(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement)values.push(e.value);
          if(e.tagName==='IMG'&&e.complete&&e.naturalWidth)checkImage(e.currentSrc);
          if(e.tagName.toLowerCase()==='image'&&e.getAttribute('href'))checkImage(e.getAttribute('href'));
          for(const match of getComputedStyle(e).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g))checkImage(match[1]);
          if(e.shadowRoot)scan(e.shadowRoot);
        }
      }scan(document.body);
      const all=values.join('\n');const found=forbidden.filter(n=>all.toLowerCase().includes(n.toLowerCase()));
      if(publicFixture&&/NC Local|NC News & Information|nclocal|Catherine Komp/i.test(all))found.push('historical fixture contamination');
      return [...found,...unapproved];
    },{forbidden,publicFixture,allowedImages});
    if(remaining.length)throw new Error(`Privacy guard refused capture: ${remaining.join(', ')}`);
  }
}
