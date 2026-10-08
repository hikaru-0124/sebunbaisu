import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Rooms} from '../scripts/rooms.mjs';
import {chooseCpu} from '../src/engine.js';

function setup(count=3,options={}) {
  const service=new Rooms({random:()=>0,...options});
  const sessions=[service.create({name:'ホスト',count})];
  for(let i=1;i<count;i++)sessions.push(service.join({code:sessions[0].code,name:`友人${i}`}));
  const view=i=>service.snapshot(sessions[i].code,sessions[i].token);
  const command=(i,action,payload={})=>service.command(sessions[i].code,sessions[i].token,{action,revision:view(i).revision,...payload});
  return {service,sessions,view,command};
}
test('作成・参加・定員・名前・認証・ホスト権限',()=>{
  const {service,sessions,command}=setup();
  assert.match(sessions[0].code,/^[A-F0-9]{6}$/);
  assert.throws(()=>service.create({name:'',count:3}));
  assert.throws(()=>service.create({name:'名前',count:2}));
  assert.throws(()=>service.join({code:sessions[0].code,name:'追加'}),/満員/);
  assert.throws(()=>service.snapshot(sessions[0].code,'偽の参加情報'),/無効/);
  assert.throws(()=>command(1,'start'),/作成者/);
  command(0,'start');
  assert.throws(()=>command(1,'play',{id:0}),/手番/);
  assert.throws(()=>command(0,'play',{id:20}),/手札にない/);
});
test('対戦状態は本人の手札だけを送る・山札の内容と他人の効果選択を送らない',()=>{
  const {view,command}=setup();command(0,'start');
  for(let i=0;i<3;i++){
    const s=view(i);
    assert(s.game.players[0].hand.every(Number.isInteger));
    assert(s.game.players.slice(1).every(p=>p.hand.every(id=>id===null)));
    assert(s.game.deck.every(id=>id===null));
    assert.equal(s.game.players[0].name,i===0?'ホスト':`友人${i}`);
  }
  command(0,'play',{id:0});
  assert(view(0).game.pending.options.every(o=>o.ids.every(id=>id===null)));
  assert.equal(view(1).game.pending,null);
  assert.equal(view(2).game.pending,null);
});
test('演出は全員の確認を待ち、重複操作・古い画面を拒否する',()=>{
  const {service,sessions,view,command}=setup();command(0,'start');
  const stale=view(0).revision;
  const played=command(0,'play',{id:0});
  assert(view(1).locked);
  assert.throws(()=>command(0,'effect',{option:0}),/確認/);
  command(0,'ack',{sequence:played.sequence});command(1,'ack',{sequence:played.sequence});
  assert(view(0).locked);command(2,'ack',{sequence:played.sequence});assert(!view(0).locked);
  assert.throws(()=>service.command(sessions[0].code,sessions[0].token,{action:'effect',option:0,revision:stale}),/最新/);
  const result=command(0,'effect',{option:0});
  command(0,'ack',{sequence:played.sequence});assert(view(0).ackNeeded,'古い演出への確認が新しい演出を解除した');
  for(let i=0;i<3;i++)command(i,'ack',{sequence:result.sequence});
  assert.equal(view(1).game.turn,0);
});
test('切断中は進行を止め、同じ参加情報で戻れる',()=>{
  let time=0;const {view,command}=setup(3,{now:()=>time});command(0,'start');
  time=16000;view(0);assert(!view(0).allConnected);
  assert.throws(()=>command(0,'play',{id:0}),/接続/);
  view(1);view(2);assert(view(0).allConnected);assert(!view(0).locked);
  command(0,'play',{id:0});
});
test('退出は対戦を終えて待機室へ戻す・ホスト退出時は次の人に引き継ぐ',()=>{
  const {view,command,service,sessions}=setup();command(0,'start');command(0,'leave');
  assert.equal(view(1).game,null);assert(view(1).host);assert.equal(view(1).members.length,2);
  service.join({code:sessions[1].code,name:'新しい友人'});command(1,'start');assert(view(1).game);
});
test('20試合の通信対戦：各席の相対表示と確認を通して勝敗まで到達',()=>{
  let seed=211;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let match=0;match<20;match++){
    const n=match%2?3:4,{service,sessions,view,command}=setup(n,{random});command(0,'start');
    let steps=0;
    while(view(0).game.status!=='game' && steps++<10000){
      const host=view(0);
      if(host.locked){for(let i=0;i<n;i++)command(i,'ack',{sequence:host.sequence});continue;}
      if(host.game.status==='round'){command(0,'next');continue;}
      const seat=host.game.turn,s=view(seat);
      assert.equal(s.game.turn,0);
      if(s.game.status==='effect')command(seat,'effect',{option:chooseCpu(s.game)});
      else command(seat,'play',{id:chooseCpu(s.game)});
      const g=service.room(sessions[0].code).game,ids=[...g.deck,...g.players.flatMap(p=>[...p.hand,...p.field])];
      assert.equal(ids.length,35);assert.equal(new Set(ids).size,35);
    }
    assert(steps<10000);assert(view(0).game.players.some(p=>p.score>=3));
    for(let i=0;i<n;i++)command(i,'ack',{sequence:view(i).sequence});
    command(0,'restart');assert(view(0).game.players.every(p=>p.score===0));
  }
});
