'use strict';
const { buildConfigDocs } = require('../../scripts/lib/answers.cjs');
const { defaultPages, buildSeedContent } = require('../../scripts/lib/seed.cjs');
const { buildPublicSpeaker } = require('shared/speaker');

const FROZEN = '2026-10-11T12:00:00.000Z';
const tierA = { slug: 'video-fixture', projectId: 'demo-run-of-show', region: 'us-central1', publicUrl: 'http://127.0.0.1:5173', storageBucket: 'demo-run-of-show.appspot.com', allowedOrigins: ['http://127.0.0.1:5173'], emailProvider: 'console', ticketingProvider: 'manual', operatorNotifier: 'none' };
const answers = {
  adminEmails: ['avery@example.test'],
  event: {
    name: 'Harborlight Forum', shortName: 'Harborlight', tagline: 'Ideas become shared work.', timezone: 'America/New_York',
    days: [{ id: 'day-1', label: 'Day one', date: '2027-05-13', startTime: '09:00', endTime: '17:00' }, { id: 'day-2', label: 'Day two', date: '2027-05-14', startTime: '09:00', endTime: '16:00' }],
    tracks: [{ letter: 'A', name: 'Listening' }, { letter: 'B', name: 'Making' }],
    venue: { name: 'Harbor Hall', city: 'Example City', places: [{id:'studio',name:'The Studio',floor:null},{id:'forum',name:'The Forum',floor:null}] },
    sender: { email: 'hello@example.test', name: 'Harborlight Forum' },
    legal: { operatorName: 'Harborlight Forum (sample event)', supportEmail: 'help@example.test' }
  },
  theme: { preset: 'civic', mode: 'light' },
  features: { sessionBookmarks: true, attendeeDirectory: false, updates: false, icsExport: false, calendarSync: false, scheduleShare: false, schedulePdf: false }
};

function fixture() {
  const built = buildConfigDocs({ answers, tierA, now: () => Date.parse(FROZEN) });
  if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const config = built.docs;
  config.event.historicalDemo = false;
  config.theme.logos = {primary:null,mark:null,footer:null};
  config.bootstrap = {adminEmails:['avery@example.test'],staffEmails:['rowan@example.test']};
  const allowed = new Set(['home','schedule','speakers','sponsors']);
  const pages = defaultPages().filter(p => allowed.has(p.id)).map(p => ({...p,sections:p.id==='home'?p.sections.filter(s=>['hero','info','sponsors'].includes(s.id)):p.sections,visible:true,revision:1,seeded:true}));
  const text = {
    hero__title: { value: 'Good ideas need a place to meet.' },
    hero__subtitle: { value: 'Two days of listening, learning, and building useful things together.' },
    info__when: { label:'When',value:'May 13–14, 2027',note:'Two days. Room for new ideas.' },
    info__where: { label:'Where',value:'Harbor Hall',note:'Example City · Sample event' },
    info__where_transit: {text:'Come with a question. Leave with a next step.'},
    info__who: {label:'Who',value:'People who build things together',note:'Community organizers, makers, and curious minds.'},
    sponsors__lede: {value:'Supported by organizations that put people first.'},
  };
  const content = buildSeedContent({pages,docs:config,tierA,seededAt:FROZEN}).filter(x=>text[x.id]).map(x=>({...x,...text[x.id],visible:true,revision:1,publishedAt:FROZEN}));
  const speakers = [
    ['rowan-vale','Rowan','Vale','Harborlight Lab','Community researcher'],
    ['avery-lane','Avery','Lane','Openfield Studio','Workshop facilitator'],
    ['sage-ellis','Sage','Ellis','Common Ground Collective','Project lead'],
    ['robin-hale','Robin','Hale','Field Notes Cooperative','Editor']
  ].map(([slug,firstName,lastName,organization,jobTitle])=>({id:`speaker-${slug}`,slug,firstName,lastName,organization,jobTitle,bio:`${firstName} helps teams turn shared questions into practical work.`,status:'approved',email:null,uid:null,headshotPath:null,visible:true,socialHandles:{},revision:1}));
  const sessions = [
    ['welcome','09:00','09:30','Opening the conversation','keynote','A','forum',[speakers[0].id]],
    ['listening','10:00','11:00','Listening to your community','workshop','A','studio',[speakers[0].id,speakers[1].id]],
    ['making','11:15','12:15','From an idea to a useful prototype','workshop','B','forum',[speakers[2].id]],
    ['together','13:15','14:15','Building a practice that lasts','panel','B','studio',[speakers[3].id]],
  ].map(([id,startTime,endTime,title,type,track,placeId,speakerIds],order)=>({id:`session-${id}`,dayId:'day-1',startTime,endTime,title,type,track,placeId,location:placeId==='studio'?'The Studio':'The Forum',speakerIds,description:'Bring a question from your own work. Explore it with others, compare approaches, and leave with a practical next step.',visible:true,revision:1,order,seeded:true}));
  sessions.push({...sessions[2],id:'session-next',dayId:'day-2',title:'Make the next step together',startTime:'09:30',endTime:'10:30',order:0});
  const organizations = [
    {id:'org-openfield',name:'Openfield Studio',tier:'Community partners',description:'Space for people to turn ideas into shared work.'},
    {id:'org-common-ground',name:'Common Ground Collective',tier:'Community partners',description:'Practical support for projects that bring people together.'}
  ].map((o,order)=>({...o,order,visible:true,revision:1,logoPath:null,url:null}));
  return {config,pages,content,speakers,sessions,organizations,timeline:[]};
}
function snapshot() {const f=fixture();return {event:f.config.event,features:f.config.features,theme:f.config.theme,pages:f.pages,content:f.content,sessions:f.sessions,speakers:f.speakers.map(s=>({id:s.id,...buildPublicSpeaker(s)})),organizations:f.organizations,timeline:[]};}
module.exports={fixture,snapshot,answers,tierA,FROZEN};
