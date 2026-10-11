import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {publicExperience} from '../trailer/assembly/experience.mjs';
import {selection,validateExperience,graphicRect} from '../trailer/assembly/state.ts';
import {validateScoreRecord,expectedScoreSources} from '../score-provenance.mjs';
import {ROOT} from '../project.mjs';
import {assemblyTimeline as clock} from '../trailer/assembly/timeline.ts';

test('bookmarks add personal references without removing or reordering public sessions',()=>{
 const e=publicExperience(),q=clock.assembly,program=e.sessions.map(s=>s.id);
 for(let f=0;f<clock.duration;f++){
  const state=selection(e,q,f);assert.deepEqual(state.program,program);
  assert.deepEqual(state.saved,e.sessions.slice(1,3).filter((_,i)=>f>=q.bookmarks[i]).map(s=>s.id));
  assert.deepEqual(state.arrived,e.sessions.slice(1,3).filter((_,i)=>f>=q.bookmarks[i]+47).map(s=>s.id));
 }
});
test('illustrated data rejects broken speaker links and impossible session times',()=>{
 const e=publicExperience();validateExperience(e);
 for(const breakInput of [x=>{x.sessions[1].speakerIds=['nonexistent']},x=>{x.sessions[1].end='08:00'},x=>{x.sessions[1].id=x.sessions[0].id},x=>{x.sessions=[]}]){
  const bad=structuredClone(e);breakInput(bad);assert.throws(()=>validateExperience(bad));
 }
});
test('the illustrated style uses the actual product presets and bundled heading faces',()=>{
 const e=publicExperience();assert.equal(e.before.name,'Institutional');assert.equal(e.before.font,'Merriweather');assert.equal(e.after.font,'Fraunces');
 const preset=JSON.parse(fs.readFileSync(new URL('../../design/tokens/presets/newsroom.json',import.meta.url)));assert.equal(e.after.accent,'#'+preset.palette.light.primary.map(n=>n.toString(16).padStart(2,'0')).join(''));
 assert.ok(e.sessions.find(s=>s.id==='session-listening').speakerIds.length===2);
 assert.ok(clock.assembly.themePublish>Math.max(...clock.assembly.styleFlow));
 assert.ok(clock.assembly.themePublish<clock.assembly.gather);
});
test('tactile sounds match component arrivals, style changes, and both bookmark copies',()=>{
 const q=clock.assembly,r=JSON.parse(fs.readFileSync(new URL('../assets/audio/general-trailer-landscape.json',import.meta.url)));
 const validate=events=>{
  const frames=kind=>events.filter(e=>e.kind===kind).map(e=>e.frame);
  assert.deepEqual(frames('component-arrival'),q.arrivals);
  assert.deepEqual(frames('style-arrival'),q.styleFlow);
  assert.deepEqual(frames('bookmark'),q.bookmarks);
  assert.deepEqual(frames('schedule-arrival'),q.bookmarks.map(f=>f+47));
  assert.deepEqual(frames('assembly-action'),[q.join,q.themePublish]);
 };
 validate(r.arrangement.events);
 const late=structuredClone(r.arrangement.events);late.find(e=>e.kind==='schedule-arrival').frame+=6;
 assert.throws(()=>validate(late),'A late arrival sound must be rejected');
});
test('section cameras keep the outgoing composition at the transition boundary',()=>{
 for(const f of [clock.assembly.shape,clock.assembly.gather]){
  const before=graphicRect(false,clock.assembly,f-1),after=graphicRect(false,clock.assembly,f);
  for(const key of Object.keys(before))assert.ok(Math.abs(before[key]-after[key])<.1,`${key} jumps at ${f}`);
 }
});
test('score freshness rejects a missing assembly dependency even when legacy hashes match',()=>{
 const expected=expectedScoreSources(ROOT,clock.id,clock),record={clock,wavHash:'current',sources:{...expected}};
 validateScoreRecord(record,expected,clock,'current');
 delete record.sources['trailer/assembly/score.mjs'];
 assert.throws(()=>validateScoreRecord(record,expected,clock,'current'),/dependency/);
 record.sources={...expected,'trailer/assembly/make-score.mjs':'old-wrapper'};
 assert.throws(()=>validateScoreRecord(record,expected,clock,'current'),/dependency/);
});
