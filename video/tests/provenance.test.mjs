import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {REPO} from '../project.mjs';
import {inputDigest,requireFreshRender} from '../provenance.mjs';

for(const [family,file] of [
 ['Merriweather','merriweather-700-latin.woff2'],
 ['Fraunces','fraunces-latin.woff2'],
 ['PublicSans','public-sans-latin.woff2'],
]){
 test(`changing private ${family} bytes invalidates a non-assembly render`,t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'video-identity-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'assets/audio'),{recursive:true});
  fs.writeFileSync(path.join(root,'assets/audio/identity-landscape.wav'),'fixed score');
  const project={clock:{id:'identity',duration:30},format:'landscape',captures:{},identityFont:family};
  const bundle=Buffer.from('fixed scene bundle');
  const before=inputDigest(root,project,bundle);
  const record={digest:before,start:0,end:29};
  requireFreshRender(record,before,project.clock);

  // Change only the bytes returned for the selected face, without touching assets.
  const font=path.join(REPO,'apps/web/public/fonts',file),read=fs.readFileSync;
  t.mock.method(fs,'readFileSync',(name,...args)=>{
   const bytes=read(name,...args);
   return name===font?Buffer.concat([bytes,Buffer.from('changed font')]):bytes;
  });
  const after=inputDigest(root,project,bundle);
  assert.notEqual(after,before,'The selected font must participate in the cache key');
  assert.throws(()=>requireFreshRender(record,after,project.clock),/stale/);
 });
}
