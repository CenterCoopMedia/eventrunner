import path from 'node:path';
import {writeWav} from '../../synth.mjs';
import {compose} from './score.mjs';
export function assemblyScore(clock,raw){
 const score=compose(clock);writeWav(raw,score);return score.arrangement;
}
export const scoreSources=['trailer/assembly/make-score.mjs','trailer/assembly/score.mjs','trailer/assembly/timeline.ts'];
export const sourcePaths=root=>scoreSources.map(f=>path.join(root,f));
