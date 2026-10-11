import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {fixture,snapshot}=require('./fixture.cjs');
const {emitAll}=require('../../scripts/lib/emit.cjs');
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const GENERATED=process.env.GENERATED_DIR??path.join(os.tmpdir(),'eventrunner-video-generated');
export async function seed() {
  for(const [key,value] of Object.entries({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'})){
    if(process.env[key]&&process.env[key]!==value)throw new Error(`Refusing nonlocal ${key}`);
    process.env[key]=value;
  }
  const functionRequire=createRequire(path.join(ROOT,'functions/package.json'));
  const {initializeApp,getApps}=functionRequire('firebase-admin/app');
  const {getFirestore}=functionRequire('firebase-admin/firestore');
  const {getAuth}=functionRequire('firebase-admin/auth');
  const app=getApps()[0]??initializeApp({projectId:'demo-run-of-show'});
  const db=getFirestore(app); const auth=getAuth(app);
  const existing=await db.doc('config/event').get();
  if(existing.exists&&existing.data().name!=='Harborlight Forum')throw new Error('Existing emulator belongs to a different fixture; restart this task’s emulators.');
  const f=fixture();
  // Reset only our task-owned emulator. This is never a production cleanup path.
  for(const name of ['cmsContent_drafts','cmsPages_drafts','cmsSchedule_drafts','cmsOrganizations_drafts','bookmarks','auth_rate_limits','cmsVersions','cmsPublishQueue']){
    const docs=await db.collection(name).get();
    for(const doc of docs.docs)await doc.ref.delete();
  }
  const batch=db.batch();
  for(const [id,data] of Object.entries(f.config))batch.set(db.doc(`config/${id}`),data);
  for(const [collection,rows] of Object.entries({cmsPages:f.pages,cmsContent:f.content,cmsSchedule:f.sessions,cmsOrganizations:f.organizations,speakers:f.speakers})){
    for(const {id,...data} of rows)batch.set(db.doc(`${collection}/${id}`),data);
  }
  await batch.commit();
  for(const [uid,email,firstName,lastName,role] of [['video-operator','avery@example.test','Avery','Lane','admin'],['video-staff','rowan@example.test','Rowan','Vale','admin'],['video-attendee','sage@example.test','Sage','Ellis','attendee']]){
    try{await auth.getUser(uid);}catch{await auth.createUser({uid,email,emailVerified:true});}
    await db.doc(`users/${uid}`).set({email,firstName,lastName,displayName:`${firstName} ${lastName}`,role,registrationStatus:'approved',approvalSource:'admin',profileVisibility:'private',profileComplete:true,organization:'Harborlight Lab',badges:[],customBadges:[],socialHandles:{},createdAt:'2026-10-11T12:00:00.000Z'});
    const saved=await db.collection(`users/${uid}/bookmarks`).get();for(const d of saved.docs)await d.ref.delete();
  }
  fs.mkdirSync(GENERATED,{recursive:true});
  for(const [file,content] of Object.entries(emitAll(snapshot())))fs.writeFileSync(path.join(GENERATED,file),content);
  fs.mkdirSync(path.join(ROOT,'video/.cache'),{recursive:true});
  fs.writeFileSync(path.join(ROOT,'video/.cache/fixture.json'),JSON.stringify(f,null,2));
  console.log('Seeded fictional video fixture; complete snapshot:',GENERATED);
}
if(process.argv[1]===fileURLToPath(import.meta.url))await seed();
