import test from 'node:test';
import assert from 'node:assert/strict';
import {requireVerifiedExport} from '../export-guard.mjs';

test('public export rejects changed movies and obsolete flash evidence',()=>{
 const valid={inputDigest:'scene',sha256:'movie',flash:{fileHash:'movie',analyzerHash:'analyzer',pass:true}};
 requireVerifiedExport(valid,'scene','movie','analyzer');
 for(const mutate of [r=>{r.inputDigest='old'},r=>{r.sha256='other'},r=>{r.flash.fileHash='other'},r=>{r.flash.analyzerHash='old'},r=>{r.flash.pass=false}]){
  const bad=structuredClone(valid);mutate(bad);assert.throws(()=>requireVerifiedExport(bad,'scene','movie','analyzer'));
 }
});
