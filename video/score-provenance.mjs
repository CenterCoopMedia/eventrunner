import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT} from './project.mjs';
import {sourcePaths} from './trailer/assembly/make-score.mjs';
export const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function expectedScoreSources(root,piece,clock){
 const timeline=path.join(root,piece,'timeline.ts');
 const files=['synth.mjs','make-score.mjs','audio-plan.mjs','score-provenance.mjs'].map(f=>path.join(ROOT,f));
 files.push(timeline,...(clock.assembly?sourcePaths(ROOT):[]));
 return Object.fromEntries(files.map(f=>[f===timeline?'timeline.ts':path.relative(ROOT,f),hash(f)]));
}
export function validateScoreRecord(record,expected,clock,wavHash){
 if(JSON.stringify(record.clock)!==JSON.stringify(clock)||record.wavHash!==wavHash)throw new Error('Score clock or WAV is stale; rebuild the score');
 if(Object.keys(record.sources).length!==Object.keys(expected).length||Object.entries(expected).some(([key,value])=>record.sources[key]!==value))throw new Error('Score source dependency is stale or missing; rebuild the score');
}
export function requireCurrentScore(root,piece,format,clock){
 const wav=path.join(root,'assets/audio',`${piece}-${format}.wav`);
 const record=JSON.parse(fs.readFileSync(wav.replace('.wav','.json'),'utf8'));
 validateScoreRecord(record,expectedScoreSources(root,piece,clock),clock,hash(wav));
}
