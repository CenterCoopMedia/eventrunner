// Writes the showreel score: raw mix, -16 LUFS master and a JSON record.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {RATE,writeWav,normalize} from '../synth.mjs';
import {compose} from './score.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const {timeline}=await import(new URL('./timeline.ts',import.meta.url));
const sha256=data=>crypto.createHash('sha256').update(data).digest('hex');
const cache=path.join(root,'.cache'),out=path.join(root,'out');
fs.mkdirSync(cache,{recursive:true});fs.mkdirSync(out,{recursive:true});
const raw=path.join(cache,'showreel-raw.wav'),wav=path.join(out,'showreel.wav');
const score=compose(timeline);
writeWav(raw,score);
const target=-16,{lufs,truePeak,method}=normalize(raw,wav,target);
const record={
 piece:timeline.id,sampleRate:RATE,bits:16,channels:2,samples:score.count,
 clockHash:sha256(JSON.stringify(timeline)),seed:timeline.seed,
 target,lufs,truePeak,method,events:score.events.length,wavSha256:sha256(fs.readFileSync(wav)),
};
fs.writeFileSync(path.join(out,'showreel.score.json'),JSON.stringify(record,null,2)+'\n');
console.log(`showreel: ${lufs} LUFS, ${truePeak} dBTP, ${score.count} samples`);
