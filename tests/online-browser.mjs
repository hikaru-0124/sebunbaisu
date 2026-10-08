import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const pages=[],contexts=[],errors=[];
async function view(page){return page.evaluate(async()=>{const s=JSON.parse(sessionStorage.getItem('seven-vice-online'));return (await fetch(`/api/rooms/${s.code}`,{headers:{Authorization:`Bearer ${s.token}`}})).json();});}
async function acknowledgeAll(){
  for(let round=0;round<6;round++){
    let count=0;
    for(const page of pages){if(await page.locator('#action-dialog[open]').count()){await page.click('#acknowledge-action');count++;}}
    if(!count)break;
  }
  await expect.poll(async()=>(await view(pages[0])).locked).toBe(false);
}
try{
  for(let i=0;i<3;i++){
    const context=await browser.newContext({viewport:{width:i===2?390:1280,height:i===2?844:900}});contexts.push(context);
    await context.addInitScript(()=>localStorage.setItem('seven-vice-presentation','manual'));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));pages.push(page);
    await page.goto('http://localhost:3000');
  }
  await pages[0].fill('#online-name','ホスト');await pages[0].click('#online-create');
  await pages[0].locator('.room-code strong').waitFor();
  const code=(await pages[0].locator('.room-code strong').textContent()).trim();
  await pages[0].screenshot({path:'/tmp/seven-vice-online-room.png',fullPage:true});
  for(let i=1;i<3;i++){
    await pages[i].goto(`http://localhost:3000/?room=${code}`);
    assert.equal(await pages[i].inputValue('#room-code-input'),code);
    await pages[i].fill('#online-name',`友人${i}`);await pages[i].click('#online-join');
    await pages[i].locator('.room-code strong').waitFor();
  }
  await expect(pages[0].locator('#online-start')).toBeEnabled();
  await pages[0].click('#online-start');
  for(const page of pages)await page.locator('.game-layout').waitFor();
  const snapshots=await Promise.all(pages.map(view));
  for(const state of snapshots){assert(state.game.players[0].hand.every(Number.isInteger));assert(state.game.players.slice(1).every(p=>p.hand.every(id=>id===null)));assert(state.game.deck.every(id=>id===null));}
  let actor=snapshots[0].game.turn;
  await pages[actor].locator('[data-action="hand"]').first().click();await pages[actor].click('#play-selected');
  for(const page of pages)await page.locator('#action-dialog[open]').waitFor();
  const titles=await Promise.all(pages.map(p=>p.locator('.action-subtitle').textContent()));assert(titles.every(t=>t===titles[0]));
  await pages[2].screenshot({path:'/tmp/seven-vice-online-mobile-action.png',animations:'disabled'});
  await pages[0].click('#acknowledge-action');
  assert((await view(pages[0])).locked,'他の人の確認を待たずに進行した');
  await acknowledgeAll();
  // 再読み込みしても同じ席へ復帰し、手札を保持する。
  const beforeReload=await view(pages[1]);await pages[1].reload();await pages[1].locator('.game-layout').waitFor();
  const afterReload=await view(pages[1]);assert.equal(afterReload.seat,beforeReload.seat);assert.deepEqual(afterReload.game.players[0].hand,beforeReload.game.players[0].hand);
  // ネットワーク切断を表示し、復帰後に自動で続行できる。
  await contexts[2].setOffline(true);
  await expect(pages[2].locator('.network-error')).toBeVisible({timeout:12000});
  await contexts[2].setOffline(false);
  await expect(pages[2].locator('.network-error')).toHaveCount(0,{timeout:12000});
  // 全操作を3つの画面から実行し、結果まで同期する。
  let steps=0;
  for(;steps<1000;steps++){
    let host=await view(pages[0]);
    if(host.locked){for(const page of pages)if((await view(page)).ackNeeded)await page.locator('#action-dialog[open]').waitFor();await acknowledgeAll();continue;}
    if(host.game.status==='game')break;
    if(host.game.status==='round'){await expect(pages[0].locator('#next-round')).toBeVisible();await pages[0].click('#next-round');await expect.poll(async()=>(await view(pages[0])).game.round).toBe(host.game.round+1);continue;}
    actor=host.game.turn;
    const page=pages[actor],state=await view(page);
    const choice=await page.evaluate(async state=>{const {chooseCpu}=await import('/src/engine.js');return chooseCpu(state.game);},state);
    if(state.game.status==='effect'){
      await page.locator(`[data-action="target"][data-option="${choice}"]`).waitFor();await page.click(`[data-action="target"][data-option="${choice}"]`);
    }else{
      await expect(page.locator(`[data-action="hand"][data-id="${choice}"]`)).toBeEnabled();await page.click(`[data-action="hand"][data-id="${choice}"]`);await page.click('#play-selected');
    }
    await expect.poll(async()=>(await view(pages[0])).sequence).toBeGreaterThan(host.sequence);
    for(const player of pages)await player.locator('#action-dialog[open]').waitFor();
    await acknowledgeAll();
    if(steps%15===0)console.log(`通信対戦の画面検証：${steps+1}操作完了`);
  }
  assert(steps<1000);
  const finals=await Promise.all(pages.map(view));assert(finals.every(s=>s.game.status==='game'));
  const winners=finals.map(s=>s.game.players[s.game.result.winner].name);assert(winners.every(n=>n===winners[0]));
  await pages[0].screenshot({path:'/tmp/seven-vice-online-result.png',fullPage:true});
  await expect(pages[0].locator('#new-game')).toBeVisible();await pages[0].click('#new-game');
  await expect.poll(async()=>(await view(pages[0])).game.players.every(p=>p.score===0)).toBe(true);
  await pages[2].click('#leave-room');await pages[2].click('#confirm-leave');
  await pages[2].locator('.online-setup').waitFor();
  await pages[0].locator('.room-code strong').waitFor();assert.equal((await view(pages[0])).game,null);
  assert.deepEqual(errors,[]);
  console.log(`通信ブラウザ検証成功：3端末で参加・非公開手札・演出同期・全員の確認・再読み込み・切断復帰・${steps}操作で対戦完了・再戦・退出。`);
}finally{for(const context of contexts)await context.close();await browser.close();}
