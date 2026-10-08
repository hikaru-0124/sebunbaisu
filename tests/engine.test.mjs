import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, playCard, resolveEffect, nextRound, chooseCpu, points, typeOf } from '../src/engine.js';
import { describeEvent } from '../src/presentation.js';

function state(type, previous = null) {
  return { version: 1, players: [
    { name:'あなた', hand:[type * 5, 31], field:[], score:0 },
    { name:'CPU 1', hand:[6], field:[11], score:0 },
    { name:'CPU 2', hand:[7], field:[12,13,21,22], score:0 },
  ], deck:[32,33,34,1,2,3], turn:0, starter:0, round:1, status:'play', lastEffect:previous, pending:null, result:null, log:[] };
}
test('準備は35枚・非公開の初期手札と手番のドロー', () => {
  const s = createGame(4);
  assert.equal(s.deck.length, 30);
  assert.equal(s.players[s.turn].hand.length, 2);
  for (let i=0;i<4;i++) if (i !== s.turn) assert.equal(s.players[i].hand.length,1);
  assert.equal(new Set([...s.deck,...s.players.flatMap(p => p.hand)]).size,35);
  assert.throws(() => createGame(2));
});
test('憤怒は相手の手札を場へ・相手が補充・自分の手札を保持', () => {
  const s = state(0); playCard(s,0);
  assert.equal(s.status,'effect');
  resolveEffect(s,1);
  assert.deepEqual(s.players[0].field,[0,7]);
  assert.deepEqual(s.players[0].hand,[31]);
  assert.deepEqual(s.players[2].hand,[3]);
});
test('嫉妬は手札と相手の場を交換し、移動したカードの効果は発動しない', () => {
  const s=state(1);playCard(s,5);resolveEffect(s,0);
  assert.deepEqual(s.players[0].hand,[11]);
  assert.deepEqual(s.players[0].field,[5]);
  assert.deepEqual(s.players[1].field,[31]);
});
test('強欲は選んだ相手の場から1枚奪う', () => {
  const s=state(2);playCard(s,10);resolveEffect(s,0);
  assert.deepEqual(s.players[0].field,[10,11]);
  assert.deepEqual(s.players[1].field,[]);
});
test('傲慢の追加手番で怠惰を出すと傲慢をコピー', () => {
  const s=state(3);s.players[0].hand=[15,25];playCard(s,15);
  assert.equal(s.turn,0);assert.equal(s.players[0].hand.length,2);
  playCard(s,25);assert.equal(s.turn,0);assert.equal(s.lastEffect,3);
});
test('暴食は右隣から同種1〜2枚を選択する', () => {
  const s=state(4);playCard(s,20);
  assert(s.pending.options.every(o=>o.target===2));
  assert(s.pending.options.every(o=>o.ids.length<=2 && new Set(o.ids.map(typeOf)).size===1));
  const index=s.pending.options.findIndex(o=>o.ids.length===2 && typeOf(o.ids[0])===2);
  resolveEffect(s,index);assert.deepEqual(s.players[0].field,[20,12,13]);
});
test('色欲は山札の1枚を場に移し、その効果は使わない', () => {
  const s=state(6);s.players[0].hand=[30,26];playCard(s,30);
  assert.deepEqual(s.players[0].field,[30,3]);
  assert.equal(s.turn,1);assert.equal(s.lastEffect,6);
});
test('最初の怠惰は効果なし・連続する怠惰は元の効果を使う', () => {
  const s=state(5);playCard(s,25);assert.equal(s.lastEffect,null);assert.equal(s.turn,1);
  const copy=state(5,2);playCard(copy,25);assert.equal(copy.pending.effect,2);
  resolveEffect(copy,0);assert.equal(copy.lastEffect,2);
});
test('山札が尽きた憤怒は手札を奪い、補充を省略して続行', () => {
  const s=state(0);s.deck=[];playCard(s,0);resolveEffect(s,1);
  assert.deepEqual(s.players[2].hand,[]);assert.deepEqual(s.players[0].hand,[31]);
});
test('嫉妬は自分の手札が残っていなければ交換しない', () => {
  const s=state(1);s.deck=[];s.players[0].hand=[5];playCard(s,5);
  assert.equal(s.status,'play');assert.deepEqual(s.players[1].field,[11]);
});
test('得点条件・3点でゲーム終了・次の先手は得点者', () => {
  assert.equal(points([0,1,2,3]),1);assert.equal(points([0,5,10,15,20,25,30]),2);
  const s=state(0);s.players[0].field=[1,2,3];s.players[0].score=2;
  playCard(s,0);resolveEffect(s,0);assert.equal(s.status,'game');assert.equal(s.players[0].score,3);
  const round=state(0);round.players[0].field=[1,2,3];playCard(round,0);resolveEffect(round,0);
  assert.equal(round.status,'round');nextRound(round);assert.equal(round.turn,0);assert.equal(round.lastEffect,null);
});
test('嫉妬で相手のセットが完成した場合も相手が得点する', () => {
  const s=state(1);s.players[0].hand=[5,31];s.players[1].field=[30,32,33,11];
  playCard(s,5);resolveEffect(s,s.pending.options.findIndex(o=>o.ids[0]===11));
  assert.equal(s.result.winner,1);assert.equal(s.players[1].score,1);
});
test('全員の手札が尽きた場合は無得点でラウンドを終了', () => {
  const s=state(5);s.deck=[];s.players.forEach(p=>p.hand=[]);s.players[0].hand=[25];playCard(s,25);
  assert.equal(s.status,'round');assert.equal(s.result.winner,null);
});
test('100試合のCPU対戦：カードの保存・手札の上限・全試合の終了', () => {
  let seed=777;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let match=0;match<100;match++) {
    const s=createGame(match%2?3:4,random);
    let steps=0;
    while(s.status!=='game' && steps++<10000) {
      if(s.status==='round') nextRound(s,random);
      else if(s.status==='effect') resolveEffect(s,chooseCpu(s));
      else playCard(s,chooseCpu(s));
      const ids=[...s.deck,...s.players.flatMap(p=>[...p.hand,...p.field])];
      assert.equal(ids.length,35);assert.equal(new Set(ids).size,35);
      assert(s.players.every(p=>p.hand.length<=2));
    }
    assert.equal(s.status,'game',`試合${match}が終わらない`);
  }
});
test('演出イベントはカード提示から効果へ順番に生成・補充した手札は公開しない', () => {
  const s=state(0);playCard(s,0);
  assert.deepEqual(s.events,[{kind:'play',actor:0,type:0,effect:0}]);
  resolveEffect(s,1);
  assert.deepEqual(s.events,[{kind:'gain',actor:0,target:2,ids:[7],effect:0,refilled:true}]);
  assert(!JSON.stringify(s.events).includes('"ids":[3]'));
  assert.match(describeEvent(s.events[0],s.players).detail,/相手は山札から手札を補充/);
});
test('色欲の成功を対象なしと表示しない・コピー元と交換カードが分かる', () => {
  const s=state(6);s.players[0].hand=[30,26];playCard(s,30);
  assert.deepEqual(s.events.map(e=>e.kind),['play','gain']);
  assert(!s.log.some(l=>l.includes('対象がない')));
  const copy=state(5,3);playCard(copy,25);
  assert.match(describeEvent(copy.events[0],copy.players).detail,/傲慢.*コピー/);
  assert.deepEqual(copy.events.map(e=>e.kind),['play','extra']);
  const swap=state(1);playCard(swap,5);resolveEffect(swap,0);
  assert.deepEqual(swap.events.map(e=>e.kind),['swap']);
  const d=describeEvent(swap.events[0],swap.players);
  assert.match(d.detail,/あなたの手札「色欲」.*CPU 1の場/);
  assert.deepEqual(d.types,[6,2]);
});
