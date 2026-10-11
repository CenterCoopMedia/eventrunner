/* global document */
import test from 'node:test';import assert from 'node:assert/strict';import {chromium}from'@playwright/test';
import {knownNames,sanitize,secureContext,isLoopback}from'../capture/privacy.mjs';
test('only loopback capture requests pass',()=>{for(const url of ['http://127.0.0.1:5173/','http://localhost:4175/'])assert.ok(isLoopback(url));for(const url of ['https://example.test/','https://localhost.example.test/','file:///etc/passwd'])assert.equal(isLoopback(url),false);});
test('privacy guard replaces text, attributes, values and open shadow roots; fails closed on residue',async()=>{
 const browser=await chromium.launch({chromiumSandbox:true});try{const context=await browser.newContext();await secureContext(context);const page=await context.newPage();const name=knownNames[0];await page.setContent('<p></p><input><div id="shadow"></div>');await page.evaluate(name=>{document.querySelector('p').textContent=name;document.querySelector('input').value=name;document.querySelector('p').setAttribute('title',name);document.querySelector('#shadow').attachShadow({mode:'open'}).innerHTML='<span>'+name+'</span>';},name);await sanitize(page);assert.ok(!(await page.locator('body').innerText()).includes(name));assert.ok(!(await page.locator('input').inputValue()).includes(name));await page.locator('p').evaluate((e,n)=>e.setAttribute('data-unhandled',n),name);await assert.rejects(()=>sanitize(page),/Privacy guard refused/);await page.locator('p').evaluate(e=>e.setAttribute('data-unhandled','safe'));await page.evaluate(name=>document.querySelector('p').textContent=name.toUpperCase(),name);await assert.rejects(()=>sanitize(page),/Privacy guard refused/);
 }finally{await browser.close();}
});
test('privacy guard rejects unapproved images, shadow images and closed roots',async()=>{
 const browser=await chromium.launch({chromiumSandbox:true});
 try{
  const context=await browser.newContext();await secureContext(context);const page=await context.newPage();await page.goto('about:blank');
  await page.setContent('<div id="host"></div>');
  await page.locator('#host').evaluate(e=>{e.attachShadow({mode:'open'}).innerHTML='<div style="background-image:url(https://example.test/portrait.png)">Safe words</div>';});
  await assert.rejects(()=>sanitize(page),/unapproved image/);
  await page.setContent('<svg><image href="data:image/png;base64,AA==" /></svg>');
  await assert.rejects(()=>sanitize(page),/unapproved image/);
  await page.setContent('<div id="closed"></div>');await page.locator('#closed').evaluate(e=>e.attachShadow({mode:'closed'}));
  await assert.rejects(()=>sanitize(page),/closed shadow root/);
 }finally{await browser.close();}
});
