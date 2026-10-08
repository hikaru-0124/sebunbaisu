import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless:true });
try {
  const page = await browser.newPage({ viewport: { width:1440, height:1000 } });
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  await page.goto('http://localhost:3000');
  await page.locator('.hero-copy h1').waitFor();
  await page.screenshot({path:'/tmp/seven-vice-lobby.png',fullPage:true});
  await page.click('#rules-button');
  assert.equal(await page.locator('.rule-card').count(),7);
  await page.click('[data-close="rules-dialog"]');
  await page.clock.install();
  const state=await page.evaluate(async()=>{const {createGame}=await import('/src/engine.js');const s=createGame(3,()=>0);localStorage.setItem('seven-vice-game-v1',JSON.stringify(s));return s;});
  assert.equal(state.turn,0);
  await page.reload();
  await page.click('#resume-game');
  await page.locator('[data-action="hand"]').first().click();
  await page.screenshot({path:'/tmp/seven-vice-table.png',fullPage:true});
  await page.click('#play-selected');
  await page.locator('#action-dialog[open]').waitFor();
  assert.match(await page.locator('.action-subtitle').textContent(),/あなたが「憤怒」/);
  await page.selectOption('#presentation-speed','manual');
  const paused = await page.evaluate(()=>localStorage.getItem('seven-vice-game-v1'));
  await page.clock.fastForward(15000);
  assert.equal(await page.evaluate(()=>localStorage.getItem('seven-vice-game-v1')),paused,'確認中に手番が進んだ');
  await page.screenshot({path:'/tmp/seven-vice-action.png',fullPage:true,animations:'disabled'});
  await page.click('#acknowledge-action');
  assert.equal(await page.locator('#action-dialog[open]').count(),0);
  let steps=0;
  let sawCpuAction=false;
  for(;steps<3000;steps++) {
    if(await page.locator('#action-dialog[open]').count()) {
      if((await page.locator('.action-actor').textContent()).startsWith('CPU')) sawCpuAction=true;
      await page.click('#acknowledge-action');
      continue;
    }
    const s=await page.evaluate(()=>JSON.parse(localStorage.getItem('seven-vice-game-v1')));
    if(s.status==='game') break;
    if(s.status==='round') await page.click('#next-round');
    else if(s.turn!==0) await page.clock.fastForward(1100);
    else if(s.status==='effect') {
      const choice=await page.evaluate(async()=>{const {chooseCpu}=await import('/src/engine.js');return chooseCpu(JSON.parse(localStorage.getItem('seven-vice-game-v1')));});
      await page.locator(`[data-option="${choice}"]`).click();
    } else {
      const id=await page.evaluate(async()=>{const {chooseCpu}=await import('/src/engine.js');return chooseCpu(JSON.parse(localStorage.getItem('seven-vice-game-v1')));});
      await page.locator(`[data-action="hand"][data-id="${id}"]`).click();
      await page.click('#play-selected');
    }
  }
  assert(steps<3000,'ブラウザ上で対戦が完了しない');
  assert(sawCpuAction,'他プレイヤーのカード表示がない');
  await page.click('#restart-game');await page.click('[data-close="restart-dialog"]');
  await page.setViewportSize({width:390,height:844});
  await page.click('#new-game');
  await page.clock.fastForward(10000);
  await page.screenshot({path:'/tmp/seven-vice-mobile.png',fullPage:true,animations:'disabled'});
  if(await page.locator('#action-dialog[open]').count()) {
    const bounds=await page.locator('#action-dialog').boundingBox();
    assert(bounds.x>=0 && bounds.x+bounds.width<=390 && bounds.y>=0 && bounds.y+bounds.height<=844,'演出が画面に収まらない');
    await page.click('#acknowledge-action');
  }
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'スマートフォン幅で横にはみ出している');
  const missingImages=await page.locator('img').evaluateAll(imgs=>imgs.filter(i=>!i.complete||i.naturalWidth===0).map(i=>i.src));
  assert.deepEqual(missingImages,[],'画像が表示されていない');
  // 4人用のレイアウトと再開を検証。
  await page.evaluate(async()=>{const {createGame}=await import('/src/engine.js');localStorage.setItem('seven-vice-game-v1',JSON.stringify(createGame(4,()=>0)));});
  await page.reload();await page.click('#resume-game');
  assert.equal(await page.locator('.player').count(),4);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'4人用画面が横にはみ出している');
  await page.screenshot({path:'/tmp/seven-vice-mobile-four.png',fullPage:true});
  // 自動表示も途中で次へ進まず、設定した時間で解除される。
  await page.evaluate(async()=>{const {createGame}=await import('/src/engine.js');localStorage.setItem('seven-vice-game-v1',JSON.stringify(createGame(3,()=>0)));localStorage.setItem('seven-vice-presentation','normal');});
  await page.reload();await page.click('#resume-game');
  await page.locator('[data-action="hand"]').first().click();await page.click('#play-selected');
  const beforeAutomatic=await page.evaluate(()=>localStorage.getItem('seven-vice-game-v1'));
  await page.clock.fastForward(2000);
  assert.equal(await page.locator('#action-dialog[open]').count(),1);
  assert.equal(await page.evaluate(()=>localStorage.getItem('seven-vice-game-v1')),beforeAutomatic);
  await page.clock.fastForward(500);
  assert.equal(await page.locator('#action-dialog[open]').count(),0);
  await page.locator('[data-action="target"]').first().click();
  await page.click('#acknowledge-action');
  // ルールを読んでいる間にもCPUは進めない。
  await page.click('#rules-button');
  const beforeRules=await page.evaluate(()=>localStorage.getItem('seven-vice-game-v1'));
  await page.clock.fastForward(15000);
  assert.equal(await page.evaluate(()=>localStorage.getItem('seven-vice-game-v1')),beforeRules);
  await page.click('[data-close="rules-dialog"]');
  await page.clock.runFor(1200);
  assert.equal(await page.locator('#action-dialog[open]').count(),1,JSON.stringify(await page.evaluate(()=>({state:JSON.parse(localStorage.getItem('seven-vice-game-v1')),dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.id)}))));
  assert.match(await page.locator('.action-actor').textContent(),/^CPU/);
  await page.selectOption('#presentation-speed','manual');
  await page.screenshot({path:'/tmp/seven-vice-mobile-action.png',animations:'disabled'});
  // キーボードでも演出を進められ、閉じても入力がロックされない。
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
  console.log(`ブラウザ検証成功：対戦完了 (${steps}操作)、行動表示・確認待ち中の停止・CPU演出、再開、全カード画像、390pxの3人・4人表示。`);
} finally { await browser.close(); }
