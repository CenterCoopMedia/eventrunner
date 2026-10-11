import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Public trailer data shares the fiction fixture and actual product presets.
export function publicExperience(){
 const {fixture}=require('../../capture/fixture.cjs');
 const f=fixture(),preset=name=>JSON.parse(fs.readFileSync(new URL(`../../../design/tokens/presets/${name}.json`,import.meta.url)));
 const civic=preset('civic'),news=preset('newsroom');
 const color=p=>'#'+p.palette.light.primary.map(n=>n.toString(16).padStart(2,'0')).join('');
 return {name:f.config.event.name,shortName:f.config.event.shortName,
  headline:f.content.find(c=>c.id==='hero__title').value,
  dates:f.content.find(c=>c.id==='info__when').value,venue:f.config.event.venue.name,
  sessions:f.sessions.filter(s=>s.dayId==='day-1').map(s=>({id:s.id,title:s.title,time:s.startTime,end:s.endTime,room:s.location,speakerIds:s.speakerIds})),
  speakers:f.speakers.map(s=>({id:s.id,name:s.firstName+' '+s.lastName,role:s.jobTitle,organization:s.organization})),
  before:{name:civic.label,accent:color(civic),font:'Merriweather'},after:{name:news.label,accent:color(news),font:'Fraunces'}};
}
