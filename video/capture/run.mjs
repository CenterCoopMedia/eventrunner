/* global document, scrollX, scrollY */
import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {secureContext,sanitize} from './privacy.mjs';
import {seed} from './seed.mjs';
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099';
process.env.E2E_MAIL_FILE??=fileURLToPath(new URL('../../e2e/.tmp/dev-mail.jsonl',import.meta.url));
const {signIn}=await import('../../e2e/helpers.mjs');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const requested=process.argv.includes('--format')?process.argv[process.argv.indexOf('--format')+1]:null;
const only=process.argv.includes('--piece')?process.argv[process.argv.indexOf('--piece')+1]:null;
const all=!only||only==='general-trailer';
const fixtureHash=crypto.createHash('sha256').update(fs.readFileSync(new URL('fixture.cjs',import.meta.url))).digest('hex');
const browser=await chromium.launch({chromiumSandbox:true});
try{
for(const format of requested?[requested]:['landscape','vertical']){
  await seed();
  const viewport=format==='landscape'?{width:1440,height:950}:{width:390,height:844};
  const out=path.join(root,'assets/captures',format);fs.mkdirSync(out,{recursive:true});
  const manifestPath=path.join(out,'boxes.json');
  const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{};
  async function account(email){
    const context=await browser.newContext({viewport,deviceScaleFactor:2,locale:'en-US',timezoneId:'America/New_York',reducedMotion:'reduce',serviceWorkers:'block',baseURL:'http://127.0.0.1:5173'});
    const blocked=await secureContext(context);const page=await context.newPage();page.setDefaultTimeout(15000);
    page.on('pageerror',e=>console.error('Page error:',e.message));
    if(email)await signIn(page,email);
    await page.clock.setFixedTime(new Date('2026-10-11T12:00:00Z'));
    async function stable(){
      await page.evaluate(()=>document.fonts.ready);
      await page.locator('[aria-busy="true"]').first().waitFor({state:'hidden',timeout:10000}).catch(()=>{});
      if(await page.getByRole('button',{name:'End tour',exact:true}).isVisible())await page.getByRole('button',{name:'End tour',exact:true}).click();
      await page.evaluate(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))));
      await page.waitForTimeout(160);
    }
    async function shot(name,targets={},focus=[]){
      await stable();await sanitize(page);
      if(blocked.some(url=>/firestore\.googleapis\.com|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/.test(url)))throw new Error('Firebase attempted a production endpoint; check VITE_USE_EMULATORS.');
      const boxes={};
      for(const [key,locator] of Object.entries(targets)){
        const box=await locator.boundingBox();if(!box)throw new Error(`Missing target ${name}/${key}`);boxes[key]=box;
      }
      if(targets.field){boxes.fieldPanel=await targets.field.locator('..').boundingBox();focus=['fieldPanel'];}
      if(name==='draft-hover')focus=['action','publish'];
      if(name==='publish-hover')focus=['draft','action'];
      if(name==='draft-saved'||name==='published'){
        const status=page.getByText(name==='draft-saved'?'Draft saved. It is not public until you publish.':'Published. The public site picks it up live.',{exact:true}).first();
        boxes.status=await status.evaluate(e=>{const range=document.createRange();range.selectNodeContents(e);const b=range.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height};});focus=['status'];
      }
      if(name==='style-before'||name==='style-chosen'){boxes.panel=await targets.style.locator('..').boundingBox();focus=['panel'];}
      const file=`${name}.png`;
      let imageViewport=viewport;
      if(targets.preview){const b=boxes.preview;await targets.preview.screenshot({path:path.join(out,file),animations:'disabled'});imageViewport={width:b.width,height:b.height};for(const [key,box]of Object.entries(boxes))boxes[key]={...box,x:box.x-b.x,y:box.y-b.y};boxes.preview={x:0,y:0,width:b.width,height:b.height};}
      else await page.screenshot({path:path.join(out,file),animations:'disabled'});
      manifest[name]={file,viewport:imageViewport,browserViewport:viewport,scale:2,route:page.url(),scroll:await page.evaluate(()=>({x:scrollX,y:scrollY})),boxes,focus,selectors:Object.fromEntries(Object.entries(targets).map(([k,l])=>[k,l.toString()])),fixtureHash,blockedRequests:[...new Set(blocked.map(u=>new URL(u).origin+new URL(u).pathname))]};
      fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));console.log(format,name);
    }
    async function press(name,locator,targets={},focus=[]){await locator.scrollIntoViewIfNeeded();await locator.hover();await shot(name,{...targets,action:locator},focus.length?focus:['action']);await locator.click();}
    async function nav(label){
      const menu=page.locator('summary').filter({hasText:'Menu'}).or(page.getByRole('button',{name:'Menu',exact:true})).filter({visible:true}).first();
      const menuName=label==='Branding'?'branding-menu':email==='sage@example.test'&&label==='Schedule'?'schedule-menu':`operator-${label.toLowerCase()}-menu`;
      if(format==='vertical'&&await menu.isVisible())await press(menuName,menu);
      let link=page.getByRole('navigation').getByRole('link',{name:label,exact:true}).first();
      if(!await link.isVisible()){
        if(await menu.isVisible())await press(menuName,menu);
        link=page.getByRole('link',{name:label,exact:true}).filter({visible:true}).first();
      }
      // The admin rail folds its groups (issue #477). A link inside a closed
      // group is hidden: open the group that holds it, then use the link.
      if(!await link.isVisible()){
        const folded=page.locator('.admin-docket-group[hidden] a').filter({hasText:new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`)}).first();
        const list=await folded.count()?await folded.evaluate((a)=>a.closest('ul').id):null;
        if(list){
          await page.locator(`[aria-controls="${list}"]`).filter({visible:true}).first().click();
          link=page.getByRole('link',{name:label,exact:true}).filter({visible:true}).first();
        }
      }
      return link;
    }
    return {context,page,shot,press,stable,nav};
  }
  if(all||only==='publish-page'){
    const {context,page,shot,press,stable}=await account('rowan@example.test');
    await page.goto('/');await expect(page.locator('article[data-cms-content-source="live"]')).toBeVisible();
    await shot('staff-home',{hero:page.locator('article section').first()},['hero']);
    const edit=page.getByRole('link',{name:'Edit section: Hero',exact:true}).first();
    await press('edit-section',edit,{hero:page.locator('article section').first()},['hero','action']);
    const block=page.getByRole('link',{name:'Good ideas need a place to meet.',exact:true});
    await expect(block).toBeVisible();await press('headline-list',block,{},['action']);
    const field=page.getByLabel('Text',{exact:true});await expect(field).toBeVisible();
    const draft=page.getByRole('button',{name:'Save draft',exact:true});const publish=page.getByRole('button',{name:'Save and publish',exact:true});
    await shot('editor-before',{field,draft,publish},['field','draft','publish']);
    await field.click();await field.press('ControlOrMeta+A');await field.press('Backspace');
    const text='A place to share practical ideas.';
    await shot('typing-00',{field,draft,publish},['field','draft','publish']);
    for(let i=0;i<text.length;i++){
      await field.pressSequentially(text[i]);
      await shot(`typing-${String(i+1).padStart(2,'0')}`,{field,draft,publish},['field','draft','publish']);
    }
    await press('draft-hover',draft,{field,publish},['field','action','publish']);
    await expect(page.getByText(/Draft saved/i).first()).toBeVisible();
    await shot('draft-saved',{field,draft,publish},['field','draft','publish']);
    const draftVisitor=await account(null);await draftVisitor.page.goto('/');
    await expect(draftVisitor.page.getByRole('heading',{name:'Good ideas need a place to meet.',exact:true})).toBeVisible();
    await draftVisitor.context.close();
    await press('publish-hover',publish,{field,draft},['field','draft','action']);
    await expect(page.getByText('Published. The public site picks it up live.',{exact:true}).first()).toBeVisible();
    await shot('published',{field,publish},['field','publish']);
    await page.goto('/');await expect(page.getByRole('heading',{name:text,exact:true})).toBeVisible();
    await stable();
    await shot('staff-result',{hero:page.locator('article section').first()},['hero']);
    await context.close();
    const visitor=await account(null);await visitor.page.goto('/');
    await expect(visitor.page.getByRole('heading',{name:text,exact:true})).toBeVisible();
    await visitor.shot('public-result',{hero:visitor.page.locator('article section').first()},['hero']);
    await visitor.context.close();
  }
  if(all||only==='save-schedule'){
    const {context,page,shot,press,nav,stable}=await account('sage@example.test');
    await page.goto('/');await expect(page.locator('article[data-cms-content-source="live"]')).toBeVisible();
    await shot('attendee-home',{hero:page.locator('article section').first()},['hero']);
    const schedule=await nav('Schedule');await press('schedule-nav',schedule);
    const day=page.getByRole('button',{name:'Day one',exact:true});
    await expect(day).toBeVisible();await press('day-select',day);
    const search=page.getByRole('searchbox',{name:'Search this day'});
    await expect(search).toBeVisible();await search.scrollIntoViewIfNeeded();
    await shot('schedule-before',{search,day},['search','day']);
    await search.click();
    for(let i=0;i<'Listening'.length;i++){
      await search.pressSequentially('Listening'[i]);
      await shot(`search-${i+1}`,{search},['search']);
    }
    const session=page.getByRole('link',{name:'Listening to your community',exact:true});
    await press('session-open',session);
    const sessionHeading=page.getByRole('heading',{name:'Listening to your community',exact:true});
    await expect(sessionHeading).toBeVisible();
    const bookmark=page.getByRole('button',{name:'Bookmark',exact:true}).first();
    await expect(bookmark).toBeVisible();
    const article=page.locator('main article').first();
    await stable();await article.evaluate(e=>e.scrollIntoView({block:'center'}));
    await press('bookmark-hover',bookmark,{session:sessionHeading,article},['article']);
    const saved=page.getByRole('button',{name:'Bookmarked',exact:true}).first();await expect(saved).toBeEnabled();
    await shot('bookmarked',{session:sessionHeading,saved,article},['article']);
    const back=page.getByRole('link',{name:/Back to the (schedule|program)/i});
    await press('back-to-schedule',back);
    const mine=page.getByRole('link',{name:'My schedule',exact:true});await press('my-schedule-nav',mine);
    await expect(page.getByRole('heading',{name:'My schedule',exact:true})).toBeVisible();
    await expect(session).toBeVisible();
    const resultHeader=article.locator(':scope > header');
    await resultHeader.evaluate(e=>e.scrollIntoView({block:'start'}));
    await shot('my-schedule',{header:resultHeader,session},['header','session']);
    await page.reload();await expect(session).toBeVisible();
    await resultHeader.evaluate(e=>e.scrollIntoView({block:'start'}));
    await shot('my-schedule-verified',{header:resultHeader,session},['header','session']);
    await context.close();
  }
  if(all||only==='change-style'){
    // Shared style shots keep the trailer's published headline regardless of
    // which documented capture command ran last. Establish it through the UI.
    const writer=await account('rowan@example.test');await writer.page.goto('/admin/content/home/hero/title');
    const headline=writer.page.getByLabel('Text',{exact:true});await expect(headline).toBeVisible();
    if(await headline.inputValue()!=='A place to share practical ideas.'){
      await headline.fill('A place to share practical ideas.');await writer.page.getByRole('button',{name:'Save and publish',exact:true}).click();
      await expect(writer.page.getByText('Published. The public site picks it up live.',{exact:true}).first()).toBeVisible();
    }
    await writer.context.close();
    const {context,page,shot,press,nav,stable}=await account('avery@example.test');
    await page.goto('/admin');await stable();
    await shot('operator-overview',{heading:page.getByRole('heading',{name:'Overview',exact:true})},['heading']);
    const branding=await nav('Branding');await press('branding-nav',branding);
    const pageStyle=page.getByRole('button',{name:'Page style',exact:true});await expect(pageStyle).toBeVisible();
    await press('page-style-nav',pageStyle);
    const style=page.getByLabel('Site style',{exact:true});await style.scrollIntoViewIfNeeded();
    await shot('style-before',{style},['style']);
    await style.selectOption('newsroom');
    await shot('style-chosen',{style},['style']);
    const previewPage=page.getByLabel('Page',{exact:true});
    const previewMode=page.getByLabel('Mode',{exact:true});
    const phone=page.getByRole('button',{name:'Phone',exact:true});
    const desktop=page.getByRole('button',{name:'Desktop',exact:true});
    async function preview(name,pageName,width,mode){
      const selector=`iframe[title="${pageName} preview, ${mode} mode, ${width}px wide"]`;
      const frame=page.locator(selector);
      await expect(frame).toBeVisible();
      await frame.scrollIntoViewIfNeeded();
      for(const f of page.frames())await f.evaluate(()=>document.fonts.ready);
      const inner=page.frameLocator(selector);
      const subject=pageName==='Home'?inner.locator('article section').first():inner.locator('.session-block__face').first().or(inner.locator('td').filter({has:inner.getByRole('link',{name:'Opening the conversation',exact:true})})).first();
      await subject.scrollIntoViewIfNeeded();
      await shot(name,{preview:frame,subject},['subject']);
    }
    await desktop.click();await previewMode.selectOption('light');
    await preview('preview-home','Home',1440,'light');
    await previewPage.scrollIntoViewIfNeeded();await previewPage.hover();
    await shot('preview-page-control',{action:previewPage},['action']);
    await previewPage.selectOption('schedule');
    await preview('preview-schedule','Schedule',1440,'light');
    await press('preview-phone-control',phone);
    await preview('preview-phone-light','Schedule',390,'light');
    await previewMode.scrollIntoViewIfNeeded();await previewMode.hover();
    await shot('preview-mode-control',{action:previewMode},['action']);
    await previewMode.selectOption('dark');
    await preview('preview-phone-dark','Schedule',390,'dark');
    await previewMode.selectOption('light');
    const heading=page.getByRole('heading',{name:'Branding',exact:true});await heading.scrollIntoViewIfNeeded();
    await page.getByRole('group',{name:'Branding tasks'}).scrollIntoViewIfNeeded();
    await expect(page.getByText(/This draft holds .* contrast failure/)).toHaveCount(0);
    await shot('theme-validation',{heading,tasks:page.getByRole('group',{name:'Branding tasks'})},['heading','tasks']);
    const publish=page.getByRole('button',{name:'Publish the theme',exact:true});await press('theme-publish-hover',publish);
    await expect(page.getByText('Theme published.',{exact:true})).toBeVisible();
    await shot('theme-published',{publish},['publish']);
    await page.goto('/');await expect(page.locator('article[data-cms-content-source="live"]')).toBeVisible();
    await shot('styled-home',{hero:page.locator('article section').first()},['hero']);
    const schedule=await nav('Schedule');await schedule.click();await expect(page.getByRole('heading',{name:/Schedule/}).first()).toBeVisible();
    const entry=page.locator('.session-block__face').first().or(page.locator('td').filter({has:page.getByRole('link',{name:'Opening the conversation',exact:true})}));
    await entry.first().scrollIntoViewIfNeeded();
    await shot('styled-schedule',{entry:entry.first()},['entry']);
    const speakers=await nav('Speakers');await speakers.click();await expect(page.getByRole('heading',{name:'Speakers',exact:true})).toBeVisible();
    const speaker=page.locator('main li').filter({has:page.getByRole('link',{name:'Avery Lane',exact:true})}).first();
    await speaker.scrollIntoViewIfNeeded();
    await shot('styled-speakers',{speaker},['speaker']);
    await context.close();
    const styledVisitor=await account(null);await styledVisitor.page.goto('/');
    await expect(styledVisitor.page.getByRole('heading',{name:'A place to share practical ideas.',exact:true})).toBeVisible();
    await expect(styledVisitor.page.getByRole('link',{name:/Edit section:/})).toHaveCount(0);
    await styledVisitor.shot('styled-public-home',{hero:styledVisitor.page.locator('article section').first()},['hero']);
    await styledVisitor.context.close();
  }
}
}finally{await browser.close();}
